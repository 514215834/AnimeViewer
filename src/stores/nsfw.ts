import { defineStore } from 'pinia'
import { useSettingsStore } from './settings'
import { dataSource } from '../api/dataSource'
import { demoDetail } from '../api/demo'

/**
 * 条目 nsfw 标记缓存（会话级，不持久化）。
 * flags 语义：true = R18；false = 已检查为安全 / 检查失败；undefined = 尚未检查。
 */
export const useNsfwStore = defineStore('nsfw', {
  state: () => ({
    flags: {} as Record<string, boolean>,
  }),
  getters: {
    isNsfw: (s) => (id: number) => s.flags[String(id)] === true,
  },
  actions: {
    async ensure(ids: number[]) {
      const settings = useSettingsStore()
      if (!settings.hideNsfw) return
      if (settings.isDemo) {
        // 演示模式：直接读取内置数据的 nsfw 标记
        ids.forEach((id) => {
          try {
            this.flags[String(id)] = !!demoDetail(id).nsfw
          } catch {
            this.flags[String(id)] = false
          }
        })
        return
      }
      const todo = ids.filter((id) => this.flags[String(id)] === undefined)
      if (!todo.length) return
      // 先占位，避免并发期间重复排队
      todo.forEach((id) => {
        this.flags[String(id)] = false
      })
      const queue = [...todo]
      const worker = async () => {
        while (queue.length) {
          const id = queue.shift()!
          try {
            const detail = await dataSource.subject(id)
            this.flags[String(id)] = !!detail.nsfw
          } catch {
            // 检查失败按非 R18 处理，不打断其余检查
            this.flags[String(id)] = false
          }
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()])
    },
  },
})
