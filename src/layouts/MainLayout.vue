<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, h, type Component } from 'vue'
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
  NBadge,
  NDrawer,
  NDrawerContent,
  useDialog,
  useMessage,
} from 'naive-ui'
import type { MenuOption } from 'naive-ui'
import {
  TodayOutline,
  CalendarOutline,
  CompassOutline,
  SearchOutline,
  LibraryOutline,
  TimeOutline,
  CloudDownloadOutline,
  SettingsOutline,
  TvOutline,
  MoonOutline,
  SunnyOutline,
  MenuOutline,
} from '@vicons/ionicons5'
import { useSettingsStore } from '../stores/settings'
import { useLibraryStore } from '../stores/library'
import { useSyncStore } from '../stores/sync'
import { mediaService } from '../api/mediaService'
import { dataSource } from '../api/dataSource'
import { loadJson, saveJson } from '../utils/storage'

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()
const library = useLibraryStore()
const sync = useSyncStore()
const message = useMessage()
const dialog = useDialog()

const collapsed = ref(false)

/* ── v0.31 G2/G4 账户绑定通知与存量收编裁决（§5S）：绑定/换号 toast + 收编弹窗二选一。
 *    immediate 必须：路由初始导航为异步——App.onMounted 的 ensureBinding 先于本组件挂载执行，
 *    bindingNotice/adoptionPrompt 可能已带着值等在这里（IAB 实测复现：非 immediate 永不追认旧值） ── */
watch(
  () => sync.bindingNotice,
  (n) => {
    if (!n) return
    message.info(n)
    sync.bindingNotice = ''
  },
  { immediate: true },
)
watch(
  () => sync.adoptionPrompt,
  (p) => {
    if (!p) return
    const who = sync.account?.nickname || sync.account?.username || `用户 ${sync.account?.id ?? ''}`
    dialog.warning({
      title: '收编升级前的存量数据',
      content: `本机检测到升级前的存量追番数据：${p.dirtyCount} 条未推送改动（含单集进度标记）。\n当前登录账户：${who}。\n\n「推送到该账户」：收编后立即同步，把改动写入该账户云端；\n「仅保留在本机」：改动清脏永不推送（云端零写入）。`,
      positiveText: '推送到该账户',
      negativeText: '仅保留在本机',
      maskClosable: false,
      closable: false,
      onPositiveClick: () => void handleAdoption(true),
      onNegativeClick: () => void handleAdoption(false),
    })
  },
  { immediate: true },
)
async function handleAdoption(push: boolean) {
  const r = await sync.resolveAdoption(push)
  if (r.ok) message.success(r.message)
  else message.warning(r.message)
}

/* ── v0.19 SU3 应用内通知：60s 轮询 summary —— 待确认命中数 → 「下载」角标；新命中/新完成 → toast ── */
const pendingHits = ref(0)
let lastHitId = 0
let lastCompletedKey = ''
let notifyTimer: number | null = null

async function pollSummary(silent = false) {
  if (!mediaService.configured()) return
  try {
    const s = await mediaService.downloadSummary()
    pendingHits.value = s.pendingHits
    if (s.lastHit && s.lastHit.id > lastHitId) {
      if (!silent) {
        const subj = s.lastHit.subjectNameCn || s.lastHit.subjectName || `条目 ${s.lastHit.subjectId}`
        message.info(
          `订阅命中：${subj}${s.lastHit.episodeSort ? ` 第 ${s.lastHit.episodeSort} 话` : ''}——下载中心待确认`,
          { duration: 6000 },
        )
      }
      lastHitId = s.lastHit.id
    }
    if (s.lastCompleted) {
      const key = `${s.lastCompleted.id}:${s.lastCompleted.completedAt ?? 0}`
      if (key !== lastCompletedKey) {
        if (!silent && lastCompletedKey) {
          const c = s.lastCompleted
          message.success(
            `下载完成：${c.subjectNameCn || c.subjectName || c.name || `任务 #${c.id}`}——文件已进入媒体库匹配`,
            { duration: 6000 },
          )
        }
        lastCompletedKey = key
      }
    }
  } catch {
    // 服务不可达：静默（不打扰正常浏览）
  }
}

onMounted(() => {
  // 首轮静默建立基线，后续有新事件才 toast
  void pollSummary(true)
  notifyTimer = window.setInterval(() => void pollSummary(), 60000)
})
onBeforeUnmount(() => {
  if (notifyTimer) window.clearInterval(notifyTimer)
})

/* ── v0.29 Q2 更新提醒：启动/切回应用时对比追番库与周历（本地对比，零新增 API）——
 *   今日有新话且未看完 → toast 一次；设置开关关闭零打扰；localStorage 按日节流（每天至多一次），不与 v0.19 轮询通道重复打扰 ── */
const UPDATE_NOTIFY_KEY = 'animeviewer:update-notify'

async function checkTodayUpdates() {
  if (!settings.updateNotify) return
  const today = new Date().toISOString().slice(0, 10)
  if (loadJson<string>(UPDATE_NOTIFY_KEY, '') === today) return
  try {
    const days = await dataSource.calendar(true)
    const d = new Date().getDay()
    const todayId = d === 0 ? 7 : d
    const todayIds = new Set(days.find((x) => x.weekday.id === todayId)?.items.map((i) => i.id) ?? [])
    const hits = library.list.filter((e) => {
      if (e.status !== 'doing' || !todayIds.has(e.subjectId)) return false
      // 新集判定：周历话数（较新鲜）优先，回退条目 epsTotal；话数未知无法判定 → 跳过
      const eps = days.find((x) => x.weekday.id === todayId)?.items.find((i) => i.id === e.subjectId)?.eps
      return eps && eps > 0 ? e.progress < eps : e.epsTotal > 0 ? e.progress < e.epsTotal : false
    })
    if (!hits.length) return
    saveJson(UPDATE_NOTIFY_KEY, today)
    const names = hits.slice(0, 3).map((e) => e.nameCn || e.name).join('、')
    message.info(`今日更新提醒：${hits.length} 部追番有新话——${names}${hits.length > 3 ? ' 等' : ''}，去「今日」查看`, {
      duration: 8000,
    })
  } catch {
    // 周历不可达：静默（提醒是增强能力，不打扰正常浏览）
  }
}

onMounted(() => {
  void checkTodayUpdates()
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisibility))

function onVisibility() {
  if (document.visibilityState === 'visible') void checkTodayUpdates()
}

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
  { label: '播放历史', key: 'history', icon: renderIcon(TimeOutline) },
  {
    // v0.19 SU3：待确认命中数角标（label 为渲染函数；折叠态 label 不显示，与追番计数同样局限）
    label: () =>
      h('span', { class: 'downloads-label' }, [
        '下载',
        pendingHits.value > 0
          ? h(NBadge, { value: pendingHits.value, class: 'dl-badge' })
          : null,
      ]),
    key: 'downloads',
    icon: renderIcon(CloudDownloadOutline),
  },
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
            round
            :type="settings.isDemo ? 'warning' : 'success'"
            :bordered="false"
            class="source-tag"
          >
            <span class="source-dot" />{{ settings.isDemo ? '演示数据' : '在线 API' }}
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
          <NTag size="small" round :type="settings.isDemo ? 'warning' : 'success'" :bordered="false" class="source-tag">
            <span class="source-dot" />{{ settings.isDemo ? '演示数据' : '在线 API' }}
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

/* 菜单激活态：渐变底 + 左侧发光指示条 + 白字（覆盖 naive 默认主色底） */
.sider-inner :deep(.n-menu .n-menu-item-content) {
  border-radius: 10px;
}

.sider-inner :deep(.n-menu .n-menu-item-content--selected) {
  position: relative;
  background: linear-gradient(90deg, rgba(138, 123, 255, 0.22), rgba(138, 123, 255, 0.07)) !important;
}

.sider-inner :deep(.n-menu .n-menu-item-content--selected::before) {
  content: '';
  position: absolute;
  left: 3px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 18px;
  border-radius: 3px;
  background: var(--av-progress-grad);
  box-shadow: 0 0 10px rgba(138, 123, 255, 0.8);
}

.sider-inner :deep(.n-menu .n-menu-item-content--selected .n-menu-item-content-header),
.sider-inner :deep(.n-menu .n-menu-item-content--selected .n-menu-item-content-header a) {
  color: #fff !important;
  font-weight: 600;
}

.sider-inner :deep(.n-menu .n-menu-item-content--selected .n-icon) {
  color: #fff;
}

html.light .sider-inner :deep(.n-menu .n-menu-item-content--selected) {
  background: linear-gradient(90deg, rgba(138, 123, 255, 0.18), rgba(138, 123, 255, 0.05)) !important;
}

html.light .sider-inner :deep(.n-menu .n-menu-item-content--selected .n-menu-item-content-header),
html.light .sider-inner :deep(.n-menu .n-menu-item-content--selected .n-menu-item-content-header a) {
  color: #5b4fd6 !important;
}

html.light .sider-inner :deep(.n-menu .n-menu-item-content--selected .n-icon) {
  color: #5b4fd6;
}

.sider-footer {
  margin-top: auto;
  padding: 14px 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px solid var(--av-border);
}

/* v0.12 B2 数据源标签呼吸点（动效尊重 prefers-reduced-motion，降级规则在 styles.css） */
.source-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 5px;
  background: currentColor;
  box-shadow: 0 0 6px currentColor;
  vertical-align: middle;
  animation: av-breath 2.4s ease-in-out infinite;
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

/* v0.19 SU3 下载角标（菜单 label 内） */
.downloads-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dl-badge :deep(.n-badge-sup) {
  box-shadow: 0 0 0 2px var(--av-surface);
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
