import { describe, expect, it } from 'vitest'
import {
  AV_GOLD,
  DEFAULT_THEME_COLOR,
  THEME_PRESETS,
  buildThemeOverrides,
  deriveShades,
  hexToRgb,
  mixHex,
  normalizeHex,
  rgbComponents,
  themeCssVars,
} from './theme'

/**
 * v0.32 TH1（§5T）主题单一事实源纯函数：hex 解析/归一、hover·pressed 派生、
 * CSS 变量与 naive themeOverrides 生成。非法输入一律回退默认紫——
 * 设置页取色器可输入任意内容，主题派生不允许抛错或产出半成品色值。
 */

describe('hexToRgb / normalizeHex', () => {
  it('六位与三位 hex 均可解析，大小写不敏感', () => {
    expect(hexToRgb('#8a7bff')).toEqual({ r: 138, g: 123, b: 255 })
    expect(hexToRgb('#8A7BFF')).toEqual({ r: 138, g: 123, b: 255 })
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(hexToRgb('#000')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('非法输入返回 null（空串/缺 #/位数错/非 hex 字符/非字符串）', () => {
    expect(hexToRgb('')).toBeNull()
    expect(hexToRgb('8a7bff')).toBeNull()
    expect(hexToRgb('#12')).toBeNull()
    expect(hexToRgb('#12345')).toBeNull()
    expect(hexToRgb('#1234567')).toBeNull()
    expect(hexToRgb('#zzzzzz')).toBeNull()
    expect(hexToRgb(undefined as unknown as string)).toBeNull()
  })

  it('normalizeHex 归一为小写六位，非法返回 null', () => {
    expect(normalizeHex('#8A7BFF')).toBe('#8a7bff')
    expect(normalizeHex('#FfF')).toBe('#ffffff')
    expect(normalizeHex('nope')).toBeNull()
  })
})

describe('mixHex / deriveShades', () => {
  it('mixHex 向白/黑按比例混合并取整', () => {
    // #8a7bff + 16% 白 ≈ 旧 hover #a092ff（视觉连续）
    expect(mixHex('#8a7bff', 'white', 0.16)).toBe('#9d90ff')
    // + 14% 黑 ≈ 旧 pressed #6f61e0（视觉连续）
    expect(mixHex('#8a7bff', 'black', 0.14)).toBe('#776adb')
    expect(mixHex('#ffffff', 'black', 1)).toBe('#000000')
    expect(mixHex('#000000', 'white', 0)).toBe('#000000')
  })

  it('deriveShades：hover 亮于 base、pressed 暗于 base，base 归一化', () => {
    const s = deriveShades('#8A7BFF')
    expect(s.base).toBe('#8a7bff')
    expect(s.hover).toBe(mixHex('#8a7bff', 'white', 0.16))
    expect(s.pressed).toBe(mixHex('#8a7bff', 'black', 0.14))
    const luma = (hex: string) => hexToRgb(hex)!.r + hexToRgb(hex)!.g + hexToRgb(hex)!.b
    expect(luma(s.hover)).toBeGreaterThan(luma(s.base))
    expect(luma(s.pressed)).toBeLessThan(luma(s.base))
  })

  it('极端亮/暗色派生仍产出合法 hex（clamp 不越界）', () => {
    for (const hex of ['#ffffff', '#000000', '#f5f5ff', '#101014']) {
      const s = deriveShades(hex)
      for (const v of [s.base, s.hover, s.pressed]) expect(v).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(deriveShades('#ffffff').hover).toBe('#ffffff')
    expect(deriveShades('#000000').pressed).toBe('#000000')
  })

  it('非法输入整体回退默认紫（不抛错、不出半成品）', () => {
    expect(deriveShades('garbage')).toEqual(deriveShades(DEFAULT_THEME_COLOR))
    expect(themeCssVars('garbage')).toEqual(themeCssVars(DEFAULT_THEME_COLOR))
    expect(() => buildThemeOverrides('garbage')).not.toThrow()
  })
})

describe('rgbComponents / themeCssVars / buildThemeOverrides', () => {
  it('rgbComponents 输出空格分量串（CSS rgb(var(--x) / a) 用）', () => {
    expect(rgbComponents('#8a7bff')).toBe('138 123 255')
    expect(rgbComponents('#FF0000')).toBe('255 0 0')
  })

  it('themeCssVars 产出六枚主色变量（三态 + ink/shade 变体随主题色派生）', () => {
    const vars = themeCssVars('#8a7bff')
    expect(vars['--av-primary-rgb']).toBe('138 123 255')
    expect(vars['--av-primary']).toBe('#8a7bff')
    expect(vars['--av-primary-hover']).toBe(deriveShades('#8a7bff').hover)
    expect(vars['--av-primary-pressed']).toBe(deriveShades('#8a7bff').pressed)
    // ink 亮变体 ≈ 旧手调 #cfc7ff（视觉连续）；shade 暗变体 ≈ 旧 #5b4fd6
    expect(vars['--av-primary-ink']).toBe(mixHex('#8a7bff', 'white', 0.59))
    expect(vars['--av-primary-shade']).toBe(mixHex('#8a7bff', 'black', 0.35))
    expect(Object.keys(vars)).toHaveLength(6)
  })

  it("buildThemeOverrides 对齐 naive common 主色三项 + borderRadius '8px'", () => {
    const o = buildThemeOverrides('#4c8dff')
    const s = deriveShades('#4c8dff')
    expect(o.common?.primaryColor).toBe('#4c8dff')
    expect(o.common?.primaryColorHover).toBe(s.hover)
    expect(o.common?.primaryColorPressed).toBe(s.pressed)
    expect(o.common?.borderRadius).toBe('8px')
  })
})

describe('预设与常量', () => {
  it('默认主色与金色常量为既定值（视觉连续）', () => {
    expect(DEFAULT_THEME_COLOR).toBe('#8a7bff')
    expect(AV_GOLD).toBe('#ffd75e')
  })

  it('8 个预设全部为合法六位 hex 且含默认紫', () => {
    expect(THEME_PRESETS).toHaveLength(8)
    for (const p of THEME_PRESETS) {
      expect(normalizeHex(p.value)).toBe(p.value)
      expect(p.label.length).toBeGreaterThan(0)
    }
    expect(THEME_PRESETS.map((p) => p.value)).toContain(DEFAULT_THEME_COLOR)
  })
})
