import { reactive } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useSettingsStore } from '../stores/settings'
import { isTauri } from './tauri'

/**
 * v1.0 D2 内置媒体服务自动桥接（仅 Tauri 桌面端生效；Web 环境零开销）。
 * 壳已拉起 sidecar 服务端（main.rs，注入 data-dir/parent-pid/包内二进制路径），
 * 这里轮询 service_status；就绪判定（端口 TCP 可达 + token 回读）在壳进程内闭环，
 * 不经 WebView2 网络栈——系统代理/CORS 等环境因素不参与判定。
 * 就绪后把地址与 Token 自动填充进前端配置（用户已手动配置其他地址时不覆盖）。
 */

interface ServiceStatus {
  running: boolean
  ready: boolean
  url: string
  token: string | null
  error: string | null
}

/** 阻塞式等待窗口：Spring Boot 冷启动数秒；杀软首扫 35MB jar + 4000 JRE 文件可能拖到分钟级 */
const BOOT_TIMEOUT_MS = 120 * 1000
/** 阻塞期轮询间隔 */
const POLL_INTERVAL_MS = 1500
/** 超时后转低频后台重试（永不放弃——服务端一旦就绪立即回填） */
const RETRY_INTERVAL_MS = 15 * 1000

/** SettingsView 展示用的实时状态（bootstrap 过程更新） */
export const desktopServiceState = reactive({
  checking: false,
  ready: false,
  elapsed: 0,
  url: '',
  error: '',
})

/** 单次尝试：invoke service_status（壳内已含端口探测 + token 回读） */
async function tryOnce(): Promise<{ url: string; token: string } | null> {
  const st = await invoke<ServiceStatus>('service_status')
  desktopServiceState.url = st.url
  if (st.error) desktopServiceState.error = st.error
  if (st.ready && st.token) return { url: st.url, token: st.token }
  return null
}

function fillSettings(url: string, token: string): void {
  const s = useSettingsStore()
  // 手动配置优先：地址或 Token 已被用户改成其他值时不覆盖
  if ((!s.svcUrl || s.svcUrl === url) && (!s.svcToken || s.svcToken === token)) {
    s.applyPatch({ svcUrl: url, svcToken: token })
  }
}

/** App.vue 启动调用：builtin 模式下等待服务就绪并自动回填配置 */
export async function bootstrapBuiltinService(): Promise<void> {
  if (!isTauri()) return
  const s = useSettingsStore()
  if (s.desktopSvcMode !== 'builtin') return
  if (desktopServiceState.ready) return
  desktopServiceState.checking = true
  desktopServiceState.error = ''
  desktopServiceState.elapsed = 0

  // 阻塞期：1.5s 高频轮询，覆盖正常冷启动
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const ok = await tryOnce().catch(() => null)
    if (ok) {
      desktopServiceState.ready = true
      desktopServiceState.checking = false
      fillSettings(ok.url, ok.token)
      return
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    desktopServiceState.elapsed = Math.round((Date.now() - (deadline - BOOT_TIMEOUT_MS)) / 1000)
  }

  // 超时后转低频后台重试（杀软首扫等慢场景），UI 显示"仍在等待"但不阻塞用户操作
  void (async () => {
    while (!desktopServiceState.ready) {
      await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS))
      if (desktopServiceState.ready) return
      const ok = await tryOnce().catch(() => null)
      if (ok) {
        desktopServiceState.ready = true
        desktopServiceState.checking = false
        fillSettings(ok.url, ok.token)
      }
    }
  })()
  desktopServiceState.error = '内置服务启动耗时较长（杀软扫描中？），就绪后将自动填充——详见 %APPDATA%/AnimeViewer/logs'
}

/** 设置页「重新检测」：单次尝试并刷新状态展示 */
export async function recheckBuiltinService(): Promise<void> {
  if (!isTauri()) return
  desktopServiceState.checking = true
  try {
    const ok = await tryOnce().catch(() => null)
    if (ok) {
      desktopServiceState.ready = true
      desktopServiceState.error = ''
      fillSettings(ok.url, ok.token)
    } else if (!desktopServiceState.error) {
      desktopServiceState.error = '内置服务未就绪（仍在启动或未随包）'
    }
  } finally {
    desktopServiceState.checking = false
  }
}
