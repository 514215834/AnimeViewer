import { describe, expect, it } from 'vitest'
import { todayUpdateSubjectIds } from './notify'
import type { CalendarDay, CalendarSubject } from '../types/bangumi'

/** T3 「今日更新」计算纯函数单测：周历当天分栏 ∩ 追番库，按通知范围过滤 */

function day(id: number, ids: number[]): CalendarDay {
  return {
    weekday: { id, en: `d${id}`, cn: `周${id}`, ja: '' },
    items: ids.map((i) => ({ id: i, name: `s${i}`, name_cn: '' })) as CalendarSubject[],
  }
}

const ENTRIES = [
  { subjectId: 1, status: 'doing' as const },
  { subjectId: 2, status: 'wish' as const },
  { subjectId: 3, status: 'done' as const },
]

describe('todayUpdateSubjectIds', () => {
  it('只取当天分栏 ∩ 追番库；scope=doing 时仅「在看」命中', () => {
    // 2026-09-12 为周六（weekday.id=6）
    const days = [day(6, [1, 2, 99]), day(7, [3])]
    expect(todayUpdateSubjectIds(days, ENTRIES, 'doing', new Date(2026, 8, 12))).toEqual([1])
    expect(todayUpdateSubjectIds(days, ENTRIES, 'all', new Date(2026, 8, 12))).toEqual([1, 2])
  })

  it('getDay()=0（周日）正确映射为 weekday.id=7', () => {
    // 2026-09-13 为周日
    const days = [day(6, [1]), day(7, [1, 2])]
    expect(todayUpdateSubjectIds(days, ENTRIES, 'all', new Date(2026, 8, 13))).toEqual([1, 2])
  })

  it('当天无分栏或库为交集为空时返回空数组', () => {
    expect(todayUpdateSubjectIds([day(1, [1])], ENTRIES, 'all', new Date(2026, 8, 12))).toEqual([])
    expect(todayUpdateSubjectIds([], ENTRIES, 'all', new Date(2026, 8, 12))).toEqual([])
  })
})
