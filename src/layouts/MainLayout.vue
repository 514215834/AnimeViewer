<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NLayout, NLayoutContent, NLayoutSider, NMenu, NSwitch, NTag } from 'naive-ui'
import type { MenuOption } from 'naive-ui'
import { useSettingsStore } from '../stores/settings'
import { useLibraryStore } from '../stores/library'

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()
const library = useLibraryStore()

const collapsed = ref(false)

const menuOptions = computed<MenuOption[]>(() => [
  { label: '📅 每周新番', key: 'calendar' },
  { label: '🧭 发现', key: 'discover' },
  { label: '🔍 搜索', key: 'search' },
  { label: `📚 我的追番${library.count ? ` (${library.count})` : ''}`, key: 'library' },
  { label: '⚙️ 设置', key: 'settings' },
])

const activeKey = computed(() => (route.name as string) || 'calendar')

function onMenuSelect(key: string) {
  router.push({ name: key })
}
</script>

<template>
  <NLayout has-sider style="height: 100vh">
    <NLayoutSider
      bordered
      collapse-mode="width"
      :collapsed-width="64"
      :width="210"
      :collapsed="collapsed"
      show-trigger
      @update:collapsed="(v: boolean) => (collapsed = v)"
    >
      <div class="sider-inner">
        <div class="logo" @click="router.push({ name: 'calendar' })">
          <span class="logo-icon">📺</span>
          <span v-if="!collapsed" class="logo-text">AnimeViewer</span>
        </div>
        <NMenu
          :value="activeKey"
          :options="menuOptions"
          :collapsed="collapsed"
          :collapsed-width="64"
          :indent="20"
          @update:value="onMenuSelect"
        />
        <div class="sider-footer">
          <div class="footer-row">
            <span v-if="!collapsed" class="footer-label">🌙</span>
            <NSwitch size="small" :value="settings.theme === 'dark'" @update:value="settings.toggleTheme()" />
            <span v-if="!collapsed" class="footer-label">☀️</span>
          </div>
          <NTag
            v-if="!collapsed"
            size="small"
            :type="settings.isDemo ? 'warning' : 'success'"
            :bordered="false"
            class="source-tag"
          >
            {{ settings.isDemo ? '演示数据' : '在线 API' }}
          </NTag>
        </div>
      </div>
    </NLayoutSider>
    <NLayoutContent class="content" :native-scrollbar="false">
      <div class="page-container">
        <RouterView />
      </div>
    </NLayoutContent>
  </NLayout>
</template>

<style scoped>
.sider-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 18px 16px 14px;
  cursor: pointer;
  user-select: none;
}

.logo-icon {
  font-size: 22px;
}

.logo-text {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.3px;
}

.sider-footer {
  margin-top: auto;
  padding: 14px 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.footer-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.footer-label {
  font-size: 13px;
}

.source-tag {
  align-self: flex-start;
}

.content {
  height: 100vh;
}

.page-container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 22px 26px 40px;
}
</style>
