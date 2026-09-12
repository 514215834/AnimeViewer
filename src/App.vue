<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { NConfigProvider, NDialogProvider, NGlobalStyle, NMessageProvider, darkTheme, dateZhCN, zhCN } from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'
import { useSettingsStore } from './stores/settings'
import { useSyncStore } from './stores/sync'
import { useLibraryStore } from './stores/library'
import { startNotifyScheduler } from './utils/notify'

const settings = useSettingsStore()
const sync = useSyncStore()
const library = useLibraryStore()

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#8a7bff',
    primaryColorHover: '#a092ff',
    primaryColorPressed: '#6f61e0',
    borderRadius: '8px',
  },
}

// 主题切换：naive-ui 走 JS 主题，自定义令牌走 html.light class（styles.css --av-* 变量）
watch(
  () => settings.theme,
  (t) => document.documentElement.classList.toggle('light', t !== 'dark'),
  { immediate: true },
)

// 启动时静默自动同步一次（有 Token 且在线模式时）；
// 演示模式（含运行中切换）触发演示追番库异步播种（v0.10 P1，demo 模块按需加载）；
// T3 桌面通知调度器（仅 Tauri 环境生效，Web 下零开销空操作）
onMounted(() => {
  void sync.autoSyncOnce()
  startNotifyScheduler()
})
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
