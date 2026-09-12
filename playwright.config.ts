import { defineConfig } from '@playwright/test'

/**
 * v1.0-S1 T4 E2E 冒烟：演示模式主链路（今日 → 周历 → 详情 → 加追 → 剧集勾选 → 搜索）。
 * 走系统已安装的 Edge 内核（channel: msedge，免浏览器下载）；用例各自独立 context（localStorage 隔离）。
 * 演示模式零网络依赖，无 Token 不触发云同步。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  outputDir: './test-results',
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'msedge',
    viewport: { width: 1280, height: 820 },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
