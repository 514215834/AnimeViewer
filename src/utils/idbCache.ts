/** v0.10 P3：轻量 IndexedDB KV 持久缓存（零依赖，替代技术选型文档既定的 Dexie 方案）。
 *  定位仅为缓存层：打开失败 / 读写异常 / 环境不支持（隐私模式、无 IDB）一律静默降级为未命中，
 *  绝不影响功能正确性。TTL 由读取方判断，记录内嵌写入时间戳。 */

import { PERSIST_TTL_MS } from './cache'

const DB_NAME = 'animeviewer'
const DB_VERSION = 1
const STORE = 'cache'

interface IdbRecord {
  value: unknown
  at: number
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null)
        return
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

export async function idbGet<T>(key: string, ttlMs = PERSIST_TTL_MS): Promise<T | undefined> {
  try {
    const db = await openDb()
    if (!db) return undefined
    return await new Promise<T | undefined>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => {
        const rec = req.result as IdbRecord | undefined
        if (!rec || typeof rec.at !== 'number' || Date.now() - rec.at >= ttlMs) {
          resolve(undefined)
          return
        }
        resolve(rec.value as T)
      }
      req.onerror = () => resolve(undefined)
    })
  } catch {
    return undefined
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ value, at: Date.now() } satisfies IdbRecord, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch {
    // 静默：缓存写失败不影响功能
  }
}

export async function idbClear(): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch {
    // 静默
  }
}
