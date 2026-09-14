<script setup lang="ts">
/** v0.16 DN3 下载中心：aria2 下载引擎的前端面板。
 *  引擎状态卡（可用性/模式/版本/下载目录 + 重启）→ 添加磁力（解析预览 + 可选关联条目/集数，
 *  服务未配置时降级「一键复制磁力」）→ 任务列表（2s 轮询，进度/速度/peer 如实显示）→
 *  任务详情抽屉（文件清单勾选 select-file、删除含删文件）。
 *  v0.18 qBittorrent 外部应用直开：添加磁力即拉起本机 qBt（无 RPC），此类任务状态定格
 *  external（已交给下载器），列表不显示进度条/速度，暂停恢复与文件勾选被隐藏（在 qBt 中操作）。
 *  v0.19 SU1/SU2 订阅自动化：待确认命中区（一键下载/忽略/忽略字幕组并记忆）+ 订阅管理
 *  （全自动开关/立即全量检索/取消订阅）+ 命中历史台账。 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCheckbox,
  NCollapse,
  NCollapseItem,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NIcon,
  NInput,
  NInputNumber,
  NModal,
  NPopconfirm,
  NProgress,
  NSelect,
  NSpin,
  NSwitch,
  NTag,
  NTooltip,
  useMessage,
} from 'naive-ui'
import {
  AddOutline,
  CloudDownloadOutline,
  CopyOutline,
  PauseOutline,
  PlayOutline,
  RefreshOutline,
  SearchOutline,
  TrashOutline,
} from '@vicons/ionicons5'
import { clipboard } from '../utils/clipboard'
import {
  formatBytes,
  formatSpeed,
  mediaService,
  parseMagnet,
  ServiceError,
  type SvcDownloadEngine,
  type SvcDownloadTask,
  type SvcSubHit,
  type SvcSubscription,
} from '../api/mediaService'
import EmptyHint from '../components/EmptyHint.vue'

const message = useMessage()

/* ── 引擎状态 ── */

const engine = ref<SvcDownloadEngine | null>(null)
const serviceConfigured = computed(() => mediaService.configured())
const engineChecking = ref(false)

async function refreshEngine() {
  if (!serviceConfigured.value) return
  engineChecking.value = true
  try {
    engine.value = await mediaService.downloadEngine()
  } catch (e) {
    engine.value = { available: false, mode: 'managed', error: e instanceof ServiceError ? e.message : '引擎状态获取失败' }
  } finally {
    engineChecking.value = false
  }
}

async function restartEngine() {
  engineChecking.value = true
  try {
    engine.value = await mediaService.restartDownloadEngine()
    message.success(engine.value.available ? '引擎已重启' : `引擎重启失败：${engine.value.error ?? ''}`)
  } catch (e) {
    message.error(e instanceof ServiceError ? e.message : '重启失败')
  } finally {
    engineChecking.value = false
  }
}

/* ── 任务列表（2s 轮询） ── */

const tasks = ref<SvcDownloadTask[]>([])
const loading = ref(true)
let timer: number | null = null

async function refreshTasks(silent = true) {
  if (!serviceConfigured.value) {
    loading.value = false
    return
  }
  if (!silent) loading.value = true
  try {
    tasks.value = await mediaService.downloads()
  } catch (e) {
    if (!silent) message.error(e instanceof ServiceError ? e.message : '任务列表加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await Promise.all([refreshEngine(), refreshTasks(false), refreshSubscriptionData()])
  timer = window.setInterval(refreshTasks, 2000)
  subTimer = window.setInterval(refreshSubscriptionData, 10000)
})
onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
  if (subTimer) window.clearInterval(subTimer)
})

/* ── v0.19 SU1/SU2 订阅与命中（10s 轮询；操作后立即刷新） ── */

const pendingHits = ref<SvcSubHit[]>([])
const hitHistory = ref<SvcSubHit[]>([])
const subs = ref<SvcSubscription[]>([])
const subBusyId = ref<number | null>(null)
const checkNowBusy = ref(false)
let subTimer: number | null = null

const HIT_STATUS: Record<string, { label: string; type: 'default' | 'success' | 'warning' | 'info' | 'error' }> = {
  pending: { label: '待确认', type: 'warning' },
  enqueued: { label: '已入队', type: 'info' },
  auto: { label: '已自动入队', type: 'success' },
  ignored: { label: '已忽略', type: 'error' },
}

async function refreshSubscriptionData(silent = true) {
  if (!serviceConfigured.value) return
  try {
    const [pending, history, list] = await Promise.all([
      mediaService.subHits('pending', 50),
      mediaService.subHits(undefined, 30),
      mediaService.subscriptions(),
    ])
    pendingHits.value = pending
    hitHistory.value = history.filter((h) => h.status !== 'pending')
    subs.value = list
  } catch (e) {
    if (!silent) message.error(e instanceof ServiceError ? e.message : '订阅数据加载失败')
  }
}

function subName(s: SvcSubscription): string {
  return s.subjectNameCn || s.subjectName || `条目 ${s.subjectId}`
}

function hitSubjectName(h: SvcSubHit): string {
  return h.subjectNameCn || h.subjectName || `条目 ${h.subjectId}`
}

async function acceptHit(h: SvcSubHit) {
  subBusyId.value = h.id
  try {
    await mediaService.acceptHit(h.id)
    message.success(h.episodeSort ? `第 ${h.episodeSort} 话资源已加入下载队列` : '资源已加入下载队列')
    await Promise.all([refreshSubscriptionData(), refreshTasks()])
  } catch (e) {
    message.error(e instanceof ServiceError ? e.message : '入队失败')
    await refreshSubscriptionData()
  } finally {
    subBusyId.value = null
  }
}

async function ignoreHit(h: SvcSubHit, blockFansub: boolean) {
  subBusyId.value = h.id
  try {
    await mediaService.ignoreHit(h.id, blockFansub)
    message.success(blockFansub && h.fansub ? `已忽略，且后续不再显示「${h.fansub}」的命中` : '已忽略该命中')
    await refreshSubscriptionData()
  } catch (e) {
    message.error(e instanceof ServiceError ? e.message : '操作失败')
    await refreshSubscriptionData()
  } finally {
    subBusyId.value = null
  }
}

async function toggleSubAuto(s: SvcSubscription, auto: boolean) {
  subBusyId.value = s.id
  try {
    await mediaService.updateSubscription(s.id, { auto })
    message.success(auto
      ? '已开启全自动：命中直接入下载队列（受每日上限/大小上限/仅已匹配三重保护约束）'
      : '已切换为待确认模式：命中需人工确认后才下载')
    await refreshSubscriptionData()
  } catch (e) {
    message.error(e instanceof ServiceError ? e.message : '操作失败')
  } finally {
    subBusyId.value = null
  }
}

async function removeSub(s: SvcSubscription) {
  subBusyId.value = s.id
  try {
    await mediaService.unsubscribeSubject(s.id)
    message.success(`已取消订阅「${subName(s)}」`)
    await refreshSubscriptionData()
  } catch (e) {
    message.error(e instanceof ServiceError ? e.message : '操作失败')
  } finally {
    subBusyId.value = null
  }
}

async function checkNow() {
  checkNowBusy.value = true
  try {
    const hits = await mediaService.checkSubscriptionsNow()
    message.success(hits > 0 ? `全量检索完成，新增 ${hits} 条命中` : '全量检索完成，暂无新命中')
  } catch (e) {
    message.error(e instanceof ServiceError ? e.message : '检索失败')
  } finally {
    checkNowBusy.value = false
    await refreshSubscriptionData()
  }
}

const activeTasks = computed(() => tasks.value.filter((t) => !['completed', 'error'].includes(t.status)))
const finishedTasks = computed(() => tasks.value.filter((t) => ['completed', 'error'].includes(t.status)))

const STATUS_TAG: Record<string, { label: string; type: 'default' | 'success' | 'warning' | 'info' | 'error' }> = {
  queued: { label: '排队中', type: 'default' },
  metadata: { label: '解析元数据', type: 'info' },
  downloading: { label: '下载中', type: 'success' },
  paused: { label: '已暂停', type: 'warning' },
  external: { label: '已交给下载器', type: 'info' },
  completed: { label: '已完成', type: 'success' },
  error: { label: '失败', type: 'error' },
}

/** v0.18 当前引擎是否 qBittorrent 直开（添加弹窗文案/操作隐藏依据） */
const externalEngine = computed(() => engine.value?.available && engine.value?.mode === 'external-app')

function taskName(t: SvcDownloadTask): string {
  if (t.name) return t.name
  if (t.subjectNameCn || t.subjectName) return `${t.subjectNameCn || t.subjectName}（未命名资源）`
  return t.uri.replace(/^magnet:\?xt=urn:btih:/, 'BT ').slice(0, 60)
}

function ratio(t: SvcDownloadTask): number {
  return t.totalLength > 0 ? Math.min(1, t.completedLength / t.totalLength) : 0
}

async function pauseOrResume(t: SvcDownloadTask) {
  try {
    if (t.status === 'paused') await mediaService.resumeDownload(t.id)
    else await mediaService.pauseDownload(t.id)
    await refreshTasks()
  } catch (e) {
    message.error(e instanceof ServiceError ? e.message : '操作失败')
  }
}

async function removeTask(t: SvcDownloadTask, deleteFiles: boolean) {
  try {
    await mediaService.removeDownload(t.id, deleteFiles)
    message.success(deleteFiles ? '任务已删除，文件一并清除' : '任务已删除，文件保留')
    detailOpen.value = false
    await Promise.all([refreshTasks(), refreshEngine()])
  } catch (e) {
    message.error(e instanceof ServiceError ? e.message : '删除失败')
  }
}

/* ── 添加磁力 ── */

const addOpen = ref(false)
const addUri = ref('')
const addBusy = ref(false)
const addSearch = ref('')
const addSearching = ref(false)
const addSubject = ref<{ subjectId: number; name: string; nameCn?: string } | null>(null)
const addSort = ref<number | null>(null)
const parsed = computed(() => parseMagnet(addUri.value.trim()))
const addValid = computed(() => parsed.value.infoHash !== undefined || /^(https?|ftp):\/\//i.test(addUri.value.trim()))
let searchTimer: number | null = null

function openAdd() {
  addUri.value = ''
  addSearch.value = ''
  addSubject.value = null
  addSort.value = null
  addOpen.value = true
}

function onSearchInput(v: string) {
  addSearch.value = v
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(runSearch, 350)
}

const subjectOptions = ref<{ label: string; value: number; raw: { subjectId: number; name: string; nameCn?: string } }[]>([])

async function runSearch() {
  const kw = addSearch.value.trim()
  if (!kw) {
    subjectOptions.value = []
    return
  }
  addSearching.value = true
  try {
    const list = await mediaService.bangumiSearch(kw)
    subjectOptions.value = list.map((s) => ({
      label: `${s.nameCn || s.name || `条目 ${s.subjectId}`}${s.nameCn && s.name ? ` (${s.name})` : ''}`,
      value: s.subjectId,
      raw: { subjectId: s.subjectId, name: s.name ?? '', nameCn: s.nameCn },
    }))
  } catch (e) {
    message.warning(e instanceof ServiceError ? e.message : '条目搜索失败')
    subjectOptions.value = []
  } finally {
    addSearching.value = false
  }
}

function onSubjectPick(v: number | null) {
  const hit = subjectOptions.value.find((o) => o.value === v)
  addSubject.value = hit ? hit.raw : null
}

async function submitAdd() {
  if (!addValid.value || addBusy.value) return
  addBusy.value = true
  try {
    await mediaService.addDownload({
      uri: addUri.value.trim(),
      subjectId: addSubject.value?.subjectId,
      subjectName: addSubject.value?.name,
      subjectNameCn: addSubject.value?.nameCn,
      episodeSort: addSort.value ?? undefined,
    })
    message.success(externalEngine.value ? '已拉起本机 qBittorrent 下载' : '任务已加入下载队列')
    addOpen.value = false
    await Promise.all([refreshTasks(), refreshEngine()])
  } catch (e) {
    if (e instanceof ServiceError && e.kind === 'unreachable') {
      message.error('媒体服务未配置或不可达——可将磁力链接复制到外部 BT 客户端下载')
    } else {
      message.error(e instanceof ServiceError ? e.message : '添加失败')
    }
  } finally {
    addBusy.value = false
  }
}

async function copyMagnet() {
  await clipboard.write(addUri.value.trim())
  message.success('磁力链接已复制，可粘贴到外部 BT 客户端（qBittorrent 等）')
}

/** 任务磁力/直链复制（直开任务进度不可见，复制后可自行粘贴回 qBt） */
async function copyTaskUri(t: SvcDownloadTask) {
  await clipboard.write(t.uri)
  message.success('链接已复制')
}

/* ── 任务详情 ── */

const detailOpen = ref(false)
const detailTask = ref<SvcDownloadTask | null>(null)
const fileSelection = ref<Set<number>>(new Set())
const applyingSelection = ref(false)

function openDetail(t: SvcDownloadTask) {
  detailTask.value = t
  fileSelection.value = new Set(t.files.filter((f) => f.selected).map((f) => f.index))
  detailOpen.value = true
}

/** 轮询同步详情抽屉内容 */
function syncDetail() {
  if (!detailOpen.value || !detailTask.value) return
  const fresh = tasks.value.find((t) => t.id === detailTask.value!.id)
  if (fresh) detailTask.value = fresh
}

function toggleFile(index: number, checked: boolean) {
  const next = new Set(fileSelection.value)
  if (checked) next.add(index)
  else next.delete(index)
  fileSelection.value = next
}

const selectionChanged = computed(() => {
  if (!detailTask.value) return false
  const original = new Set(detailTask.value.files.filter((f) => f.selected).map((f) => f.index))
  return original.size !== fileSelection.value.size || [...fileSelection.value].some((i) => !original.has(i))
})

const filesComplete = computed(() => {
  const files = detailTask.value?.files ?? []
  return files.length > 0 && files.every((f) => f.completedLength >= f.length && f.length >= 0)
})

async function applySelection() {
  if (!detailTask.value || !selectionChanged.value || applyingSelection.value) return
  applyingSelection.value = true
  try {
    await mediaService.applyDownloadSelection(detailTask.value.id, [...fileSelection.value])
    message.success('文件选择已应用')
    await refreshTasks()
    syncDetail()
  } catch (e) {
    message.error(e instanceof ServiceError ? e.message : '应用失败')
  } finally {
    applyingSelection.value = false
  }
}

function fmtWhen(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

defineExpose({ syncDetail })
let syncTimer: number | null = null
onMounted(() => {
  // 详情抽屉随轮询同步（refreshTasks 之后）
  syncTimer = window.setInterval(syncDetail, 2000)
})
onBeforeUnmount(() => {
  if (syncTimer) window.clearInterval(syncTimer)
})
</script>

<template>
  <div class="page-container">
    <div class="page-head">
      <h2><NIcon :component="CloudDownloadOutline" /> 下载</h2>
      <div class="head-actions">
        <NTooltip v-if="!serviceConfigured">
          <template #trigger>
            <NTag size="small" type="warning" round>媒体服务未配置</NTag>
          </template>
          在设置页配置媒体服务后可使用 BT 下载中心
        </NTooltip>
        <NButton size="small" quaternary :loading="engineChecking" @click="refreshEngine">
          <template #icon><NIcon :component="RefreshOutline" /></template>
          刷新引擎
        </NButton>
        <NButton size="small" type="primary" round @click="openAdd">
          <template #icon><NIcon :component="AddOutline" /></template>
          添加磁力
        </NButton>
      </div>
    </div>

    <!-- 引擎状态卡 -->
    <div v-if="serviceConfigured" class="engine-card" :class="{ off: engine && !engine.available }">
      <template v-if="engine">
        <NTag size="small" round :type="engine.available ? 'success' : 'error'" :bordered="false">
          {{ engine.available ? `引擎可用 · ${engine.mode === 'external-app' ? 'qBittorrent 直开' : engine.mode === 'external' ? '外部实例' : '托管模式'}` : '引擎不可用' }}
        </NTag>
        <span v-if="engine.version" class="engine-meta">aria2 {{ engine.version }}</span>
        <span v-if="engine.downloadDir" class="engine-meta">目录 {{ engine.downloadDir }}</span>
        <span v-if="engine.error" class="engine-error">{{ engine.error }}</span>
        <NButton v-if="engine.available" size="tiny" quaternary @click="restartEngine">
          {{ engine.mode === 'external-app' ? '重新检测' : '重启引擎' }}
        </NButton>
        <NButton v-else size="tiny" quaternary type="primary" @click="restartEngine">重试连接</NButton>
      </template>
      <NSpin v-else size="small" />
    </div>

    <!-- v0.19 SU2 待确认命中（订阅自动化的命中默认人工把关） -->
    <section v-if="serviceConfigured && pendingHits.length" class="dl-section sub-section">
      <h3 class="dl-title">
        待确认命中（{{ pendingHits.length }}）
        <span class="sub-hint">订阅检索到的新资源——确认后才下载</span>
      </h3>
      <div v-for="h in pendingHits" :key="h.id" class="hit-row">
        <div class="dl-main">
          <div class="dl-name-line">
            <NTag size="tiny" round :bordered="false" type="warning">第 {{ h.episodeSort ?? '?' }} 话</NTag>
            <NTag v-if="h.fansub" size="tiny" round :bordered="false">{{ h.fansub }}</NTag>
            <span class="hit-name" :title="h.title">{{ h.title }}</span>
          </div>
          <div class="dl-stat-line">
            <span>{{ hitSubjectName(h) }}</span>
            <span v-if="h.size">{{ h.size }}</span>
            <span v-if="h.site">{{ h.site }}</span>
            <span>{{ fmtWhen(h.createdAt) }}</span>
          </div>
        </div>
        <div class="dl-ops hit-ops" @click.stop>
          <NButton size="tiny" type="primary" secondary :loading="subBusyId === h.id" @click="acceptHit(h)">下载</NButton>
          <NButton size="tiny" quaternary :disabled="subBusyId === h.id" @click="ignoreHit(h, false)">忽略</NButton>
          <NPopconfirm
            v-if="h.fansub"
            @positive-click="ignoreHit(h, true)"
          >
            <template #trigger>
              <NButton size="tiny" quaternary :disabled="subBusyId === h.id">忽略该字幕组</NButton>
            </template>
            后续订阅检索不再显示「{{ h.fansub }}」的命中，确定？
          </NPopconfirm>
        </div>
      </div>
    </section>

    <!-- v0.19 SU1 订阅管理 -->
    <section v-if="serviceConfigured" class="dl-section sub-section">
      <h3 class="dl-title">
        订阅（{{ subs.length }}）
        <NButton size="tiny" quaternary :loading="checkNowBusy" class="check-now" @click="checkNow">立即全量检索</NButton>
      </h3>
      <div v-if="!subs.length" class="dl-none">
        还没有订阅——在条目详情页剧集 Tab 打开「自动追下载」即可定时追新集
      </div>
      <div v-for="s in subs" :key="s.id" class="sub-row">
        <div class="dl-main">
          <div class="dl-name-line">
            <span class="dl-name" :title="subName(s)">{{ subName(s) }}</span>
            <NTag size="tiny" round :bordered="false" :type="s.auto ? 'success' : 'default'">
              {{ s.auto ? '全自动' : '待确认' }}
            </NTag>
            <span class="sub-baseline">基线第 {{ s.minEpisode }} 话后</span>
            <NTag v-for="f in s.ignoredFansubs.slice(0, 3)" :key="f" size="tiny" round :bordered="false" type="error">
              屏蔽 {{ f }}
            </NTag>
          </div>
          <div class="dl-stat-line">
            <span>上次检索 {{ s.lastCheckedAt ? fmtWhen(s.lastCheckedAt) : '尚未执行' }}</span>
            <span v-if="s.lastHitAt">最近命中 {{ fmtWhen(s.lastHitAt) }}</span>
          </div>
        </div>
        <div class="dl-ops" @click.stop>
          <span class="sub-auto-label">{{ s.auto ? '全自动' : '待确认' }}</span>
          <NSwitch
            size="small"
            :value="s.auto"
            :disabled="subBusyId === s.id"
            @update:value="(v: boolean) => toggleSubAuto(s, v)"
          />
          <NPopconfirm @positive-click="removeSub(s)">
            <template #trigger>
              <NButton size="tiny" quaternary type="error" circle>
                <template #icon><NIcon :component="TrashOutline" /></template>
              </NButton>
            </template>
            取消订阅「{{ subName(s) }}」？（已生成的待确认命中保留）
          </NPopconfirm>
        </div>
      </div>
    </section>

    <div v-if="loading" class="dl-state"><NSpin size="medium" /></div>

    <EmptyHint
      v-else-if="!tasks.length"
      text="还没有下载任务"
      sub="点击「添加磁力」粘贴磁力链接或种子直链；完成后文件自动进入媒体库匹配播放"
    >
      <NButton size="small" secondary type="primary" @click="openAdd">添加第一个任务</NButton>
    </EmptyHint>

    <template v-else>
      <section class="dl-section">
        <h3 class="dl-title">进行中（{{ activeTasks.length }}）</h3>
        <div v-if="!activeTasks.length" class="dl-none">没有进行中的任务</div>
        <div v-for="t in activeTasks" :key="t.id" class="dl-row" @click="openDetail(t)">
          <div class="dl-main">
            <div class="dl-name-line">
              <span class="dl-name" :title="t.name || t.uri">{{ taskName(t) }}</span>
              <NTag size="tiny" round :bordered="false" :type="STATUS_TAG[t.status]?.type ?? 'default'">
                {{ STATUS_TAG[t.status]?.label ?? t.status }}
              </NTag>
              <NTag v-if="t.subjectNameCn || t.subjectName" size="tiny" round :bordered="false">
                {{ t.subjectNameCn || t.subjectName }}<template v-if="t.episodeSort"> · 第 {{ t.episodeSort }} 话</template>
              </NTag>
            </div>
            <template v-if="t.status === 'external'">
              <div class="dl-external-tip">已拉起本机 qBittorrent 下载——进度与文件请在 qBittorrent 中查看</div>
            </template>
            <template v-else>
              <NProgress
                class="dl-bar"
                type="line"
                :percentage="Math.round(ratio(t) * 1000) / 10"
                :show-indicator="false"
                :height="6"
                :border-radius="4"
              />
              <div class="dl-stat-line">
                <span>{{ formatBytes(t.completedLength) }} / {{ t.totalLength ? formatBytes(t.totalLength) : '未知大小' }}</span>
                <span v-if="t.status === 'downloading'" class="dl-speed">↓ {{ formatSpeed(t.downloadSpeed) }}</span>
                <span>连接 {{ t.connections }} · 种子 {{ t.seeds }}</span>
              </div>
            </template>
            <div v-if="t.error" class="dl-error">{{ t.error }}</div>
          </div>
          <div class="dl-ops" @click.stop>
            <NButton size="tiny" quaternary circle @click="copyTaskUri(t)" title="复制磁力/直链">
              <template #icon><NIcon :component="CopyOutline" /></template>
            </NButton>
            <NButton v-if="t.status !== 'external'" size="tiny" quaternary circle @click="pauseOrResume(t)">
              <template #icon>
                <NIcon :component="t.status === 'paused' ? PlayOutline : PauseOutline" />
              </template>
            </NButton>
            <NPopconfirm @positive-click="removeTask(t, false)">
              <template #trigger>
                <NButton size="tiny" quaternary type="error" circle>
                  <template #icon><NIcon :component="TrashOutline" /></template>
                </NButton>
              </template>
              {{ t.status === 'external' ? '删除台账记录（qBittorrent 中的任务与文件不受影响）' : '删除任务（下载文件保留在磁盘）' }}
            </NPopconfirm>
          </div>
        </div>
      </section>

      <section v-if="finishedTasks.length" class="dl-section">
        <h3 class="dl-title">已结束（{{ finishedTasks.length }}）</h3>
        <div v-for="t in finishedTasks" :key="t.id" class="dl-row done" @click="openDetail(t)">
          <div class="dl-main">
            <div class="dl-name-line">
              <span class="dl-name" :title="t.name || t.uri">{{ taskName(t) }}</span>
              <NTag size="tiny" round :bordered="false" :type="STATUS_TAG[t.status]?.type ?? 'default'">
                {{ STATUS_TAG[t.status]?.label ?? t.status }}
              </NTag>
              <NTag v-if="t.subjectNameCn || t.subjectName" size="tiny" round :bordered="false">
                {{ t.subjectNameCn || t.subjectName }}<template v-if="t.episodeSort"> · 第 {{ t.episodeSort }} 话</template>
              </NTag>
            </div>
            <div class="dl-stat-line">
              <span>{{ formatBytes(t.completedLength) }}{{ t.totalLength ? ` / ${formatBytes(t.totalLength)}` : '' }}</span>
              <span class="dl-when">{{ fmtWhen(t.completedAt || t.createdAt) }}</span>
            </div>
            <div v-if="t.error" class="dl-error">{{ t.error }}</div>
          </div>
          <div class="dl-ops" @click.stop>
            <NPopconfirm @positive-click="removeTask(t, false)">
              <template #trigger>
                <NButton size="tiny" quaternary type="error" circle>
                  <template #icon><NIcon :component="TrashOutline" /></template>
                </NButton>
              </template>
              删除任务记录（下载文件保留在磁盘）
            </NPopconfirm>
          </div>
        </div>
      </section>
    </template>

    <!-- v0.19 SU2 订阅命中历史日志（时间/条目/命中标题/动作；独立于任务列表空态） -->
    <NCollapse v-if="serviceConfigured && hitHistory.length" class="hit-history">
      <NCollapseItem title="订阅命中历史" name="history">
        <div v-for="h in hitHistory" :key="h.id" class="hit-row history-row">
          <div class="dl-main">
            <div class="dl-name-line">
              <NTag size="tiny" round :bordered="false" :type="HIT_STATUS[h.status]?.type ?? 'default'">
                {{ HIT_STATUS[h.status]?.label ?? h.status }}
              </NTag>
              <NTag v-if="h.episodeSort" size="tiny" round :bordered="false">第 {{ h.episodeSort }} 话</NTag>
              <span class="hit-name" :title="h.title">{{ h.title }}</span>
            </div>
            <div class="dl-stat-line">
              <span>{{ hitSubjectName(h) }}</span>
              <span v-if="h.note">{{ h.note }}</span>
              <span>{{ fmtWhen(h.decidedAt || h.createdAt) }}</span>
            </div>
          </div>
        </div>
      </NCollapseItem>
    </NCollapse>

    <!-- 添加磁力弹窗 -->
    <NModal v-model:show="addOpen" transform-origin="center" preset="card" title="添加下载任务" class="add-modal">
      <NInput
        v-model:value="addUri"
        type="textarea"
        placeholder="粘贴磁力链接（magnet:?xt=urn:btih:…）或种子/文件直链（http/https/ftp）"
        :rows="3"
      />
      <div v-if="addUri.trim()" class="add-preview">
        <template v-if="parsed.infoHash">
          <span>BT {{ parsed.infoHash.slice(0, 16) }}…</span>
          <span v-if="parsed.displayName">「{{ parsed.displayName }}」</span>
          <span class="dim">自带 tracker {{ parsed.trackers }} 条</span>
        </template>
        <template v-else-if="addValid">
          <span>直链下载</span>
        </template>
        <template v-else>
          <span class="engine-error">无法识别的链接</span>
        </template>
      </div>
      <div v-if="addUri.trim() && addValid && externalEngine" class="add-engine-hint dim">
        qBittorrent 直开：提交后服务端将直接拉起本机 qBittorrent 下载（进度在 qBt 内查看，此处仅记录台账）
      </div>

      <div class="add-subject">
        <NInput
          :value="addSearch"
          clearable
          placeholder="关联追番条目（可选）——输入关键词搜索 Bangumi"
          @update:value="onSearchInput"
        >
          <template #prefix><NIcon :component="SearchOutline" /></template>
        </NInput>
        <NSelect
          class="add-subject-select"
          :value="addSubject?.subjectId ?? null"
          :options="subjectOptions"
          :loading="addSearching"
          clearable
          placeholder="选择条目（选中后下载完成自动绑定）"
          @update:value="onSubjectPick"
        />
        <NInputNumber v-model:value="addSort" class="add-sort" size="medium" :min="1" placeholder="集数" />
      </div>

      <template #footer>
        <div class="add-footer">
          <NButton v-if="addUri.trim() && !serviceConfigured" quaternary @click="copyMagnet">
            <template #icon><NIcon :component="CopyOutline" /></template>
            复制磁力（服务未配置）
          </NButton>
          <NButton
            type="primary"
            round
            :disabled="!addValid || !serviceConfigured"
            :loading="addBusy"
            @click="submitAdd"
          >
            {{ externalEngine ? '用 qBittorrent 打开' : '加入下载队列' }}
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- 任务详情抽屉 -->
    <NDrawer v-model:show="detailOpen" :width="520" placement="right">
      <NDrawerContent v-if="detailTask" :title="taskName(detailTask)" closable>
        <div class="detail-meta">
          <NTag size="small" round :bordered="false" :type="STATUS_TAG[detailTask.status]?.type ?? 'default'">
            {{ STATUS_TAG[detailTask.status]?.label ?? detailTask.status }}
          </NTag>
          <NTag v-if="detailTask.subjectNameCn || detailTask.subjectName" size="small" round :bordered="false">
            关联 {{ detailTask.subjectNameCn || detailTask.subjectName }}
            <template v-if="detailTask.episodeSort"> · 第 {{ detailTask.episodeSort }} 话</template>
          </NTag>
          <span v-if="detailTask.completedAt" class="dim">完成于 {{ fmtWhen(detailTask.completedAt) }}</span>
        </div>
        <div v-if="detailTask.status === 'downloading'" class="detail-progress">
          <NProgress
            type="line"
            :percentage="Math.round(ratio(detailTask) * 1000) / 10"
            indicator-placement="inside"
            :height="14"
            :border-radius="6"
          />
          <div class="dl-stat-line">
            <span>{{ formatBytes(detailTask.completedLength) }} / {{ formatBytes(detailTask.totalLength) }}</span>
            <span class="dl-speed">↓ {{ formatSpeed(detailTask.downloadSpeed) }} · ↑ {{ formatSpeed(detailTask.uploadSpeed) }}</span>
            <span>连接 {{ detailTask.connections }} · 种子 {{ detailTask.seeds }}</span>
          </div>
        </div>
        <div v-if="detailTask.error" class="dl-error">{{ detailTask.error }}</div>
        <div class="detail-uri dim" :title="detailTask.uri">{{ detailTask.uri }}</div>

        <template v-if="detailTask.status === 'external'">
          <NAlert type="info" :show-icon="false" class="detail-external-tip">
            已拉起本机 qBittorrent 下载——下载进度、做种与文件管理请在 qBittorrent 中查看；此页仅保留任务台账。
          </NAlert>
        </template>
        <template v-else>
          <h4 class="detail-files-title">文件（{{ detailTask.files.length }}）</h4>
          <NEmpty v-if="!detailTask.files.length" description="元数据解析中，文件清单稍后出现" size="small" />
          <div v-else class="file-list">
            <label v-for="f in detailTask.files" :key="f.index" class="file-row">
              <NCheckbox
                size="small"
                :checked="fileSelection.has(f.index)"
                :disabled="filesComplete"
                @update:checked="(v: boolean) => toggleFile(f.index, v)"
              />
              <span class="file-name" :title="f.path">{{ f.name || f.path }}</span>
              <span class="file-size dim">
                {{ formatBytes(f.completedLength) }} / {{ formatBytes(f.length) }}
              </span>
            </label>
          </div>
          <NButton
            v-if="detailTask.files.length && !filesComplete"
            size="small"
            type="primary"
            secondary
            :disabled="!selectionChanged"
            :loading="applyingSelection"
            @click="applySelection"
          >
            应用文件选择（{{ fileSelection.size }} / {{ detailTask.files.length }}）
          </NButton>
          <p v-if="detailTask.files.length && !filesComplete" class="detail-hint dim">
            整季包可只勾选需要的集；应用时会短暂暂停任务，未选文件将被清理
          </p>
        </template>

        <template #footer>
          <div class="detail-footer">
            <NButton size="small" quaternary @click="copyTaskUri(detailTask!)">
              <template #icon><NIcon :component="CopyOutline" /></template>
              复制磁力
            </NButton>
            <div v-if="detailTask.status !== 'external'" class="detail-footer-right">
              <NPopconfirm @positive-click="removeTask(detailTask!, false)">
                <template #trigger>
                  <NButton size="small" quaternary type="error">
                    <template #icon><NIcon :component="TrashOutline" /></template>
                    删除任务
                  </NButton>
                </template>
                仅删除任务记录，磁盘文件保留
              </NPopconfirm>
              <NPopconfirm @positive-click="removeTask(detailTask!, true)">
                <template #trigger>
                  <NButton size="small" type="error" secondary>
                    <template #icon><NIcon :component="TrashOutline" /></template>
                    删除任务并删文件
                  </NButton>
                </template>
                删除任务并一并删除已下载的文件（不可恢复）？
              </NPopconfirm>
            </div>
            <NPopconfirm v-else @positive-click="removeTask(detailTask!, false)">
              <template #trigger>
                <NButton size="small" type="error" secondary>
                  <template #icon><NIcon :component="TrashOutline" /></template>
                  删除台账记录
                </NButton>
              </template>
              仅删除下载中心记录，qBittorrent 中的任务与磁盘文件不受影响
            </NPopconfirm>
          </div>
        </template>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.engine-card {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  margin-bottom: 14px;
  border: 1px dashed var(--av-border);
  border-radius: 10px;
  font-size: 12px;
}

.engine-card.off {
  border-color: rgba(255, 120, 120, 0.4);
}

.engine-meta {
  color: var(--av-text-tertiary);
}

.engine-error {
  color: #e88080;
  font-size: 12px;
}

.dl-state {
  display: flex;
  justify-content: center;
  margin: 60px 0;
}

.dl-section {
  margin-bottom: 22px;
}

/* ── v0.19 订阅区（待确认命中 + 订阅管理 + 命中历史）── */

.sub-section {
  border: 1px solid var(--av-border);
  border-radius: 12px;
  padding: 12px 14px;
}

.sub-section .dl-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sub-hint {
  font-size: 11.5px;
  font-weight: 400;
  color: var(--av-text-tertiary);
}

.check-now {
  margin-left: auto;
}

.hit-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 10px;
  border-radius: 10px;
}

.hit-row:hover {
  background: var(--av-primary-soft);
}

.hit-name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hit-ops {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.sub-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 10px;
  border-radius: 10px;
}

.sub-row:hover {
  background: var(--av-primary-soft);
}

.sub-baseline {
  font-size: 11.5px;
  color: var(--av-text-tertiary);
}

.sub-auto-label {
  font-size: 11.5px;
  color: var(--av-text-tertiary);
}

.history-row {
  padding: 5px 4px;
}

.hit-history {
  margin-top: 4px;
}

.dl-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 700;
  color: var(--av-text-secondary);
}

.dl-none {
  font-size: 12px;
  color: var(--av-text-tertiary);
  padding: 6px 0;
}

.dl-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 10px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.dl-row:hover {
  background: var(--av-primary-soft);
}

.dl-row.done {
  opacity: 0.72;
}

.dl-main {
  flex: 1;
  min-width: 0;
}

.dl-name-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.dl-name {
  font-size: 13.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dl-bar {
  margin: 5px 0 2px;
  max-width: 560px;
}

.dl-stat-line {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--av-text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-wrap: wrap;
}

.dl-speed {
  color: var(--av-primary);
}

.dl-when {
  margin-left: auto;
}

.dl-error {
  margin-top: 3px;
  font-size: 11.5px;
  color: #e88080;
}

.dl-external-tip {
  margin: 5px 0 2px;
  max-width: 560px;
  font-size: 11.5px;
  color: var(--av-text-secondary);
  background: var(--av-primary-soft);
  border-radius: 8px;
  padding: 5px 10px;
}

.add-engine-hint {
  margin-top: 8px;
}

.detail-external-tip {
  margin-bottom: 10px;
}

.dl-ops {
  display: flex;
  gap: 4px;
  flex: none;
}

.add-modal {
  width: 560px;
  max-width: calc(100vw - 32px);
}

.add-preview {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
  font-size: 12px;
  color: var(--av-text-secondary);
}

.dim {
  color: var(--av-text-tertiary);
  font-size: 11.5px;
}

.add-subject {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.add-subject > :first-child {
  flex: 1 1 100%;
}

.add-subject-select {
  flex: 1;
  min-width: 200px;
}

.add-sort {
  width: 110px;
}

.add-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.detail-progress {
  margin-bottom: 10px;
}

.detail-uri {
  margin: 10px 0;
  word-break: break-all;
}

.detail-files-title {
  margin: 14px 0 8px;
  font-size: 13px;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
  max-height: 320px;
  overflow: auto;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border-radius: 8px;
  cursor: pointer;
}

.file-row:hover {
  background: var(--av-primary-soft);
}

.file-name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  flex: none;
  font-variant-numeric: tabular-nums;
}

.detail-hint {
  margin-top: 8px;
}

.detail-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.detail-footer-right {
  display: flex;
  gap: 8px;
}
</style>
