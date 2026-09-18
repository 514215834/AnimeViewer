/** v0.23 字幕纯函数层（SB1/SB2/SB3 共用，供单测，不依赖浏览器 API）：
 *  - srtToVtt：本地 .srt → WebVTT（ArtPlayer 仅吃 vtt；ass 不在本地支持范围，UI 明示）
 *  - matchSubtitle：视频同目录同名（含常见中文字幕语言后缀）srt/vtt 探测
 *  - pickDefaultTrack：服务源内封字幕默认轨启发式——第一中文轨（简体 > 泛中文 > 繁体），无中文取第一条
 *  - trackLabel / isSubtitleName：展示与识别辅助 */

export interface SubtitleTrack {
  index: number
  /** 字幕编码名（ass/subrip/subs/mov_text…），ffprobe 缺省为 null */
  codec?: string | null
  language?: string | null
  title?: string | null
}

/** 外挂字幕条目（VideoPlayer props）：url 为 vtt 地址（blob URL 或服务地址） */
export interface SubtitleEntry {
  index: number
  label: string
  url: string
  /** 默认选中轨 */
  selected?: boolean
}

/** 本地外挂字幕仅支持 srt/vtt（本机无 ffmpeg，ass 不在范围并在 UI 明示） */
export const SUBTITLE_EXTS = ['srt', 'vtt']

export function isSubtitleName(name: string): boolean {
  return SUBTITLE_EXTS.includes(name.split('.').pop()?.toLowerCase() ?? '')
}

/* ── SB2：srt → vtt ── */

/** srt → WebVTT（纯函数）：
 *  - 头部 WEBVTT；BOM/行尾 \r\n 归一；可选 cue 序号行丢弃（vtt 序号可选）
 *  - 时间戳逗号毫秒 → 点；hh:mm:ss,xxx / mm:ss,xxx 两种形态都接受
 *  - 正文原样保留（<i> 等内联标签在 vtt 中合法）；无有效 cue 的输入返回仅头部的空 vtt */
export function srtToVtt(text: string): string {
  const body = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const blocks = body.split(/\n{2,}/)
  const cueRe =
    /^(\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3}/
  const out: string[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    const tIdx = lines.findIndex((l) => cueRe.test(l.trim()))
    if (tIdx < 0) continue // 无时间轴的块（序号残留/注释）跳过
    const timing = lines[tIdx].trim().replace(/,/g, '.')
    const content = lines.slice(tIdx + 1).join('\n')
    out.push(`${timing}\n${content}`)
  }
  return `WEBVTT\n\n${out.length ? out.join('\n\n') + '\n' : ''}`
}

/* ── SB2：同名外挂字幕探测 ── */

/** 常见中文字幕语言后缀（`标题.chs.srt` 形态），按优先级排列 */
const LANG_SUFFIXES = ['chs', 'zh', 'zh-cn', 'zh-hans', 'sc', 'cht', 'zh-tw', 'zh-hant', 'zh-hk', 'tc', 'big5']

/** 视频同名字幕探测（纯函数）：
 *  优先 stem 完全同名（`Foo - 01.srt`），其次 `stem.{lang}.srt`（简体后缀优先于繁体）；
 *  扩展名大小写不敏感，无匹配返回 null */
export function matchSubtitle(videoName: string, siblings: string[]): string | null {
  const stem = videoName.replace(/\.[^.]+$/, '').toLowerCase()
  if (!stem) return null
  const subs = siblings
    .filter((n) => isSubtitleName(n))
    .sort((a, b) => a.localeCompare(b))
  const stemOf = (n: string) => n.replace(/\.[^.]+$/, '').toLowerCase()
  const exact = subs.find((n) => stemOf(n) === stem)
  if (exact) return exact
  for (const lang of LANG_SUFFIXES) {
    const hit = subs.find((n) => {
      const s = stemOf(n)
      return s.startsWith(stem + '.') && s.slice(stem.length + 1).toLowerCase() === lang
    })
    if (hit) return hit
  }
  return null
}

/* ── SB1：服务源默认轨选择启发式 ── */

/** 中文轨判定分值（越大越优先）：2=简体 1=泛中文 0=非中文；繁体 0.5（同为中文但排简体之后）。
 *  覆盖：ISO 码（zh-hans/hant/tw/hk、chi、zho）、民间码（chs/cht/big5/sc/tc）、标题含 简/繁/中 字样。
 *  裸 zh/chi 视为泛中文（1）——仅显式简/繁标记才决定简繁优先级 */
export function zhTrackScore(track: SubtitleTrack): number {
  const lang = (track.language ?? '').toLowerCase()
  const title = track.title ?? ''
  const simplified = /^(chs|sc|zh[-_.](hans|cn|sg))$/.test(lang) || /简|简中/.test(title)
  const traditional = /^(cht|tc|big5|zht|zh[-_.](hant|tw|hk))$/.test(lang) || /繁/.test(title)
  const generic = /^(zh|chi|zho)([-_.].+)?$/.test(lang) || /中/.test(title)
  if (simplified) return 2
  if (traditional) return 0.5
  if (generic) return 1
  return 0
}

/** 默认轨：分值最高的第一轨（无中文轨返回第一条；空列表返回 null） */
export function pickDefaultTrack(tracks: SubtitleTrack[]): SubtitleTrack | null {
  if (!tracks.length) return null
  let best = tracks[0]
  let bestScore = zhTrackScore(tracks[0])
  for (const t of tracks) {
    const s = zhTrackScore(t)
    if (s > bestScore) {
      best = t
      bestScore = s
    }
  }
  return best
}

/** 轨道展示名：title 优先（`简体中文`），无 title 退 `语言 (codec)`，再退 `字幕轨 N` */
export function trackLabel(track: SubtitleTrack): string {
  const parts: string[] = []
  if (track.title && track.title.trim()) parts.push(track.title.trim())
  else if (track.language) parts.push(track.language)
  if (track.codec) parts.push(track.codec)
  return parts.join(' · ') || `字幕轨 ${track.index + 1}`
}

/* ── 反馈：字幕字号 ── */

/** 字幕字号范围（px）与默认值：ArtPlayer 默认 20px 偏小，默认调大至 40 */
export const SUBTITLE_FONT_SIZE = { min: 20, max: 72, step: 2, default: 40 } as const

/** 字号钳制（纯函数）：非法/越界值收敛到 20~72，缺省回默认 40 */
export function clampSubtitleFontSize(v: number | null | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return SUBTITLE_FONT_SIZE.default
  return Math.min(SUBTITLE_FONT_SIZE.max, Math.max(SUBTITLE_FONT_SIZE.min, Math.round(v)))
}
