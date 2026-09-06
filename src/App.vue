<script setup lang="ts">
import { onMounted } from 'vue'
import { NConfigProvider, NDialogProvider, NGlobalStyle, NMessageProvider, darkTheme, dateZhCN, zhCN } from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'
import { useSettingsStore } from './stores/settings'
import { useSyncStore } from './stores/sync'

const settings = useSettingsStore()
const sync = useSyncStore()

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#8a7bff',
    primaryColorHover: '#a092ff',
    primaryColorPressed: '#6f61e0',
    borderRadius: '8px',
  },
}

// 启动时静默自动同步一次（有 Token 且在线模式时）
onMounted(() => {
  void sync.autoSyncOnce()
})
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
