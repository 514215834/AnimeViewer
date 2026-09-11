import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTtlCache, evictLru } from './cache'

describe('evictLru（纯逻辑）', () => {
  it('超出容量时按插入序淘汰最旧条目并返回淘汰数', () => {
    const map = new Map<string, number>([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
    expect(evictLru(map, 2)).toBe(1)
    expect([...map.keys()]).toEqual(['b', 'c'])
    // 未超限时不淘汰
    expect(evictLru(map, 2)).toBe(0)
  })

  it('空表与容量为 0 的边界', () => {
    const map = new Map<string, number>()
    expect(evictLru(map, 0)).toBe(0)
    map.set('x', 1)
    expect(evictLru(map, 0)).toBe(1)
    expect(map.size).toBe(0)
  })
})

describe('createTtlCache', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('TTL 内命中；过期后失效且条目被移除（不占用容量）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const c = createTtlCache<string>(1000, 10)
    c.set('k', 'v')
    vi.setSystemTime(800)
    expect(c.get('k')).toBe('v')
    vi.setSystemTime(1600)
    expect(c.get('k')).toBeUndefined()
    // 过期条目已删除：后续写入 10 条也不会先挤掉「k」
    for (let i = 0; i < 10; i++) c.set(`k${i}`, 'x')
    expect(c.get('k0')).toBe('x')
  })

  it('容量上限 LRU：淘汰最旧未访问条目，get 刷新新鲜度', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const c = createTtlCache<number>(100000, 2)
    c.set('a', 1)
    c.set('b', 2)
    vi.setSystemTime(10)
    expect(c.get('a')).toBe(1) // a 被访问 → 变为最新
    c.set('c', 3) // 容量 2，淘汰最旧的 b
    expect(c.get('a')).toBe(1)
    expect(c.get('b')).toBeUndefined()
    expect(c.get('c')).toBe(3)
  })

  it('重复 set 同一 key 不产生重复条目', () => {
    const c = createTtlCache<number>(100000, 3)
    c.set('a', 1)
    c.set('a', 2)
    expect(c.get('a')).toBe(2)
    c.set('b', 3)
    c.set('c', 4)
    expect(c.get('a')).toBe(2)
    expect(c.get('b')).toBe(3)
    expect(c.get('c')).toBe(4)
  })
})
