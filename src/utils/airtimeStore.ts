/**
 * v0.29 Q1 放送时刻共享读取层。
 *
 * 数据源：详情页 infobox「放送开始」（dataSource.subject，随既有详情双层缓存走——
 * 周历/今日页/追番库惰性拉取详情零新增端点，命中 idb 缓存时零网络）。
 * 普查定案（2026-09-23）：现网 infobox 无一含时刻，本层产出多为「仅日期」形态——
 * 上层（周历/今日页/追番库）一律按「有时刻用时刻、无时刻回退星期粒度」防御降级。
 */
import { ref, watch } from 'vue'
import { dataSource } from '../api/dataSource'
import { airDateInfoBoxed, parseAirTime, type AirTime } from './airtime'

const cache = new Map<number, AirTime | null>()
const inflight = new Map<number, Promise<AirTime | null>>()

/** 拉取并解析条目放送时刻（含日期）；失败/无数据返回 null，不抛错（防御降级） */
export function fetchAirtime(id: number): Promise<AirTime | null> {
  if (cache.has(id)) return Promise.resolve(cache.get(id) ?? null)
  const pending = inflight.get(id)
  if (pending) return pending
  const task = dataSource
    .subject(id)
    .then((s) => {
      const t = parseAirTime(airDateInfoBoxed(s.infobox))
      cache.set(id, t)
      return t
    })
    .catch(() => {
      cache.set(id, null)
      return null
    })
    .finally(() => inflight.delete(id))
  inflight.set(id, task)
  return task
}

/** 响应式批量读取：ids 变化时拉取，未解析完成的条目保持 undefined（UI 先渲染回退形态）。
 *  内部带 watch(ids)，调用方传响应式 getter 即可；重复进入由模块级 cache 秒回。 */
export function useAirtimes(ids: () => number[]) {
  const map = ref(new Map<number, AirTime | null | undefined>())
  let seq = 0
  const run = () => {
    const list = ids()
    const mySeq = ++seq
    for (const id of list) {
      if (map.value.has(id)) continue
      map.value.set(id, undefined)
      void fetchAirtime(id).then((t) => {
        if (mySeq !== seq) return
        map.value.set(id, t)
        map.value = new Map(map.value) // 触发响应式
      })
    }
  }
  watch(ids, run, { immediate: true })
  return map
}
