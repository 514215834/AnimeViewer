import { describe, expect, it } from 'vitest'
import {
  demoBrowseSubjects,
  demoCalendar,
  demoEpisodes,
  demoLibrary,
  demoSearch,
  isDemoSubjectId,
} from './demo'

describe('演示搜索（与在线接口同构的过滤语义）', () => {
  it('关键词命中中文名或原名，大小写不敏感', () => {
    expect(demoSearch('星轨', [], 'match').total).toBe(1)
    expect(demoSearch('starlight', [], 'match').total).toBe(1)
    expect(demoSearch('不存在的番', [], 'match').total).toBe(0)
  })

  it('多标签为「且」关系；-前缀为客户端排除', () => {
    // 「奇幻」∩「热血」仅 900011《刃与诗》同时带两标签
    expect(demoSearch('', ['奇幻', '热血'], 'match').total).toBe(1)
    expect(demoSearch('', ['治愈'], 'match').total).toBe(4)
    // 排除治愈后：全部 14 条 - 4 条治愈
    expect(demoSearch('', ['-治愈'], 'match').total).toBe(10)
  })

  it('排序：heat 按 在看人数，rank 按排名，默认按评分', () => {
    const heat = demoSearch('', [], 'heat').data
    expect(heat[0].id).toBe(900008) // 苍穹远征队 doing 12300 全库最高
    const rank = demoSearch('', [], 'rank').data
    expect(rank[0].id).toBe(900008) // rank 95 全库最优
    const score = demoSearch('', [], 'score').data
    expect(score[0].id).toBe(900008) // 8.9 分最高
  })

  it('分页 limit/offset 与总数', () => {
    const page = demoSearch('', [], 'match', 5, 5)
    expect(page.total).toBe(14)
    expect(page.data).toHaveLength(5)
    expect(demoSearch('', [], 'match', 5, 10).data).toHaveLength(4)
  })

  it('D3 高级筛选在演示数据上生效（日期/评分/人数/排名）', () => {
    // 小众佳作预设：评分人数 ≥200 且排名 ≤800（规划时实测 7 条）
    const niche = demoSearch('', [], 'rank', 24, 0, { ratingCountMin: 200, rankMax: 800 })
    expect(niche.total).toBe(7)
    // 年代过滤：仅 2026-07 之后（含）开播
    const july = demoSearch('', [], 'match', 24, 0, { airDateFrom: '2026-07-01' })
    expect(july.total).toBe(12) // 14 条中 2026-04 开播的 900005/900006 被排除
    // 评分区间
    expect(demoSearch('', [], 'match', 24, 0, { ratingMin: 8.5 }).total).toBe(3) // 8.6/8.9/8.8
  })
})

describe('演示年代浏览', () => {
  it('按年/月过滤与排序', () => {
    expect(demoBrowseSubjects({ year: 2026 }).total).toBe(14)
    expect(demoBrowseSubjects({ year: 2026, month: 4 }).total).toBe(2)
    const byDate = demoBrowseSubjects({ year: 2026, sort: 'date' }).data
    expect((byDate[0] as { date?: string }).date).toBe('2026-07-10')
    const byRank = demoBrowseSubjects({ year: 2026, sort: 'rank' }).data
    expect((byRank[0] as { id: number }).id).toBe(900008)
  })
})

describe('演示剧集与演示库数据健全性（H1/H3 演示闭环依赖）', () => {
  it('demoEpisodes：正篇 + SP/OP/ED 样例，字段结构完整', () => {
    const eps = demoEpisodes(900001)
    expect(eps.filter((e) => e.type === 0)).toHaveLength(12)
    const sp = eps.find((e) => e.type === 1)!
    expect(sp.name).toBe('SP')
    expect(sp.comment).toBe(5)
    expect(sp.desc).toContain('特别篇')
    expect(eps.find((e) => e.type === 2)).toBeTruthy()
    expect(eps.find((e) => e.type === 3)).toBeTruthy()
    // id 确定性：id*10000 + 序号（供单集 PUT / 抽屉使用的稳定键）
    expect(eps[0].id).toBe(9000010001)
  })

  it('demoLibrary 种子与演示周历完全重叠，watchedEps 与进度一致', () => {
    const lib = demoLibrary()
    expect(lib).toHaveLength(4)
    const calIds = new Set(demoCalendar().flatMap((d) => d.items.map((i) => i.id)))
    for (const e of lib) {
      expect(calIds.has(e.subjectId)).toBe(true)
      expect(e.watchedEps?.length).toBe(e.progress)
      expect(e.epsTotal).toBeGreaterThan(0)
    }
  })

  it('演示条目 ID 段判定', () => {
    expect(isDemoSubjectId(900000)).toBe(false)
    expect(isDemoSubjectId(900001)).toBe(true)
    expect(isDemoSubjectId(900014)).toBe(true)
    expect(isDemoSubjectId(900015)).toBe(false)
  })
})
