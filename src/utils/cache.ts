/** v0.10 P3：缓存原语（纯逻辑，供单测）。
 *  createTtlCache 在 v0.2 内存 TTL 基础上增加容量上限与 LRU 淘汰：
 *  Map 的插入序即新鲜序——命中/写入时重插刷新，容量超限时淘汰最旧条目。 */

export interface CacheEntry<T> {
  at: number
  data: T
}

/** 超出容量时按 Map 插入序（最旧在前）淘汰，返回淘汰数量 */
export function evictLru<K, V>(map: Map<K, V>, maxEntries: number): number {
  let evicted = 0
  while (map.size > maxEntries) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
    evicted += 1
  }
  return evicted
}

export function createTtlCache<T>(ttlMs: number, maxEntries = 300) {
  const map = new Map<string, CacheEntry<T>>()
  return {
    get(key: string): T | undefined {
      const hit = map.get(key)
      if (!hit) return undefined
      if (Date.now() - hit.at >= ttlMs) {
        // 过期条目直接移除，避免僵尸条目长期占用容量
        map.delete(key)
        return undefined
      }
      // 命中后重插刷新 LRU 新鲜度
      map.delete(key)
      map.set(key, hit)
      return hit.data
    },
    set(key: string, data: T) {
      map.delete(key)
      map.set(key, { at: Date.now(), data })
      evictLru(map, maxEntries)
    },
    clear() {
      map.clear()
    },
  }
}

/** 持久层兜底 TTL：内存层仍按各自 5/10/30min 判新鲜，持久层只保证跨会话有底 */
export const PERSIST_TTL_MS = 24 * 60 * 60 * 1000
