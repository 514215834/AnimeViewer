import { beforeEach, describe, expect, it } from 'vitest'
import {
  ADOPTED_KEY,
  LEGACY_ACCOUNT_KEYS,
  LOCAL_NS,
  countLegacyPending,
  nsKey,
  persistedAccountNs,
  planAdoption,
  realNsOfMeId,
} from './accountNs'

/**
 * v0.31 G1/G2 纯函数单测（§5S 验收标准 1）：命名空间键形 / 收编计划（推送/保留两分支）
 * / 未推送计数 / 持久化 settings 兜底读取。localStorage 由 happy-dom 提供，逐例清空。
 */

beforeEach(() => {
  localStorage.clear()
})

describe('nsKey / realNsOfMeId 键形', () => {
  it('nsKey：账户键 = 基础键:{accountKey}，与 demo 库键天然不撞', () => {
    expect(nsKey('animeviewer:library', 'u12345')).toBe('animeviewer:library:u12345')
    expect(nsKey('animeviewer:sync:pendingEps', 'u1')).toBe('animeviewer:sync:pendingEps:u1')
    expect(nsKey('animeviewer:library', 'local')).toBe('animeviewer:library:local')
    // demo 是模式维度：同一基础键三种后缀互不相同
    const forms = ['animeviewer:library:u12345', 'animeviewer:library:local', 'animeviewer:library:demo']
    expect(new Set(forms).size).toBe(3)
  })

  it('realNsOfMeId：有效 id → u{id}；匿名/缺失 → null（调用方保持现状）', () => {
    expect(realNsOfMeId(42)).toBe('u42')
    expect(realNsOfMeId(0)).toBeNull()
    expect(realNsOfMeId(null)).toBeNull()
    expect(realNsOfMeId(undefined)).toBeNull()
  })

  it('persistedAccountNs：读持久化 settings 的 accountKey，空值回退 local', () => {
    expect(persistedAccountNs()).toBe(LOCAL_NS)
    localStorage.setItem('animeviewer:settings', JSON.stringify({ accountKey: 'u77' }))
    expect(persistedAccountNs()).toBe('u77')
    localStorage.setItem('animeviewer:settings', JSON.stringify({ accountKey: '' }))
    expect(persistedAccountNs()).toBe(LOCAL_NS)
  })
})

function legacySnapshot(overrides: Partial<Parameters<typeof planAdoption>[0]> = {}) {
  return {
    items: { '100': { subjectId: 100, name: 'A', dirty: true }, '200': { subjectId: 200, name: 'B', dirty: false } },
    characters: { '10': { characterId: 10, name: 'C', dirty: true } },
    persons: {},
    removed: { '300': 1758600000000 },
    pendingEps: [{ subjectId: 100, episodeId: 11, type: 2, at: 1 }],
    lastSyncAt: 1758500000000,
    ...overrides,
  }
}

describe('planAdoption 收编计划', () => {
  it('push=true：原样并入（dirty 与待推队列保留，随同步推送到目标账户）', () => {
    const plan = planAdoption(legacySnapshot(), true)
    expect(Object.keys(plan.items)).toEqual(['100', '200'])
    expect((plan.items['100'] as { dirty?: boolean }).dirty).toBe(true)
    expect(plan.pendingEps).toHaveLength(1)
    expect(plan.removed['300']).toBe(1758600000000)
    expect(plan.lastSyncAt).toBe(1758500000000)
  })

  it('push=false「保留本地不推送」：条目/角色/人物 dirty 清零，单集待推队列清空', () => {
    const plan = planAdoption(legacySnapshot(), false)
    expect(Object.keys(plan.items)).toEqual(['100', '200']) // 条目本体保留（本地可看可删）
    expect(plan.items['100']).not.toHaveProperty('dirty')
    expect(plan.items['100']).not.toHaveProperty('dirtyAt')
    expect(plan.characters['10']).not.toHaveProperty('dirty')
    expect(plan.pendingEps).toEqual([])
    expect(plan.removed['300']).toBe(1758600000000)
  })

  it('收编计划不动墓碑与 lastSyncAt（两分支一致）', () => {
    for (const push of [true, false]) {
      const plan = planAdoption(legacySnapshot(), push)
      expect(plan.removed).toEqual(legacySnapshot().removed)
      expect(plan.lastSyncAt).toBe(1758500000000)
    }
  })
})

describe('countLegacyPending 未推送计数', () => {
  it('条目 dirty + 角色 dirty + 人物 dirty + 单集队列长度', () => {
    expect(countLegacyPending(legacySnapshot())).toBe(3) // 条目 1 + 角色 1 + 队列 1
    expect(countLegacyPending(planAdoption(legacySnapshot(), false))).toBe(0)
  })
})

describe('LEGACY_ACCOUNT_KEYS 旧键清单', () => {
  it('覆盖 6 个升级前无后缀键，且与 adopted 标记键不重叠', () => {
    expect(LEGACY_ACCOUNT_KEYS).toHaveLength(6)
    expect(LEGACY_ACCOUNT_KEYS).not.toContain(ADOPTED_KEY)
  })
})
