import { defineStore } from 'pinia'
import { loadJson, saveJson } from '../utils/storage'

export type WatchStatus = 'wish' | 'doing' | 'done'

export interface LibraryEntry {
  subjectId: number
  name: string
  nameCn: string
  image?: string
  status: WatchStatus
  progress: number
  epsTotal: number
  /** 已看单集（对应 Bangumi episode.sort） */
  watchedEps?: number[]
  /** 条目评分，加追时从详情带入 */
  score?: number
  /** 条目标签（加追/同步时取 Top5），用于库内标签筛选 */
  tags?: string[]
  addedAt: number
  /** 本地有未推送到云端的改动 */
  dirty?: boolean
  /** 服务端收藏最近更新时间（ISO），用于合并冲突判断 */
  serverUpdatedAt?: string
}

interface LibraryState {
  items: Record<string, LibraryEntry>
}

const STORAGE_KEY = 'animeviewer:library'

const STATUS_VALUES: readonly string[] = ['wish', 'doing', 'done']

// 注意：state 必须用具名键包裹 Record，直接把 Record 作为 state 根对象
// 会导致 getter 收到混入 actions 的 store 实例
export const useLibraryStore = defineStore('library', {
  state: (): LibraryState => ({
    items: loadJson<Record<string, LibraryEntry>>(STORAGE_KEY, {}),
  }),
  getters: {
    list: (s): LibraryEntry[] => Object.values(s.items).sort((a, b) => b.addedAt - a.addedAt),
    count: (s) => Object.keys(s.items).length,
  },
  actions: {
    has(id: number): boolean {
      return !!this.items[String(id)]
    },
    entry(id: number): LibraryEntry | undefined {
      return this.items[String(id)]
    },
    add(payload: {
      subjectId: number
      name: string
      nameCn: string
      image?: string
      epsTotal: number
      score?: number
      tags?: string[]
    }) {
      this.items[String(payload.subjectId)] = {
        subjectId: payload.subjectId,
        name: payload.name,
        nameCn: payload.nameCn,
        image: payload.image,
        status: 'wish',
        progress: 0,
        epsTotal: payload.epsTotal,
        watchedEps: [],
        score: payload.score,
        tags: payload.tags,
        addedAt: Date.now(),
        dirty: true,
      }
      this.persist()
    },
    remove(id: number) {
      delete this.items[String(id)]
      this.persist()
    },
    setStatus(id: number, status: WatchStatus) {
      const e = this.items[String(id)]
      if (!e) return
      e.status = status
      if (status === 'done' && e.epsTotal > 0) this.setProgress(id, e.epsTotal)
      e.dirty = true
      this.persist()
    },
    setProgress(id: number, progress: number) {
      const e = this.items[String(id)]
      if (!e) return
      e.progress = progress
      // 数字进度与单集勾选双向同步：视为已看第 1~N 话
      e.watchedEps = Array.from({ length: progress }, (_, i) => i + 1)
      e.dirty = true
      this.persist()
    },
    setEpisodeWatched(id: number, sort: number, watched: boolean) {
      const e = this.items[String(id)]
      if (!e) return
      const set = new Set(e.watchedEps ?? [])
      if (watched) set.add(sort)
      else set.delete(sort)
      e.watchedEps = [...set].sort((a, b) => a - b)
      e.progress = e.watchedEps.length
      e.dirty = true
      this.persist()
    },
    setWatchedAll(id: number, watched: boolean, sorts: number[]) {
      const e = this.items[String(id)]
      if (!e) return
      if (watched) {
        const set = new Set([...(e.watchedEps ?? []), ...sorts])
        e.watchedEps = [...set].sort((a, b) => a - b)
      } else {
        e.watchedEps = []
      }
      e.progress = e.watchedEps.length
      e.dirty = true
      this.persist()
    },
    /** 合并云端收藏：本地无则创建；本地有未推送改动则本地赢；否则服务端较新时覆盖 */
    upsertFromServer(payload: {
      subjectId: number
      name: string
      nameCn: string
      image?: string
      status: WatchStatus
      progress: number
      epsTotal: number
      tags?: string[]
      serverUpdatedAt?: string
    }): 'created' | 'updated' | 'skipped' {
      const key = String(payload.subjectId)
      const local = this.items[key]
      if (!local) {
        this.items[key] = {
          subjectId: payload.subjectId,
          name: payload.name,
          nameCn: payload.nameCn,
          image: payload.image,
          status: payload.status,
          progress: payload.progress,
          epsTotal: payload.epsTotal,
          watchedEps: Array.from({ length: payload.progress }, (_, i) => i + 1),
          tags: payload.tags,
          addedAt: Date.now(),
          dirty: false,
          serverUpdatedAt: payload.serverUpdatedAt,
        }
        this.persist()
        return 'created'
      }
      if (local.dirty) return 'skipped'
      if (
        payload.serverUpdatedAt &&
        local.serverUpdatedAt &&
        payload.serverUpdatedAt <= local.serverUpdatedAt
      ) {
        return 'skipped'
      }
      local.status = payload.status
      local.progress = payload.progress
      local.watchedEps = Array.from({ length: payload.progress }, (_, i) => i + 1)
      local.serverUpdatedAt = payload.serverUpdatedAt ?? local.serverUpdatedAt
      this.persist()
      return 'updated'
    },
    /** 推送成功后清除脏标记 */
    markSynced(id: number, serverUpdatedAt: string) {
      const e = this.items[String(id)]
      if (!e) return
      e.dirty = false
      e.serverUpdatedAt = serverUpdatedAt
      this.persist()
    },
    /** 本地待推送的条目数 */
    dirtyCount(): number {
      return Object.values(this.items).filter((e) => e.dirty).length
    },
    /** 导入收藏：校验并合并（已存在的条目跳过），返回统计 */
    importEntries(raw: unknown[]): { added: number; skipped: number } {
      let added = 0
      let skipped = 0
      for (const item of raw) {
        const e = item as Partial<LibraryEntry>
        if (typeof e?.subjectId !== 'number' || typeof e?.name !== 'string' || !e.name) {
          skipped++
          continue
        }
        if (this.items[String(e.subjectId)]) {
          skipped++
          continue
        }
        this.items[String(e.subjectId)] = {
          subjectId: e.subjectId,
          name: e.name,
          nameCn: typeof e.nameCn === 'string' && e.nameCn ? e.nameCn : e.name,
          image: typeof e.image === 'string' ? e.image : undefined,
          status: STATUS_VALUES.includes(e.status as string) ? (e.status as WatchStatus) : 'wish',
          progress: Number(e.progress) || 0,
          epsTotal: Number(e.epsTotal) || 0,
          watchedEps: Array.isArray(e.watchedEps) ? e.watchedEps.filter((n) => typeof n === 'number') : [],
          score: typeof e.score === 'number' ? e.score : undefined,
          tags: Array.isArray(e.tags) ? e.tags.filter((t) => typeof t === 'string') : undefined,
          addedAt: Number(e.addedAt) || Date.now(),
          dirty: true,
        }
        added++
      }
      this.persist()
      return { added, skipped }
    },
    persist() {
      saveJson(STORAGE_KEY, JSON.parse(JSON.stringify(this.items)))
    },
  },
})
