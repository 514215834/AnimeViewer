<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, h, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NLayout,
  NLayoutContent,
  NLayoutSider,
  NMenu,
  NSwitch,
  NTag,
  NIcon,
  NButton,
  NDrawer,
  NDrawerContent,
} from 'naive-ui'
import type { MenuOption } from 'naive-ui'
import {
  TodayOutline,
  CalendarOutline,
  CompassOutline,
  SearchOutline,
  LibraryOutline,
  SettingsOutline,
  TvOutline,
  MoonOutline,
  SunnyOutline,
  MenuOutline,
} from '@vicons/ionicons5'
import { useSettingsStore } from '../stores/settings'
import { useLibraryStore } from '../stores/library'

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()
const library = useLibraryStore()

const collapsed = ref(false)

/** v0.10 P4：≤768px 判定（JS 驱动布局切换，桌面布局不动） */
const isMobile = ref(false)
let mql: MediaQueryList | null = null
onMounted(() => {
  if (typeof window.matchMedia !== 'function') return
  mql = window.matchMedia('(max-width: 768px)')
  isMobile.value = mql.matches
  mql.addEventListener('change', onMqChange)
})
onBeforeUnmount(() => mql?.removeEventListener('change', onMqChange))
function onMqChange(e: MediaQueryListEvent) {
  isMobile.value = e.matches
  if (!e.matches) drawerOpen.value = false
}

/** v0.10 U2：菜单 emoji 改图标库（tree-shaking 仅打包引用项） */
function renderIcon(icon: Component) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

const menuOptions = computed<MenuOption[]>(() => [
  { label: '今日', key: 'today', icon: renderIcon(TodayOutline) },
  { label: '每周新番', key: 'calendar', icon: renderIcon(CalendarOutline) },
  { label: '发现', key: 'discover', icon: renderIcon(CompassOutline) },
  { label: '搜索', key: 'search', icon: renderIcon(SearchOutline) },
  { label: `我的追番${library.count ? ` (${library.count})` : ''}`, key: 'library', icon: renderIcon(LibraryOutline) },
  { label: '设置', key: 'settings', icon: renderIcon(SettingsOutline) },
])

const activeKey = computed(() => (route.name as string) || 'today')

function onMenuSelect(key: string) {
  router.push({ name: key })
}

/* ── P4 移动端 ── */
const drawerOpen = ref(false)
function onMenuSelectMobile(key: string) {
  drawerOpen.value = false
  router.push({ name: key })
}
</script>

<template>
  <!-- 桌面：侧边栏布局（v0.10 起保持不动） -->
  <NLayout v-if="!isMobile" has-sider style="height: 100vh">
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
        <div class="logo" @click="router.push({ name: 'today' })">
          <NIcon size="24" class="logo-icon" :component="TvOutline" />
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
            <NIcon v-if="!collapsed" size="15" class="footer-label" :component="MoonOutline" />
            <NSwitch size="small" :value="settings.theme === 'dark'" @update:value="settings.toggleTheme()" />
            <NIcon v-if="!collapsed" size="15" class="footer-label" :component="SunnyOutline" />
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
        <!-- v0.10 U4：路由切换过渡（fade + 上移），prefers-reduced-motion 下禁用（styles.css） -->
        <RouterView v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </div>
    </NLayoutContent>
  </NLayout>

  <!-- 移动端（≤768px）：顶栏 + 抽屉导航 -->
  <div v-else class="mobile-shell">
    <div class="m-topbar">
      <NButton quaternary size="small" aria-label="打开导航" @click="drawerOpen = true">
        <NIcon :size="20" :component="MenuOutline" />
      </NButton>
      <div class="m-logo" @click="router.push({ name: 'today' })">
        <NIcon size="20" class="logo-icon" :component="TvOutline" />
        <span>AnimeViewer</span>
      </div>
      <NSwitch size="small" :value="settings.theme === 'dark'" @update:value="settings.toggleTheme()" />
    </div>
    <div class="m-content">
      <div class="page-container">
        <RouterView v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </div>
    </div>
  </div>

  <NDrawer v-model:show="drawerOpen" placement="left" :width="232">
    <NDrawerContent body-content-style="padding: 0" title="导航" closable>
      <div class="sider-inner">
        <NMenu :value="activeKey" :options="menuOptions" :indent="20" @update:value="onMenuSelectMobile" />
        <div class="sider-footer">
          <NTag size="small" :type="settings.isDemo ? 'warning' : 'success'" :bordered="false" class="source-tag">
            {{ settings.isDemo ? '演示数据' : '在线 API' }}
          </NTag>
        </div>
      </div>
    </NDrawerContent>
  </NDrawer>
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
  color: var(--av-primary);
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
  color: var(--av-text-secondary);
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

/* ── P4 移动端（结构由 isMobile JS 驱动，此处仅样式） ── */
.mobile-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.m-topbar {
  height: 52px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid var(--av-border);
  background: var(--av-surface);
  backdrop-filter: blur(8px);
}

.m-logo {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
  margin-right: auto;
}

.m-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

@media (max-width: 768px) {
  .page-container {
    padding: 14px 12px 32px;
  }
}
</style>
