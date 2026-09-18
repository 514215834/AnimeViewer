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
  /** v0.16 DN5 来源下载任务溯源 */
  downloadTaskId?: number
  downloadTaskName?: string
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

/** 浏览器原生可随机访问的容器（其余走服务端 ffmpeg 转封装 + seek 重拉）。
 *  v0.23 SB0：mkv 直发探测通过（video/webm MIME + Range），直发失败由播放页自动降级转封装 */
export const DIRECT_EXTS = ['mp4', 'm4v', 'webm', 'mkv']

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

/** v0.15 O1 流代理地址（纯函数）：直链/HLS 经服务代理转发（Token 查询参数传递） */
export function buildProxyUrl(baseUrl: string, token: string, targetUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return `${base}/api/proxy?token=${encodeURIComponent(token)}&url=${encodeURIComponent(targetUrl)}`
}

/** v0.15 O3 WebDAV 会话流地址（纯函数）：streamId 为短时会话，凭据只在服务端内存 */
export function buildWebdavStreamUrl(baseUrl: string, token: string, streamId: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return `${base}/api/webdav/stream/${encodeURIComponent(streamId)}?token=${encodeURIComponent(token)}`
}

/* ── v0.23 SB1 内封字幕 ── */

export interface SvcSubtitleTrack {
  index: number
  codec?: string | null
  language?: string | null
  title?: string | null
}

/** 字幕轨地址（纯函数）：ArtPlayer subtitle 以 fetch 加载无法带自定义头，Token 走查询参数（与 stream 双通道一致） */
export function buildSubtitleUrl(baseUrl: string, token: string, fileId: number, track: number): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return `${base}/api/files/${fileId}/subtitle/${track}?token=${encodeURIComponent(token)}`
}

/* ── v0.16 DN2/DN3 下载中心（类型与服务端 Dtos.java 一一对应）── */

export type DownloadStatus = 'queued' | 'metadata' | 'downloading' | 'paused' | 'external' | 'completed' | 'error'

export interface SvcDownloadFile {
  index: number
  path: string
  name: string
  length: number
  completedLength: number
  selected: boolean
}

export interface SvcDownloadTask {
  id: number
  gid?: string
  infoHash?: string
  name?: string
  uri: string
  subjectId?: number
  subjectName?: string
  subjectNameCn?: string
  episodeSort?: number
  status: DownloadStatus
  totalLength: number
  completedLength: number
  downloadSpeed: number
  uploadSpeed: number
  connections: number
  seeds: number
  files: SvcDownloadFile[]
  error?: string
  createdAt?: number
  completedAt?: number
}

export type DownloadEngineType = 'aria2-managed' | 'aria2-external' | 'qbittorrent'

export interface SvcDownloadEngine {
  available: boolean
  mode: 'managed' | 'external' | 'external-app'
  version?: string
  downloadDir?: string
  error?: string
}

export interface SvcDownloadSettings {
  /** v0.18 引擎类型：aria2 托管 / aria2 外部 / qBittorrent 外部应用直开 */
  engineType: DownloadEngineType
  enginePath: string
  engineUrl: string
  engineSecret: string
  rpcPort: number
  /** qBittorrent 可执行文件完整路径（直开模式唯一配置） */
  qbPath: string
  downloadDir: string
  maxConcurrent: number
  uploadLimit: string
  trackers: string[]
  autoScan: boolean
  seedTimeMinutes: number
  checkCertificate: boolean
}

export interface SvcDownloadAddRequest {
  uri: string
  subjectId?: number
  subjectName?: string
  subjectNameCn?: string
  episodeSort?: number
}

/** 磁力解析纯函数（添加弹窗预览用）：infohash / dn 显示名 / 自带 tracker 数 */
export function parseMagnet(uri: string): { infoHash?: string; displayName?: string; trackers: number } {
  const out: { infoHash?: string; displayName?: string; trackers: number } = { trackers: 0 }
  if (!uri.startsWith('magnet:?')) return out
  for (const pair of uri.slice(8).split('&')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const k = pair.slice(0, eq)
    const v = pair.slice(eq + 1)
    try {
      if (k === 'xt' && v.startsWith('urn:btih:')) out.infoHash = v.slice(9)
      else if (k === 'dn') out.displayName = decodeURIComponent(v.replace(/\+/g, ' '))
      else if (k === 'tr') out.trackers += 1
    } catch {
      /* 非法编码忽略该参数 */
    }
  }
  return out
}

/** 下载速度/体积格式化（纯函数） */
export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let v = bytesPerSec
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u += 1
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u += 1
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`
}

/** 服务播放的进度标识：按「条目 + 话数」记忆（同一集换绑/重扫文件后进度不丢） */
export function servicePositionId(subjectId: number, sort: number): string {
  return `svc:${subjectId}:${sort}`
}

export interface SvcWebdavEntry {
  name: string
  dir: boolean
  size?: number
  mtime?: number
}

export interface SvcWebdavBrowse {
  path: string
  list: SvcWebdavEntry[]
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
    if (res.status === 409) {
      // 409 语义随端点不同（扫描进行中 / 任务已存在 / 任务已结束）——真实原因在响应体
      let msg = '扫描正在进行中'
      try {
        const body = (await res.json()) as { message?: string }
        if (body?.message) msg = body.message
      } catch {
        /* 非 JSON 错误体，保留默认文案 */
      }
      throw new ServiceError('busy', msg)
    }
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

  /* ── v0.23 SB1 内封字幕：枚举 / VTT 提取地址 ── */

  subtitleTracks(id: number): Promise<SvcSubtitleTrack[]> {
    return request<{ tracks: SvcSubtitleTrack[] }>(`/api/files/${id}/subtitles`).then((r) => r.tracks)
  },
  subtitleUrl(id: number, track: number): string {
    const { svcUrl, svcToken } = useSettingsStore()
    return buildSubtitleUrl(svcUrl, svcToken, id, track)
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

  /** v0.15 O1 在线源代理地址：服务未配置返回空串（调用方据此提示） */
  proxyUrl(targetUrl: string): string {
    const { svcUrl, svcToken } = useSettingsStore()
    if (!svcUrl.trim() || !svcToken.trim()) return ''
    return buildProxyUrl(svcUrl, svcToken, targetUrl)
  },

  /* ── v0.15 O3 WebDAV（凭据仅随 POST 体流转，来自设置页本机存储）── */

  webdavBrowse(path: string): Promise<SvcWebdavBrowse> {
    const { webdavUrl, webdavUser, webdavPass } = useSettingsStore()
    return post<SvcWebdavBrowse>('/api/webdav/browse', {
      url: webdavUrl.trim(),
      username: webdavUser,
      password: webdavPass,
      path,
    })
  },
  webdavOpen(): Promise<{ streamId: string }> {
    const { webdavUrl, webdavUser, webdavPass } = useSettingsStore()
    return post<{ streamId: string }>('/api/webdav/open', {
      url: webdavUrl.trim(),
      username: webdavUser,
      password: webdavPass,
    })
  },
  webdavStreamUrl(streamId: string): string {
    const { svcUrl, svcToken } = useSettingsStore()
    return buildWebdavStreamUrl(svcUrl, svcToken, streamId)
  },

  /* ── v0.16 DN1/DN3 下载中心 ── */

  downloadEngine(): Promise<SvcDownloadEngine> {
    return request<SvcDownloadEngine>('/api/downloads/engine')
  },
  restartDownloadEngine(): Promise<SvcDownloadEngine> {
    return post<SvcDownloadEngine>('/api/downloads/engine/restart')
  },
  downloadSettings(): Promise<SvcDownloadSettings> {
    return request<SvcDownloadSettings>('/api/downloads/settings')
  },
  saveDownloadSettings(s: SvcDownloadSettings): Promise<SvcDownloadSettings> {
    return request<SvcDownloadSettings>('/api/downloads/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    })
  },
  downloads(): Promise<SvcDownloadTask[]> {
    return request<{ tasks: SvcDownloadTask[] }>('/api/downloads').then((r) => r.tasks)
  },
  addDownload(req: SvcDownloadAddRequest): Promise<SvcDownloadTask> {
    return post<SvcDownloadTask>('/api/downloads', req)
  },
  pauseDownload(id: number): Promise<void> {
    return post<void>(`/api/downloads/${id}/pause`)
  },
  resumeDownload(id: number): Promise<void> {
    return post<void>(`/api/downloads/${id}/resume`)
  },
  applyDownloadSelection(id: number, indexes: number[]): Promise<void> {
    return post<void>(`/api/downloads/${id}/selection`, { indexes })
  },
  removeDownload(id: number, deleteFiles: boolean): Promise<void> {
    return request<void>(`/api/downloads/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteFiles }),
    })
  },

  /* ── v0.17 R1/R2 资源发现（RSS 站点源 + 条目找资源）── */

  resourceSearch(keyword: string, sites?: string[]): Promise<SvcResourceSearch> {
    const qs = new URLSearchParams({ keyword })
    if (sites?.length) qs.set('sites', sites.join(','))
    return request<SvcResourceSearch>(`/api/resources/search?${qs.toString()}`, undefined, 30000)
  },
  resourceSites(): Promise<SvcResourceSite[]> {
    return request<{ sites: SvcResourceSite[] }>('/api/resources/sites').then((r) => r.sites)
  },
  saveResourceSite(site: SvcResourceSite): Promise<SvcResourceSite[]> {
    return request<{ sites: SvcResourceSite[] }>('/api/resources/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(site),
    }).then((r) => r.sites)
  },
  removeResourceSite(key: string): Promise<SvcResourceSite[]> {
    return request<{ sites: SvcResourceSite[] }>(`/api/resources/sites/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }).then((r) => r.sites)
  },
  enqueueResource(req: SvcResourceAddRequest): Promise<SvcDownloadTask> {
    return post<SvcDownloadTask>('/api/resources/enqueue', req)
  },

  /* ── v0.19 SU1/SU2/SU3 订阅自动化 ── */

  subscriptions(): Promise<SvcSubscription[]> {
    return request<{ items: SvcSubscription[] }>('/api/subscriptions').then((r) => r.items)
  },
  subscribeSubject(req: SvcSubscriptionAddRequest): Promise<SvcSubscription> {
    return post<SvcSubscription>('/api/subscriptions', req)
  },
  updateSubscription(
    id: number,
    patch: { autoScore?: number; minEpisode?: number; aiKeywords?: string[] },
  ): Promise<SvcSubscription> {
    return request<SvcSubscription>(`/api/subscriptions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  },
  /** v0.22 AI1：手动判定命中语义（存量无判定/复核用）；返回判定后的命中 */
  aiJudgeHit(id: number): Promise<SvcSubHit> {
    return post<SvcSubHit>(`/api/subscriptions/hits/${id}/ai-judge`)
  },
  /** v0.22 AI2：AI 生成订阅扩展检索词（LLM 候选缓存到订阅行，可再人工编辑） */
  generateAiKeywords(id: number): Promise<SvcSubscription> {
    return post<SvcSubscription>(`/api/subscriptions/${id}/ai-keywords`)
  },
  /** v0.22 AI3：文件名语义解析兜底（LLM 判定标题/集数并预填关联条目 → pending 待人工确认绑定） */
  aiAnalyzeFile(id: number): Promise<{ title: string; episode: number; subjectId?: number; subjectName?: string; message?: string }> {
    return post(`/api/files/${id}/ai-analyze`)
  },
  unsubscribeSubject(id: number): Promise<void> {
    return request<void>(`/api/subscriptions/${id}`, { method: 'DELETE' })
  },
  /** 手动全量检索（忽略间隔到期判定）；返回本轮新命中数 */
  checkSubscriptionsNow(): Promise<number> {
    return post<{ hits: number }>('/api/subscriptions/check').then((r) => r.hits)
  },
  subHits(status?: string, limit = 50): Promise<SvcSubHit[]> {
    const qs = new URLSearchParams({ limit: String(limit) })
    if (status) qs.set('status', status)
    return request<{ items: SvcSubHit[] }>(`/api/subscriptions/hits?${qs.toString()}`).then((r) => r.items)
  },
  acceptHit(id: number): Promise<SvcDownloadTask> {
    return post<SvcDownloadTask>(`/api/subscriptions/hits/${id}/accept`)
  },
  ignoreHit(id: number, blockFansub: boolean): Promise<void> {
    return post<void>(`/api/subscriptions/hits/${id}/ignore`, { blockFansub })
  },
  /** 批量忽略（多选/全选取消）；返回 { ignored, skipped }（skipped=不存在或已处理的条数） */
  batchIgnoreHits(ids: number[]): Promise<{ ignored: number; skipped: number }> {
    return post<{ ignored: number; skipped: number }>('/api/subscriptions/hits/batch-ignore', { ids })
  },
  /** 批量删除命中历史（多选）；仅删除已处理命中，待确认跳过 */
  batchDeleteHits(ids: number[]): Promise<{ deleted: number; skipped: number }> {
    return post<{ deleted: number; skipped: number }>('/api/subscriptions/hits/batch-delete', { ids })
  },
  /** 清空命中历史（全部非待确认命中）；返回删除条数 */
  clearHitHistory(): Promise<{ deleted: number }> {
    return post<{ deleted: number }>('/api/subscriptions/hits/clear-history')
  },
  subscriptionSettings(): Promise<SvcSubscriptionSettings> {
    return request<SvcSubscriptionSettings>('/api/subscriptions/settings')
  },
  saveSubscriptionSettings(s: SvcSubscriptionSettings): Promise<SvcSubscriptionSettings> {
    return request<SvcSubscriptionSettings>('/api/subscriptions/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    })
  },
  /** SU3 通知汇总（待确认数角标 + 最近命中/完成 toast 判定），供全局 60s 轮询 */
  downloadSummary(): Promise<SvcDownloadSummary> {
    return request<SvcDownloadSummary>('/api/downloads/summary')
  },

  /* ── v0.22 AI 分析剧集 ── */

  aiSettings(): Promise<SvcAiSettings> {
    return request<SvcAiSettings>('/api/ai/settings')
  },
  saveAiSettings(s: SvcAiSettings): Promise<SvcAiSettings> {
    return request<SvcAiSettings>('/api/ai/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    })
  },
}

/* ── v0.19 SU1/SU2/SU3 订阅自动化（类型与服务端 Dtos.java 一一对应）── */

export interface SvcSubscription {
  id: number
  subjectId: number
  subjectName?: string
  subjectNameCn?: string
  /** v0.20 起弃用：自动入队阈值 autoScore 取代二值开关（存量保留，勿再读写） */
  auto: boolean
  /** 过滤基线：第 N 话及以下不再命中（观看进度抬升，只升不降） */
  minEpisode: number
  ignoredFansubs: string[]
  /** v0.20 自动入队阈值：0=特殊值（全部命中需手动确认，默认）；1~100=匹配度达阈值自动入队（三重保护仍兜底） */
  autoScore: number
  /** v0.20 SU8 最近一轮检索失败摘要（null=成功），驱动订阅行「检索失败」红标 */
  lastCheckError?: string
  lastCheckedAt?: number
  lastHitAt?: number
  createdAt: number
  /** v0.22 AI2 扩展检索词（LLM 生成缓存/人工编辑；null=从未生成，首轮 AI 就绪时懒生成） */
  aiKeywords?: string[] | null
}

export interface SvcSubscriptionAddRequest {
  subjectId: number
  subjectName?: string
  subjectNameCn?: string
  /** 观看进度基线（maxWatched 结果） */
  minEpisode?: number
  /** v0.20 自动入队阈值：0=手动确认（默认），1~100=评分达标自动入队 */
  autoScore?: number
}

export interface SvcSubHit {
  id: number
  subjectId: number
  subjectName?: string
  subjectNameCn?: string
  episodeSort?: number
  title: string
  fansub?: string
  magnet: string
  infoHash?: string
  site?: string
  size?: string
  pubDate?: number
  status: 'pending' | 'enqueued' | 'ignored' | 'auto'
  note?: string
  /** v0.20 匹配度评分 0~100（服务端落库口径；存量 null = 未评分） */
  score?: number | null
  /** 评分明细 JSON：{"total":N,"parts":["维度 得分",…]} */
  scoreDetail?: string | null
  createdAt: number
  decidedAt?: number
  /** v0.22 AI1 语义判定 JSON：{"type":"episode|op|ed|other","episode":N|null,"isMainline":bool,"reason"}（null=未判定） */
  aiVerdict?: string | null
}

export interface SvcSubscriptionSettings {
  /** 定时检索间隔（30~360 分钟） */
  intervalMinutes: number
  /** 资源大小下限（MB，0 = 不限），滤广告 */
  minSizeMb: number
  /** 全自动保护 I：每日自动入队上限 */
  autoDailyLimit: number
  /** 全自动保护 II：单任务大小上限（MB，0 = 不限） */
  autoMaxSizeMb: number
  /** 全自动保护 III：仅已匹配条目（媒体库无绑定的全自动命中降级待确认） */
  autoOnlyMatched: boolean
  /** v0.20 SU4 新订阅匹配度阈值默认值（0=手动确认特殊值，1~100） */
  defaultAutoScore: number
  /** v0.20 SU5 全局字幕组偏好（评分加权，与订阅级屏蔽互补） */
  globalFansubs: string[]
  /** v0.20 SU6 已入队同集忽略后续命中（关闭可补收其他字幕组/编码版本） */
  skipEnqueuedEpisode: boolean
}

export interface SvcDownloadSummary {
  pendingHits: number
  activeTasks: number
  lastHit?: SvcSubHit
  lastCompleted?: { id: number; name?: string; subjectName?: string; subjectNameCn?: string; completedAt?: number }
}

/* ── v0.22 AI 分析剧集（类型与服务端 Dtos.java 一一对应）── */

export interface SvcAiSettings {
  enabled: boolean
  /** OpenAI 兼容接口根地址（可含 /v1；本地 Ollama 形如 http://127.0.0.1:11434/v1） */
  baseUrl: string
  model: string
  apiKey: string
  /** 单次请求超时（秒，5~120） */
  timeoutSeconds: number
  /** 小时滚动配额护栏（0=不限） */
  maxCallsPerHour: number
  /** AI1 判定非本篇时自动忽略（默认关，误判可清历史重评） */
  autoIgnoreNonEpisode: boolean
  /** 服务端只读回显：enabled 且地址与模型齐备 */
  ready: boolean
  /** 服务端只读回显：本小时已用调用数 */
  callsThisHour: number
  /** v0.22 逐请求附加头（每行「Name: Value」，如 opencode zen 需 x-opencode-session） */
  extraHeaders: string
}

/** AI1 命中语义判定（纯函数视图）：解析 aiVerdict JSON，损坏/未判定返回 null */
export interface HitAiVerdict {
  type: 'episode' | 'op' | 'ed' | 'other'
  /** 判定集数（与启发式解析不一致时前端展示「建议第 N 话」） */
  episode: number | null
  isMainline: boolean
  reason?: string
}

export function hitAiVerdict(json: string | null | undefined): HitAiVerdict | null {
  if (!json) return null
  try {
    const n = JSON.parse(json) as Partial<HitAiVerdict>
    const type = n.type === 'episode' || n.type === 'op' || n.type === 'ed' ? n.type : 'other'
    const episode = typeof n.episode === 'number' && n.episode > 0 && n.episode <= 999 ? n.episode : null
    return { type, episode, isMainline: n.isMainline === undefined ? type === 'episode' : !!n.isMainline, reason: n.reason }
  } catch {
    return null
  }
}

/** 徽章短文案：AI 本篇 / AI 主题曲 / AI 非本篇 */
export function hitAiLabel(v: HitAiVerdict): string {
  if (v.type === 'episode') return 'AI 本篇'
  if (v.type === 'op' || v.type === 'ed') return 'AI 主题曲'
  return 'AI 非本篇'
}

/** 观看进度基线（纯函数）：订阅时以「已看最大话数」初始化过滤基线（只看本篇 sort，已看列表为空返回 0） */
export function maxWatched(watchedEps?: number[] | null): number {
  if (!watchedEps || !watchedEps.length) return 0
  return Math.max(...watchedEps.filter((n) => Number.isFinite(n) && n > 0), 0)
}

/* ── v0.17 R1/R2 资源发现（类型与服务端 Dtos.java 一一对应）── */

export interface SvcResourceItem {
  title: string
  magnet: string
  infoHash?: string
  site: string
  size?: string
  category?: string
  publisher?: string
  pubDate?: number
  link?: string
}

export interface SvcResourceSite {
  key: string
  name: string
  baseUrl: string
  searchTemplate: string
  builtin: boolean
}

export interface SvcResourceSearch {
  keyword: string
  items: SvcResourceItem[]
  sites: SvcResourceSite[]
  error?: string
}

export interface SvcResourceAddRequest {
  magnet: string
  subjectId?: number
  subjectName?: string
  subjectNameCn?: string
  episodeSort?: number
}

/** 从资源标题提取字幕组（纯函数，R3 过滤用）：
 *  行首 [组名]（最常见）→ 竖线前缀（acgnx 官方发布「镜像站 | 标题」形态取镜像名）→ 其余返回 null */
export function extractFansub(title: string): string | null {
  const t = title.trim()
  const lead = t.match(/^\[([^\[\]]{1,30})]/)
  if (lead) return lead[1].trim()
  const pipe = t.match(/^([^|｜]{1,24})[|｜]/)
  if (pipe) return pipe[1].trim()
  return null
}

/** 关键词策略（纯函数）：中文名/原名双查询合并的基础——按名种给出候选词序（去重、非空） */
export function searchKeywords(nameCn?: string, name?: string): string[] {
  const out: string[] = []
  for (const s of [nameCn?.trim(), name?.trim()]) {
    if (s && !out.includes(s)) out.push(s)
  }
  return out
}

/** 资源标题集数猜测（纯函数，确认弹窗预填用）：
 *  优先 EP33 / 第33话 等显式标记，退化为「最后一个独立数字」。
 *  v0.21 补记（2026-09-16 与服务端 SubscriptionFilter.parseEpisode 同步修）：独立数字退化排除
 *  年份 / 1080p 后缀 / 单位尾数（24bit·48kHz·60fps·192kbps）/ 点分邻接（2026.07.08 日期段、
 *  H.264 编码名、Vol.12 卷号）/ 连字符范围包（第01-04巻、1-3 epub）——此前 LoliHouse「てんびん - 11」
 *  裸数字集数标题被尾部 HEVC-10bit 劫持成 10（订阅 #29 实测 11 条全解析成 10）。 */
export function guessEpisodeSortFromTitle(title: string): number | null {
  const explicit = title.match(/EP?\s*(\d{1,4})(?!\d)/i) ?? title.match(/第\s*(\d{1,4})\s*[话話集]/)
  if (explicit) {
    const n = Number(explicit[1])
    if (n >= 1 && n <= 999) return n
  }
  const UNIT_TAIL = /^(bit|khz|hz|kbps|mbps|fps)/
  let guess: number | null = null
  for (const m of title.matchAll(/\d{1,4}(?!\d)/g)) {
    const n = Number(m[0])
    const i = m.index!
    const tail = title.slice(i + m[0].length).toLowerCase()
    const before = title.slice(0, i)
    if (n < 1 || n > 999) continue
    if (n >= 1900 && n <= 2099) continue
    if (tail.startsWith('p') || UNIT_TAIL.test(tail)) continue
    if (before.endsWith('.') || tail.startsWith('.')) continue
    if ((before.endsWith('-') && /\d$/.test(before.slice(0, -1))) || /^-\d/.test(tail)) continue
    guess = n
  }
  return guess
}
