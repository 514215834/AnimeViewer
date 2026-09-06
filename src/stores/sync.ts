import { defineStore } from 'pinia'
import { ApiError, bangumiApi, clearApiCache } from '../api/bangumi'
import { dataSource } from '../api/dataSource'
import { useLibraryStore } from './library'
import type { WatchStatus } from './library'
import { useSettingsStore } from './settings'
import type { BangumiMe, UserSubjectCollection } from '../types/bangumi'
import { loadJson, saveJson } from '../utils/storage'

const LAST_SYNC_KEY = 'animeviewer:sync:lastAt'
const PULL_PAGE_SIZE = 50
const MAX_PULL_PAGES = 40
const PUSH_CONCURRENCY = 2

/** 本地状态 → Bangumi 收藏类型（1=想看 2=看过 3=在看） */
const LOCAL_TO_SERVER: Record<WatchStatus, 1 | 2 | 3> = { wish: 1, done: 2, doing: 3 }

function serverToLocal(t: number): WatchStatus | null {
  if (t === 1) return 'wish'
  if (t === 2) return 'done'
  if (t === 3) return 'doing'
  return null // 4=搁置 5=抛弃：不同步到本地
}

async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
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

export const useSyncStore = defineStore('sync', {
  state: () => ({
    syncing: false,
    account: null as BangumiMe | null,
    lastSyncAt: loadJson<number | null>(LAST_SYNC_KEY, null),
    lastError: '',
    logs: [] as string[],
  }),
  getters: {
    lastSyncText: (s) => (s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString('zh-CN') : '从未同步'),
  },
  actions: {
    log(line: string) {
      this.logs.unshift(`[${new Date().toLocaleTimeString('zh-CN')}] ${line}`)
      if (this.logs.length > 30) this.logs.length = 30
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
      let pushed = 0
      let failed = 0
      try {
        // 1. 账户
        const me = await bangumiApi.me()
        this.account = me
        const username = me.username || String(me.id ?? '')
        if (!username) return fail('无法获取当前账户用户名')

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
            serverUpdatedAt: item.updated_at,
          })
          if (r === 'created') created++
          else if (r === 'updated') updated++
        }
        this.log(`拉取云端 ${valid.length} 条：新增 ${created}，更新 ${updated}`)

        // 4. 推送本地改动（dirty 即待同步队列，失败保留下次重放）
        const dirtyItems = library.list.filter((e) => e.dirty)
        let queue = [...dirtyItems]
        const pushOne = async (entry: (typeof dirtyItems)[number]) => {
          try {
            await bangumiApi.upsertCollection(entry.subjectId, LOCAL_TO_SERVER[entry.status])
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
            library.markSynced(entry.subjectId, new Date().toISOString())
            pushed++
          } catch (e) {
            failed++
            const reason = e instanceof ApiError ? `HTTP ${e.status}` : e instanceof Error ? e.message : String(e)
            this.log(`推送失败（保留待重试）：${entry.nameCn || entry.name} —— ${reason}`)
          }
        }
        await pool(queue, PUSH_CONCURRENCY, pushOne)
        queue = []
        if (dirtyItems.length) this.log(`推送本地改动 ${dirtyItems.length} 条：成功 ${pushed}，失败 ${failed}`)

        this.lastSyncAt = Date.now()
        saveJson(LAST_SYNC_KEY, this.lastSyncAt)
        clearApiCache()
        const message = `同步完成：云端 ${valid.length} 条，本地新增 ${created} / 更新 ${updated}，推送 ${pushed}${failed ? `（失败 ${failed}，已保留待重试）` : ''}`
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
