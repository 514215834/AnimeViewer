import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSyncStore } from './sync'
import { LOCAL_TO_SERVER, pool, serverToLocal, snapshotLegacy } from './sync'
import { useLibraryStore } from './library'
import { useSettingsStore } from './settings'
import { bangumiApi } from '../api/bangumi'
import { ADOPTED_KEY } from '../utils/accountNs'
import type { BangumiMe } from '../types/bangumi'

/** H5 同步队列与映射工具单测：不触网（freshEnv 清空 Token 后 flush 直接返回） */
function freshEnv() {
  localStorage.clear()
  setActivePinia(createPinia())
  useSettingsStore().$patch({ accessToken: '', dataSource: 'online' })
}

beforeEach(() => freshEnv())

describe('状态映射（本地 ↔ Bangumi）', () => {
  it('LOCAL_TO_SERVER：1=想看 2=看过 3=在看（官方定义与直觉相反）', () => {
    expect(LOCAL_TO_SERVER).toEqual({ wish: 1, done: 2, doing: 3 })
  })

  it('serverToLocal：4=搁置 5=抛弃 不同步到本地', () => {
    expect(serverToLocal(1)).toBe('wish')
    expect(serverToLocal(2)).toBe('done')
    expect(serverToLocal(3)).toBe('doing')
    expect(serverToLocal(4)).toBeNull()
    expect(serverToLocal(5)).toBeNull()
  })
})

describe('E1 单集增量标记队列', () => {
  it('入队并按 subjectId+episodeId 去重取最新方向', async () => {
    const sync = useSyncStore()
    await sync.markEpisodeWatched(100, 11, 0, 1, true)
    await sync.markEpisodeWatched(100, 12, 0, 2, true)
    await sync.markEpisodeWatched(100, 11, 0, 1, false) // 同集重新入队，覆盖旧标记
    expect(sync.pendingEpisodeMarks).toHaveLength(2)
    expect(sync.pendingEpisodeMarks.find((m) => m.episodeId === 11)?.type).toBe(0)
    expect(sync.pendingEpisodeMarks.find((m) => m.episodeId === 12)?.type).toBe(2)
  })

  it('H3：非本篇标记同样入队（推送走同一单集 PUT 路径）', async () => {
    const sync = useSyncStore()
    await sync.markEpisodeWatched(100, 91, 1, 1, true) // SP 集
    expect(sync.pendingEpisodeMarks).toHaveLength(1)
    expect(sync.pendingEpisodeMarks[0].type).toBe(2)
  })

  it('purgePendingEpisodeMarks 清空指定条目的待推标记', async () => {
    const sync = useSyncStore()
    await sync.markEpisodeWatched(100, 11, 0, 1, true)
    await sync.markEpisodeWatched(200, 21, 0, 1, true)
    sync.purgePendingEpisodeMarks(100)
    expect(sync.pendingEpisodeMarks.map((m) => m.subjectId)).toEqual([200])
  })
})

describe('pool 有界并发执行器', () => {
  it('并发度限制与全部执行', async () => {
    let running = 0
    let peak = 0
    const done: number[] = []
    await pool([1, 2, 3, 4, 5], 2, async (n) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      done.push(n)
    })
    expect(peak).toBeLessThanOrEqual(2)
    expect(done.sort()).toEqual([1, 2, 3, 4, 5])
  })
})

/* ── v0.31 G1/G2/G3 账户隔离（§5S）：ensureBinding / 收编 / 命名空间闸 ── */

/** me spy：按 id 造最小 BangumiMe；reject 模拟网络失败 */
function meSpy(id: number) {
  return vi
    .spyOn(bangumiApi, 'me')
    .mockResolvedValue({ id, username: `user${id}`, nickname: `账户${id}` } as BangumiMe)
}

function seedLegacy(dirty = true) {
  localStorage.setItem(
    'animeviewer:library',
    JSON.stringify({
      '100': { subjectId: 100, name: 'Legacy', nameCn: '存量', status: 'doing', progress: 1, epsTotal: 0, addedAt: 1, dirty },
    }),
  )
  localStorage.setItem(
    'animeviewer:sync:pendingEps',
    JSON.stringify([{ subjectId: 100, episodeId: 11, type: 2, at: 1 }]),
  )
}

describe('G3 ensureBinding 账户绑定与换号检测', () => {
  it('Token 空：不触网、accountKey 保持空（local 命名空间）', async () => {
    const me = meSpy(5)
    const sync = useSyncStore()
    await sync.ensureBinding()
    expect(me).not.toHaveBeenCalled()
    expect(useSettingsStore().accountKey).toBe('')
    expect(sync.adoptionPrompt).toBeNull()
  })

  it('首次绑定：me() → u5，命名空间切换 + adopted 标记写入', async () => {
    meSpy(5)
    const sync = useSyncStore()
    useSettingsStore().$patch({ accessToken: 'tok' })
    await sync.ensureBinding()
    expect(useSettingsStore().accountKey).toBe('u5')
    expect(sync.account?.id).toBe(5)
    expect(JSON.parse(localStorage.getItem(ADOPTED_KEY)!).adoptedBy).toBe('u5')
    expect(sync.bindingNotice).toContain('账户5')
  })

  it('me() 失败：保持现状（accountKey 不动、不收编不写标记）', async () => {
    seedLegacy(true)
    vi.spyOn(bangumiApi, 'me').mockRejectedValue(new Error('offline'))
    const sync = useSyncStore()
    useSettingsStore().$patch({ accessToken: 'tok' })
    await sync.ensureBinding()
    expect(useSettingsStore().accountKey).toBe('')
    expect(localStorage.getItem(ADOPTED_KEY)).toBeNull()
    expect(sync.adoptionPrompt).toBeNull()
    expect(sync.logs[0]).toContain('账户识别失败')
  })
})

describe('G2 收编迁移', () => {
  it('真实账户 + 脏数据：挂起裁决，resolve(false) 清脏收编并删旧键（幂等标记生效）', async () => {
    seedLegacy(true)
    meSpy(5)
    const sync = useSyncStore()
    useSettingsStore().$patch({ accessToken: 'tok' })
    await sync.ensureBinding()
    expect(sync.adoptionPrompt).toEqual({ dirtyCount: 2 }) // 条目 dirty 1 + 待推队列 1
    // 挂起期间旧键原封不动
    expect(snapshotLegacy()).not.toBeNull()
    await sync.resolveAdoption(false)
    // 新库收到条目本体但 dirty 已清；待推队列清空；旧键删除；标记写入
    const items = JSON.parse(localStorage.getItem('animeviewer:library:u5')!)
    expect(items['100'].nameCn).toBe('存量')
    expect(items['100']).not.toHaveProperty('dirty')
    expect(JSON.parse(localStorage.getItem('animeviewer:sync:pendingEps:u5')!)).toEqual([])
    expect(localStorage.getItem('animeviewer:library')).toBeNull()
    expect(localStorage.getItem('animeviewer:sync:pendingEps')).toBeNull()
    expect(JSON.parse(localStorage.getItem(ADOPTED_KEY)!).adoptedBy).toBe('u5')
    expect(sync.adoptionPrompt).toBeNull()
    // 幂等：再次 ensureBinding 不再挂裁决、库不再变化
    await sync.ensureBinding()
    expect(sync.adoptionPrompt).toBeNull()
  })

  it('resolve(true) 推送分支：dirty 与待推队列原样保留（同步接线由实机验收）', async () => {
    seedLegacy(true)
    meSpy(5)
    const sync = useSyncStore()
    useSettingsStore().$patch({ accessToken: 'tok' })
    await sync.ensureBinding()
    expect(sync.adoptionPrompt).toEqual({ dirtyCount: 2 })
    // 直接落地 push 语义（不触网）：applyAdoption 内部被 resolveAdoption(true) 调用前段一致
    sync.applyAdoption(snapshotLegacy()!, true)
    const items = JSON.parse(localStorage.getItem('animeviewer:library:u5')!)
    expect(items['100'].dirty).toBe(true)
    expect(JSON.parse(localStorage.getItem('animeviewer:sync:pendingEps:u5')!)).toHaveLength(1)
  })

  it('匿名（Token 空）收编：直接执行不弹裁决，dirty 原样保留，收编到 local', async () => {
    seedLegacy(true)
    const me = meSpy(5)
    const sync = useSyncStore()
    await sync.ensureBinding()
    expect(me).not.toHaveBeenCalled()
    expect(sync.adoptionPrompt).toBeNull()
    const items = JSON.parse(localStorage.getItem('animeviewer:library:local')!)
    expect(items['100'].dirty).toBe(true)
    expect(JSON.parse(localStorage.getItem(ADOPTED_KEY)!).adoptedBy).toBe('local')
    expect(localStorage.getItem('animeviewer:library')).toBeNull()
  })

  it('切换后推送范围为空：u5 的脏数据留在 :u5 键，切 u7 后 dirtyCount=0', async () => {
    seedLegacy(true)
    const me5 = meSpy(5)
    const sync = useSyncStore()
    useSettingsStore().$patch({ accessToken: 'tok' })
    await sync.ensureBinding()
    expect(sync.adoptionPrompt).toEqual({ dirtyCount: 2 })
    // 先落地推送分支脏数据（模拟用户选推送但同步未跑）
    sync.applyAdoption(snapshotLegacy()!, true)
    expect(me5).toHaveBeenCalled()
    // 换号到 u7：库重载为空 → 推送范围为 0；u5 数据原样保留
    meSpy(7)
    useSettingsStore().$patch({ accessToken: 'tok7' })
    await sync.ensureBinding()
    const library = useLibraryStore()
    expect(useSettingsStore().accountKey).toBe('u7')
    expect(library.dirtyCount()).toBe(0)
    expect(JSON.parse(localStorage.getItem('animeviewer:library:u5')!)['100'].dirty).toBe(true)
    expect(JSON.parse(localStorage.getItem(ADOPTED_KEY)!).adoptedBy).toBe('u5')
  })
})

describe('G1 命名空间闸与队列隔离', () => {
  it('pendingEps 按账户命名空间隔离：切号队列换库，切回回归', () => {
    localStorage.setItem('animeviewer:sync:pendingEps:u1', JSON.stringify([{ subjectId: 1, episodeId: 2, type: 2, at: 1 }]))
    const settings = useSettingsStore()
    const sync = useSyncStore()
    settings.applyPatch({ accountKey: 'u1' })
    sync.reloadPending()
    expect(sync.pendingEpisodeMarks).toHaveLength(1)
    settings.applyPatch({ accountKey: 'u2' })
    sync.reloadPending()
    expect(sync.pendingEpisodeMarks).toHaveLength(0)
    settings.applyPatch({ accountKey: 'u1' })
    sync.reloadPending()
    expect(sync.pendingEpisodeMarks).toHaveLength(1)
  })

  it('绑定未完成（accountKey 空）时 syncNow/flush 双闸拒绝推拉', async () => {
    const me = vi.spyOn(bangumiApi, 'me')
    const sync = useSyncStore()
    useSettingsStore().$patch({ accessToken: 'tok' })
    const r = await sync.syncNow()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('账户绑定未完成')
    expect(me).not.toHaveBeenCalled()
    expect(await sync.flushPendingEpisodeMarks()).toBe(0)
  })

  it('身份一致性闸：绑定 u5 但当前 Token 属 u7 → syncNow 中止不推不拉', async () => {
    const me = meSpy(7)
    const collections = vi.spyOn(bangumiApi, 'userCollections')
    const sync = useSyncStore()
    const settings = useSettingsStore()
    settings.$patch({ accessToken: 'tok', accountKey: 'u5' })
    const r = await sync.syncNow()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('命名空间不一致')
    expect(me).toHaveBeenCalledTimes(1)
    expect(collections).not.toHaveBeenCalled()
  })

  it('演示模式单集标记不入待推队列（连带缺陷修复：防假 episodeId 重放进真实云端）', async () => {
    const sync = useSyncStore()
    useSettingsStore().$patch({ dataSource: 'demo' })
    await sync.markEpisodeWatched(900005, 900101, 0, 1, true)
    expect(sync.pendingEpisodeMarks).toHaveLength(0)
  })
})
