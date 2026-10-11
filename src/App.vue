<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { NConfigProvider, NDialogProvider, NGlobalStyle, NMessageProvider, darkTheme, dateZhCN, zhCN } from 'naive-ui'
import { useSettingsStore } from './stores/settings'
import { useSyncStore } from './stores/sync'
import { useLibraryStore } from './stores/library'
import { migrateDemoMediaData } from './utils/mediaStore'
import { buildThemeOverrides, themeCssVars } from './utils/theme'

const settings = useSettingsStore()
const sync = useSyncStore()
const library = useLibraryStore()

// v0.32 TH1（§5T）：主题色单一事实源 = settings.themeColor，CSS 变量与 naive themeOverrides 均派生自它
// （utils/theme.ts），「两处手工同步」销账；themeColor 变更双轨一次同步
const themeOverrides = computed(() => buildThemeOverrides(settings.themeColor))

// 主题切换：naive-ui 走 JS 主题，自定义令牌走 html.light class（styles.css --av-* 变量）；
// 主题色经内联变量覆盖 styles.css :root 默认值（默认紫），玻璃档位经 data-glass 驱动三档令牌
watch(
  () => [settings.theme, settings.themeColor] as const,
  ([, color]) => {
    document.documentElement.classList.toggle('light', settings.theme !== 'dark')
    for (const [k, v] of Object.entries(themeCssVars(color))) document.documentElement.style.setProperty(k, v)
  },
  { immediate: true },
)
watch(
  () => settings.glassLevel,
  (level) => {
    document.documentElement.dataset.glass = level
  },
  { immediate: true },
)

// 启动编排：① 账户绑定/换号检测（含 v0.31 G2 存量收编，幂等）→ ② 静默自动同步（绑定完成后才推拉，
// 杜绝「绑定未完成时把 A 的 dirty 推给 B 的云端」摸底风险 1）；
// ③ 播放数据双库一次性迁移（v0.30 补记六：旧单库演示起源记录搬入演示库，幂等）；
// ④ 演示模式（含运行中切换）触发演示追番库异步播种（v0.10 P1，demo 模块按需加载）
onMounted(() => {
  void migrateDemoMediaData()
  void (async () => {
    await sync.ensureBinding()
    void sync.autoSyncOnce()
  })()
})
// v0.31 G3（§5S）：Token 变更单一入口（设置页保存/验证、退出登录、OAuth 回调均经 settings.applyPatch 触发）
watch(
  () => settings.accessToken,
  () => void sync.ensureBinding(),
)
watch(
  () => settings.isDemo,
  (isDemo) => {
    if (isDemo) void library.ensureDemoSeed()
  },
  { immediate: true },
)
</script>

<template>
  <NConfigProvider
    :theme="settings.theme === 'dark' ? darkTheme : null"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <NMessageProvider placement="top-right">
      <NDialogProvider>
        <RouterView />
      </NDialogProvider>
    </NMessageProvider>
    <NGlobalStyle />
  </NConfigProvider>
</template>
