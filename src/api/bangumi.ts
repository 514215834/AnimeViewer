import { useSettingsStore } from '../stores/settings'
import type {
  BangumiMe,
  CalendarDay,
  CharacterDetail,
  CharacterPerson,
  CharacterSearchItem,
  Episode,
  EpisodeMarkType,
  IndexInfo,
  IndexSubjectItem,
  Paged,
  PersonDetail,
  PersonSearchItem,
  RelatedSubject,
  SearchResponse,
  SearchResultItem,
  StaffWork,
  SubjectCharacter,
  SubjectDetail,
  SubjectPerson,
  UserCharacterCollection,
  UserEpisodeCollection,
  UserProfile,
  UserPersonCollection,
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
const relatedCache = createTtlCache<RelatedSubject[]>(SUB_RESOURCE_TTL)
const characterCache = createTtlCache<CharacterDetail>(SUBJECT_TTL)
const personCache = createTtlCache<PersonDetail>(SUBJECT_TTL)
const characterWorksCache = createTtlCache<StaffWork[]>(SUB_RESOURCE_TTL)
const personWorksCache = createTtlCache<StaffWork[]>(SUB_RESOURCE_TTL)
const characterPersonsCache = createTtlCache<CharacterPerson[]>(SUB_RESOURCE_TTL)

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
  /** 新增或修改收藏状态（upsert）：type 1=想看 2=看过 3=在看；
   *  F6 私有评分与笔记：rate（0-10，0=删除评分）/comment/private（仅自己可见）均可选，未定义字段不动云端现状 */
  upsertCollection(
    subjectId: number,
    type: 1 | 2 | 3,
    review?: { rate?: number; comment?: string; isPrivate?: boolean },
  ): Promise<void> {
    const body: Record<string, unknown> = { type }
    if (review?.rate !== undefined) body.rate = review.rate
    if (review?.comment !== undefined) body.comment = review.comment
    if (review?.isPrivate !== undefined) body.private = review.isPrivate
    return request<void>(`/v0/users/-/collections/${subjectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
  /** E1 单集增量标记（沉浸观剧）：type 2=看过 0=未看；条目未收藏时返回 400，由调用方先 upsert 再重试 */
  putEpisodeMark(episodeId: number, type: EpisodeMarkType): Promise<void> {
    return request<void>(`/v0/users/-/collections/-/episodes/${episodeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    })
  },
  /** E1 读取单集收藏状态 */
  getEpisodeMark(episodeId: number): Promise<{ type?: EpisodeMarkType }> {
    return request<{ type?: EpisodeMarkType }>(`/v0/users/-/collections/-/episodes/${episodeId}`)
  },
  /** F1 拉取条目的云端单集收藏状态（正篇 type=0；limit≤1000 一页覆盖常规正篇集数） */
  async userSubjectEpisodes(subjectId: number): Promise<UserEpisodeCollection[]> {
    const res = await request<Paged<UserEpisodeCollection>>(
      `/v0/users/-/collections/${subjectId}/episodes?episode_type=0&limit=1000&offset=0`,
    )
    return res.data ?? []
  },
  /** E2 获取单个条目的云端收藏（冲突比对 / 推送后回读真实 updated_at） */
  userCollection(username: string, subjectId: number): Promise<UserSubjectCollection> {
    return request<UserSubjectCollection>(
      `/v0/users/${encodeURIComponent(username)}/collections/${subjectId}`,
    )
  },
  /** E3 角色详情 */
  async characterDetail(id: number): Promise<CharacterDetail> {
    const cached = characterCache.get(String(id))
    if (cached) return cached
    const data = await request<CharacterDetail>(`/v0/characters/${id}`)
    characterCache.set(String(id), data)
    return data
  },
  /** E3 人物详情 */
  async personDetail(id: number): Promise<PersonDetail> {
    const cached = personCache.get(String(id))
    if (cached) return cached
    const data = await request<PersonDetail>(`/v0/persons/${id}`)
    personCache.set(String(id), data)
    return data
  },
  /** E3 角色参与的作品（image 为单个 URL 字符串） */
  async characterSubjects(id: number): Promise<StaffWork[]> {
    const cached = characterWorksCache.get(String(id))
    if (cached) return cached
    const data = await request<StaffWork[]>(`/v0/characters/${id}/subjects`)
    characterWorksCache.set(String(id), data)
    return data
  },
  /** E3/E4 人物参与的作品 */
  async personSubjects(id: number): Promise<StaffWork[]> {
    const cached = personWorksCache.get(String(id))
    if (cached) return cached
    const data = await request<StaffWork[]>(`/v0/persons/${id}/subjects`)
    personWorksCache.set(String(id), data)
    return data
  },
  /** F3 角色关联声优（每项含所属作品与 staff 身份，点击可跳人物页） */
  async characterPersons(id: number): Promise<CharacterPerson[]> {
    const cached = characterPersonsCache.get(String(id))
    if (cached) return cached
    const data = await request<CharacterPerson[]>(`/v0/characters/${id}/persons`)
    characterPersonsCache.set(String(id), data)
    return data
  },
  /** E5 用户资料（含头像/签名） */
  userProfile(username: string): Promise<UserProfile> {
    return request<UserProfile>(`/v0/users/${encodeURIComponent(username)}`)
  },
  /** E6 收藏角色（需 write:collection 授权） */
  collectCharacter(characterId: number): Promise<void> {
    return request<void>(`/v0/characters/${characterId}/collect`, { method: 'POST' })
  },
  /** E6 取消收藏角色：规范已声明但服务端实测未实现（404 路由未注册），调用失败时须回滚本地状态 */
  uncollectCharacter(characterId: number): Promise<void> {
    return request<void>(`/v0/characters/${characterId}/collect`, { method: 'DELETE' })
  },
  /** E6 分页拉取当前用户收藏的角色列表（列表项自带名称与头像） */
  myCharacterCollections(username: string, offset = 0, limit = 100): Promise<Paged<UserCharacterCollection>> {
    return request<Paged<UserCharacterCollection>>(
      `/v0/users/${encodeURIComponent(username)}/collections/-/characters?limit=${limit}&offset=${offset}`,
    )
  },
  /** F2 收藏人物（需 write:collection 授权；取消收藏端点 DELETE 实测未实现，仅支持收藏） */
  collectPerson(personId: number): Promise<void> {
    return request<void>(`/v0/persons/${personId}/collect`, { method: 'POST' })
  },
  /** F2 分页拉取当前用户收藏的人物列表（列表项自带名称/头像/career） */
  myPersonCollections(username: string, offset = 0, limit = 100): Promise<Paged<UserPersonCollection>> {
    return request<Paged<UserPersonCollection>>(
      `/v0/users/${encodeURIComponent(username)}/collections/-/persons?limit=${limit}&offset=${offset}`,
    )
  },
  search(keyword: string, tags: string[], sort: string, limit = 24, offset = 0, advanced?: SearchAdvanced): Promise<SearchResponse> {
    // R18 开关统一控制：隐藏时只返回非 R18；显示时不传该字段（返回全部，能否看到 R18 取决于 Bangumi 鉴权）
    const filter: Record<string, unknown> = { type: [2] }
    if (useSettingsStore().hideNsfw) filter.nsfw = false
    if (tags.length) filter.tag = tags
    // D3 高级筛选：air_date/rating/rating_count/rank，比较表达式为字符串（如 ">=2024-01-01"），多值「且」
    if (advanced) {
      const airDate: string[] = []
      if (advanced.airDateFrom) airDate.push(`>=${advanced.airDateFrom}`)
      // 实测：air_date 的 <= 表达式服务端恒匹配 0 条（官方示例亦只用 >= 与 <），上限一律用 < 表达
      if (advanced.airDateTo) airDate.push(`<${advanced.airDateTo}`)
      if (airDate.length) filter.air_date = airDate
      const rating: string[] = []
      if (advanced.ratingMin !== undefined) rating.push(`>=${advanced.ratingMin}`)
      if (advanced.ratingMax !== undefined) rating.push(`<=${advanced.ratingMax}`)
      if (rating.length) filter.rating = rating
      const ratingCount: string[] = []
      if (advanced.ratingCountMin !== undefined) ratingCount.push(`>=${advanced.ratingCountMin}`)
      if (advanced.ratingCountMax !== undefined) ratingCount.push(`<=${advanced.ratingCountMax}`)
      if (ratingCount.length) filter.rating_count = ratingCount
      if (advanced.rankMax !== undefined) filter.rank = [`<=${advanced.rankMax}`]
    }
    // 注意：limit/offset 是 query 参数（不在请求体里，放 body 会被忽略导致分页失效）；sort 在请求体里
    return request<SearchResponse>(`/v0/search/subjects?limit=${limit}&offset=${offset}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, filter, sort }),
    })
  },
  /** D1 按年代浏览条目（官方注明第一页缓存 24h；结果项含 nsfw 字段可直接过滤） */
  browseSubjects(opts: { year: number; month?: number; sort?: 'date' | 'rank'; limit?: number; offset?: number }): Promise<Paged<SearchResultItem>> {
    const p = new URLSearchParams({ type: '2' })
    p.set('year', String(opts.year))
    if (opts.month) p.set('month', String(opts.month))
    if (opts.sort) p.set('sort', opts.sort)
    p.set('limit', String(opts.limit ?? 24))
    p.set('offset', String(opts.offset ?? 0))
    return request<Paged<SearchResultItem>>(`/v0/subjects?${p.toString()}`)
  },
  /** D2 关联条目（前传/续集/主线/番外等，relation 为开放式中文名） */
  async relatedSubjects(id: number): Promise<RelatedSubject[]> {
    const cached = relatedCache.get(String(id))
    if (cached) return cached
    const data = await request<RelatedSubject[]>(`/v0/subjects/${id}/subjects`)
    relatedCache.set(String(id), data)
    return data
  },
  /** D5 按 ID 查看目录（官方 v0 无目录列表端点，仅支持按 ID 查看） */
  index(id: number): Promise<IndexInfo> {
    return request<IndexInfo>(`/v0/indices/${id}`)
  },
  indexSubjects(id: number, limit = 30, offset = 0): Promise<Paged<IndexSubjectItem>> {
    return request<Paged<IndexSubjectItem>>(`/v0/indices/${id}/subjects?limit=${limit}&offset=${offset}`)
  },
  /** D6 角色/人物搜索（实验性接口；keyword 必填） */
  searchCharacters(keyword: string, limit = 24, offset = 0): Promise<Paged<CharacterSearchItem>> {
    return request<Paged<CharacterSearchItem>>(`/v0/search/characters?limit=${limit}&offset=${offset}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword }),
    })
  },
  searchPersons(keyword: string, limit = 24, offset = 0): Promise<Paged<PersonSearchItem>> {
    return request<Paged<PersonSearchItem>>(`/v0/search/persons?limit=${limit}&offset=${offset}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword }),
    })
  },
}

/** D3 高级筛选参数（映射为搜索接口的 filter 比较表达式） */
export interface SearchAdvanced {
  /** 开播日期下限（含），YYYY-MM-DD */
  airDateFrom?: string
  /** 开播日期上限（不含），YYYY-MM-DD —— air_date 的 <= 服务端不支持，统一用 < 表达 */
  airDateTo?: string
  ratingMin?: number
  ratingMax?: number
  ratingCountMin?: number
  ratingCountMax?: number
  rankMax?: number
}

export function clearApiCache() {
  calendarCache.clear()
  subjectCache.clear()
  charactersCache.clear()
  personsCache.clear()
  episodesCache.clear()
  relatedCache.clear()
  characterCache.clear()
  personCache.clear()
  characterWorksCache.clear()
  personWorksCache.clear()
  characterPersonsCache.clear()
}
