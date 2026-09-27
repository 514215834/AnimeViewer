/** v0.13 PL4 播放数据 IndexedDB 持久层（独立于接口缓存库）：
 *  v0.30 补记六 双命名空间（与追番库 animeviewer:library(:demo) 同款强隔离）：
 *  - 主库 animeviewer-media：在线模式全部播放数据 + 设备级偏好（目录句柄 d:last、18+ 记忆 k:）
 *  - 演示库 animeviewer-media:demo：演示模式全部播放数据（绑定/进度/弹幕/字幕/片头/文件句柄）
 *  命名空间在每次调用时按数据源模式求值（支持运行中切换）；旧单库时代的演示起源记录由
 *  migrateDemoMediaData 启动时一次性搬入演示库（幂等）。读写异常/环境不支持一律静默降级，绝不上抛。
 *  DB 内单 store「media」，键规则：
 *  - b:{subjectId}:{sort}  → MediaBinding（剧集 ↔ 播放源绑定）
 *  - f:{name}:{size}       → MediaFileRecord（本机文件句柄，仅本机）
 *  - p:{id}                → WatchPosition（播放进度，续播记忆）
 *  - dm:{subjectId}:{sort} → 弹幕（v0.15 O4）；sub:{fileKey} 外挂字幕（v0.23 SB2）；i:{subjectId} 片头（SB5）
 *  - d:last                → 上次扫描目录句柄（每次会话需恢复授权，浏览器安全模型） */

import { useSettingsStore } from '../stores/settings'
import {
  bindingKey,
  fileKeyOf,
  positionKey,
  selectDemoOriginKeys,
  mergeMediaImport,
  type MediaBinding,
  type MediaExportSection,
  type MediaFileRecord,
  type WatchPosition,
} from './mediaCore'
import type { DanmakuItem } from './danmaku'

const DB_NAME = 'animeviewer-media'
/** 演示库：命名沿用追番库 demo 后缀约定（localStorage animeviewer:library:demo） */
const DEMO_DB_NAME = 'animeviewer-media:demo'
const DB_VERSION = 1
const STORE = 'media'
const DIR_KEY = 'd:last'

type Ns = 'main' | 'demo'

const dbPromises = new Map<Ns, Promise<IDBDatabase | null>>()

/** 当前命名空间：播放数据按数据源模式分库（调用时求值）；设备级偏好一律 main */
function currentNs(): Ns {
  return useSettingsStore().isDemo ? 'demo' : 'main'
}

function openDb(ns: Ns): Promise<IDBDatabase | null> {
  let p = dbPromises.get(ns)
  if (!p) {
    p = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') {
          resolve(null)
          return
        }
        const req = indexedDB.open(ns === 'demo' ? DEMO_DB_NAME : DB_NAME, DB_VERSION)
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
        }
        req.onsuccess = () => {
          // 连接被浏览器/异常关闭后重置单例，下次操作自动重开（否则后续读写静默失败）
          req.result.onclose = () => {
            dbPromises.delete(ns)
          }
          resolve(req.result)
        }
        req.onerror = () => resolve(null)
        req.onblocked = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
    dbPromises.set(ns, p)
  }
  return p
}

async function idbGet<T>(ns: Ns, key: string): Promise<T | null> {
  try {
    const db = await openDb(ns)
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

async function idbPut(ns: Ns, key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb(ns)
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

async function idbDelete(ns: Ns, key: string): Promise<void> {
  try {
    const db = await openDb(ns)
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

/** 前缀扫描（openCursor 全遍历 + startsWith 过滤；媒体数据量级为百级，无需索引）；空前缀 = 全量 */
async function idbScan<T>(ns: Ns, prefix: string): Promise<{ key: string; value: T }[]> {
  try {
    const db = await openDb(ns)
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
  return idbGet<MediaBinding>(currentNs(), bindingKey(subjectId, sort))
}

export async function setBinding(binding: MediaBinding): Promise<void> {
  await idbPut(currentNs(), bindingKey(binding.subjectId, binding.sort), binding)
}

export async function removeBinding(subjectId: number, sort: number): Promise<void> {
  await idbDelete(currentNs(), bindingKey(subjectId, sort))
}

/** 某条目下的全部绑定（详情页剧集 Tab 渲染播放按钮用） */
export async function listBindings(subjectId: number): Promise<MediaBinding[]> {
  const rows = await idbScan<MediaBinding>(currentNs(), `b:${subjectId}:`)
  return rows.map((r) => r.value)
}

export async function listAllBindings(): Promise<MediaBinding[]> {
  const rows = await idbScan<MediaBinding>(currentNs(), 'b:')
  return rows.map((r) => r.value)
}

/* ── 文件句柄 ── */

export function makeFileRecord(file: { name: string; size: number }, handle?: unknown): MediaFileRecord {
  return { fileKey: fileKeyOf(file.name, file.size), name: file.name, size: file.size, handle }
}

export async function getFileRecord(fileKey: string): Promise<MediaFileRecord | null> {
  return idbGet<MediaFileRecord>(currentNs(), fileKey)
}

export async function putFileRecord(rec: MediaFileRecord): Promise<void> {
  await idbPut(currentNs(), rec.fileKey, rec)
}

/* ── 播放进度 ── */

export async function getPosition(id: string): Promise<WatchPosition | null> {
  return idbGet<WatchPosition>(currentNs(), positionKey(id))
}

export async function savePosition(id: string, position: number, duration: number): Promise<void> {
  if (!id) return
  await idbPut(currentNs(), positionKey(id), { id, position, duration, updatedAt: Date.now() } satisfies WatchPosition)
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
  const rec = await idbGet<DanmakuRecord>(currentNs(), `dm:${subjectId}:${sort}`)
  return rec?.items ?? []
}

export async function saveDanmaku(subjectId: number, sort: number, items: DanmakuItem[]): Promise<void> {
  // items 可能来自响应式 ref（深层 reactive Proxy）——IDB 结构化克隆不支持 Proxy，
  // put 会抛 DataCloneError 被静默吞掉；统一净化为纯 JSON 数据再写
  const plain = JSON.parse(JSON.stringify(items)) as DanmakuItem[]
  await idbPut(currentNs(), `dm:${subjectId}:${sort}`, { subjectId, sort, items: plain, importedAt: Date.now() } satisfies DanmakuRecord)
}

/* ── 播放历史（v0.15 O5）：进度记录全量 / 单条删除 / 清空（只动进度，不碰绑定）──
   双库后天然只含当前模式的记录（演示行在线模式不可见，反之亦然） */

export async function listAllPositions(): Promise<WatchPosition[]> {
  const rows = await idbScan<WatchPosition>(currentNs(), 'p:')
  return rows.map((r) => r.value)
}

export async function deletePosition(id: string): Promise<void> {
  if (!id) return
  await idbDelete(currentNs(), positionKey(id))
}

export async function clearPositions(): Promise<void> {
  const rows = await idbScan<WatchPosition>(currentNs(), 'p:')
  for (const r of rows) await idbDelete(currentNs(), r.key)
}

/* ── v0.23 SB2 本地外挂字幕：绑定文件时把同目录同名 srt/vtt 读成 VTT 文本一并落库 ──
   键 sub:{fileKey}——字幕文本很小（几十 KB~1MB），存文本免去播放时二次文件授权；
   换绑/换集互不影响。 */

export interface SubtitleRecord {
  fileKey: string
  /** 字幕文件展示名 */
  name: string
  vtt: string
  foundAt: number
}

export async function getSubtitle(fileKey: string): Promise<SubtitleRecord | null> {
  if (!fileKey) return null
  return idbGet<SubtitleRecord>(currentNs(), `sub:${fileKey}`)
}

export async function saveSubtitle(fileKey: string, name: string, vtt: string): Promise<void> {
  if (!fileKey) return
  await idbPut(currentNs(), `sub:${fileKey}`, { fileKey, name, vtt, foundAt: Date.now() } satisfies SubtitleRecord)
}

/* ── v0.23 SB5 跳过片头：片头时长按条目记忆（秒），未记忆返回 null（调用方用默认值）── */

export async function getIntro(subjectId: number): Promise<number | null> {
  const v = await idbGet<number>(currentNs(), `i:${subjectId}`)
  return typeof v === 'number' && v >= 0 ? v : null
}

export async function setIntro(subjectId: number, seconds: number): Promise<void> {
  await idbPut(currentNs(), `i:${subjectId}`, Math.max(0, Math.round(seconds)))
}

export async function clearIntro(subjectId: number): Promise<void> {
  await idbDelete(currentNs(), `i:${subjectId}`)
}

/* ── 目录句柄（PL2：每次会话恢复一次授权；设备级数据，恒落主库不随模式分库） ── */

interface DirHandleRecord {
  name: string
  handle: unknown
}

export async function getLastDir(): Promise<DirHandleRecord | null> {
  return idbGet<DirHandleRecord>('main', DIR_KEY)
}

export async function setLastDir(name: string, handle: unknown): Promise<void> {
  await idbPut('main', DIR_KEY, { name, handle } satisfies DirHandleRecord)
}

/* ── v0.27 A3c 18+ 确认记忆（IndexedDB 持久化）：与播放数据同库，跨浏览器/清 localStorage 后不再重确认；
   localStorage 旧值由调用方读取迁移后清理。属用户偏好，恒落主库不随模式分库 ── */

const HANIME18_KEY = 'k:hanime18-confirmed'

export async function getHanime18Confirmed(): Promise<boolean> {
  return (await idbGet<unknown>('main', HANIME18_KEY)) === true
}

export async function setHanime18Confirmed(): Promise<void> {
  await idbPut('main', HANIME18_KEY, true)
}

/* ── 导出 / 导入（PL4：句柄不导出，恢复的绑定在播放时引导重选文件；按当前模式路由） ── */

export async function exportMedia(): Promise<MediaExportSection> {
  const [bindings, positions] = await Promise.all([listAllBindings(), idbScan<WatchPosition>(currentNs(), 'p:')])
  return { bindings, positions: positions.map((p) => p.value) }
}

export async function importMedia(section: Partial<MediaExportSection> | undefined): Promise<{ bindingsAdded: number; positionsMerged: number }> {
  const [curBindings, curPositions] = await Promise.all([listAllBindings(), idbScan<WatchPosition>(currentNs(), 'p:')])
  const merged = mergeMediaImport(
    { bindings: curBindings, positions: curPositions.map((p) => p.value) },
    section,
  )
  for (const b of merged.bindings) await idbPut(currentNs(), bindingKey(b.subjectId, b.sort), b)
  for (const p of merged.positions) await idbPut(currentNs(), positionKey(p.id), p)
  return merged.result
}

/* ── v0.30 补记六 一次性迁移（幂等）：把旧单库时代落在主库的演示起源记录搬入演示库。
 *  App 启动调用；搬移后主库不再含演示键，第二次起零扫描命中零写入。
 *  键集合由 selectDemoOriginKeys 纯函数判定（含共用文件保护），此处只做搬移。 */

let demoMigrated = false

export async function migrateDemoMediaData(): Promise<void> {
  if (demoMigrated) return
  demoMigrated = true
  try {
    const all = await idbScan<unknown>('main', '')
    const moveKeys = selectDemoOriginKeys(all)
    for (const key of moveKeys) {
      const rec = all.find((e) => e.key === key)
      if (!rec) continue
      await idbPut('demo', key, rec.value)
      await idbDelete('main', key)
    }
  } catch {
    // 静默：迁移失败不阻塞启动（残留键仍留在主库，功能不受影响）
  }
}
