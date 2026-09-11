import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSyncStore } from './sync'
import { LOCAL_TO_SERVER, pool, serverToLocal } from './sync'
import { useSettingsStore } from './settings'

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
