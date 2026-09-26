import { ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

/**
 * v1.0 D4 E2E 服务端链路冒烟：真实 AnimeViewerService 隔离实例（裁剪 JRE 启动，贴近桌面版形态）
 * 覆盖「连接测试 → 添加媒体目录 → 扫描入库 → mp4 直连 Range 流」链路（与 main.spec 的 Web 主链路互补）。
 * 隔离措施：独立端口 18877 / data 目录与媒体目录落 tmpdir / 每例独立 context（localStorage 注入）。
 * 边界（如实记录）：磁力下载依赖外部网络不自动化，由服务端集成测试与人工验收覆盖。
 */

const PORT = 18877
const SVC_URL = `http://127.0.0.1:${PORT}`
const RUNTIME_JAVA = join(import.meta.dirname, '..', 'src-tauri', 'resources', 'service', 'runtime', 'bin', 'java.exe')
const SERVICE_JAR = join(import.meta.dirname, '..', 'src-tauri', 'resources', 'service', 'service.jar')
const FFMPEG = join(import.meta.dirname, '..', 'src-tauri', 'resources', 'service', 'bin', 'ffmpeg.exe')
const SVC_CWD = join(tmpdir(), 'av-e2e-svc')
const MEDIA_DIR = join(tmpdir(), 'av-e2e-media')

let svc: ChildProcess | null = null
let token = ''

async function pollToken(deadlineMs: number): Promise<string> {
  const tokenFile = join(SVC_CWD, 'data', 'token')
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    if (existsSync(tokenFile)) {
      const t = readFileSync(tokenFile, 'utf8').trim()
      if (t) return t
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('服务端 token 未在时限内生成')
}

async function svcApi(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SVC_URL}${path}`, { ...init, headers: { 'X-AV-Token': token, ...(init?.headers ?? {}) } })
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  rmSync(SVC_CWD, { recursive: true, force: true })
  rmSync(MEDIA_DIR, { recursive: true, force: true })
  mkdirSync(SVC_CWD, { recursive: true })
  mkdirSync(MEDIA_DIR, { recursive: true })

  // 测试媒体：ffmpeg testsrc 生成 3s mp4（桌面版随包 ffmpeg 生成——自身也是随包链路的验证）
  execSync(`"${FFMPEG}" -y -v error -f lavfi -i testsrc=duration=3:size=320x240:rate=10 -pix_fmt yuv420p "${join(MEDIA_DIR, 'e2e-sample.mp4')}"`)

  svc = spawn(RUNTIME_JAVA, [
    '-jar', SERVICE_JAR,
    `--server.port=${PORT}`,
    '--av.scan.auto-on-start=false',
  ], { cwd: SVC_CWD, stdio: 'ignore' })
  token = await pollToken(60_000)
  // 等端口就绪
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const res = await svcApi('/api/health')
      if (res.ok) return
    } catch { /* 未就绪继续等 */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('服务端未在时限内就绪')
}, 120_000)

test.afterAll(async () => {
  svc?.kill()
  await new Promise((r) => setTimeout(r, 1000))
  rmSync(SVC_CWD, { recursive: true, force: true })
  rmSync(MEDIA_DIR, { recursive: true, force: true })
})

test.beforeEach(async ({ context }) => {
  await context.addInitScript(([url, tk]) => {
    localStorage.setItem('animeviewer:settings', JSON.stringify({
      dataSource: 'demo',          // 演示模式：无网络依赖，媒体服务与数据源模式无关
      svcUrl: url,
      svcToken: tk,
    }))
  }, [SVC_URL, token] as unknown as [string, string])
})

test('设置页连接测试：真实服务端状态卡（版本/ffmpeg 可用性）', async ({ page }) => {
  await page.goto('/#/settings')
  await page.locator('.adv-head-title', { hasText: '媒体服务' }).click()
  await page.getByRole('button', { name: '连接测试' }).click()
  await expect(page.locator('.svc-status')).toContainText('AnimeViewerService v0.30.0', { timeout: 15_000 })
  await expect(page.locator('.svc-status')).toContainText('ffmpeg 可用')
})

test('媒体库链路：添加目录 → 扫描入库 → 状态卡计数与文件列表', async ({ page }) => {
  await page.goto('/#/settings')
  await page.locator('.adv-head-title', { hasText: '媒体服务' }).click()
  await page.getByRole('button', { name: '媒体库管理' }).click()

  // 添加目录（抽屉内路径输入）→ 全量扫描 → 轮询状态卡
  const dirInput = page.locator('.n-drawer input[type="text"]').first()
  await dirInput.fill(MEDIA_DIR)
  await page.getByRole('button', { name: /添加/ }).first().click()
  await expect(page.locator('.n-drawer')).toContainText('e2e-sample.mp4', { timeout: 15_000 })

  // 状态卡：文件 1（未识别——无绑定属正常，匹配链路由服务端单测覆盖）
  await expect(page.locator('.n-drawer')).toContainText('文件 1', { timeout: 15_000 })
})

test('mp4 直连流：Range 请求 206 + Content-Range（媒体库文件 id 动态获取）', async ({ page }) => {
  // files 列表拿 id
  const list = await (await svcApi('/api/files?page=1&pageSize=10')).json()
  const file = (list.items ?? [])[0]
  expect(file, '扫描入库的测试文件应存在').toBeTruthy()
  expect(file.name).toBe('e2e-sample.mp4')

  // Range 请求（<video> 标签的取流形态）
  const res = await svcApi(`/api/stream/${file.id}?token=${token}`, { headers: { Range: 'bytes=0-1023' } })
  expect(res.status).toBe(206)
  expect(res.headers.get('content-range')).toContain('bytes 0-1023/')
  const buf = await res.arrayBuffer()
  expect(buf.byteLength).toBe(1024)
})
