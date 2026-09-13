/** v0.14 S5 AnimeViewerService 前端客户端：
 *  媒体库状态 / 目录与扫描 / 文件匹配 / Bangumi 查询代理 / 流地址构造。
 *  纯函数部分（buildStreamUrl / servicePositionId / isDirectExt）供单测；
 *  fetch 失败统一归一为 ServiceError（不可达 / 未授权 / 服务端错误），视图层只看 message。 */

import { useSettingsStore } from '../stores/settings'

/* ── 类型（与服务端 Dtos.java 一一对应）── */

export interface SvcHealth {
  name: string
  version: string
  ffmpeg: boolean
  ffprobe: boolean
}

export interface SvcScanStatus {
  running: boolean
  phase: string
  scanned: number
  added: number
  updated: number
  removed: number
  matched: number
  failed: number
  currentPath?: string
  startedAt?: number
  finishedAt?: number
  lastError?: string
  /** 匹配阶段进度（matchTotal=本轮待匹配数，matchDone=已处理数） */
  matchTotal: number
  matchDone: number
}

export interface SvcStatus {
  version: string
  ffmpeg: boolean
  ffprobe: boolean
  directories: number
  files: number
  bound: number
  pending: number
  unmatched: number
  scan: SvcScanStatus
}

export interface SvcDirectory {
  id: number
  path: string
  enabled: boolean
  fileCount: number
  createdAt?: number
}

export type SvcMatchState = 'unmatched' | 'pending' | 'bound'

export interface SvcFile {
  id: number
  dirId: number
  path: string
  name: string
  ext: string
  size: number
  mtime: number
  durationSec?: number
  container?: string
  vcodec?: string
  acodec?: string
  width?: number
  height?: number
  parsedTitle?: string
  parsedEpisode?: number
  matchState: SvcMatchState
  subjectId?: number
  subjectName?: string
  subjectNameCn?: string
  episodeSort?: number
  autoBound: boolean
  matchedAt?: number
  probedAt?: number
  error?: string
}

export interface SvcPage<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface SvcSubjectFile {
  fileId: number
  sort: number
  name: string
  durationSec?: number
  ext: string
  direct: boolean
}

export interface SvcBangumiSubject {
  subjectId: number
  name?: string
  nameCn?: string
  date?: string
  image?: string
}

export interface SvcBangumiEpisode {
  episodeId: number
  sort: number
  type: number
  name?: string
  nameCn?: string
}

export interface SvcMatchOutcome {
  state: SvcMatchState
  subjectId?: number
  subjectName?: string
  subjectNameCn?: string
  exact: boolean
  message?: string
}

/* ── 纯函数（供单测）── */

/** 浏览器原生可随机访问的容器（其余走服务端 ffmpeg 转封装 + seek 重拉） */
export const DIRECT_EXTS = ['mp4', 'm4v', 'webm']

export function isDirectExt(ext?: string | null): boolean {
  return !!ext && DIRECT_EXTS.includes(ext.toLowerCase())
}

/** 服务流地址：<video> 无法带自定义请求头，Token 走查询参数（局域网个人服务，可接受） */
export function buildStreamUrl(baseUrl: string, token: string, fileId: number, t?: number): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  const qs = new URLSearchParams({ token })
  if (t && t > 0) qs.set('t', String(Math.floor(t)))
  return `${base}/api/stream/${fileId}?${qs.toString()}`
}

/** 服务播放的进度标识：按「条目 + 话数」记忆（同一集换绑/重扫文件后进度不丢） */
export function servicePositionId(subjectId: number, sort: number): string {
  return `svc:${subjectId}:${sort}`
}

/* ── 错误归一 ── */

export class ServiceError extends Error {
  kind: 'unreachable' | 'unauthorized' | 'server' | 'busy'

  constructor(kind: ServiceError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

/* ── 客户端 ── */

function baseOf(): string {
  return useSettingsStore().svcUrl.trim().replace(/\/+$/, '')
}

function configured(): boolean {
  return useSettingsStore().svcEnabled
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 10000): Promise<T> {
  if (!configured()) throw new ServiceError('unreachable', '媒体服务未配置')
  const { svcToken } = useSettingsStore()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(baseOf() + path, {
      ...init,
      signal: ctrl.signal,
      headers: { 'X-AV-Token': svcToken, ...(init?.headers ?? {}) },
    })
    if (res.status === 401) throw new ServiceError('unauthorized', '媒体服务 Token 不正确')
    if (res.status === 409) throw new ServiceError('busy', '扫描正在进行中')
    if (!res.ok) {
      let msg = `服务错误（HTTP ${res.status}）`
      try {
        const body = (await res.json()) as { message?: string }
        if (body?.message) msg = body.message
      } catch {
        /* 非 JSON 错误体 */
      }
      throw new ServiceError('server', msg)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  } catch (e) {
    if (e instanceof ServiceError) throw e
    throw new ServiceError('unreachable', '媒体服务不可达（请确认服务已启动且地址正确）')
  } finally {
    clearTimeout(timer)
  }
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export const mediaService = {
  configured,

  /** 免 Token 健康检查（连接测试第一步） */
  health(): Promise<SvcHealth> {
    if (!useSettingsStore().svcUrl.trim()) {
      return Promise.reject(new ServiceError('unreachable', '媒体服务未配置'))
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    return fetch(`${baseOf()}/api/health`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new ServiceError('server', `服务异常（HTTP ${r.status}）`)
        return r.json() as Promise<SvcHealth>
      })
      .catch((e) => {
        if (e instanceof ServiceError) throw e
        throw new ServiceError('unreachable', '媒体服务不可达（请确认服务已启动且地址正确）')
      })
      .finally(() => clearTimeout(timer))
  },

  status(): Promise<SvcStatus> {
    return request<SvcStatus>('/api/status')
  },
  directories(): Promise<SvcDirectory[]> {
    return request<SvcDirectory[]>('/api/directories')
  },
  addDirectory(path: string): Promise<void> {
    return post<void>('/api/directories', { path })
  },
  removeDirectory(id: number): Promise<void> {
    return request<void>(`/api/directories/${id}`, { method: 'DELETE' })
  },
  scan(full = false): Promise<void> {
    return post<void>('/api/scan', { full })
  },
  scanStatus(): Promise<SvcScanStatus> {
    return request<SvcScanStatus>('/api/scan/status')
  },
  files(params: { dirId?: number; state?: string; q?: string; limit?: number; offset?: number } = {}): Promise<SvcPage<SvcFile>> {
    const qs = new URLSearchParams()
    if (params.dirId) qs.set('dirId', String(params.dirId))
    if (params.state) qs.set('state', params.state)
    if (params.q) qs.set('q', params.q)
    qs.set('limit', String(params.limit ?? 50))
    qs.set('offset', String(params.offset ?? 0))
    return request<SvcPage<SvcFile>>(`/api/files?${qs.toString()}`)
  },
  fileDetail(id: number): Promise<SvcFile> {
    return request<SvcFile>(`/api/files/${id}`)
  },
  match(fileId: number, subjectId: number, sort: number): Promise<void> {
    return post<void>(`/api/files/${fileId}/match`, { subjectId, sort })
  },
  unbind(fileId: number): Promise<void> {
    return post<void>(`/api/files/${fileId}/unbind`)
  },
  rematch(fileId: number): Promise<SvcMatchOutcome> {
    return post<SvcMatchOutcome>(`/api/files/${fileId}/rematch`)
  },
  /** 某条目已绑定的文件（详情页剧集 Tab 播放按钮） */
  subjectFiles(subjectId: number): Promise<SvcSubjectFile[]> {
    return request<SvcSubjectFile[]>(`/api/subjects/${subjectId}/files`)
  },
  /** 人工改绑：Bangumi 搜索 / 剧集列表（服务端直连） */
  bangumiSearch(kw: string): Promise<SvcBangumiSubject[]> {
    return request<{ list: SvcBangumiSubject[] }>(`/api/bangumi/search?kw=${encodeURIComponent(kw)}`).then((r) => r.list)
  },
  bangumiEpisodes(subjectId: number): Promise<SvcBangumiEpisode[]> {
    return request<{ list: SvcBangumiEpisode[] }>(`/api/bangumi/subjects/${subjectId}/episodes`).then((r) => r.list)
  },

  streamUrl(fileId: number, t?: number): string {
    const { svcUrl, svcToken } = useSettingsStore()
    return buildStreamUrl(svcUrl, svcToken, fileId, t)
  },
}
