import { defineStore } from 'pinia'
import { ApiError, bangumiApi, clearApiCache } from '../api/bangumi'
import { dataSource } from '../api/dataSource'
import { useLibraryStore } from './library'
import type { WatchStatus } from './library'
import { useSettingsStore } from './settings'
import type { BangumiMe, EpisodeMarkType, UserProfile, UserSubjectCollection } from '../types/bangumi'
import { loadJson, saveJson } from '../utils/storage'

const LAST_SYNC_KEY = 'animeviewer:sync:lastAt'
const PENDING_EPS_KEY = 'animeviewer:sync:pendingEps'
const PULL_PAGE_SIZE = 50
const MAX_PULL_PAGES = 40
const PUSH_CONCURRENCY = 2

/** 本地状态 → Bangumi 收藏类型（1=想看 2=看过 3=在看）。导出仅供单测（H5） */
export const LOCAL_TO_SERVER: Record<WatchStatus, 1 | 2 | 3> = { wish: 1, done: 2, doing: 3 }

export function serverToLocal(t: number): WatchStatus | null {
  if (t === 1) return 'wish'
  if (t === 2) return 'done'
  if (t === 3) return 'doing'
  return null // 4=搁置 5=抛弃：不同步到本地
}

/** 有界并发执行器。导出仅供单测（H5） */
export async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()!
      await worker(item)
    }
  })
  await Promise.all(runners)
}

export interface SyncResult {
  ok: boolean
  message: string
  created: number
  updated: number
  pushed: number
  failed: number
}

/** E1 待推送的单集增量标记（与条目级 dirty 队列并行的细粒度队列） */
export interface PendingEpisodeMark {
  subjectId: number
  episodeId: number
  type: Extract<EpisodeMarkType, 0 | 2>
  /** 入队时间，重放按序执行 */
  at: number
}

export const useSyncStore = defineStore('sync', {
  state: () => ({
    syncing: false,
    account: null as BangumiMe | null,
    /** E5 用户资料（头像/昵称/签名），随同步或设置页加载 */
    profile: null as UserProfile | null,
    lastSyncAt: loadJson<number | null>(LAST_SYNC_KEY, null),
    lastError: '',
    logs: [] as string[],
    /** E1 单集增量标记待推送队列（持久化，失败保留重放） */
    pendingEpisodeMarks: loadJson<PendingEpisodeMark[]>(PENDING_EPS_KEY, []),
    /** 单集队列重放中的运行时标志（防并发重入） */
    flushingEps: false,
  }),
  getters: {
    lastSyncText: (s) => (s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString('zh-CN') : '从未同步'),
    /** 设置页「待推送」计数：条目级 dirty + 单集标记 + 角色收藏 + 人物收藏 */
    pendingPushCount(): number {
      const library = useLibraryStore()
      return (
        library.dirtyCount() +
        this.pendingEpisodeMarks.length +
        library.pendingCharacters.length +
        library.pendingPersons.length
      )
    },
  },
  actions: {
    log(line: string) {
      this.logs.unshift(`[${new Date().toLocaleTimeString('zh-CN')}] ${line}`)
      if (this.logs.length > 30) this.logs.length = 30
    },
    persistPending() {
      saveJson(PENDING_EPS_KEY, this.pendingEpisodeMarks)
    },
    /** 条目被移出追番时清空其待推单集标记：避免队列重放时 400 兜底把已移除的条目重新收藏到云端 */
    purgePendingEpisodeMarks(subjectId: number) {
      const rest = this.pendingEpisodeMarks.filter((m) => m.subjectId !== subjectId)
      if (rest.length !== this.pendingEpisodeMarks.length) {
        this.pendingEpisodeMarks = rest
        this.persistPending()
      }
    },
    /** E5 拉取用户资料（失败静默：资料卡为非关键信息） */
    async loadProfile(username: string) {
      try {
        this.profile = await dataSource.userProfile(username)
      } catch {
        /* 保持现有 profile */
      }
    },
    /** E5 确保资料可用：设置页打开/同步时调用 */
    async ensureProfile() {
      const settings = useSettingsStore()
      if (settings.isDemo) {
        if (!this.profile) await this.loadProfile('demo')
        return
      }
      if (!settings.accessToken.trim()) return
      if (!this.account) {
        try {
          this.account = await bangumiApi.me()
        } catch {
          return
        }
      }
      const username = this.account?.username || String(this.account?.id ?? '')
      if (username && !this.profile) await this.loadProfile(username)
    },
    /**
     * E1 沉浸观剧/剧集勾选的单集标记入口：本地增量更新 + 入待推队列，
     * 并尽力即时推送（失败静默留在队列，随下次同步重放）。
     * H3：epType≠0（SP/OP/ED/预告）写 watchedSpecial 复合桶，不影响正篇进度
     */
    async markEpisodeWatched(subjectId: number, episodeId: number, epType: number, sort: number, watched: boolean) {
      const library = useLibraryStore()
      if (epType === 0) library.markEpisodeLocal(subjectId, sort, watched)
      else library.markSpecialEpisodeLocal(subjectId, epType, sort, watched)
      const type: PendingEpisodeMark['type'] = watched ? 2 : 0
      this.pendingEpisodeMarks = [
        ...this.pendingEpisodeMarks.filter((m) => !(m.subjectId === subjectId && m.episodeId === episodeId)),
        { subjectId, episodeId, type, at: Date.now() },
      ]
      this.persistPending()
      void this.flushPendingEpisodeMarks()
    },
    /** E1 重放单集标记队列；条目未收藏（400）时先 upsert 收藏再重试一次 */
    async flushPendingEpisodeMarks(username?: string): Promise<number> {
      const settings = useSettingsStore()
      const library = useLibraryStore()
      if (settings.isDemo || !settings.accessToken.trim()) return 0
      if (this.flushingEps) return 0
      if (!this.pendingEpisodeMarks.length) return 0
      this.flushingEps = true
      try {
        if (!username) {
          try {
            const me = this.account ?? (await bangumiApi.me())
            this.account = me
            username = me.username || String(me.id ?? '')
          } catch {
            return 0
          }
        }
        let ok = 0
        const remaining: PendingEpisodeMark[] = []
        const marks = [...this.pendingEpisodeMarks].sort((a, b) => a.at - b.at)
        for (const m of marks) {
          try {
            await bangumiApi.putEpisodeMark(m.episodeId, m.type)
            ok++
          } catch (e) {
            if (e instanceof ApiError && e.status === 400) {
              try {
                const entry = library.entry(m.subjectId)
                // 无条目信息时按标记方向推断：标看过 → 2=看过，取消 → 3=在看
                const t = entry ? LOCAL_TO_SERVER[entry.status] : m.type === 2 ? 2 : 3
                await bangumiApi.upsertCollection(m.subjectId, t)
                await bangumiApi.putEpisodeMark(m.episodeId, m.type)
                ok++
              } catch {
                remaining.push(m)
              }
            } else {
              remaining.push(m)
            }
          }
        }
        if (remaining.length !== this.pendingEpisodeMarks.length) {
          this.pendingEpisodeMarks = remaining
          this.persistPending()
        }
        if (ok) this.log(`单集增量标记已推送 ${ok} 条`)
        return ok
      } finally {
        this.flushingEps = false
      }
    },
    /** 拉取云端收藏并合并到本地，再推送本地待同步改动 */
    async syncNow(): Promise<SyncResult> {
      const settings = useSettingsStore()
      const library = useLibraryStore()
      const fail = (message: string): SyncResult => ({ ok: false, message, created: 0, updated: 0, pushed: 0, failed: 0 })
      if (settings.isDemo) return fail('演示模式不支持云同步，请切换到在线模式')
      if (!settings.accessToken.trim()) return fail('未配置 Access Token，无法云同步')
      if (this.syncing) return fail('同步正在进行中')

      this.syncing = true
      this.lastError = ''
      let created = 0
      let updated = 0
      let conflictLocal = 0
      let pushed = 0
      let failed = 0
      try {
        // 1. 账户与资料
        const me = await bangumiApi.me()
        this.account = me
        const username = me.username || String(me.id ?? '')
        if (!username) return fail('无法获取当前账户用户名')
        void this.loadProfile(username)

        // 2. 拉取云端动画收藏（分页全量）
        const serverItems: UserSubjectCollection[] = []
        let offset = 0
        for (let page = 0; page < MAX_PULL_PAGES; page++) {
          const res = await bangumiApi.userCollections(username, offset, PULL_PAGE_SIZE)
          serverItems.push(...res.data)
          const total = res.total ?? serverItems.length
          offset += res.data.length
          if (!res.data.length || serverItems.length >= total) break
        }
        const valid = serverItems.filter((i) => serverToLocal(i.type) !== null)

        // 3. 合并：本地缺失的条目需先取详情补齐元数据
        const missingIds = valid.filter((i) => !library.has(i.subject_id)).map((i) => i.subject_id)
        await pool(missingIds, 4, async (id) => {
          try {
            await dataSource.subject(id) // 命中后会进入 TTL 缓存
          } catch {
            /* 详情获取失败时仍用占位信息建条目 */
          }
        })
        for (const item of valid) {
          const status = serverToLocal(item.type)!
          const exists = library.has(item.subject_id)
          let name = `条目 ${item.subject_id}`
          let nameCn = name
          let image: string | undefined
          let epsTotal = 0
          let tags: string[] | undefined
          if (!exists) {
            try {
              const d = await dataSource.subject(item.subject_id)
              name = d.name
              nameCn = d.name_cn || d.name
              image = d.images?.common || d.images?.large
              epsTotal = d.total_episodes || 0
              tags = (d.tags ?? []).slice(0, 5).map((t) => t.name)
            } catch {
              /* 使用占位信息 */
            }
          }
          const r = library.upsertFromServer({
            subjectId: item.subject_id,
            name,
            nameCn,
            image,
            status,
            progress: item.ep_status ?? 0,
            epsTotal,
            tags,
            // F6：评分/笔记/私密标记随列表项带入（非 dirty 条目跟随云端）
            rate: item.rate,
            comment: item.comment,
            isPrivate: item.private,
            serverUpdatedAt: item.updated_at,
          })
          if (r === 'created') created++
          else if (r === 'updated' || r === 'conflict-remote-win') updated++
          else if (r === 'conflict-local-win') conflictLocal++
        }
        this.log(`拉取云端 ${valid.length} 条：新增 ${created}，更新 ${updated}${conflictLocal ? `，冲突保留本地 ${conflictLocal}` : ''}`)

        // 4. 推送本地改动（dirty 即待同步队列，失败保留下次重放）
        const dirtyItems = library.list.filter((e) => e.dirty)
        const pushOne = async (entry: (typeof dirtyItems)[number]) => {
          try {
            // F6：私有评分与笔记随 upsert 推送（rate=0 删除云端评分，空串清除评价；未设置的字段不动云端现状）
            const review =
              entry.myRate !== undefined || entry.myComment !== undefined || entry.privateFlag !== undefined
                ? { rate: entry.myRate, comment: entry.myComment, isPrivate: entry.privateFlag }
                : undefined
            await bangumiApi.upsertCollection(entry.subjectId, LOCAL_TO_SERVER[entry.status], review)
            // F4 防线：本地零进度（新加追/重新加追）时先回读云端单集状态并入，避免整表 PATCH 清空另一设备的进度。
            // H3 修复：仅取正篇（episode.type=0）——云端 SP 标记的 sort 与正篇重叠，并入会误标正篇进度
            if (entry.epsTotal > 0 && !(entry.watchedEps?.length ?? 0)) {
              try {
                const items = await bangumiApi.userSubjectEpisodes(entry.subjectId)
                const sorts = items
                  .filter((x) => x.type === 2 && x.episode.type === 0)
                  .map((x) => x.episode.sort)
                if (sorts.length) library.applyCloudEpisodes(entry.subjectId, sorts)
              } catch {
                /* 回读失败按本地空进度继续推送 */
              }
            }
            // 同步单集进度：sort → Bangumi episode id，看过标记 2 / 未看清除 0
            if (entry.epsTotal > 0) {
              const eps = await dataSource.episodes(entry.subjectId)
              const mainEps = eps.filter((x) => x.type === 0)
              const watched = new Set(entry.watchedEps ?? [])
              const watchedIds = mainEps.filter((x) => watched.has(x.sort)).map((x) => x.id)
              const unwatchedIds = mainEps.filter((x) => !watched.has(x.sort)).map((x) => x.id)
              if (watchedIds.length) await bangumiApi.markEpisodes(entry.subjectId, watchedIds, 2)
              if (unwatchedIds.length) await bangumiApi.markEpisodes(entry.subjectId, unwatchedIds, 0)
            }
            // E2：推送成功后回读云端单条收藏，取真实 updated_at 作为后续冲突比对的基线
            try {
              const remote = await bangumiApi.userCollection(username, entry.subjectId)
              library.markSynced(entry.subjectId, remote.updated_at ?? new Date().toISOString())
            } catch {
              library.markSynced(entry.subjectId, new Date().toISOString())
            }
            pushed++
          } catch (e) {
            failed++
            const reason = e instanceof ApiError ? `HTTP ${e.status}` : e instanceof Error ? e.message : String(e)
            this.log(`推送失败（保留待重试）：${entry.nameCn || entry.name} —— ${reason}`)
          }
        }
        await pool(dirtyItems, PUSH_CONCURRENCY, pushOne)
        if (dirtyItems.length) this.log(`推送本地改动 ${dirtyItems.length} 条：成功 ${pushed}，失败 ${failed}`)

        // 5. E1 重放单集增量标记队列
        const epMarks = await this.flushPendingEpisodeMarks(username)

        // 5.5 F1 云端单集进度拉取（同步闭环）：仅处理「非 dirty 且无待推单集标记」的条目，
        // 云端存在已看记录时覆盖本地（换机/多设备恢复）；云端无记录时保留本地（防止误清 ep_status 推导的进度）
        let epPulled = 0
        const pullable = library.list.filter(
          (e) => !e.dirty && e.epsTotal > 0 && !this.pendingEpisodeMarks.some((m) => m.subjectId === e.subjectId),
        )
        await pool(pullable, 2, async (entry) => {
          try {
            const items = await bangumiApi.userSubjectEpisodes(entry.subjectId)
            // H3 修复：仅合并正篇记录——云端 SP 标记的 sort 与正篇空间重叠，无过滤会误标正篇第 1 话
            const sorts = items
              .filter((x) => x.type === 2 && x.episode.type === 0)
              .map((x) => x.episode.sort)
            if (sorts.length && library.applyCloudEpisodes(entry.subjectId, sorts)) epPulled++
          } catch {
            /* 单集拉取失败不阻塞主流程 */
          }
        })
        if (epPulled) this.log(`单集进度拉取合并 ${epPulled} 条（云端覆盖本地）`)

        // 6. E6 角色收藏：推送本地待收藏 + 拉取云端列表
        const pendingChars = library.pendingCharacters
        let charPushed = 0
        await pool(pendingChars, PUSH_CONCURRENCY, async (c) => {
          try {
            await bangumiApi.collectCharacter(c.characterId)
            library.markCharacterSynced(c.characterId)
            charPushed++
          } catch (e) {
            const reason = e instanceof ApiError ? `HTTP ${e.status}` : e instanceof Error ? e.message : String(e)
            this.log(`角色收藏推送失败（保留待重试）：${c.nameCn || c.name} —— ${reason}`)
          }
        })
        if (pendingChars.length) this.log(`推送角色收藏 ${pendingChars.length} 个：成功 ${charPushed}`)
        try {
          const remoteChars = await dataSource.myCharacterCollections(username)
          for (const c of remoteChars.data ?? []) {
            library.upsertCharacterFromServer({
              characterId: c.id,
              name: c.name,
              image: c.images?.medium || c.images?.large || undefined,
            })
          }
        } catch {
          /* 角色收藏拉取失败不影响主流程 */
        }

        // 7. F2 人物收藏：推送本地待收藏 + 拉取云端列表（与角色收藏对称）
        const pendingPersons = library.pendingPersons
        let personPushed = 0
        await pool(pendingPersons, PUSH_CONCURRENCY, async (p) => {
          try {
            await bangumiApi.collectPerson(p.personId)
            library.markPersonSynced(p.personId)
            personPushed++
          } catch (e) {
            const reason = e instanceof ApiError ? `HTTP ${e.status}` : e instanceof Error ? e.message : String(e)
            this.log(`人物收藏推送失败（保留待重试）：${p.nameCn || p.name} —— ${reason}`)
          }
        })
        if (pendingPersons.length) this.log(`推送人物收藏 ${pendingPersons.length} 个：成功 ${personPushed}`)
        try {
          const remotePersons = await dataSource.myPersonCollections(username)
          for (const p of remotePersons.data ?? []) {
            library.upsertPersonFromServer({
              personId: p.id,
              name: p.name,
              image: p.images?.medium || p.images?.large || undefined,
              career: p.career,
            })
          }
        } catch {
          /* 人物收藏拉取失败不影响主流程 */
        }

        this.lastSyncAt = Date.now()
        saveJson(LAST_SYNC_KEY, this.lastSyncAt)
        clearApiCache()
        const message = `同步完成：云端 ${valid.length} 条，本地新增 ${created} / 更新 ${updated}，推送 ${pushed}${failed ? `（失败 ${failed}，已保留待重试）` : ''}${epMarks ? `，单集标记 ${epMarks}` : ''}${charPushed ? `，角色收藏 ${charPushed}` : ''}${personPushed ? `，人物收藏 ${personPushed}` : ''}${epPulled ? `，单集拉取 ${epPulled}` : ''}`
        this.log(message)
        return { ok: true, message, created, updated, pushed, failed }
      } catch (e) {
        let message = e instanceof Error ? e.message : String(e)
        if (e instanceof ApiError && e.status === 401) message = 'Token 无效或已过期（401），请重新配置'
        this.lastError = message
        this.log(`同步失败：${message}`)
        return fail(`同步失败：${message}`)
      } finally {
        this.syncing = false
      }
    },
    /** 应用启动时的静默自动同步（每次会话最多尝试一次） */
    async autoSyncOnce() {
      const settings = useSettingsStore()
      if (settings.isDemo || !settings.accessToken.trim()) return
      const r = await this.syncNow()
      if (!r.ok) this.log(`自动同步未成功：${r.message}`)
    },
  },
})
