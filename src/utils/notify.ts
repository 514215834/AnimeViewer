import { dataSource } from '../api/dataSource'
import { useLibraryStore } from '../stores/library'
import { useSettingsStore } from '../stores/settings'
import type { NotifyScope } from '../stores/settings'
import type { CalendarDay } from '../types/bangumi'
import { loadJson, saveJson } from './storage'
import { isTauri } from './tauri'

/**
 * T3 「今日更新」系统通知（v1.0-S1）：仅 Tauri 桌面端生效。
 * 周历 ∩ 追番库计算今日更新，与「上次已通知集合」（按日期持久化）diff 后只对新集弹系统通知。
 * 开关默认关闭（2026-09-12 评审决议）；范围（在看/全部）与检查间隔均可配置；演示模式跳过。
 */

const NOTIFIED_KEY = 'animeviewer:notify:last'
/** 调度 tick 周期（1 分钟；间隔配置变更无需重建定时器） */
const TICK_MS = 60 * 1000
/** 启动后首查延迟：避开首屏请求与自动同步高峰 */
const FIRST_CHECK_DELAY_MS = 15 * 1000

/** 已通知集合的持久化形态（按日期滚动：跨天自动失效重建） */
interface NotifiedState {
  date: string
  ids: number[]
}

/** legacy /calendar 的 weekday.id：1=周一 … 7=周日；JS getDay()：0=周日 … 6=周六 */
function todayWeekdayId(now: Date): number {
  const js = now.getDay()
  return js === 0 ? 7 : js
}

/** 通知目标的条目最小形态（纯函数便于单测） */
interface NotifyEntry {
  subjectId: number
  status: 'wish' | 'doing' | 'done'
}

/** 计算今日更新的条目 id：周历当天分栏 ∩ 追番库，按通知范围过滤。导出仅供单测 */
export function todayUpdateSubjectIds(days: CalendarDay[], entries: NotifyEntry[], scope: NotifyScope, now: Date): number[] {
  const day = days.find((d) => d.weekday.id === todayWeekdayId(now))
  if (!day) return []
  const inLib = new Set(entries.map((e) => e.subjectId))
  const doingOnly = scope === 'doing' ? new Set(entries.filter((e) => e.status === 'doing').map((e) => e.subjectId)) : null
  return day.items
    .map((i) => i.id)
    .filter((id) => inLib.has(id) && (!doingOnly || doingOnly.has(id)))
}

async function ensureNotifyPermission(): Promise<boolean> {
  const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification')
  let granted = await isPermissionGranted()
  if (!granted) granted = (await requestPermission()) === 'granted'
  return granted
}

let started = false
let lastCheckAt = 0

/** 启动通知调度器（App.vue onMounted 调用；Web 环境直接返回，零开销） */
export function startNotifyScheduler(): void {
  if (started || !isTauri()) return
  started = true
  window.setTimeout(() => void checkTodayUpdates(), FIRST_CHECK_DELAY_MS)
  window.setInterval(() => void tick(), TICK_MS)
}

async function tick(): Promise<void> {
  const s = useSettingsStore()
  if (!s.desktopNotifyEnabled) return
  if (Date.now() - lastCheckAt < s.desktopNotifyIntervalMin * 60 * 1000) return
  await checkTodayUpdates()
}

/** 执行一次检查：发送「今日新集」系统通知，返回发送条数（任何失败静默——通知为锦上添花） */
export async function checkTodayUpdates(): Promise<number> {
  const s = useSettingsStore()
  if (!isTauri() || s.isDemo || !s.desktopNotifyEnabled) return 0
  lastCheckAt = Date.now()
  try {
    const days = await dataSource.calendar()
    const lib = useLibraryStore()
    const ids = todayUpdateSubjectIds(
      days,
      lib.list.map((e) => ({ subjectId: e.subjectId, status: e.status })),
      s.desktopNotifyScope,
      new Date(),
    )
    const key = new Date().toISOString().slice(0, 10)
    const prev = loadJson<NotifiedState>(NOTIFIED_KEY, { date: '', ids: [] })
    const baseIds = prev.date === key ? prev.ids : []
    const fresh = ids.filter((id) => !baseIds.includes(id))
    if (!fresh.length) return 0
    if (!(await ensureNotifyPermission())) return 0
    const { sendNotification } = await import('@tauri-apps/plugin-notification')
    let sent = 0
    for (const id of fresh) {
      const e = lib.entry(id)
      if (!e) continue
      const total = e.epsTotal || 0
      const nextEp = total ? Math.min(e.progress + 1, total) : e.progress + 1
      sendNotification({
        title: e.nameCn || e.name,
        body: `今日更新 · 第 ${nextEp} 话可看（当前进度 ${e.progress}${total ? `/${total}` : ''}）`,
      })
      sent++
    }
    saveJson(NOTIFIED_KEY, { date: key, ids: [...baseIds, ...fresh] } satisfies NotifiedState)
    return sent
  } catch {
    return 0
  }
}

/** 设置页「发送测试通知」：直接发一条固定通知验证权限与通道 */
export async function sendTestNotification(): Promise<boolean> {
  if (!isTauri()) return false
  try {
    if (!(await ensureNotifyPermission())) return false
    const { sendNotification } = await import('@tauri-apps/plugin-notification')
    sendNotification({
      title: 'AnimeViewer 通知测试',
      body: '桌面通知工作正常。今日有更新的追番条目将在检查后提醒。',
    })
    return true
  } catch {
    return false
  }
}
