import { reactive } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useSettingsStore } from '../stores/settings'
import { isTauri } from './tauri'

/**
 * v1.0 D2 内置媒体服务自动桥接（仅 Tauri 桌面端生效；Web 环境零开销）。
 * 壳已拉起 sidecar 服务端（main.rs，注入 data-dir/parent-pid/包内二进制路径），
 * 这里轮询 service_status（Rust 回读 data/token）+ /api/health，
 * 就绪后把地址与 Token 自动填充进前端配置（用户已手动配置其他地址时不覆盖）。
 */

interface ServiceStatus {
  running: boolean
  url: string
  token: string | null
  error: string | null
}

/** 健康就绪判定超时：Spring Boot 冷启动数秒，60s 覆盖慢盘/杀软扫描场景 */
const BOOT_TIMEOUT_MS = 60 * 1000
const POLL_INTERVAL_MS = 1500

/** SettingsView 展示用的实时状态（bootstrap 过程更新） */
export const desktopServiceState = reactive({
  checking: false,
  ready: false,
  url: '',
  error: '',
})

/** 单次尝试：取 status → 有 token 则探健康端点；就绪返回 url+token */
async function tryOnce(): Promise<{ url: string; token: string } | null> {
  const st = await invoke<ServiceStatus>('service_status')
  desktopServiceState.url = st.url
  if (st.error && !st.running) {
    desktopServiceState.error = st.error
    return null
  }
  if (!st.token) return null
  try {
    const res = await fetch(`${st.url}/api/health`, { headers: { 'X-AV-Token': st.token } })
    if (!res.ok) return null
    return { url: st.url, token: st.token }
  } catch {
    return null
  }
}

/** App.vue 启动调用：builtin 模式下等待服务就绪并自动回填配置（外部手动配置优先，不覆盖） */
export async function bootstrapBuiltinService(): Promise<void> {
  if (!isTauri()) return
  const s = useSettingsStore()
  if (s.desktopSvcMode !== 'builtin') return
  desktopServiceState.checking = true
  desktopServiceState.error = ''
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  try {
    while (Date.now() < deadline) {
      const ok = await tryOnce().catch(() => null)
      if (ok) {
        desktopServiceState.ready = true
        // 手动配置优先：地址或 Token 已被用户改成其他值时不覆盖
        if ((!s.svcUrl || s.svcUrl === ok.url) && (!s.svcToken || s.svcToken === ok.token)) {
          s.applyPatch({ svcUrl: ok.url, svcToken: ok.token })
        }
        return
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }
    desktopServiceState.error = '内置服务启动超时（详见 %APPDATA%/AnimeViewer/logs/service.log）'
  } finally {
    desktopServiceState.checking = false
  }
}

/** 设置页「重新检测」：单次尝试并刷新状态展示 */
export async function recheckBuiltinService(): Promise<void> {
  if (!isTauri()) return
  desktopServiceState.checking = true
  desktopServiceState.error = ''
  try {
    const ok = await tryOnce().catch(() => null)
    desktopServiceState.ready = !!ok
    if (ok) {
      const s = useSettingsStore()
      if ((!s.svcUrl || s.svcUrl === ok.url) && (!s.svcToken || s.svcToken === ok.token)) {
        s.applyPatch({ svcUrl: ok.url, svcToken: ok.token })
      }
    } else if (!desktopServiceState.error) {
      desktopServiceState.error = '内置服务未就绪（仍在启动或未随包）'
    }
  } finally {
    desktopServiceState.checking = false
  }
}
