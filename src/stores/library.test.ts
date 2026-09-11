import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLibraryStore } from './library'
import { useSettingsStore } from './settings'
import { demoCalendar } from '../api/demo'

/**
 * H5 同步引擎核心单测：library 状态机（E2 三态 / F6 轻量字段 / 墓碑 / 双库迁移）。
 * happy-dom 提供 localStorage；每例重建 pinia + 清空存储，保证互不污染。
 */
function freshEnv(seedOnline: Record<string, unknown> = {}, seedDemo: Record<string, unknown> | null = null) {
  localStorage.clear()
  if (Object.keys(seedOnline).length) localStorage.setItem('animeviewer:library', JSON.stringify(seedOnline))
  if (seedDemo) localStorage.setItem('animeviewer:library:demo', JSON.stringify(seedDemo))
  setActivePinia(createPinia())
  // 测试一律清空 Token，杜绝测试触发真实网络请求
  useSettingsStore().$patch({ accessToken: '', dataSource: 'online' })
}

type UpsertPayload = Parameters<ReturnType<typeof useLibraryStore>['upsertFromServer']>[0]

/** 构造一条最小可用的服务端收藏载荷 */
function serverPayload(overrides: Partial<UpsertPayload> = {}): UpsertPayload {
  return {
    subjectId: 100,
    name: 'Server Subject',
    nameCn: '服务端条目',
    status: 'doing',
    progress: 3,
    epsTotal: 12,
    serverUpdatedAt: '2026-09-01T00:00:00+08:00',
    ...overrides,
  }
}

beforeEach(() => freshEnv())

describe('library 加追/移除与墓碑', () => {
  it('add 创建想看条目并置 dirty，同时解除墓碑', () => {
    const lib = useLibraryStore()
    lib.remove(42)
    expect(lib.removedSubjects['42']).toBeTruthy()
    lib.add({ subjectId: 100, name: 'A', nameCn: '甲', epsTotal: 12 })
    const e = lib.entry(100)
    expect(e?.status).toBe('wish')
    expect(e?.watchedEps).toEqual([])
    expect(e?.dirty).toBe(true)
    expect(lib.removedSubjects['100']).toBeUndefined()
  })

  it('remove 记录墓碑，云同步拉取不再复活', () => {
    const lib = useLibraryStore()
    lib.upsertFromServer(serverPayload())
    expect(lib.has(100)).toBe(true)
    lib.remove(100)
    expect(lib.has(100)).toBe(false)
    const r = lib.upsertFromServer(serverPayload())
    expect(r).toBe('skipped')
    expect(lib.has(100)).toBe(false)
  })
})

describe('数字进度与单集勾选双向同步', () => {
  it('setProgress 派生 watchedEps 1..N', () => {
    const lib = useLibraryStore()
    lib.add({ subjectId: 100, name: 'A', nameCn: '甲', epsTotal: 12 })
    lib.setProgress(100, 3)
    expect(lib.entry(100)?.watchedEps).toEqual([1, 2, 3])
    expect(lib.entry(100)?.progress).toBe(3)
  })

  it('markEpisodeLocal 增删单集并重算进度，但不打条目 dirty（E1 增量路径）', () => {
    const lib = useLibraryStore()
    lib.add({ subjectId: 100, name: 'A', nameCn: '甲', epsTotal: 12 })
    lib.markSynced(100, '2026-09-01T00:00:00+08:00')
    lib.markEpisodeLocal(100, 2, true)
    lib.markEpisodeLocal(100, 5, true)
    expect(lib.entry(100)?.watchedEps).toEqual([2, 5])
    expect(lib.entry(100)?.progress).toBe(2)
    lib.markEpisodeLocal(100, 2, false)
    expect(lib.entry(100)?.watchedEps).toEqual([5])
    expect(lib.entry(100)?.progress).toBe(1)
    expect(lib.entry(100)?.dirty).toBe(false) // E1 增量路径不打条目 dirty，走单集 PUT 队列
  })

  it('setEpisodeWatched / setWatchedAll 走整表路径（dirty）', () => {
    const lib = useLibraryStore()
    lib.add({ subjectId: 100, name: 'A', nameCn: '甲', epsTotal: 12 })
    lib.markSynced(100, '2026-09-01T00:00:00+08:00')
    lib.setEpisodeWatched(100, 4, true)
    expect(lib.entry(100)?.dirty).toBe(true)
    expect(lib.entry(100)?.watchedEps).toEqual([4])
    lib.setWatchedAll(100, true, [1, 2, 3])
    expect(lib.entry(100)?.watchedEps).toEqual([1, 2, 3, 4])
    lib.setWatchedAll(100, false, [])
    expect(lib.entry(100)?.watchedEps).toEqual([])
    expect(lib.entry(100)?.progress).toBe(0)
  })
})

describe('E2 收藏合并三态 + F6 轻量字段', () => {
  it('本地缺失时 created（进度派生单集，评分列表项带入）', () => {
    const lib = useLibraryStore()
    const r = lib.upsertFromServer(serverPayload({ rate: 7, comment: '好', isPrivate: true, tags: ['奇幻'] }))
    expect(r).toBe('created')
    const e = lib.entry(100)
    expect(e?.watchedEps).toEqual([1, 2, 3])
    expect(e?.myRate).toBe(7)
    expect(e?.myComment).toBe('好')
    expect(e?.privateFlag).toBe(true)
    expect(e?.dirty).toBe(false)
  })

  it('非 dirty 且服务端较新 → updated；服务端未变化 → skipped', () => {
    const lib = useLibraryStore()
    lib.upsertFromServer(serverPayload())
    const r2 = lib.upsertFromServer(serverPayload({ progress: 5, serverUpdatedAt: '2026-09-02T00:00:00+08:00' }))
    expect(r2).toBe('updated')
    expect(lib.entry(100)?.progress).toBe(5)
    const r3 = lib.upsertFromServer(serverPayload({ serverUpdatedAt: '2026-09-02T00:00:00+08:00' }))
    expect(r3).toBe('skipped')
  })

  it('dirty 条目：远端较新则远端胜（清 dirty），本地较新则保留 dirty 待推送', () => {
    const lib = useLibraryStore()
    lib.upsertFromServer(serverPayload({ serverUpdatedAt: '2026-09-01T00:00:00+08:00' }))
    lib.markSynced(100, '2026-09-01T00:00:00+08:00')
    // 本地改动（dirtyAt = 现在，2026-09-10）晚于远端 09-02 → 本地胜
    lib.setStatus(100, 'done')
    const rLocal = lib.upsertFromServer(serverPayload({ progress: 8, serverUpdatedAt: '2026-09-02T00:00:00+08:00' }))
    expect(rLocal).toBe('conflict-local-win')
    expect(lib.entry(100)?.dirty).toBe(true)
    expect(lib.entry(100)?.progress).toBe(12) // setStatus('done') 已推满进度，本地未被覆盖
    // 远端更晚 → 远端胜并清 dirty
    const rRemote = lib.upsertFromServer(
      serverPayload({ progress: 9, status: 'done', serverUpdatedAt: '2999-01-01T00:00:00+08:00' }),
    )
    expect(rRemote).toBe('conflict-remote-win')
    expect(lib.entry(100)?.dirty).toBe(false)
    expect(lib.entry(100)?.progress).toBe(9)
  })

  it('F6：非 dirty 条目评分/笔记/私密无条件跟随云端（即使条目级 skipped）', () => {
    const lib = useLibraryStore()
    lib.upsertFromServer(serverPayload({ rate: 6, comment: '云端改评' }))
    expect(lib.entry(100)?.myRate).toBe(6)
    // 服务端时间未推进 → skipped，但轻量字段在此之前已跟随
    const r = lib.upsertFromServer(serverPayload({ rate: 9, comment: '云端改评 v0.7' }))
    expect(r).toBe('skipped')
    expect(lib.entry(100)?.myRate).toBe(9)
    expect(lib.entry(100)?.myComment).toBe('云端改评 v0.7')
  })

  it('F6：dirty 条目本地较新时保留本地评分待推送', () => {
    const lib = useLibraryStore()
    lib.upsertFromServer(serverPayload())
    lib.markSynced(100, '2026-09-01T00:00:00+08:00')
    lib.setMyReview(100, { rate: 5 }) // dirtyAt = now
    const r2 = lib.upsertFromServer(serverPayload({ rate: 1, serverUpdatedAt: '2026-09-03T00:00:00+08:00' }))
    expect(r2).toBe('conflict-local-win')
    expect(lib.entry(100)?.myRate).toBe(5)
    expect(lib.entry(100)?.dirty).toBe(true)
  })

  it('setMyReview 变更打 dirty 并持久化字段', () => {
    const lib = useLibraryStore()
    lib.add({ subjectId: 100, name: 'A', nameCn: '甲', epsTotal: 12 })
    lib.setMyReview(100, { rate: 8, comment: '笔记', isPrivate: true })
    const e = lib.entry(100)
    expect(e?.myRate).toBe(8)
    expect(e?.myComment).toBe('笔记')
    expect(e?.privateFlag).toBe(true)
    expect(e?.dirty).toBe(true)
  })
})

describe('F1 云端单集合并 applyCloudEpisodes', () => {
  it('云端记录覆盖本地并返回 true；无变化返回 false', () => {
    const lib = useLibraryStore()
    lib.add({ subjectId: 100, name: 'A', nameCn: '甲', epsTotal: 12 })
    lib.setProgress(100, 2)
    expect(lib.applyCloudEpisodes(100, [1, 2, 3, 4])).toBe(true)
    expect(lib.entry(100)?.watchedEps).toEqual([1, 2, 3, 4])
    expect(lib.entry(100)?.progress).toBe(4)
    expect(lib.applyCloudEpisodes(100, [4, 3, 2, 1])).toBe(false) // 去重排序后与现状一致
  })
})

describe('导入兼容', () => {
  it('importEntries 校验、去重并解除墓碑', () => {
    const lib = useLibraryStore()
    lib.remove(100)
    const r = lib.importEntries([
      { subjectId: 100, name: 'A', nameCn: '甲', status: 'doing', progress: 2, epsTotal: 12, watchedEps: [1, 2] },
      { name: '缺 id' },
      { subjectId: 'bad', name: '类型错' },
      { subjectId: 100, name: '重复' },
    ])
    expect(r).toEqual({ added: 1, skipped: 3 })
    expect(lib.entry(100)?.watchedEps).toEqual([1, 2])
    expect(lib.removedSubjects['100']).toBeUndefined()
  })
})

describe('H3 非本篇单集标记（watchedSpecial 复合桶）', () => {
  it('勾选写独立桶，不影响正篇 watchedEps 与进度', () => {
    const lib = useLibraryStore()
    lib.add({ subjectId: 100, name: 'A', nameCn: '甲', epsTotal: 12 })
    lib.setProgress(100, 3) // 正篇看到第 3 话
    lib.markSpecialEpisodeLocal(100, 1, 1, true) // SP sort=1 与第 1 话 sort 冲突，但写独立桶
    expect(lib.entry(100)?.watchedEps).toEqual([1, 2, 3]) // 正篇分毫未动
    expect(lib.entry(100)?.progress).toBe(3)
    expect(lib.hasSpecialEpisode(100, 1, 1)).toBe(true)
    lib.markSpecialEpisodeLocal(100, 3, 1, true) // ED sort=1
    expect(lib.entry(100)?.watchedSpecial).toEqual({ '1': [1], '3': [1] })
  })

  it('取消勾选后空桶与空对象均被清理', () => {
    const lib = useLibraryStore()
    lib.add({ subjectId: 100, name: 'A', nameCn: '甲', epsTotal: 12 })
    lib.markSpecialEpisodeLocal(100, 1, 1, true)
    lib.markSpecialEpisodeLocal(100, 1, 2, true)
    lib.markSpecialEpisodeLocal(100, 1, 1, false)
    expect(lib.hasSpecialEpisode(100, 1, 1)).toBe(false)
    expect(lib.hasSpecialEpisode(100, 1, 2)).toBe(true)
    lib.markSpecialEpisodeLocal(100, 1, 2, false)
    expect(lib.entry(100)?.watchedSpecial).toBeUndefined() // 空对象整体移除
  })

  it('epType=0 拒绝写入（正篇必须走 markEpisodeLocal）', () => {
    const lib = useLibraryStore()
    lib.add({ subjectId: 100, name: 'A', nameCn: '甲', epsTotal: 12 })
    lib.markSpecialEpisodeLocal(100, 0, 1, true)
    expect(lib.entry(100)?.watchedSpecial).toBeUndefined()
  })

  it('importEntries 校验复合桶形态', () => {
    const lib = useLibraryStore()
    const r = lib.importEntries([
      { subjectId: 100, name: 'A', nameCn: '甲', status: 'doing', progress: 0, epsTotal: 12, watchedSpecial: { '1': [1, 2], bad: 'x' } },
    ])
    expect(r.added).toBe(1)
    expect(lib.entry(100)?.watchedSpecial).toEqual({ '1': [1, 2] })
  })
})

describe('演示/在线双库隔离与迁移', () => {
  it('演示库首次装载自动播种 4 条种子，且种子全部命中演示周历', () => {
    freshEnv()
    useSettingsStore().$patch({ dataSource: 'demo' })
    const lib = useLibraryStore()
    const seedIds = lib.list.map((e) => e.subjectId).sort((a, b) => a - b)
    expect(seedIds).toEqual([900001, 900003, 900013, 900014])
    const calIds = new Set(demoCalendar().flatMap((d) => d.items.map((i) => i.id)))
    for (const id of seedIds) expect(calIds.has(id)).toBe(true)
  })

  it('历史混入在线库的演示条目被一次性迁出演示库且幂等', () => {
    freshEnv(
      {
        '100': { subjectId: 100, name: 'Real', nameCn: '真实', status: 'doing', progress: 1, epsTotal: 12, addedAt: 1, dirty: false },
        '900005': { subjectId: 900005, name: 'Mixed', nameCn: '混入样例', status: 'doing', progress: 1, epsTotal: 12, addedAt: 2, dirty: true },
      },
      null,
    )
    const lib = useLibraryStore()
    expect(Object.keys(lib.items)).toEqual(['100'])
    expect(lib.demoItems['900005']?.dirty).toBe(false) // 迁移时清除 dirty（演示条目永不参与云同步）
    // 幂等：第二次装载不再有可迁移项
    setActivePinia(createPinia())
    useSettingsStore().$patch({ accessToken: '' })
    const lib2 = useLibraryStore()
    expect(Object.keys(lib2.items)).toEqual(['100'])
    expect(Object.keys(lib2.demoItems)).toContain('900005')
  })

  it('activeItems 按数据源模式路由读写', () => {
    freshEnv()
    const lib = useLibraryStore()
    const settings = useSettingsStore()
    settings.$patch({ dataSource: 'demo' })
    lib.add({ subjectId: 900005, name: 'Iron', nameCn: '钢铁燕尾蝶', epsTotal: 24 })
    expect(lib.demoItems['900005']).toBeTruthy()
    expect(lib.items['900005']).toBeUndefined()
    settings.$patch({ dataSource: 'online' })
    expect(lib.has(900005)).toBe(false)
    expect(lib.count).toBe(0) // 在线库为空，看不到演示库数据
  })
})
