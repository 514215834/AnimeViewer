// D2 修复复验：标题 build 标识 + 桥接 + 「本地媒体库」链路实测
import { chromium } from '@playwright/test'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
const page = ctx.pages()[0] ?? (await ctx.newPage())

const logs = []
page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text().slice(0, 150)}`))

// 1) 等桥接就绪（最多 30s），读 settings + 标题
let settings = null
for (let i = 0; i < 15; i++) {
  await page.waitForTimeout(2000)
  const raw = await page.evaluate(() => localStorage.getItem('animeviewer:settings'))
  settings = raw ? JSON.parse(raw) : null
  if (settings?.svcToken) break
}
console.log('=== 标题 ===')
console.log(await page.title())
console.log('=== 桥接回填 ===')
console.log(JSON.stringify({ svcUrl: settings?.svcUrl, hasToken: !!settings?.svcToken, mode: settings?.desktopSvcMode }))

// 2) 媒体库 API 全类型请求（用户报「本地媒体库连接失败」的请求面）
const probe = await page.evaluate(async () => {
  const s = JSON.parse(localStorage.getItem('animeviewer:settings'))
  const h = { 'X-AV-Token': s.svcToken }
  const out = {}
  for (const [k, url] of Object.entries({
    health: `${s.svcUrl}/api/health`,
    status: `${s.svcUrl}/api/files/status`,
    directories: `${s.svcUrl}/api/directories`,
    files: `${s.svcUrl}/api/files?page=1&pageSize=10`,
  })) {
    try {
      const r = await fetch(url, { headers: h })
      out[k] = `${r.status} ${(await r.text()).slice(0, 60)}`
    } catch (e) {
      out[k] = `FETCH_FAIL ${String(e).slice(0, 80)}`
    }
  }
  return out
})
console.log('=== 媒体库 API（前端视角） ===')
console.log(JSON.stringify(probe, null, 1))

// 3) 设置页真实操作：展开媒体服务 → 点媒体库管理 → 抽屉内容
await page.goto('http://tauri.localhost/#/settings')
await page.waitForTimeout(1200)
await page.locator('.adv-head-title', { hasText: '媒体服务' }).click()
await page.waitForTimeout(500)
console.log('=== 状态行 ===')
console.log((await page.locator('.svc-mode-status').textContent())?.trim())
await page.getByRole('button', { name: '媒体库管理' }).click()
await page.waitForTimeout(1500)
const drawerText = await page.locator('.n-drawer-body-content-wrapper').textContent().catch(() => '(抽屉未找到)')
console.log('=== 媒体库抽屉（前 200 字） ===')
console.log(drawerText?.replace(/\s+/g, ' ').slice(0, 200))

console.log('=== console（尾部） ===')
console.log(logs.slice(-8).join('\n') || '(无)')
await browser.close()
