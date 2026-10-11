import type { GlobalThemeOverrides } from 'naive-ui'

/* ═══ v0.32 TH1 主题单一事实源（§5T） ═══
   settings.themeColor 是主题色的唯一输入：CSS 变量（themeCssVars，App.vue 写入
   documentElement）与 naive-ui themeOverrides（buildThemeOverrides）均由本模块派生，
   消灭 styles.css 与 App.vue「两处手工同步」。全部纯函数、非法输入回退默认紫，
   设置页取色器可输入任意内容而不允许抛错或产出半成品色值 */

export const DEFAULT_THEME_COLOR = '#8a7bff'
/** 金色（评分星/分数）语义色常量：JS prop 场景（NRate color）与 CSS --av-gold 同源 */
export const AV_GOLD = '#ffd75e'

export interface ThemePreset {
  label: string
  value: string
}

/** 预设色板（设置页「外观」区 + 侧栏快捷色板共用；首项为默认紫） */
export const THEME_PRESETS: ThemePreset[] = [
  { label: '星紫', value: '#8a7bff' },
  { label: '海蓝', value: '#4c8dff' },
  { label: '青碧', value: '#24b8c4' },
  { label: '竹绿', value: '#45b884' },
  { label: '琥珀', value: '#d9a13b' },
  { label: '暖橙', value: '#ef8a3c' },
  { label: '樱粉', value: '#ef6eae' },
  { label: '绯红', value: '#e05d5d' },
]

export interface Rgb {
  r: number
  g: number
  b: number
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** #rgb/#rrggbb → Rgb；非法输入（缺 #、位数错、非 hex、非字符串）返回 null */
export function hexToRgb(hex: string): Rgb | null {
  if (typeof hex !== 'string') return null
  const m = HEX_RE.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

/** 归一为小写六位 hex；非法返回 null */
export function normalizeHex(hex: string): string | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  return `#${[rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)))

/** 向纯白/纯黑按比例混合（ratio 0~1 之外的值按 clamp 处理），返回小写六位 hex */
export function mixHex(hex: string, target: 'white' | 'black', ratio: number): string {
  const rgb = hexToRgb(hex) ?? hexToRgb(DEFAULT_THEME_COLOR)!
  const t = Math.max(0, Math.min(1, ratio))
  const edge = target === 'white' ? 255 : 0
  const mix = (v: number) => clamp255(v + (edge - v) * t)
  return `#${[mix(rgb.r), mix(rgb.g), mix(rgb.b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export interface ThemeShades {
  base: string
  hover: string
  pressed: string
}

/** 主色三态派生：hover 提亮（混白 16%）/ pressed 压暗（混黑 14%）——
 *  对默认紫的产出与旧手调值（#a092ff / #6f61e0）视觉连续 */
export function deriveShades(hex: string): ThemeShades {
  const base = normalizeHex(hex) ?? DEFAULT_THEME_COLOR
  return { base, hover: mixHex(base, 'white', 0.16), pressed: mixHex(base, 'black', 0.14) }
}

/** 'r g b' 空格分量串（CSS 现代语法 rgb(var(--av-primary-rgb) / alpha) 用）；非法回退默认紫 */
export function rgbComponents(hex: string): string {
  const rgb = hexToRgb(hex) ?? hexToRgb(DEFAULT_THEME_COLOR)!
  return `${rgb.r} ${rgb.g} ${rgb.b}`
}

/** 主题色 → documentElement 内联 CSS 变量集（App.vue watch 逐枚 setProperty）。
 *  ink=主色亮变体（暗色软底上的高对比字）/ shade=主色暗变体（亮色软底上），
 *  均随主题色派生（旧手调 #cfc7ff / #5b4fd6 的替代） */
export function themeCssVars(hex: string): Record<string, string> {
  const s = deriveShades(hex)
  return {
    '--av-primary-rgb': rgbComponents(s.base),
    '--av-primary': s.base,
    '--av-primary-hover': s.hover,
    '--av-primary-pressed': s.pressed,
    '--av-primary-ink': mixHex(s.base, 'white', 0.59),
    '--av-primary-shade': mixHex(s.base, 'black', 0.35),
  }
}

/** 主题色 → naive-ui GlobalThemeOverrides.common 主色（borderRadius 沿用 v0.10 既定 8px） */
export function buildThemeOverrides(hex: string): GlobalThemeOverrides {
  const s = deriveShades(hex)
  return {
    common: {
      primaryColor: s.base,
      primaryColorHover: s.hover,
      primaryColorPressed: s.pressed,
      borderRadius: '8px',
    },
  }
}
