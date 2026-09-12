import { defineStore } from 'pinia'
import { loadJson, saveJson } from '../utils/storage'
import { useSettingsStore } from './settings'
import { isDemoSubjectId } from '../api/demoIds'

export type WatchStatus = 'wish' | 'doing' | 'done'

export interface LibraryEntry {
  subjectId: number
  name: string
  nameCn: string
  image?: string
  status: WatchStatus
  progress: number
  epsTotal: number
  /** 已看单集（对应 Bangumi episode.sort；仅正篇 type=0。SP/OP/ED 见 watchedSpecial） */
  watchedEps?: number[]
  /** H3 非「本篇」单集已看标记：EpType（1=SP 2=OP 3=ED 4=预告）→ sorts 复合桶。
   *  正篇 sort 空间与非本篇重叠（SP sort=1 与第 1 话冲突），故分开存储；进度/沉浸观剧仍只统计正篇 */
  watchedSpecial?: Record<string, number[]>
  /** 条目评分，加追时从详情带入 */
  score?: number
  /** F6 我的评分（0-10 整数；0=用户主动清除，推送 0 删除云端评分；undefined=从未评过，推送时忽略） */
  myRate?: number
  /** F6 我的笔记/短评（同步到云端收藏评价；空串=清除，undefined=从未写过） */
  myComment?: string
  /** F6 私密收藏（仅自己可见；undefined=跟随云端现状） */
  privateFlag?: boolean
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

/** F2 我收藏的人物（与角色收藏对称；personId 为键） */
export interface CollectedPerson {
  personId: number
  name: string
  nameCn?: string
  image?: string
  career?: string[]
  addedAt: number
  /** 本地收藏尚未推送到云端（collectPerson 失败时保留重试） */
  dirty?: boolean
}

interface LibraryState {
  /** 在线收藏（云同步唯一作用域） */
  items: Record<string, LibraryEntry>
  /** 演示收藏（离线模式专用，首次进入演示模式时由 ensureDemoSeed 播种，与在线数据完全隔离） */
  demoItems: Record<string, LibraryEntry>
  /** v0.10 P1：演示库待播种标记（true=演示存储为空且尚未加载 demo 模块，App.vue 监听 isDemo 触发播种） */
  needsDemoSeed?: boolean
  characters: Record<string, CollectedCharacter>
  persons: Record<string, CollectedPerson>
  /** 移除墓碑（subjectId → 移除时间）：云端无删除收藏端点，同步拉取时跳过这些条目防止复活；显式重新加追会解除 */
  removedSubjects: Record<string, number>
}

const STORAGE_KEY = 'animeviewer:library'
/** 演示模式「我的追番」独立存储：与在线收藏（STORAGE_KEY）互不可见、互不影响 */
const DEMO_STORAGE_KEY = 'animeviewer:library:demo'
const CHARACTERS_KEY = 'animeviewer:characters'
const PERSONS_KEY = 'animeviewer:persons'
const REMOVED_KEY = 'animeviewer:removedSubjects'

const STATUS_VALUES: readonly string[] = ['wish', 'doing', 'done']

/** H3 导入时校验 watchedSpecial：仅保留「数值键 → 数值数组」形态的桶 */
function normalizeSpecial(raw: unknown): Record<string, number[]> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, number[]> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v) && v.every((n) => typeof n === 'number')) out[k] = v as number[]
  }
  return Object.keys(out).length ? out : undefined
}

/** 演示/在线追番库分库装载：演示库首次进入时由 App.vue 触发 ensureDemoSeed 异步播种（v0.10 P1 起 demo 模块按需加载）；
 *  历史版本曾共用一个存储，混入在线库的演示条目在此一次性迁出演示库（演示条目不参与云同步，dirty 无意义故清除） */
function loadNamespacedItems(): { online: Record<string, LibraryEntry>; demo: Record<string, LibraryEntry>; needsSeed: boolean } {
  const online = loadJson<Record<string, LibraryEntry>>(STORAGE_KEY, {})
  const storedDemo = loadJson<Record<string, LibraryEntry> | null>(DEMO_STORAGE_KEY, null)
  const demo: Record<string, LibraryEntry> = storedDemo ?? {}
  let migrated = false
  for (const key of Object.keys(online)) {
    if (isDemoSubjectId(Number(key))) {
      if (!demo[key]) demo[key] = { ...online[key], dirty: false }
      delete online[key]
      migrated = true
    }
  }
  if (migrated) saveJson(DEMO_STORAGE_KEY, demo)
  if (migrated) saveJson(STORAGE_KEY, online)
  return { online, demo, needsSeed: !storedDemo }
}

// 注意：state 必须用具名键包裹 Record，直接把 Record 作为 state 根对象
// 会导致 getter 收到混入 actions 的 store 实例
export const useLibraryStore = defineStore('library', {
  state: (): LibraryState => {
    const { online, demo, needsSeed } = loadNamespacedItems()
    return {
      items: online,
      demoItems: demo,
      needsDemoSeed: needsSeed,
      characters: loadJson<Record<string, CollectedCharacter>>(CHARACTERS_KEY, {}),
      persons: loadJson<Record<string, CollectedPerson>>(PERSONS_KEY, {}),
      removedSubjects: loadJson<Record<string, number>>(REMOVED_KEY, {}),
    }
  },
  getters: {
    /** 当前模式的收藏记录：演示/在线双库隔离，全部读写经由该入口路由 */
    activeItems(): Record<string, LibraryEntry> {
      return useSettingsStore().isDemo ? this.demoItems : this.items
    },
    list(): LibraryEntry[] {
      return Object.values(this.activeItems).sort((a, b) => b.addedAt - a.addedAt)
    },
    count(): number {
      return Object.keys(this.activeItems).length
    },
    /** E6 我的角色列表（按收藏时间倒序） */
    characterList: (s): CollectedCharacter[] =>
      Object.values(s.characters).sort((a, b) => b.addedAt - a.addedAt),
    characterCount: (s) => Object.keys(s.characters).length,
    /** 待推送的角色收藏（collect 失败保留下次重放） */
    pendingCharacters(): CollectedCharacter[] {
      return this.characterList.filter((c) => c.dirty)
    },
    /* ── F2 我的人物 ── */
    personList: (s): CollectedPerson[] =>
      Object.values(s.persons).sort((a, b) => b.addedAt - a.addedAt),
    personCount: (s) => Object.keys(s.persons).length,
    /** 待推送的人物收藏 */
    pendingPersons(): CollectedPerson[] {
      return this.personList.filter((p) => p.dirty)
    },
  },
  actions: {
    /** v0.10 P1：演示库异步播种——demo 模块动态加载后写入演示库并持久化；
     *  仅演示模式触发（在线模式不下载 demo chunk），仅首次（演示存储为空）执行一次 */
    async ensureDemoSeed() {
      if (!this.needsDemoSeed) return
      this.needsDemoSeed = false
      try {
        const { demoLibrary } = await import('../api/demo')
        for (const e of demoLibrary()) this.demoItems[String(e.subjectId)] = e
        saveJson(DEMO_STORAGE_KEY, this.demoItems)
      } catch {
        // demo 模块加载失败：演示库保持为空，各视图已有空态兜底
      }
    },
    has(id: number): boolean {
      return !!this.activeItems[String(id)]
    },
    entry(id: number): LibraryEntry | undefined {
      return this.activeItems[String(id)]
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
      this.activeItems[String(payload.subjectId)] = {
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
      delete this.activeItems[String(id)]
      // 移除墓碑：云端无删除收藏端点，不记墓碑的话下次同步拉取会复活该条目
      this.removedSubjects[String(id)] = Date.now()
      this.persist()
    },
    setStatus(id: number, status: WatchStatus) {
      const e = this.activeItems[String(id)]
      if (!e) return
      e.status = status
      if (status === 'done' && e.epsTotal > 0) this.setProgress(id, e.epsTotal)
      e.dirty = true
      e.dirtyAt = Date.now()
      this.persist()
    },
    setProgress(id: number, progress: number) {
      const e = this.activeItems[String(id)]
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
      const e = this.activeItems[String(id)]
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
      const e = this.activeItems[String(id)]
      if (!e) return
      const set = new Set(e.watchedEps ?? [])
      if (watched) set.add(sort)
      else set.delete(sort)
      e.watchedEps = [...set].sort((a, b) => a - b)
      e.progress = e.watchedEps.length
      e.dirtyAt = Date.now()
      this.persist()
    },
    /** H3 非本篇单集标记的本地部分：写 watchedSpecial 复合桶，不影响正篇 watchedEps/进度/完成度 */
    markSpecialEpisodeLocal(id: number, epType: number, sort: number, watched: boolean) {
      const e = this.activeItems[String(id)]
      if (!e || epType === 0) return
      const key = String(epType)
      const bucket = new Set(e.watchedSpecial?.[key] ?? [])
      if (watched) bucket.add(sort)
      else bucket.delete(sort)
      const nextSpecial: Record<string, number[]> = { ...(e.watchedSpecial ?? {}) }
      if (bucket.size) nextSpecial[key] = [...bucket].sort((a, b) => a - b)
      else delete nextSpecial[key]
      if (Object.keys(nextSpecial).length) e.watchedSpecial = nextSpecial
      else delete e.watchedSpecial
      e.dirtyAt = Date.now()
      this.persist()
    },
    /** H3 读取非本篇桶内 sort（供视图判定勾选态） */
    hasSpecialEpisode(id: number, epType: number, sort: number): boolean {
      return !!this.activeItems[String(id)]?.watchedSpecial?.[String(epType)]?.includes(sort)
    },
    setWatchedAll(id: number, watched: boolean, sorts: number[]) {
      const e = this.activeItems[String(id)]
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
    /**
     * F6 我的评分与笔记：本地即时保存并打条目级 dirty（沿用 E2 三态推送）。
     * rate=0 表示用户主动清除评分（推送 0 删除云端评分）；comment 空串表示清除笔记
     */
    setMyReview(id: number, patch: { rate?: number; comment?: string; isPrivate?: boolean }) {
      const e = this.activeItems[String(id)]
      if (!e) return
      if (patch.rate !== undefined && e.myRate !== patch.rate) e.myRate = patch.rate
      if (patch.comment !== undefined && e.myComment !== patch.comment) e.myComment = patch.comment
      if (patch.isPrivate !== undefined && e.privateFlag !== patch.isPrivate) e.privateFlag = patch.isPrivate
      e.dirty = true
      e.dirtyAt = Date.now()
      this.persist()
    },
    /**
     * F1 云端单集状态合并（云端覆盖本地）。调用方保证仅在「云端存在单集记录」时调用，
     * 避免把 ep_status 推导出的本地进度误清；返回是否有变化
     */
    applyCloudEpisodes(id: number, sorts: number[]): boolean {
      const e = this.activeItems[String(id)]
      if (!e) return false
      const next = [...new Set(sorts)].sort((a, b) => a - b)
      const prev = e.watchedEps ?? []
      if (prev.length === next.length && prev.every((v, i) => v === next[i])) return false
      e.watchedEps = next
      e.progress = next.length
      this.persist()
      return true
    },
    /** T5 云端非本篇单集状态合并：payload 中出现的类型桶（EpType→sorts）整体覆盖本地，
     *  云端无记录的桶保留本地（与 applyCloudEpisodes 的「有记录才覆盖」语义一致）；返回是否有变化 */
    applyCloudSpecialEpisodes(id: number, special: Record<string, number[]>): boolean {
      const e = this.activeItems[String(id)]
      if (!e) return false
      const next: Record<string, number[]> = { ...(e.watchedSpecial ?? {}) }
      let changed = false
      for (const [k, sorts] of Object.entries(special)) {
        const merged = [...new Set(sorts)].sort((a, b) => a - b)
        const prev = next[k]
        if (!prev || prev.length !== merged.length || prev.some((v, i) => v !== merged[i])) {
          next[k] = merged
          changed = true
        }
      }
      if (!changed) return false
      if (Object.keys(next).length) e.watchedSpecial = next
      else delete e.watchedSpecial
      this.persist()
      return true
    },
    /** 合并云端收藏：本地无则创建；本地有未推送改动时按 dirtyAt 与远端 updated_at 做条目级新者合并（E2），否则服务端较新时覆盖。
     *  F6：rate/comment/private 属「轻量字段」——规范明示修改评分/评价时 updated_at 不刷新（官方 bug），
     *  条目级新旧比对不可靠，故对非 dirty 条目无条件跟随云端（dirty 条目保留本地值待推送） */
    upsertFromServer(payload: {
      subjectId: number
      name: string
      nameCn: string
      image?: string
      status: WatchStatus
      progress: number
      epsTotal: number
      tags?: string[]
      rate?: number
      comment?: string
      isPrivate?: boolean
      serverUpdatedAt?: string
    }): 'created' | 'updated' | 'skipped' | 'conflict-local-win' | 'conflict-remote-win' {
      const key = String(payload.subjectId)
      const items = this.activeItems
      const local = items[key]
      const cloudRate = typeof payload.rate === 'number' && payload.rate > 0 ? payload.rate : undefined
      const cloudComment = typeof payload.comment === 'string' ? payload.comment : undefined
      const cloudPrivate = typeof payload.isPrivate === 'boolean' ? payload.isPrivate : undefined
      if (!local) {
        // 移除墓碑：用户已明确移除该条目，云同步拉取不得复活（显式加追时墓碑已被解除）
        if (this.removedSubjects[key]) return 'skipped'
        items[key] = {
          subjectId: payload.subjectId,
          name: payload.name,
          nameCn: payload.nameCn,
          image: payload.image,
          status: payload.status,
          progress: payload.progress,
          epsTotal: payload.epsTotal,
          watchedEps: Array.from({ length: payload.progress }, (_, i) => i + 1),
          tags: payload.tags,
          myRate: cloudRate,
          myComment: cloudComment,
          privateFlag: cloudPrivate,
          addedAt: Date.now(),
          dirty: false,
          serverUpdatedAt: payload.serverUpdatedAt,
        }
        this.persist()
        return 'created'
      }
      // F6：非 dirty 条目的评分/笔记/私密标记无条件跟随云端（见函数头注释）
      if (!local.dirty) {
        local.myRate = cloudRate
        local.myComment = cloudComment
        local.privateFlag = cloudPrivate
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
          local.myRate = cloudRate
          local.myComment = cloudComment
          local.privateFlag = cloudPrivate
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
      const e = this.activeItems[String(id)]
      if (!e) return
      e.dirty = false
      e.serverUpdatedAt = serverUpdatedAt
      this.persist()
    },
    /** 本地待推送的条目数 */
    dirtyCount(): number {
      return Object.values(this.activeItems).filter((e) => e.dirty).length
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
    /* ── F2 我的人物 ── */
    hasPerson(personId: number): boolean {
      return !!this.persons[String(personId)]
    },
    /** 本地点击收藏人物（在线推送失败时保留 dirty，由同步队列重放） */
    addPerson(payload: { personId: number; name: string; nameCn?: string; image?: string; career?: string[] }) {
      const key = String(payload.personId)
      if (this.persons[key]) return
      this.persons[key] = {
        personId: payload.personId,
        name: payload.name,
        nameCn: payload.nameCn,
        image: payload.image,
        career: payload.career,
        addedAt: Date.now(),
        dirty: true,
      }
      this.persist()
    },
    /** 云端收藏列表合并到本地（F2 同步拉取） */
    upsertPersonFromServer(payload: { personId: number; name: string; nameCn?: string; image?: string; career?: string[] }) {
      const key = String(payload.personId)
      const existing = this.persons[key]
      if (existing) {
        if (existing.dirty) return 'skipped'
        existing.name = payload.name
        existing.nameCn = payload.nameCn ?? existing.nameCn
        existing.image = payload.image ?? existing.image
        existing.career = payload.career ?? existing.career
        this.persist()
        return
      }
      this.persons[key] = { ...payload, addedAt: Date.now(), dirty: false }
      this.persist()
    },
    /** 本地移除人物收藏（云端取消依赖 DELETE /persons/{id}/collect，服务端实测未实现） */
    removePerson(personId: number) {
      delete this.persons[String(personId)]
      this.persist()
    },
    /** 推送成功后清除人物收藏的脏标记 */
    markPersonSynced(personId: number) {
      const p = this.persons[String(personId)]
      if (!p) return
      p.dirty = false
      this.persist()
    },
    /** 导入收藏：校验并合并（已存在的条目跳过），返回统计。写入当前模式的收藏库 */
    importEntries(raw: unknown[]): { added: number; skipped: number } {
      let added = 0
      let skipped = 0
      const items = this.activeItems
      for (const item of raw) {
        const e = item as Partial<LibraryEntry>
        if (typeof e?.subjectId !== 'number' || typeof e?.name !== 'string' || !e.name) {
          skipped++
          continue
        }
        if (items[String(e.subjectId)]) {
          skipped++
          continue
        }
      items[String(e.subjectId)] = {
        subjectId: e.subjectId,
        name: e.name,
        nameCn: typeof e.nameCn === 'string' && e.nameCn ? e.nameCn : e.name,
        image: typeof e.image === 'string' ? e.image : undefined,
        status: STATUS_VALUES.includes(e.status as string) ? (e.status as WatchStatus) : 'wish',
        progress: Number(e.progress) || 0,
        epsTotal: Number(e.epsTotal) || 0,
        watchedEps: Array.isArray(e.watchedEps) ? e.watchedEps.filter((n) => typeof n === 'number') : [],
        watchedSpecial: normalizeSpecial(e.watchedSpecial),
        score: typeof e.score === 'number' ? e.score : undefined,
        myRate: typeof e.myRate === 'number' ? e.myRate : undefined,
        myComment: typeof e.myComment === 'string' ? e.myComment : undefined,
        privateFlag: typeof e.privateFlag === 'boolean' ? e.privateFlag : undefined,
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
      saveJson(DEMO_STORAGE_KEY, JSON.parse(JSON.stringify(this.demoItems)))
      saveJson(CHARACTERS_KEY, JSON.parse(JSON.stringify(this.characters)))
      saveJson(PERSONS_KEY, JSON.parse(JSON.stringify(this.persons)))
      saveJson(REMOVED_KEY, JSON.parse(JSON.stringify(this.removedSubjects)))
    },
  },
})
