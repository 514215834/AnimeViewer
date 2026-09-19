/** v0.13 PL4 播放数据模型（纯逻辑层，供单测）：键规则 / 完播判定 / 文件名识别 / 导出合并。
 *  存储实现在 mediaStore.ts（IndexedDB），本文件不依赖任何浏览器存储 API。 */

/** PL3 自然看完判定阈值：播放进度 ≥95% 视为看完 */
export const WATCH_COMPLETE_RATIO = 0.95

/** v0.23 SB5 跳过片头默认时长（秒）：按条目记忆缺失时使用，可在播放页修改（0=不显示按钮） */
export const DEFAULT_INTRO_SEC = 90

/** 绑定类型：file=本机文件（句柄在 mediaFiles 记录）；url=在线直链（v0.15 扩展）；demo=内置演示视频；
 *  online=hanime1.me 在线解析源（v0.26 HN8，videoCode 为站点视频码，播放经服务端流转发） */
export type MediaBindingType = 'file' | 'url' | 'demo' | 'online'

/** 剧集绑定：subjectId + sort（正篇话数）复合键，一集一个播放源 */
export interface MediaBinding {
  subjectId: number
  sort: number
  /** 展示名（文件名 / 演示视频等） */
  name: string
  type: MediaBindingType
  /** type=file：指向 mediaFiles 记录的键（句柄仅存本机 IndexedDB，导出不含） */
  fileKey?: string
  /** type=url / demo：直接可播放地址（WebDAV 源为完整文件 URL，仅作标识与进度键，播放走服务端会话流） */
  url?: string
  /** type=url 且来源为 WebDAV（v0.15 O3）：path 为相对 WebDAV 根的原始路径，播放时 open→streamId 换取流地址 */
  webdav?: { path: string }
  /** v0.23 SB3：WebDAV 同名字幕的相对路径（存在时播放页经 O2 代理拉取转 VTT） */
  webdavSubPath?: string
  /** v0.23 SB2：本地绑定随带的同名外挂字幕展示名（文本在 mediaStore sub:{fileKey}） */
  subName?: string
  /** type=online（v0.26 HN8）：hanime1 视频码（watch?v= 参数），解析与流转发均经媒体服务 */
  videoCode?: string
  addedAt: number
}

/** 本机文件记录（两种来源二选一：FSA 句柄可持久化+重授权；File 对象由拖拽/input 兜底，Chrome 可持久化文件引用） */
export interface MediaFileRecord {
  fileKey: string
  name: string
  size: number
  /** FileSystemFileHandle */
  handle?: unknown
  /** File 对象（拖拽 / input 兜底） */
  file?: unknown
}

/** 播放进度：id 为位置标识（文件=fileKey，演示=固定值，URL=u:前缀） */
export interface WatchPosition {
  id: string
  position: number
  duration: number
  updatedAt: number
}

/** 绑定键：b:{subjectId}:{sort} */
export function bindingKey(subjectId: number, sort: number): string {
  return `b:${subjectId}:${sort}`
}

/** 文件键：名 + 大小（同名同大小视为同一文件，跨会话稳定） */
export function fileKeyOf(name: string, size: number): string {
  return `f:${name}:${size}`
}

/** 位置标识：文件绑定用 fileKey；演示视频固定；URL 加前缀；在线源（v0.26 HN7）用 o:{videoCode} */
export function positionIdOf(
  binding: Pick<MediaBinding, 'type' | 'fileKey' | 'url' | 'videoCode'>,
): string {
  if (binding.type === 'file') return binding.fileKey ?? ''
  if (binding.type === 'demo') return DEMO_POSITION_ID
  if (binding.type === 'online') return `o:${binding.videoCode ?? ''}`
  return `u:${binding.url ?? ''}`
}

/** 演示视频的固定位置标识（PL5） */
export const DEMO_POSITION_ID = 'demo-clip'

/** 位置存储键：p:{id} */
export function positionKey(id: string): string {
  return `p:${id}`
}

/** PL3 完播判定：时长已知且进度 ≥95%；时长未知（0/NaN）一律不判定 */
export function isWatchedComplete(position: number, duration: number): boolean {
  if (!Number.isFinite(position) || position < 0) return false
  if (!Number.isFinite(duration) || duration <= 0) return false
  return position / duration >= WATCH_COMPLETE_RATIO
}

/** 进度比值 0~1（时长未知返回 0） */
export function watchRatio(position: number, duration: number): number {
  if (!Number.isFinite(position) || position < 0) return 0
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(position / duration, 1)
}

/** 秒 → mm:ss / h:mm:ss（续播提示用） */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}

/** PL2 从文件名猜测集数（轻量识别，可被人工修正；正式识别在 v0.14 服务端）：
 *  取扩展名前最后一个 1~999 的数字组，排除紧跟 p/P 的分辨率（720p/1080p）与 ≥1000 的年份等 */
export function guessEpisodeSort(name: string): number | null {
  const stem = name.replace(/\.[a-z0-9]+$/i, '')
  let guess: number | null = null
  for (const m of stem.matchAll(/\d{1,4}(?!\d)/g)) {
    const n = Number(m[0])
    const next = stem[m.index + m[0].length]?.toLowerCase()
    if (n >= 1 && n <= 999 && next !== 'p') guess = n
  }
  return guess
}

/** 视频扩展名（目录扫描 / 拖拽过滤） */
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mkv', 'avi', 'mov', 'm4v', 'ts', 'm2ts', 'flv', 'wmv', 'ogv']

export function isVideoName(name: string): boolean {
  return VIDEO_EXTENSIONS.includes(name.split('.').pop()?.toLowerCase() ?? '')
}

/* ── v0.15 O1 在线源（直链 / HLS）── */

/** HLS 判定：路径以 .m3u8 结尾（大小写不敏感，忽略查询串/哈希）——hls.js 按 MSE 播放，原生 seek */
export function isHlsUrl(url: string): boolean {
  if (!url) return false
  try {
    const path = new URL(url).pathname
    return path.toLowerCase().endsWith('.m3u8')
  } catch {
    return /\.m3u8(\?|#|$)/i.test(url)
  }
}

/** URL 文件名段（去查询串/哈希后取最后一段，供名称缺省与集数猜测） */
export function urlFileName(url: string): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    const seg = u.pathname.split('/').filter(Boolean).pop() ?? ''
    return decodeURIComponent(seg)
  } catch {
    return url.split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? ''
  }
}

/* ── v0.15 O5 播放历史：位置记录 → 归属解析（纯函数） ── */

export type HistorySource = 'file' | 'url' | 'webdav' | 'demo' | 'service' | 'online'

/** 历史行归属：位置标识反解出 条目+话数+来源（无法归属的记录返回 null，如绑定已解） */
export interface HistoryOwner {
  subjectId: number
  sort: number
  source: HistorySource
  positionId: string
}

/** svc:{subjectId}:{sort} 服务源；o:{videoCode} 在线源（v0.26，按绑定 videoCode 反查）；
 *  u:{url} 按绑定 url 反查（含 WebDAV）；demo 按演示绑定；其余按 fileKey 反查 */
export function resolvePositionOwner(position: WatchPosition, bindings: MediaBinding[]): HistoryOwner | null {
  const id = position.id
  if (!id) return null
  if (id.startsWith('svc:')) {
    const m = /^svc:(\d+):(\d+)$/.exec(id)
    return m ? { subjectId: Number(m[1]), sort: Number(m[2]), source: 'service', positionId: id } : null
  }
  if (id.startsWith('o:')) {
    const code = id.slice(2)
    const b = bindings.find((x) => x.type === 'online' && x.videoCode === code)
    return b ? { subjectId: b.subjectId, sort: b.sort, source: 'online', positionId: id } : null
  }
  if (id.startsWith('u:')) {
    const url = id.slice(2)
    const b = bindings.find((x) => x.type === 'url' && x.url === url)
    return b ? { subjectId: b.subjectId, sort: b.sort, source: b.webdav ? 'webdav' : 'url', positionId: id } : null
  }
  if (id === DEMO_POSITION_ID) {
    const b = bindings.find((x) => x.type === 'demo')
    return b ? { subjectId: b.subjectId, sort: b.sort, source: 'demo', positionId: id } : null
  }
  const b = bindings.find((x) => x.type === 'file' && x.fileKey === id)
  return b ? { subjectId: b.subjectId, sort: b.sort, source: 'file', positionId: id } : null
}

/** 导出格式（可选 media 段，向后兼容：旧备份无此段照常导入；句柄不导出） */
export interface MediaExportSection {
  bindings: MediaBinding[]
  positions: WatchPosition[]
}

export interface MediaImportResult {
  bindingsAdded: number
  positionsMerged: number
}

/** 导入合并（纯函数）：绑定键不存在才建（不覆盖本机现状——本机可能已改绑）；
 *  播放位置按 updatedAt 新者覆盖；非法条目跳过 */
export function mergeMediaImport(
  existing: { bindings: MediaBinding[]; positions: WatchPosition[] },
  incoming: Partial<MediaExportSection> | undefined,
): { bindings: MediaBinding[]; positions: WatchPosition[]; result: MediaImportResult } {
  const bindings = new Map(existing.bindings.map((b) => [bindingKey(b.subjectId, b.sort), b]))
  const positions = new Map(existing.positions.map((p) => [p.id, p]))
  let bindingsAdded = 0
  let positionsMerged = 0

  for (const b of incoming?.bindings ?? []) {
    if (!b || typeof b.subjectId !== 'number' || typeof b.sort !== 'number') continue
    const key = bindingKey(b.subjectId, b.sort)
    if (bindings.has(key)) continue
    bindings.set(key, { ...b, subjectId: b.subjectId, sort: b.sort })
    bindingsAdded++
  }

  for (const p of incoming?.positions ?? []) {
    if (!p || typeof p.id !== 'string' || !p.id || !Number.isFinite(Number(p.position))) continue
    const cur = positions.get(p.id)
    const updatedAt = Number(p.updatedAt ?? 0)
    if (cur && updatedAt <= cur.updatedAt) continue
    positions.set(p.id, { id: p.id, position: Number(p.position), duration: Number(p.duration ?? 0), updatedAt })
    positionsMerged++
  }

  return { bindings: [...bindings.values()], positions: [...positions.values()], result: { bindingsAdded, positionsMerged } }
}
