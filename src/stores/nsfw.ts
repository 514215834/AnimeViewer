import { defineStore } from 'pinia'
import { useSettingsStore } from './settings'
import { dataSource } from '../api/dataSource'
import { idbGet, idbSet } from '../utils/idbCache'

const NSFW_FLAGS_KEY = 'c1:nsfw-flags'

/**
 * 条目 nsfw 标记缓存（v0.10 P3 起持久化到 IndexedDB，跨会话复用探测结果）。
 * flags 语义：true = R18；false = 已检查为安全 / 检查失败；undefined = 尚未检查。
 * 持久层只存「探测成功」的结果（失败占位的 false 不写入，避免误标 24h）。
 */
export const useNsfwStore = defineStore('nsfw', {
  state: () => ({
    flags: {} as Record<string, boolean>,
    /** 会话内是否已并入过持久层结果（每次会话读一次，避免每页重复读 IDB） */
    restored: false,
  }),
  getters: {
    isNsfw: (s) => (id: number) => s.flags[String(id)] === true,
  },
  actions: {
    async ensure(ids: number[]) {
      const settings = useSettingsStore()
      if (!settings.hideNsfw) return
      // P3：会话内首次并入持久化探测结果，命中项不再发请求
      if (!this.restored) {
        this.restored = true
        const saved = await idbGet<Record<string, boolean>>(NSFW_FLAGS_KEY)
        if (saved) {
          for (const [k, v] of Object.entries(saved)) {
            if (this.flags[k] === undefined && typeof v === 'boolean') this.flags[k] = v
          }
        }
      }
      if (settings.isDemo) {
        // 演示模式：读取内置数据的 nsfw 标记（demo 模块按需加载，v0.10 P1）
        try {
          const { demoDetail } = await import('../api/demo')
          ids.forEach((id) => {
            try {
              this.flags[String(id)] = !!demoDetail(id).nsfw
            } catch {
              this.flags[String(id)] = false
            }
          })
        } catch {
          ids.forEach((id) => {
            this.flags[String(id)] = false
          })
        }
        return
      }
      const todo = ids.filter((id) => this.flags[String(id)] === undefined)
      if (!todo.length) return
      // 先占位，避免并发期间重复排队
      todo.forEach((id) => {
        this.flags[String(id)] = false
      })
      const queue = [...todo]
      const confirmed: Record<string, boolean> = {}
      const worker = async () => {
        while (queue.length) {
          const id = queue.shift()!
          try {
            const detail = await dataSource.subject(id)
            this.flags[String(id)] = !!detail.nsfw
            // 仅探测成功的结果进入持久层（失败占位 false 不写入）
            confirmed[String(id)] = this.flags[String(id)]!
          } catch {
            // 检查失败按非 R18 处理，不打断其余检查
            this.flags[String(id)] = false
          }
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()])
      if (Object.keys(confirmed).length) {
        const saved = (await idbGet<Record<string, boolean>>(NSFW_FLAGS_KEY)) ?? {}
        void idbSet(NSFW_FLAGS_KEY, { ...saved, ...confirmed })
      }
    },
  },
})
