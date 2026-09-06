import { useSettingsStore } from '../stores/settings'
import type {
  BangumiMe,
  CalendarDay,
  Episode,
  Paged,
  SearchResponse,
  SubjectCharacter,
  SubjectDetail,
  SubjectPerson,
  UserSubjectCollection,
} from '../types/bangumi'

const DEFAULT_BASE = 'https://api.bgm.tv'
const TIMEOUT_MS = 15000

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface CacheEntry<T> {
  at: number
  data: T
}

function createTtlCache<T>(ttlMs: number) {
  const map = new Map<string, CacheEntry<T>>()
  return {
    get(key: string): T | undefined {
      const hit = map.get(key)
      if (hit && Date.now() - hit.at < ttlMs) return hit.data
      return undefined
    },
    set(key: string, data: T) {
      map.set(key, { at: Date.now(), data })
    },
    clear() {
      map.clear()
    },
  }
}

const CALENDAR_TTL = 5 * 60 * 1000
const SUBJECT_TTL = 10 * 60 * 1000
const SUB_RESOURCE_TTL = 30 * 60 * 1000

const calendarCache = createTtlCache<CalendarDay[]>(CALENDAR_TTL)
const subjectCache = createTtlCache<SubjectDetail>(SUBJECT_TTL)
const charactersCache = createTtlCache<SubjectCharacter[]>(SUB_RESOURCE_TTL)
const personsCache = createTtlCache<SubjectPerson[]>(SUB_RESOURCE_TTL)
const episodesCache = createTtlCache<Episode[]>(SUB_RESOURCE_TTL)

function baseUrl(): string {
  const s = useSettingsStore()
  return (s.apiBaseUrl || DEFAULT_BASE).replace(/\/+$/, '')
}

async function doFetch<T>(path: string, init: RequestInit | undefined, token: string | undefined): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(baseUrl() + path, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status} ${res.statusText}`)
  // 204 或空响应体（部分写接口返回 200 + 空 body）均视为无内容
  const text = await res.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError(res.status, '响应不是有效的 JSON')
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const s = useSettingsStore()
  const token = s.accessToken.trim()
  // legacy 端点（如 /calendar）的 CORS 预检不允许 Authorization 头，仅对 /v0/* 发送
  const sendAuth = !!token && path.startsWith('/v0/')
  try {
    return await doFetch<T>(path, init, sendAuth ? token : undefined)
  } catch (e) {
    // Token 失效（401）时自动降级为匿名访问，避免无效 Token 连累可用接口
    if (sendAuth && e instanceof ApiError && e.status === 401) {
      console.warn('[AnimeViewer] Access Token 无效（401），本次请求已降级为匿名访问')
      return doFetch<T>(path, init, undefined)
    }
    throw e
  }
}

export const bangumiApi = {
  async calendar(force = false): Promise<CalendarDay[]> {
    if (!force) {
      const cached = calendarCache.get('all')
      if (cached) return cached
    }
    const data = await request<CalendarDay[]>('/calendar')
    calendarCache.set('all', data)
    return data
  },
  async subject(id: number): Promise<SubjectDetail> {
    const cached = subjectCache.get(String(id))
    if (cached) return cached
    const data = await request<SubjectDetail>(`/v0/subjects/${id}`)
    subjectCache.set(String(id), data)
    return data
  },
  async characters(id: number): Promise<SubjectCharacter[]> {
    const cached = charactersCache.get(String(id))
    if (cached) return cached
    const data = await request<SubjectCharacter[]>(`/v0/subjects/${id}/characters`)
    charactersCache.set(String(id), data)
    return data
  },
  async persons(id: number): Promise<SubjectPerson[]> {
    const cached = personsCache.get(String(id))
    if (cached) return cached
    const data = await request<SubjectPerson[]>(`/v0/subjects/${id}/persons`)
    personsCache.set(String(id), data)
    return data
  },
  async episodes(subjectId: number): Promise<Episode[]> {
    const cached = episodesCache.get(String(subjectId))
    if (cached) return cached
    const res = await request<Paged<Episode> | Episode[]>(`/v0/episodes?subject_id=${subjectId}`)
    const data = Array.isArray(res) ? res : (res.data ?? [])
    episodesCache.set(String(subjectId), data)
    return data
  },
  me(): Promise<BangumiMe> {
    return request<BangumiMe>('/v0/me')
  },
  /** 分页拉取当前用户的动画收藏（需 Token；type 筛选在服务端做） */
  userCollections(username: string, offset = 0, limit = 50): Promise<Paged<UserSubjectCollection>> {
    return request<Paged<UserSubjectCollection>>(
      `/v0/users/${encodeURIComponent(username)}/collections?subject_type=2&limit=${limit}&offset=${offset}`,
    )
  },
  /** 新增或修改收藏状态（upsert）：type 1=想看 2=看过 3=在看 */
  upsertCollection(subjectId: number, type: 1 | 2 | 3): Promise<void> {
    return request<void>(`/v0/users/-/collections/${subjectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    })
  },
  /** 批量标记单集收藏状态：type 2=看过 0=未看；服务端会重算条目完成度 */
  markEpisodes(subjectId: number, episodeIds: number[], type: 0 | 2): Promise<void> {
    return request<void>(`/v0/users/-/collections/${subjectId}/episodes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episode_id: episodeIds, type }),
    })
  },
  search(keyword: string, tags: string[], sort: string, limit = 24, offset = 0): Promise<SearchResponse> {
    // R18 开关统一控制：隐藏时只返回非 R18；显示时不传该字段（返回全部，能否看到 R18 取决于 Bangumi 鉴权）
    const filter: Record<string, unknown> = { type: [2] }
    if (useSettingsStore().hideNsfw) filter.nsfw = false
    if (tags.length) filter.tag = tags
    // 注意：limit/offset 是 query 参数（不在请求体里，放 body 会被忽略导致分页失效）；sort 在请求体里
    return request<SearchResponse>(`/v0/search/subjects?limit=${limit}&offset=${offset}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, filter, sort }),
    })
  },
}

export function clearApiCache() {
  calendarCache.clear()
  subjectCache.clear()
  charactersCache.clear()
  personsCache.clear()
  episodesCache.clear()
}
