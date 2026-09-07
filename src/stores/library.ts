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
  /** 本地最后一次改动时间（ms）：E2 冲突合并时与服务端 updated_at 比较新旧 */
  dirtyAt?: number
  /** 服务端收藏最近更新时间（ISO），用于合并冲突判断 */
  serverUpdatedAt?: string
}

/** E6 我收藏的角色（characterId 为键） */
export interface CollectedCharacter {
  characterId: number
  name: string
  nameCn?: string
  image?: string
  addedAt: number
  /** 本地收藏尚未推送到云端（collectCharacter 失败时保留重试） */
  dirty?: boolean
}

interface LibraryState {
  items: Record<string, LibraryEntry>
  characters: Record<string, CollectedCharacter>
  /** 移除墓碑（subjectId → 移除时间）：云端无删除收藏端点，同步拉取时跳过这些条目防止复活；显式重新加追会解除 */
  removedSubjects: Record<string, number>
}

const STORAGE_KEY = 'animeviewer:library'
const CHARACTERS_KEY = 'animeviewer:characters'
const REMOVED_KEY = 'animeviewer:removedSubjects'

const STATUS_VALUES: readonly string[] = ['wish', 'doing', 'done']

// 注意：state 必须用具名键包裹 Record，直接把 Record 作为 state 根对象
// 会导致 getter 收到混入 actions 的 store 实例
export const useLibraryStore = defineStore('library', {
  state: (): LibraryState => ({
    items: loadJson<Record<string, LibraryEntry>>(STORAGE_KEY, {}),
    characters: loadJson<Record<string, CollectedCharacter>>(CHARACTERS_KEY, {}),
    removedSubjects: loadJson<Record<string, number>>(REMOVED_KEY, {}),
  }),
  getters: {
    list: (s): LibraryEntry[] => Object.values(s.items).sort((a, b) => b.addedAt - a.addedAt),
    count: (s) => Object.keys(s.items).length,
    /** E6 我的角色列表（按收藏时间倒序） */
    characterList: (s): CollectedCharacter[] =>
      Object.values(s.characters).sort((a, b) => b.addedAt - a.addedAt),
    characterCount: (s) => Object.keys(s.characters).length,
    /** 待推送的角色收藏（collect 失败保留下次重放） */
    pendingCharacters(): CollectedCharacter[] {
      return this.characterList.filter((c) => c.dirty)
    },
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
      // 显式加追解除移除墓碑，否则云同步拉取会跳过该条目
      delete this.removedSubjects[String(payload.subjectId)]
      this.persist()
    },
    remove(id: number) {
      delete this.items[String(id)]
      // 移除墓碑：云端无删除收藏端点，不记墓碑的话下次同步拉取会复活该条目
      this.removedSubjects[String(id)] = Date.now()
      this.persist()
    },
    setStatus(id: number, status: WatchStatus) {
      const e = this.items[String(id)]
      if (!e) return
      e.status = status
      if (status === 'done' && e.epsTotal > 0) this.setProgress(id, e.epsTotal)
      e.dirty = true
      e.dirtyAt = Date.now()
      this.persist()
    },
    setProgress(id: number, progress: number) {
      const e = this.items[String(id)]
      if (!e) return
      e.progress = progress
      // 数字进度与单集勾选双向同步：视为已看第 1~N 话
      e.watchedEps = Array.from({ length: progress }, (_, i) => i + 1)
      e.dirty = true
      e.dirtyAt = Date.now()
      this.persist()
    },
    /** 整表标记（v0.3 路径）：条目级 dirty，同步时整表 PATCH */
    setEpisodeWatched(id: number, sort: number, watched: boolean) {
      const e = this.items[String(id)]
      if (!e) return
      const set = new Set(e.watchedEps ?? [])
      if (watched) set.add(sort)
      else set.delete(sort)
      e.watchedEps = [...set].sort((a, b) => a - b)
      e.progress = e.watchedEps.length
      e.dirty = true
      e.dirtyAt = Date.now()
      this.persist()
    },
    /**
     * E1 单集增量标记的本地部分：仅更新单集与进度，不打条目 dirty——
     * 云端推送走 sync store 的 pendingEpisodeMarks 队列（单集 PUT），避免整表 PATCH 覆盖云端并发改动
     */
    markEpisodeLocal(id: number, sort: number, watched: boolean) {
      const e = this.items[String(id)]
      if (!e) return
      const set = new Set(e.watchedEps ?? [])
      if (watched) set.add(sort)
      else set.delete(sort)
      e.watchedEps = [...set].sort((a, b) => a - b)
      e.progress = e.watchedEps.length
      e.dirtyAt = Date.now()
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
      e.dirtyAt = Date.now()
      this.persist()
    },
    /** 合并云端收藏：本地无则创建；本地有未推送改动时按 dirtyAt 与远端 updated_at 做条目级新者合并（E2），否则服务端较新时覆盖 */
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
    }): 'created' | 'updated' | 'skipped' | 'conflict-local-win' | 'conflict-remote-win' {
      const key = String(payload.subjectId)
      const local = this.items[key]
      if (!local) {
        // 移除墓碑：用户已明确移除该条目，云同步拉取不得复活（显式加追时墓碑已被解除）
        if (this.removedSubjects[key]) return 'skipped'
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
      if (
        payload.serverUpdatedAt &&
        local.serverUpdatedAt &&
        payload.serverUpdatedAt <= local.serverUpdatedAt
      ) {
        return 'skipped'
      }
      // E2：本地 dirty（有未推送改动）且远端也在本地上次同步后发生了变化 → 条目级冲突，按时间新者胜
      if (local.dirty) {
        const remoteMs = payload.serverUpdatedAt ? Date.parse(payload.serverUpdatedAt) : 0
        const localMs = local.dirtyAt ?? local.addedAt
        if (remoteMs > localMs) {
          local.status = payload.status
          local.progress = payload.progress
          local.watchedEps = Array.from({ length: payload.progress }, (_, i) => i + 1)
          local.dirty = false
          local.serverUpdatedAt = payload.serverUpdatedAt
          this.persist()
          return 'conflict-remote-win'
        }
        return 'conflict-local-win' // 本地改动较新：保留 dirty，稍后推送覆盖云端
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
    /* ── E6 我的角色 ── */
    hasCharacter(characterId: number): boolean {
      return !!this.characters[String(characterId)]
    },
    /** 本地点击收藏角色（在线推送失败时保留 dirty，由同步队列重放） */
    addCharacter(payload: { characterId: number; name: string; nameCn?: string; image?: string }) {
      const key = String(payload.characterId)
      if (this.characters[key]) return
      this.characters[key] = {
        characterId: payload.characterId,
        name: payload.name,
        nameCn: payload.nameCn,
        image: payload.image,
        addedAt: Date.now(),
        dirty: true,
      }
      this.persist()
    },
    /** 云端收藏列表合并到本地（E6 同步拉取） */
    upsertCharacterFromServer(payload: { characterId: number; name: string; nameCn?: string; image?: string }) {
      const key = String(payload.characterId)
      const existing = this.characters[key]
      if (existing) {
        if (existing.dirty) return 'skipped'
        existing.name = payload.name
        existing.nameCn = payload.nameCn ?? existing.nameCn
        existing.image = payload.image ?? existing.image
        this.persist()
        return
      }
      this.characters[key] = { ...payload, addedAt: Date.now(), dirty: false }
      this.persist()
    },
    /** 本地移除角色收藏（云端取消依赖 DELETE /characters/{id}/collect，服务端实测未实现） */
    removeCharacter(characterId: number) {
      delete this.characters[String(characterId)]
      this.persist()
    },
    /** 推送成功后清除角色收藏的脏标记 */
    markCharacterSynced(characterId: number) {
      const c = this.characters[String(characterId)]
      if (!c) return
      c.dirty = false
      this.persist()
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
      // 导入视为显式加追意图，解除移除墓碑
      delete this.removedSubjects[String(e.subjectId)]
      added++
      }
      this.persist()
      return { added, skipped }
    },
    persist() {
      saveJson(STORAGE_KEY, JSON.parse(JSON.stringify(this.items)))
      saveJson(CHARACTERS_KEY, JSON.parse(JSON.stringify(this.characters)))
      saveJson(REMOVED_KEY, JSON.parse(JSON.stringify(this.removedSubjects)))
    },
  },
})
