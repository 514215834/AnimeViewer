import { describe, expect, it } from 'vitest'
import {
  airDateInfoBoxed,
  airSortKey,
  airTimeBadge,
  normalizeHour,
  parseAirTime,
} from './airtime'

/** 探测普查 2026-09-23：258 个真实样本全部为日期形态；时刻形态为防御覆盖 */
describe('parseAirTime（v0.29 Q1 infobox 放送开始解析）', () => {
  it('解析中文年月日（实测主流形态）', () => {
    const t = parseAirTime('2024年1月22日')
    expect(t?.date).toBe('2024-01-22')
    expect(t?.timed).toBe(false)
    expect(t?.raw).toBe('2024年1月22日')
  })

  it('解析 ISO 日期', () => {
    expect(parseAirTime('2024-01-25')?.date).toBe('2024-01-25')
    expect(parseAirTime('2024-01-25')?.timed).toBe(false)
  })

  it('解析日期 + 星期 + 24:30 深夜档时刻', () => {
    const t = parseAirTime('2024-10-05 星期六 24:30')
    expect(t?.date).toBe('2024-10-05')
    expect(t?.hour).toBe(24)
    expect(t?.minute).toBe(30)
    expect(t?.timed).toBe(true)
  })

  it('解析「HH时MM分」中文时刻形态', () => {
    const t = parseAirTime('2024年10月5日 23时30分')
    expect(t?.date).toBe('2024-10-05')
    expect(t?.hour).toBe(23)
    expect(t?.minute).toBe(30)
  })

  it('解析「HH:MM」冒号形态（全角冒号同受）', () => {
    expect(parseAirTime('2024-10-05 23:30')?.hour).toBe(23)
    expect(parseAirTime('23：30')?.hour).toBe(23)
    expect(parseAirTime('23：30')?.minute).toBe(30)
  })

  it('解析裸时刻（无日期）', () => {
    const t = parseAirTime('24:30')
    expect(t?.hour).toBe(24)
    expect(t?.timed).toBe(true)
    expect(t?.date).toBeUndefined()
  })

  it('年份不被误当时刻（无 时|分|: 分隔符不匹配）', () => {
    const t = parseAirTime('2024年1月22日')
    expect(t?.timed).toBe(false)
    expect(t?.hour).toBeUndefined()
  })

  it('非法分钟 60+ 仅丢弃时刻（日期保留回退）/ 全非日期时刻返回 null', () => {
    const t = parseAirTime('2024-10-05 25:60')
    expect(t?.date).toBe('2024-10-05')
    expect(t?.timed).toBe(false)
    expect(parseAirTime('48:00')).toBeNull()
    expect(parseAirTime('星期六')).toBeNull()
    expect(parseAirTime('')).toBeNull()
    expect(parseAirTime(null)).toBeNull()
  })

  it('多时刻取最后一个（放送开始/再放送并列写法）', () => {
    const t = parseAirTime('2024-10-05 24:30 / 再放送 2024-10-06 21:00')
    expect(t?.hour).toBe(21)
    expect(t?.minute).toBe(0)
  })
})

describe('normalizeHour（24+ 深夜档归一）', () => {
  it('24:30 → 次日 00:30', () => {
    expect(normalizeHour(24)).toEqual([1, 0])
    expect(normalizeHour(25)).toEqual([1, 1])
  })
  it('常规时刻不偏移', () => {
    expect(normalizeHour(23)).toEqual([0, 23])
    expect(normalizeHour(0)).toEqual([0, 0])
  })
})

describe('airTimeBadge（展示保留 24+ 原貌）', () => {
  it('24:30 原样展示', () => {
    expect(airTimeBadge('2024-10-05 星期六 24:30')).toBe('24:30')
  })
  it('无时刻返回 null（回退星期粒度）', () => {
    expect(airTimeBadge('2024年1月22日')).toBeNull()
  })
})

describe('airDateInfoBoxed（infobox 提取）', () => {
  it('精确匹配「放送开始」键并展平', () => {
    expect(airDateInfoBoxed([{ key: '话数', value: '12' }, { key: '放送开始', value: '2024年1月22日' }])).toBe(
      '2024年1月22日',
    )
  })
  it('{v}[] 数组形态展平', () => {
    expect(airDateInfoBoxed([{ key: '放送开始', value: [{ v: '2024-01-25' }] }])).toBe('2024-01-25')
  })
  it('未命中/空值返回 null', () => {
    expect(airDateInfoBoxed([{ key: '话数', value: '12' }])).toBeNull()
    expect(airDateInfoBoxed(undefined)).toBeNull()
    expect(airDateInfoBoxed([{ key: '放送开始', value: ' ' }])).toBeNull()
  })
})

describe('airSortKey（周历排序键）', () => {
  it('同日 23:59 < 24:30（归一为次日）', () => {
    const day = '2024-10-05'
    expect(airSortKey(day, 23, 59)).toBeLessThan(airSortKey(day, 24, 30))
  })
  it('24:30 归一为次日 00:30，晚于次日 00:00（凌晨看昨晚番场景）', () => {
    // 周六 24:30 实际播出于周日 00:30，比周日 00:00 的条目更晚
    expect(airSortKey('2024-10-05', 24, 30)).toBeGreaterThan(airSortKey('2024-10-06', 0, 0))
  })
  it('非法日期返回 MAX_SAFE_INTEGER（排末尾防御）', () => {
    expect(airSortKey('bad-date', 1, 0)).toBe(Number.MAX_SAFE_INTEGER)
  })
})
