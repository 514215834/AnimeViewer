import { expect, test } from '@playwright/test'

/**
 * T4 E2E 冒烟（演示模式）：覆盖「今日仪表盘 → 周历 → 详情 → 加追 → 剧集勾选 → 搜索 → 追番库」主链路。
 * 每个用例独立 context：注入演示模式配置（settings store 与默认值合并，partial 即可），
 * 演示追番库 4 条种子（星轨之约·在看 / 像素恋歌·想看 / 极光列车·在看 / 周日的写字台·看完）由应用自动播种。
 */

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('animeviewer:settings', JSON.stringify({ dataSource: 'demo' }))
  })
})

test('今日仪表盘：概览统计与继续观看（演示库种子）', async ({ page }) => {
  await page.goto('/#/today')
  // 概览六格（在看 2 / 想看 1 / 看完 1）
  await expect(page.locator('.stat-card')).toHaveCount(6)
  await expect(page.locator('.stat-card', { hasText: '在看' })).toContainText('2')
  await expect(page.locator('.stat-card', { hasText: '想看' })).toContainText('1')
  await expect(page.locator('.stat-card', { hasText: '看完' })).toContainText('1')
  // 继续观看：在看未看完条目（星轨之约 2/12、极光列车 2/13）
  await expect(page.locator('.section-title', { hasText: '继续观看' })).toBeVisible()
  await expect(page.locator('.today-row', { hasText: '星轨之约' })).toBeVisible()
  await expect(page.locator('.today-row', { hasText: '极光列车' })).toBeVisible()
})

test('周历 → 详情 → 加追 → 剧集勾选 → 刷新持久化', async ({ page }) => {
  // 周历卡片点击进入详情
  await page.goto('/#/calendar')
  await page.locator('.anime-card').first().click()
  await expect(page).toHaveURL(/#\/subject\/\d+/)

  // 加追演示条目 900002（未在种子里）：加入后剧集 Tab 可勾选
  await page.goto('/#/subject/900002')
  await expect(page.getByRole('button', { name: '加入追番' })).toBeVisible()
  await page.getByRole('button', { name: '加入追番' }).click()
  await expect(page.getByText('已加入我的追番')).toBeVisible()

  // 剧集 Tab：勾选第 1 话 → 计数变化（naive-ui NTabs 不暴露 tab ARIA 角色，按文本定位）
  await page.locator('.n-tabs-tab', { hasText: '剧集' }).click()
  const epsCount = page.locator('.eps-count')
  await expect(epsCount).toContainText('已看 0 / 12 话')
  await page.locator('.ep-row').first().locator('.n-checkbox').click()
  await expect(epsCount).toContainText('已看 1 / 12 话')

  // 刷新后勾选态持久化（localStorage）
  await page.reload()
  await page.locator('.n-tabs-tab', { hasText: '剧集' }).click()
  await expect(page.locator('.eps-count')).toContainText('已看 1 / 12 话')
})

test('搜索：关键词命中演示条目', async ({ page }) => {
  await page.goto('/#/search')
  await page.getByPlaceholder('输入动漫名称，回车搜索').fill('星轨')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.locator('.anime-card', { hasText: '星轨之约' }).first()).toBeVisible()
})

test('追番库：演示种子 4 条与分区切换', async ({ page }) => {
  await page.goto('/#/library')
  await expect(page.getByRole('radio', { name: '追番 (4)' })).toBeVisible()
  for (const name of ['星轨之约', '像素恋歌', '极光列车', '周日的写字台']) {
    await expect(page.getByText(name).first()).toBeVisible()
  }
  // 分区切换：我的角色（演示数据为空 → 计数 0）
  await page.locator('.radio-icon-row', { hasText: '我的角色' }).click()
  await expect(page.locator('.radio-icon-row', { hasText: '我的角色 (0)' })).toBeVisible()
})
