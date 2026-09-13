/** v0.13 PL4 播放数据 IndexedDB 持久层（独立于接口缓存库）：
 *  DB animeviewer-media / 单 store「media」，三类键：
 *  - b:{subjectId}:{sort}  → MediaBinding（剧集 ↔ 播放源绑定）
 *  - f:{name}:{size}       → MediaFileRecord（本机文件句柄，仅本机）
 *  - p:{id}                → WatchPosition（播放进度，续播记忆）
 *  - d:last                → 上次扫描目录句柄（每次会话需恢复授权，浏览器安全模型）
 *  与 idbCache 同风格：打开失败 / 读写异常 / 环境不支持一律静默降级，绝不上抛。 */

import {
  bindingKey,
  fileKeyOf,
  positionKey,
  mergeMediaImport,
  type MediaBinding,
  type MediaExportSection,
  type MediaFileRecord,
  type WatchPosition,
} from './mediaCore'
import type { DanmakuItem } from './danmaku'

const DB_NAME = 'animeviewer-media'
const DB_VERSION = 1
const STORE = 'media'
const DIR_KEY = 'd:last'

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

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb()
    if (!db) return null
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function idbPut(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch {
    // 静默：写失败不影响功能（播放进度可能丢失记忆，可接受）
  }
}

async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch {
    // 静默
  }
}

/** 前缀扫描（openCursor 全遍历 + startsWith 过滤；媒体数据量级为百级，无需索引） */
async function idbScan<T>(prefix: string): Promise<{ key: string; value: T }[]> {
  try {
    const db = await openDb()
    if (!db) return []
    return await new Promise<{ key: string; value: T }[]>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).openCursor()
      const out: { key: string; value: T }[] = []
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve(out)
          return
        }
        if (String(cursor.key).startsWith(prefix)) out.push({ key: String(cursor.key), value: cursor.value as T })
        cursor.continue()
      }
      req.onerror = () => resolve(out)
    })
  } catch {
    return []
  }
}

/* ── 绑定 ── */

export async function getBinding(subjectId: number, sort: number): Promise<MediaBinding | null> {
  return idbGet<MediaBinding>(bindingKey(subjectId, sort))
}

export async function setBinding(binding: MediaBinding): Promise<void> {
  await idbPut(bindingKey(binding.subjectId, binding.sort), binding)
}

export async function removeBinding(subjectId: number, sort: number): Promise<void> {
  await idbDelete(bindingKey(subjectId, sort))
}

/** 某条目下的全部绑定（详情页剧集 Tab 渲染播放按钮用） */
export async function listBindings(subjectId: number): Promise<MediaBinding[]> {
  const rows = await idbScan<MediaBinding>(`b:${subjectId}:`)
  return rows.map((r) => r.value)
}

export async function listAllBindings(): Promise<MediaBinding[]> {
  const rows = await idbScan<MediaBinding>('b:')
  return rows.map((r) => r.value)
}

/* ── 文件句柄 ── */

export function makeFileRecord(file: { name: string; size: number }, handle?: unknown): MediaFileRecord {
  return { fileKey: fileKeyOf(file.name, file.size), name: file.name, size: file.size, handle }
}

export async function getFileRecord(fileKey: string): Promise<MediaFileRecord | null> {
  return idbGet<MediaFileRecord>(fileKey)
}

export async function putFileRecord(rec: MediaFileRecord): Promise<void> {
  await idbPut(rec.fileKey, rec)
}

/* ── 播放进度 ── */

export async function getPosition(id: string): Promise<WatchPosition | null> {
  return idbGet<WatchPosition>(positionKey(id))
}

export async function savePosition(id: string, position: number, duration: number): Promise<void> {
  if (!id) return
  await idbPut(positionKey(id), { id, position, duration, updatedAt: Date.now() } satisfies WatchPosition)
}

/* ── 弹幕（v0.15 O4）：按「条目+话数」维度 dm:{subjectId}:{sort}，与播放源解耦（换绑/换源不丢）──
   前缀用 dm: 而非 d:，避开既有 d:last 目录句柄键被 d: 前缀扫描误捞 ── */

export interface DanmakuRecord {
  subjectId: number
  sort: number
  items: DanmakuItem[]
  importedAt: number
}

export async function getDanmaku(subjectId: number, sort: number): Promise<DanmakuItem[]> {
  const rec = await idbGet<DanmakuRecord>(`dm:${subjectId}:${sort}`)
  return rec?.items ?? []
}

export async function saveDanmaku(subjectId: number, sort: number, items: DanmakuItem[]): Promise<void> {
  await idbPut(`dm:${subjectId}:${sort}`, { subjectId, sort, items, importedAt: Date.now() } satisfies DanmakuRecord)
}

/* ── 播放历史（v0.15 O5）：进度记录全量 / 单条删除 / 清空（只动进度，不碰绑定）── */

export async function listAllPositions(): Promise<WatchPosition[]> {
  const rows = await idbScan<WatchPosition>('p:')
  return rows.map((r) => r.value)
}

export async function deletePosition(id: string): Promise<void> {
  if (!id) return
  await idbDelete(positionKey(id))
}

export async function clearPositions(): Promise<void> {
  const rows = await idbScan<WatchPosition>('p:')
  for (const r of rows) await idbDelete(r.key)
}

/* ── 目录句柄（PL2：每次会话恢复一次授权） ── */

interface DirHandleRecord {
  name: string
  handle: unknown
}

export async function getLastDir(): Promise<DirHandleRecord | null> {
  return idbGet<DirHandleRecord>(DIR_KEY)
}

export async function setLastDir(name: string, handle: unknown): Promise<void> {
  await idbPut(DIR_KEY, { name, handle } satisfies DirHandleRecord)
}

/* ── 导出 / 导入（PL4：句柄不导出，恢复的绑定在播放时引导重选文件） ── */

export async function exportMedia(): Promise<MediaExportSection> {
  const [bindings, positions] = await Promise.all([listAllBindings(), idbScan<WatchPosition>('p:')])
  return { bindings, positions: positions.map((p) => p.value) }
}

export async function importMedia(section: Partial<MediaExportSection> | undefined): Promise<{ bindingsAdded: number; positionsMerged: number }> {
  const [curBindings, curPositions] = await Promise.all([listAllBindings(), idbScan<WatchPosition>('p:')])
  const merged = mergeMediaImport(
    { bindings: curBindings, positions: curPositions.map((p) => p.value) },
    section,
  )
  for (const b of merged.bindings) await idbPut(bindingKey(b.subjectId, b.sort), b)
  for (const p of merged.positions) await idbPut(positionKey(p.id), p)
  return merged.result
}
