<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import {
  NAlert,
  NButton,
  NCheckbox,
  NDescriptions,
  NDescriptionsItem,
  NDrawer,
  NDrawerContent,
  NIcon,
  NInput,
  NInputNumber,
  NRate,
  NResult,
  NSelect,
  NSpin,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
} from 'naive-ui'
import {
  AddOutline,
  CreateOutline,
  GlobeOutline,
  MicOutline,
  PlayOutline,
  CloudDownloadOutline,
} from '@vicons/ionicons5'
import { dataSource } from '../api/dataSource'
import { useLibraryStore } from '../stores/library'
import { useSettingsStore } from '../stores/settings'
import { useSyncStore } from '../stores/sync'
import type { WatchStatus } from '../stores/library'
import { charAvatarUrl, coverCardUrl, upgradeStoredCover } from '../utils/image'
import { listBindings, saveDanmaku } from '../utils/mediaStore'
import { parseDanmakuXml } from '../utils/danmaku'
import type { MediaBinding } from '../utils/mediaCore'
import { mediaService, maxWatched, ServiceError, type SvcSubscription, type SvcSubjectFile } from '../api/mediaService'
import type { Episode, RelatedSubject, SubjectCharacter, SubjectDetail, SubjectPerson } from '../types/bangumi'
import PosterImage from '../components/PosterImage.vue'
import EmptyHint from '../components/EmptyHint.vue'
import MediaBindModal from '../components/MediaBindModal.vue'
import ResourceSearchModal from '../components/ResourceSearchModal.vue'
import HanimeSearchModal from '../components/HanimeSearchModal.vue'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const library = useLibraryStore()
const settings = useSettingsStore()
const sync = useSyncStore()

const subject = ref<SubjectDetail | null>(null)
const loading = ref(true)
const error = ref('')
const revealed = ref(false)

/** R18 门控：开关隐藏 R18 且条目被官方标记、且未显式揭示时，遮蔽条目内容 */
const blockedByNsfw = computed(
  () => !!subject.value?.nsfw && settings.hideNsfw && !revealed.value,
)

/** v0.12 B6 Hero 背板：与主海报同源大图（放大/模糊/饱和由 CSS 完成），无图时仅占位底色 */
const heroBackdropStyle = computed(() => {
  const src = subject.value
    ? upgradeStoredCover(subject.value.images?.large || subject.value.images?.common, settings.imageQuality)
    : ''
  return src ? { backgroundImage: `url("${src}")` } : undefined
})

const activeTab = ref('info')
const characters = ref<SubjectCharacter[] | null>(null)
const persons = ref<SubjectPerson[] | null>(null)
const episodes = ref<Episode[] | null>(null)
const related = ref<RelatedSubject[] | null>(null)
const tabError = ref('')

const id = computed(() => Number(route.params.id))
const inLibrary = computed(() => library.has(id.value))
const entry = computed(() => library.entry(id.value))

const statusOptions = [
  { label: '想看', value: 'wish' },
  { label: '在看', value: 'doing' },
  { label: '看完', value: 'done' },
]

/** 主篇剧集（type 0），SP/OP/ED 不参与进度 */
const mainEpisodes = computed(() => (episodes.value ?? []).filter((e) => e.type === 0))

/* ── G1 章节类型分组展示 ── */

const EP_TYPE_LABELS: Record<number, string> = { 0: '本篇', 1: 'SP', 2: 'OP', 3: 'ED', 4: '预告' }
/** 默认展示本篇；条目无本篇章节时回退到首个存在的类型 */
const epTypeFilter = ref(0)
/** 章节类型分组（仅展示实际存在的类型） */
const epTypeGroups = computed(() => {
  const counts = new Map<number, number>()
  for (const e of episodes.value ?? []) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
  return [0, 1, 2, 3, 4]
    .filter((t) => counts.has(t))
    .map((t) => ({ type: t, label: EP_TYPE_LABELS[t] ?? '其他', count: counts.get(t) as number }))
})
const visibleEpisodes = computed(() => {
  const list = (episodes.value ?? []).filter((e) => e.type === epTypeFilter.value)
  // H2（G5 转正）章节关键词过滤：与类型分组叠加，按名称/话数匹配
  const kw = epKeyword.value.trim().toLowerCase()
  if (!kw) return list
  return list.filter(
    (e) =>
      e.name.toLowerCase().includes(kw) ||
      (e.name_cn ?? '').toLowerCase().includes(kw) ||
      String(e.sort) === kw ||
      String(e.ep) === kw,
  )
})
const epKeyword = ref('')

/* ── G2 单集详情抽屉（含 G3 吐槽入口）── */

/** 2026-09-09 实测：列表响应已携带 comment/duration/desc 等全字段，抽屉直接读列表数据，无需单独请求 */
const drawerEp = ref<Episode | null>(null)
const showEpDrawer = ref(false)

/* ── v0.13 PL2/PL3 本地播放绑定 ── */
const showMediaModal = ref(false)
const mediaDefaultSort = ref(1)
/** sort → 绑定（剧集 Tab 行内播放按钮渲染依据） */
const boundMap = ref(new Map<number, MediaBinding>())

/* ── v0.14 S5 媒体服务绑定：sort → 服务文件（本机绑定优先，服务源兜底显示） ── */
const svcFiles = ref(new Map<number, SvcSubjectFile>())
const svcLoaded = ref(false)

async function refreshSvcFiles() {
  svcLoaded.value = false
  svcFiles.value = new Map()
  if (!settings.svcEnabled) return
  try {
    const list = await mediaService.subjectFiles(id.value)
    svcFiles.value = new Map(list.map((f) => [f.sort, f]))
    svcLoaded.value = true
  } catch {
    // 服务不可达：静默降级为无服务按钮（不干扰本机播放功能）
  }
}

async function refreshBindings() {
  const list = await listBindings(id.value)
  boundMap.value = new Map(list.map((b) => [b.sort, b]))
}

function openMediaModal(sort?: number) {
  mediaDefaultSort.value = sort ?? mainEpisodes.value.find((e) => !boundMap.value.has(e.sort))?.sort ?? 1
  showMediaModal.value = true
}

function playEp(sort: number) {
  void router.push({ name: 'watch', query: { subject: String(id.value), sort: String(sort) } })
}

/** v0.15 O4 抽屉弹幕导入：B 站 XML → dm:{subjectId}:{sort}（整文件失败拒绝导入） */
const drawerDmInput = ref<HTMLInputElement | null>(null)
let drawerDmSort = 1

function importDrawerDanmaku(sort: number) {
  drawerDmSort = sort
  drawerDmInput.value?.click()
}

async function onDrawerDanmaku(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const items = parseDanmakuXml(await file.text())
    await saveDanmaku(id.value, drawerDmSort, items)
    message.success(`已导入 ${items.length} 条弹幕（第 ${drawerDmSort} 话）`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '弹幕导入失败')
  }
}

/** v0.14 服务媒体库播放（?file= 服务文件 ID） */
function playServiceEp(sort: number) {
  const f = svcFiles.value.get(sort)
  if (!f) return
  void router.push({
    name: 'watch',
    query: { subject: String(id.value), sort: String(sort), file: String(f.fileId) },
  })
}

/** 媒体库未收录本条目时的引导（服务已配置、已加载完成、无任何绑定文件） */
const svcHintVisible = computed(
  () => settings.svcEnabled && svcLoaded.value && svcFiles.value.size === 0 && mainEpisodes.value.length > 0,
)

/* ── v0.17 R2 条目找资源：剧集 Tab / 单集抽屉入口 → ResourceSearchModal ── */
const showResourceModal = ref(false)
/** 资源搜索预填集数（null = 条目级入口） */
const resourceDefaultSort = ref<number | null>(null)

function openResourceSearch(sort?: number) {
  resourceDefaultSort.value = sort ?? null
  showResourceModal.value = true
}

function onResourceEnqueued(payload: { episodeSort?: number }) {
  // 带集数入队后刷新服务文件状态（下载完成入库前不出现新播放按钮，属预期；此处仅刷新关联状态）
  if (payload.episodeSort) message.info(`第 ${payload.episodeSort} 话资源已入队，可在「下载」页查看进度`)
}

/* ── v0.26 HN4/HN8 在线解析（hanime1.me）：剧集行/条目级入口 → HanimeSearchModal → WatchView 在线源 ── */
const showHanimeModal = ref(false)
/** 预填集数（null = 条目级入口：只搜不绑定） */
const hanimeDefaultSort = ref<number | null>(null)
/** NSFW 门（设置页开关）+ 服务已配置 + 非演示模式；在线解析依赖服务端抓取与转发 */
const hanimeOnlineVisible = computed(() => settings.hanimeNsfw && settings.svcEnabled && !settings.isDemo)

function openHanimeSearch(sort?: number) {
  hanimeDefaultSort.value = sort ?? null
  showHanimeModal.value = true
}

function onHanimePlayed(payload: { videoCode: string; title: string }) {
  showHanimeModal.value = false
  void router.push({
    name: 'watch',
    query: { subject: String(id.value), sort: String(hanimeDefaultSort.value ?? 1), online: payload.videoCode },
  })
}

async function onHanimeBound() {
  await refreshBindings()
}

/* ── v0.19 SU1 条目级「追番下载」订阅：服务已配置才可见；开启即后台定时检索（默认命中入待确认队列） ── */
const subscription = ref<SvcSubscription | null>(null)
const subscribed = computed(() => subscription.value !== null)
const subBusy = ref(false)

async function refreshSubscription() {
  if (!settings.svcEnabled || !subject.value) return
  try {
    const list = await mediaService.subscriptions()
    subscription.value = list.find((s) => s.subjectId === id.value) ?? null
    await liftBaseline()
  } catch {
    // 服务不可达：静默降级为无开关干扰
  }
}

/** 观看进度越过基线时静默抬升订阅过滤基线（只升不降，服务端同值防御）。
 *  缺陷修复：此前基线抬升仅挂在「切到剧集 Tab/条目切换」，Tab 内勾选单集/沉浸标记/
 *  全部看过均不上报，已看过的集会继续被订阅命中。 */
async function liftBaseline() {
  if (!settings.svcEnabled || !subscription.value || !entry.value) return
  const watchedMax = maxWatched(entry.value?.watchedEps)
  if (watchedMax > subscription.value.minEpisode) {
    subscription.value = await mediaService.updateSubscription(subscription.value.id, { minEpisode: watchedMax })
  }
}

async function toggleSubscription(on: boolean) {
  if (!subject.value || subBusy.value) return
  subBusy.value = true
  try {
    if (on) {
      subscription.value = await mediaService.subscribeSubject({
        subjectId: subject.value.id,
        subjectName: subject.value.name,
        subjectNameCn: subject.value.name_cn,
        minEpisode: maxWatched(entry.value?.watchedEps),
      })
      message.success(`已订阅「${subject.value.name_cn || subject.value.name}」，正在执行首次检索——命中将在下载中心待确认`)
    } else if (subscription.value) {
      await mediaService.unsubscribeSubject(subscription.value.id)
      subscription.value = null
      message.info('已取消订阅（已生成的待确认命中保留）')
    }
  } catch (e) {
    message.error(e instanceof ServiceError ? e.message : '订阅操作失败')
  } finally {
    subBusy.value = false
  }
}

/** v0.20 自动入队阈值：0=特殊值全手动确认（默认）；1~100=匹配度达阈值自动入队（三重保护仍兜底）。
 *  v0.22 实测修复：NInputNumber update:value 逐位触发（输入 30 会连发 3/30 两次 PUT）——
 *  键入期间只暂存草稿、失焦/回车才提交（无防抖，用户定案）。
 *  v0.23 实测修复：加减按钮/方向键步进不触发 blur，草稿也不响应式——点击原地不动且不提交；
 *  现草稿改响应式实时显示，加减/方向键在 capture 阶段打标后即时提交。 */
const subScoreDraft = ref<number | null>(null)

let subScoreStepPending = false

function onSubScoreClick(e: MouseEvent) {
  if ((e.target as HTMLElement | null)?.closest('button')) subScoreStepPending = true
}

function onSubScoreKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') subScoreStepPending = true
}

function onSubScoreInput(value: number | null) {
  const v = Math.max(0, Math.min(100, Math.floor(value ?? 0)))
  if (subScoreStepPending) {
    subScoreStepPending = false
    subScoreDraft.value = null
    void updateSubScore(v)
    return
  }
  if (!subscription.value || v === (subscription.value.autoScore ?? 0)) subScoreDraft.value = null
  else subScoreDraft.value = v
}

function flushSubScore() {
  if (subScoreDraft.value !== null) {
    void updateSubScore(subScoreDraft.value)
    subScoreDraft.value = null
  }
}

async function updateSubScore(value: number | null) {
  if (!subscription.value || subBusy.value) return
  const v = Math.max(0, Math.min(100, Math.floor(value ?? 0)))
  if (v === (subscription.value.autoScore ?? 0)) return
  subBusy.value = true
  try {
    subscription.value = await mediaService.updateSubscription(subscription.value.id, { autoScore: v })
    message.success(v > 0
      ? `已设置自动入队阈值 ${v}：匹配度达标的命中直接入队`
      : '已切换为手动确认模式：所有命中需人工确认后才下载')
  } catch (e) {
    message.error(e instanceof ServiceError ? e.message : '操作失败')
  } finally {
    subBusy.value = false
  }
}

// 观看进度变更（单集勾选/沉浸标记/全部看过/清空）→ 实时抬升订阅基线
watch(
  () => entry.value?.watchedEps?.length,
  () => {
    void liftBaseline()
  },
)

// 剧集 Tab 激活 / 条目切换时刷新绑定状态
watch([id, activeTab], ([, tab]) => {
  if (tab === 'eps') {
    void refreshBindings()
    void refreshSvcFiles()
    void refreshSubscription()
  }
})

watch(id, () => {
  subscription.value = null
})

function openEpDetail(ep: Episode) {
  drawerEp.value = ep
  showEpDrawer.value = true
}

/** 时长展示：优先 duration 文本，回退 duration_seconds 换算 */
const epDuration = computed(() => {
  const ep = drawerEp.value
  if (!ep) return ''
  if (ep.duration) return ep.duration
  const sec = ep.duration_seconds ?? 0
  if (!sec) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s ? `${m}m${s}s` : `${m}m`
})

/** G3：吐槽区在 bgm.tv 网页端（官方 v0 API 无评论端点），新窗口导航不受 CORS 限制 */
function openEpCommentPage() {
  if (drawerEp.value) window.open(`https://bgm.tv/ep/${drawerEp.value.id}`, '_blank', 'noopener')
}

onMounted(load)
watch(id, load)

async function load() {
  loading.value = true
  error.value = ''
  subject.value = null
  characters.value = null
  persons.value = null
  episodes.value = null
  related.value = null
  // H1 深链支持：/subject/:id?tab=eps 直达剧集 Tab（今日页「继续观看」入口）
  const qtab = String(route.query.tab ?? '')
  activeTab.value = ['eps', 'chars', 'staff', 'related'].includes(qtab) ? qtab : 'info'
  tabError.value = ''
  revealed.value = false
  epTypeFilter.value = 0
  epKeyword.value = ''
  showEpDrawer.value = false
  drawerEp.value = null
  try {
    subject.value = await dataSource.subject(id.value)
    // 修复懒加载竞态：加载期间用户已切到其他 Tab 时（activeTab 已变但 loadTabData 因 subject 未就绪提前返回），完成后补触发
    void loadTabData(activeTab.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

// 懒加载：首次切到对应 Tab 才请求（dataSource 内部有缓存）
watch(activeTab, (t) => {
  void loadTabData(t)
})

async function loadTabData(tab: string) {
  if (!subject.value) return
  tabError.value = ''
  try {
    if (tab === 'chars' && characters.value === null) {
      characters.value = await dataSource.characters(subject.value.id)
    } else if (tab === 'staff' && persons.value === null) {
      persons.value = await dataSource.persons(subject.value.id)
    } else if (tab === 'eps' && episodes.value === null) {
      episodes.value = await dataSource.episodes(subject.value.id)
      // G1：无本篇章节的条目回退展示首个存在的类型
      epTypeFilter.value = episodes.value.some((e) => e.type === 0) ? 0 : (episodes.value[0]?.type ?? 0)
    } else if (tab === 'related' && related.value === null) {
      related.value = await dataSource.relatedSubjects(subject.value.id)
    }
  } catch (e) {
    tabError.value = e instanceof Error ? e.message : String(e)
  }
}

/** 系列作品按关系分组（relation 为开放式中文名，按首次出现顺序排列） */
const relatedGroups = computed<{ relation: string; items: RelatedSubject[] }[]>(() => {
  const groups: { relation: string; items: RelatedSubject[] }[] = []
  const byRelation = new Map<string, RelatedSubject[]>()
  for (const r of related.value ?? []) {
    let list = byRelation.get(r.relation)
    if (!list) {
      list = []
      byRelation.set(r.relation, list)
      groups.push({ relation: r.relation, items: list })
    }
    list.push(r)
  }
  return groups
})

/** 关联条目的类型标注（动画条目不额外标注，非动画条目提示媒介） */
const SUBJECT_TYPE_LABELS: Record<number, string> = { 1: '书籍', 2: '动画', 3: '音乐', 4: '游戏', 6: '三次元' }

function subjectTypeLabel(type: number): string {
  return SUBJECT_TYPE_LABELS[type] ?? '条目'
}

function add() {
  const s = subject.value
  if (!s) return
  library.add({
    subjectId: s.id,
    name: s.name,
    nameCn: s.name_cn || s.name,
    image: s.images?.common || s.images?.large,
    epsTotal: s.total_episodes || 0,
    score: s.rating?.score,
    tags: (s.tags ?? []).slice(0, 5).map((t) => t.name),
  })
  message.success('已加入我的追番')
}

function remove() {
  // 先清待推单集队列，再移除（移除会记墓碑，云同步拉取不再复活该条目）
  sync.purgePendingEpisodeMarks(id.value)
  library.remove(id.value)
  message.info('已移出本地追番列表（Bangumi 暂不支持删除云端收藏，同步不会恢复）')
}

function infoboxValue(v: string | { v: string }[]): string {
  return Array.isArray(v) ? v.map((x) => x.v).join(' / ') : v
}

const infoboxRows = computed(() => {
  const rows: { key: string; value: string }[] = []
  for (const item of subject.value?.infobox ?? []) {
    if (typeof item.value === 'string' || Array.isArray(item.value)) {
      const v = infoboxValue(item.value)
      if (v) rows.push({ key: item.key, value: v })
    }
  }
  return rows
})

function isEpWatched(ep: Episode): boolean {
  // H3：正篇读 watchedEps；SP/OP/ED/预告读 watchedSpecial 复合桶（sort 空间与正篇重叠，分开存储）
  if (ep.type === 0) return entry.value?.watchedEps?.includes(ep.sort) ?? false
  return library.hasSpecialEpisode(id.value, ep.type, ep.sort)
}

function toggleEp(ep: Episode, watched: boolean) {
  if (!entry.value) return
  // E1：单集变更走增量标记（本地更新 + 待推队列单集 PUT），不再整表 PATCH
  void sync.markEpisodeWatched(entry.value.subjectId, ep.id, ep.type, ep.sort, watched)
}

/* ── E1 沉浸观剧模式 ── */
const immersive = ref(false)
const immersiveIndex = ref(0)

const immersiveEp = computed<Episode | null>(() => mainEpisodes.value[immersiveIndex.value] ?? null)
const immersiveWatched = computed(() => (immersiveEp.value ? isEpWatched(immersiveEp.value) : false))

function enterImmersive() {
  // 从第一个未看集开始；全部看完则回到第 1 集
  const firstUnwatched = mainEpisodes.value.findIndex((e) => !isEpWatched(e))
  immersiveIndex.value = firstUnwatched >= 0 ? firstUnwatched : 0
  immersive.value = true
}

function exitImmersive() {
  immersive.value = false
}

function immersiveNext() {
  if (immersiveIndex.value < mainEpisodes.value.length - 1) {
    immersiveIndex.value++
  } else {
    message.success('已经是最后一集了')
    exitImmersive()
  }
}

function immersivePrev() {
  if (immersiveIndex.value > 0) immersiveIndex.value--
}

/** 标记当前集为看过并前进；已看过的集则直接前进 */
function immersiveMarkAndNext() {
  const ep = immersiveEp.value
  if (!ep || !entry.value) return
  if (!immersiveWatched.value) {
    void sync.markEpisodeWatched(entry.value.subjectId, ep.id, ep.type, ep.sort, true)
    message.success(`第 ${ep.sort} 话已标记看过`)
  }
  immersiveNext()
}

/** E4：角色卡片 → 角色页；声优/Staff 名 → 人物页 */
function openCharacter(id: number) {
  router.push({ name: 'character', params: { id: String(id) } })
}

function openPerson(id: number) {
  router.push({ name: 'person', params: { id: String(id) } })
}

function markAllEps(watched: boolean) {
  if (!entry.value) return
  library.setWatchedAll(
    entry.value.subjectId,
    watched,
    mainEpisodes.value.map((e) => e.sort),
  )
}

function charAvatar(images?: SubjectCharacter['images']): string {
  return charAvatarUrl(images, settings.imageQuality)
}

/* ── F6 我的评分与笔记 ── */

/** 评分/私密开关即时保存；笔记输入 400ms 防抖，离开页面前兜底提交 */
function setReview(patch: { rate?: number; comment?: string; isPrivate?: boolean }) {
  if (!entry.value) return
  library.setMyReview(entry.value.subjectId, patch)
}

let commentTimer: ReturnType<typeof setTimeout> | undefined
let pendingComment: string | undefined
function onCommentInput(v: string) {
  pendingComment = v
  if (commentTimer) clearTimeout(commentTimer)
  commentTimer = setTimeout(() => {
    if (pendingComment !== undefined && entry.value) setReview({ comment: pendingComment })
    pendingComment = undefined
  }, 400)
}

onBeforeUnmount(() => {
  if (pendingComment !== undefined && entry.value) setReview({ comment: pendingComment })
  pendingComment = undefined
  if (commentTimer) clearTimeout(commentTimer)
})
</script>

<template>
  <div>
    <NButton quaternary size="small" style="margin-bottom: 14px" @click="router.back()">← 返回</NButton>

    <NSpin :show="loading">
      <NAlert v-if="error" type="error" title="加载失败">
        {{ error }} —— 请检查网络/代理，或在「设置」中修改 API 地址、切换演示数据模式。
        <NButton size="tiny" style="margin-left: 8px" @click="load">重试</NButton>
      </NAlert>

      <div v-else-if="subject" class="detail">
        <NResult
          v-if="blockedByNsfw"
          status="403"
          title="R18 内容已隐藏"
          description="该条目被 Bangumi 标记为 R18，已按「隐藏 R18 内容」设置遮蔽。"
        >
          <template #footer>
            <NButton type="primary" @click="revealed = true">本次查看该条目</NButton>
            <NButton quaternary @click="router.push({ name: 'settings' })">前往设置</NButton>
          </template>
        </NResult>
        <template v-else>
        <!-- v0.12 B6 Hero 头部：海报放大模糊饱和作背板 + 渐变压暗融入页面，前景海报浮起（R18 门控在本层之外整体生效） -->
        <div class="detail-hero">
          <div class="hero-backdrop" :style="heroBackdropStyle" aria-hidden="true" />
          <div class="hero-shade" aria-hidden="true" />
          <div class="hero-inner">
            <div class="detail-poster">
              <PosterImage
                :src="upgradeStoredCover(subject.images?.large || subject.images?.common, settings.imageQuality)"
                :title="subject.name_cn || subject.name"
                :subject-id="subject.id"
              />
            </div>
            <div class="detail-meta">
              <h2 class="detail-title">{{ subject.name_cn || subject.name }}</h2>
              <div v-if="subject.name_cn && subject.name" class="detail-sub">{{ subject.name }}</div>

              <div class="rate-row">
                <NRate :value="(subject.rating?.score ?? 0) / 2" allow-half readonly size="small" color="#ffd75e" />
                <span class="rate-num">{{ subject.rating?.score?.toFixed(1) ?? '—' }}</span>
                <span class="rate-total">{{ subject.rating?.total ?? 0 }} 人评分</span>
              </div>

              <div class="fact-row">
                <NTag v-if="subject.total_episodes" size="small" round :bordered="false">
                  共 {{ subject.total_episodes }} 话
                </NTag>
                <NTag v-if="subject.date" size="small" round :bordered="false">开播 {{ subject.date }}</NTag>
                <NTag v-if="subject.platform" size="small" round :bordered="false">{{ subject.platform }}</NTag>
              </div>

              <div v-if="subject.tags?.length" class="tag-row">
                <NTag
                  v-for="t in subject.tags.slice(0, 10)"
                  :key="t.name"
                  size="small"
                  round
                  type="info"
                  ghost
                  class="tag-clickable"
                  :title="`点击搜索标签「${t.name}」`"
                  @click="router.push({ name: 'search', query: { tag: t.name } })"
                >
                  {{ t.name }} · {{ t.count }}
                </NTag>
              </div>

              <div class="action-box">
                <template v-if="!inLibrary">
                  <NButton round type="primary" @click="add"><span class="btn-icon-row"><NIcon :component="AddOutline" size="15" />加入追番</span></NButton>
                </template>
                <template v-else-if="entry">
                  <NSelect
                    size="small"
                    :value="entry.status"
                    :options="statusOptions"
                    style="width: 110px"
                    @update:value="(v: WatchStatus) => library.setStatus(entry!.subjectId, v)"
                  />
                  <NInputNumber
                    size="small"
                    :value="entry.progress"
                    :min="0"
                    :max="entry.epsTotal > 0 ? entry.epsTotal : 9999"
                    style="width: 130px"
                    @update:value="(v: number | null) => library.setProgress(entry!.subjectId, v ?? 0)"
                  />
                  <span class="progress-text">/ {{ entry.epsTotal > 0 ? entry.epsTotal : '?' }} 话</span>
                  <NButton size="small" round quaternary type="error" @click="remove">移除</NButton>
                </template>
              </div>

              <!-- F6 我的评分与笔记（追番库内条目）：本地即时保存，随同步推送 Bangumi 收藏评价 -->
              <div v-if="entry" class="my-review">
                <div class="my-review-head">
                  <span class="my-review-title"><NIcon :component="CreateOutline" size="15" />我的评分与笔记</span>
                  <label class="my-review-private">
                    <NSwitch
                      size="small"
                      :value="entry.privateFlag ?? false"
                      @update:value="(v: boolean) => setReview({ isPrivate: v })"
                    />
                    私密（仅自己可见）
                  </label>
                </div>
                <div class="my-review-rate">
                  <NRate
                    allow-half
                    :value="(entry.myRate ?? 0) / 2"
                    size="medium"
                    color="#ffd75e"
                    @update:value="(v: number) => setReview({ rate: Math.round(v * 2) })"
                  />
                  <span v-if="entry.myRate" class="my-review-num">{{ entry.myRate }}/10</span>
                  <span v-else class="my-review-hint">点击评分</span>
                  <NButton v-if="entry.myRate" size="tiny" quaternary @click="setReview({ rate: 0 })">清除</NButton>
                </div>
                <NInput
                  type="textarea"
                  :value="entry.myComment ?? ''"
                  placeholder="写点笔记/短评（同步到 Bangumi 收藏评价，勾选私密后仅自己可见）"
                  :autosize="{ minRows: 2, maxRows: 6 }"
                  @update:value="onCommentInput"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- v0.12 B6：详情 Tabs 改分段胶囊形态 -->
        <NTabs v-model:value="activeTab" type="segment" style="margin-top: 18px" animated>
          <NTabPane name="info" tab="简介">
            <NDescriptions v-if="infoboxRows.length" :column="2" bordered size="small" style="margin-bottom: 18px">
              <NDescriptionsItem v-for="row in infoboxRows" :key="row.key" :label="row.key">
                {{ row.value }}
              </NDescriptionsItem>
            </NDescriptions>
            <section v-if="subject.summary" class="summary">
              <p>{{ subject.summary }}</p>
            </section>
            <EmptyHint v-else text="暂无简介" />
          </NTabPane>

          <NTabPane name="chars" tab="角色">
            <NAlert v-if="tabError" type="error" size="small">{{ tabError }}</NAlert>
            <NSpin :show="characters === null" v-if="activeTab === 'chars'">
              <EmptyHint v-if="characters && !characters.length" text="暂无角色数据" />
              <div v-else-if="characters" class="char-grid">
                <div
                  v-for="c in characters"
                  :key="c.id"
                  class="char-card char-card-link"
                  :title="`查看角色「${c.name}」`"
                  @click="openCharacter(c.id)"
                >
                  <PosterImage :src="charAvatar(c.images)" :title="c.name" :subject-id="c.id" />
                  <div class="char-name" :title="c.name">{{ c.name }}</div>
                  <NTag size="tiny" :bordered="false" type="info">{{ c.relation || '角色' }}</NTag>
                  <div
                    v-if="c.actors?.length"
                    class="char-actor"
                    :title="`查看声优 ${c.actors.map((a) => a.name).join(' / ')}`"
                  >
                    <NIcon :component="MicOutline" size="13" /> <span
                      v-for="a in c.actors"
                      :key="a.name"
                      class="person-link"
                      @click.stop="a.id && openPerson(a.id)"
                    >{{ a.name }}</span>
                  </div>
                </div>
              </div>
            </NSpin>
          </NTabPane>

          <NTabPane name="staff" tab="制作人员">
            <NAlert v-if="tabError" type="error" size="small">{{ tabError }}</NAlert>
            <NSpin :show="persons === null" v-if="activeTab === 'staff'">
              <EmptyHint v-if="persons && !persons.length" text="暂无制作人员数据" />
              <div v-else-if="persons" class="staff-grid">
                <div
                  v-for="p in persons"
                  :key="p.id"
                  class="staff-row staff-link"
                  :title="`查看人物「${p.name}」`"
                  @click="openPerson(p.id)"
                >
                  <span class="staff-name">{{ p.name }}</span>
                  <NTag size="tiny" :bordered="false">{{ p.relation || 'Staff' }}</NTag>
                </div>
              </div>
            </NSpin>
          </NTabPane>

          <NTabPane name="related" tab="系列作品">
            <NAlert v-if="tabError" type="error" size="small">{{ tabError }}</NAlert>
            <NSpin :show="related === null" v-if="activeTab === 'related'">
              <EmptyHint v-if="related && !related.length" text="暂无关联条目" />
              <template v-else-if="related">
                <p class="related-hint">同一系列 / 企划下的关联作品，点击封面跳转（适合确认「该从哪部看起」）</p>
                <section v-for="g in relatedGroups" :key="g.relation" class="related-group">
                  <div class="related-group-title">
                    <NTag size="small" type="primary" :bordered="false">{{ g.relation }}</NTag>
                    <span class="related-group-count">{{ g.items.length }}</span>
                  </div>
                  <div class="related-grid">
                    <div
                      v-for="r in g.items"
                      :key="r.id"
                      class="related-card"
                      :title="r.name_cn || r.name"
                      @click="router.push({ name: 'subject', params: { id: String(r.id) } })"
                    >
                      <div class="related-poster">
                        <PosterImage
                          :src="coverCardUrl(r.images, settings.imageQuality)"
                          :title="r.name_cn || r.name"
                          :subject-id="r.id"
                        />
                        <span v-if="r.type !== 2" class="related-type">{{ subjectTypeLabel(r.type) }}</span>
                      </div>
                      <div class="related-name">{{ r.name_cn || r.name }}</div>
                      <div v-if="r.name_cn && r.name !== r.name_cn" class="related-original">{{ r.name }}</div>
                    </div>
                  </div>
                </section>
              </template>
            </NSpin>
          </NTabPane>

          <NTabPane name="eps" tab="剧集">
            <NAlert v-if="tabError" type="error" size="small">{{ tabError }}</NAlert>
            <!-- v0.19 SU1 追番下载订阅：独立行，不依赖加入追番（服务已配置即可订阅） -->
            <div v-if="settings.svcEnabled && subject" class="eps-sub-row">
              <span
                class="eps-sub"
                :title="subscribed ? '已订阅：定时检索新集资源；在下载中心管理订阅与待确认命中' : '开启后服务端定时检索本条目新集资源（默认命中后人工确认）'"
              >
                追番下载
                <NSwitch
                  size="small"
                  :value="subscribed"
                  :loading="subBusy"
                  @update:value="toggleSubscription"
                />
              </span>
              <template v-if="subscribed">
                <NInputNumber
                  size="tiny"
                  class="eps-sub-score"
                  :value="subScoreDraft ?? subscription?.autoScore ?? 0"
                  :min="0"
                  :max="100"
                  :loading="subBusy"
                  placeholder="0=手动"
                  @update:value="onSubScoreInput"
                  @blur="flushSubScore"
                  @keyup.enter="flushSubScore"
                  @keydown.capture="onSubScoreKeydown"
                  @click.capture="onSubScoreClick"
                >
                  <template #prefix>阈值</template>
                </NInputNumber>
                <span class="eps-sub-state">
                  已订阅 · 基线第 {{ subscription?.minEpisode ?? 0 }} 话后 ·
                  {{ (subscription?.autoScore ?? 0) > 0 ? '匹配度达标自动入队' : '命中在下载中心待确认' }}
                </span>
              </template>
            </div>
            <EmptyHint v-if="!inLibrary" text="加入追番后，可在这里勾选单集记录进度" />
            <!-- E1 沉浸观剧模式：逐集「标记并下一集」，单集增量同步 -->
            <template v-else-if="immersive && immersiveEp">
              <div class="immersive-head">
                <NButton size="tiny" quaternary @click="exitImmersive">✕ 退出沉浸观剧</NButton>
                <span class="eps-count">第 {{ immersiveIndex + 1 }} / {{ mainEpisodes.length }} 话 · 已看 {{ entry?.watchedEps?.length ?? 0 }} 话</span>
              </div>
              <div class="immersive-card">
                <div class="immersive-sort">第 {{ immersiveEp.sort }} 话</div>
                <div class="immersive-name">{{ immersiveEp.name_cn || immersiveEp.name }}</div>
                <div v-if="immersiveEp.name_cn && immersiveEp.name !== immersiveEp.name_cn" class="immersive-sub">
                  {{ immersiveEp.name }}
                </div>
                <div v-if="immersiveEp.airdate" class="immersive-date">播出日期 {{ immersiveEp.airdate }}</div>
                <div class="immersive-actions">
                  <NButton
                    type="primary"
                    size="large"
                    :ghost="immersiveWatched"
                    @click="immersiveMarkAndNext"
                  >
                    {{ immersiveWatched ? '已看过 · 下一集 →' : '✓ 标记并下一集' }}
                  </NButton>
                  <NButton size="large" quaternary @click="immersiveNext">跳过</NButton>
                  <NButton size="large" quaternary :disabled="immersiveIndex === 0" @click="immersivePrev">← 上一集</NButton>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="eps-tools">
                <!-- v0.13 PL2 本地播放入口 -->
                <NButton size="tiny" secondary type="primary" @click="openMediaModal()">
                  <span class="btn-icon-row"><NIcon :component="PlayOutline" size="12" />本地播放</span>
                </NButton>
                <!-- v0.17 R2 条目找资源（服务已配置才显示） -->
                <NButton v-if="settings.svcEnabled" size="tiny" secondary @click="openResourceSearch()">
                  <span class="btn-icon-row"><NIcon :component="CloudDownloadOutline" size="12" />资源搜索</span>
                </NButton>
                <!-- v0.26 HN4 在线解析（NSFW 开启 + 服务已配置 + 非演示模式） -->
                <NButton v-if="hanimeOnlineVisible" size="tiny" secondary @click="openHanimeSearch()">
                  <span class="btn-icon-row"><NIcon :component="GlobeOutline" size="12" />在线解析</span>
                </NButton>
                <NButton size="tiny" secondary @click="markAllEps(true)">全部看过</NButton>
                <NButton size="tiny" secondary @click="markAllEps(false)">清空</NButton>
                <NButton size="tiny" type="primary" secondary @click="enterImmersive">▶ 沉浸观剧</NButton>
                <NInput
                  v-model:value="epKeyword"
                  size="tiny"
                  clearable
                  placeholder="过滤章节名 / 话数"
                  class="ep-filter"
                />
                <span class="eps-count">
                  已看 {{ entry?.watchedEps?.length ?? 0 }} / {{ mainEpisodes.length }} 话
                </span>
              </div>
              <!-- v0.14：媒体库未收录本条目时的引导（服务已配置才会出现） -->
              <div v-if="svcHintVisible" class="svc-hint">
                <span>媒体库中未收录本条目——把视频文件放入服务扫描目录即可自动匹配</span>
                <NButton size="tiny" quaternary type="primary" @click="router.push('/settings')">打开媒体库管理</NButton>
              </div>
              <!-- G1 章节类型分组：进度统计仅本篇（mainEpisodes 语义不变）；H3 起非本篇行支持勾选（watchedSpecial 复合桶，不影响正篇进度） -->
              <div v-if="epTypeGroups.length > 1" class="ep-type-tabs">
                <button
                  v-for="g in epTypeGroups"
                  :key="g.type"
                  type="button"
                  class="ep-type-chip"
                  :class="{ active: epTypeFilter === g.type }"
                  @click="epTypeFilter = g.type"
                >
                  {{ g.label }} {{ g.count }}
                </button>
              </div>
              <NSpin :show="episodes === null && activeTab === 'eps'">
                <EmptyHint v-if="episodes && !episodes.length" text="暂无剧集数据" />
                <EmptyHint v-else-if="episodes && !visibleEpisodes.length" :text="`没有匹配「${epKeyword.trim()}」的章节`" />
                <div v-else class="ep-list">
                  <div
                    v-for="ep in visibleEpisodes"
                    :key="ep.id"
                    class="ep-row"
                    :class="{ watched: isEpWatched(ep) }"
                    title="查看章节详情与吐槽"
                    @click="openEpDetail(ep)"
                  >
                    <!-- H3：非本篇行也可勾选（本地写 watchedSpecial 复合桶 + 单集 PUT 上云），不参与进度统计 -->
                    <NCheckbox
                      :checked="isEpWatched(ep)"
                      @update:checked="(v: boolean) => toggleEp(ep, v)"
                      @click.stop
                    />
                    <span class="ep-sort">{{ ep.type === 0 ? `第 ${ep.sort} 话` : `${EP_TYPE_LABELS[ep.type] ?? '其他'} ${ep.sort}` }}</span>
                    <span class="ep-name" :title="ep.name_cn || ep.name">{{ ep.name_cn || ep.name }}</span>
                    <span v-if="ep.airdate" class="ep-date">{{ ep.airdate }}</span>
                    <!-- v0.13：已绑定本机文件的集显示行内播放；v0.14：媒体服务已收录的集以服务源播放（本机优先） -->
                    <NButton
                      v-if="boundMap.has(ep.sort)"
                      size="tiny"
                      quaternary
                      class="ep-play"
                      title="播放本集（本机文件）"
                      @click.stop="playEp(ep.sort)"
                    >
                      <template #icon><NIcon :component="PlayOutline" size="14" /></template>
                    </NButton>
                    <NButton
                      v-else-if="svcFiles.has(ep.sort)"
                      size="tiny"
                      quaternary
                      class="ep-play ep-play-svc"
                      :title="`播放本集（媒体库：${svcFiles.get(ep.sort)?.name}）`"
                      @click.stop="playServiceEp(ep.sort)"
                    >
                      <template #icon><NIcon :component="PlayOutline" size="14" /></template>
                    </NButton>
                    <!-- v0.26 HN4 行内「在线解析」入口（与播放按钮并存，主动选择在线源） -->
                    <NButton
                      v-if="hanimeOnlineVisible"
                      size="tiny"
                      quaternary
                      class="ep-play ep-online"
                      title="在线解析播放（hanime1.me）"
                      @click.stop="openHanimeSearch(ep.sort)"
                    >
                      <template #icon><NIcon :component="GlobeOutline" size="14" /></template>
                    </NButton>
                  </div>
                </div>
              </NSpin>
            </template>
          </NTabPane>
        </NTabs>
        </template>
      </div>
    </NSpin>

    <!-- G2 单集详情抽屉：列表数据直读（实测已含全字段）；G3 吐槽入口走 bgm.tv 官网页面 -->
    <NDrawer v-model:show="showEpDrawer" :width="360" placement="right">
      <NDrawerContent :title="drawerEp ? drawerEp.name_cn || drawerEp.name : ''" closable>
        <template v-if="drawerEp">
          <div v-if="drawerEp.name_cn && drawerEp.name !== drawerEp.name_cn" class="epd-sub">{{ drawerEp.name }}</div>
          <NDescriptions :column="1" size="small" label-placement="left" bordered class="epd-facts">
            <NDescriptionsItem label="类型">
              {{ EP_TYPE_LABELS[drawerEp.type] ?? '其他' }}
              <NTag v-if="drawerEp.type !== 0" size="tiny" :bordered="false" round style="margin-left: 6px">不参与进度统计</NTag>
            </NDescriptionsItem>
            <NDescriptionsItem v-if="drawerEp.airdate" label="播出日期">{{ drawerEp.airdate }}</NDescriptionsItem>
            <NDescriptionsItem v-if="epDuration" label="时长">{{ epDuration }}</NDescriptionsItem>
            <NDescriptionsItem label="吐槽">{{ drawerEp.comment ?? 0 }} 条</NDescriptionsItem>
          </NDescriptions>
          <div class="epd-label">章节简介</div>
          <p v-if="drawerEp.desc" class="epd-desc">{{ drawerEp.desc }}</p>
          <EmptyHint v-else text="暂无章节简介" />
          <!-- v0.13 本地播放：已绑定直接播放，未绑定进入绑定弹窗（预选本集）；v0.14 服务媒体库源兜底 -->
          <div class="epd-local-actions">
            <NButton v-if="boundMap.has(drawerEp.sort)" type="primary" secondary block @click="playEp(drawerEp.sort)">
              <span class="btn-icon-row"><NIcon :component="PlayOutline" size="14" />播放本集</span>
            </NButton>
            <NButton
              v-else-if="svcFiles.has(drawerEp.sort)"
              type="primary"
              secondary
              block
              @click="playServiceEp(drawerEp.sort)"
            >
              <span class="btn-icon-row"><NIcon :component="PlayOutline" size="14" />播放本集（媒体库）</span>
            </NButton>
            <NButton quaternary block size="small" @click="openMediaModal(drawerEp.sort)">
              {{ boundMap.has(drawerEp.sort) ? '更换绑定' : '绑定本地视频' }}
            </NButton>
            <!-- v0.17 R2 单集找资源（服务已配置才显示；预填本集集数） -->
            <NButton
              v-if="settings.svcEnabled"
              quaternary
              block
              size="small"
              @click="openResourceSearch(drawerEp.type === 0 ? drawerEp.sort : undefined)"
            >
              <span class="btn-icon-row"><NIcon :component="CloudDownloadOutline" size="14" />搜索本集资源</span>
            </NButton>
            <!-- v0.26 HN4 单集在线解析（NSFW 门同剧集行） -->
            <NButton
              v-if="hanimeOnlineVisible"
              quaternary
              block
              size="small"
              @click="openHanimeSearch(drawerEp.type === 0 ? drawerEp.sort : undefined)"
            >
              <span class="btn-icon-row"><NIcon :component="GlobeOutline" size="14" />在线解析播放</span>
            </NButton>
            <!-- v0.15 O4 弹幕导入（按条目+话数存储，与播放源无关） -->
            <NButton quaternary block size="small" @click="importDrawerDanmaku(drawerEp.sort)">导入弹幕（B 站 XML）</NButton>
          </div>
          <NButton type="primary" secondary block @click="openEpCommentPage">
            去 bgm.tv 查看 {{ drawerEp.comment ?? 0 }} 条吐槽 ↗
          </NButton>
        </template>
      </NDrawerContent>
    </NDrawer>

    <!-- v0.15 O4 抽屉弹幕导入（隐藏文件选择） -->
    <input ref="drawerDmInput" type="file" accept=".xml,text/xml,application/xml" hidden @change="onDrawerDanmaku" />

    <!-- v0.13 PL2 本地播放绑定弹窗 -->
    <MediaBindModal
      v-model:show="showMediaModal"
      :subject-id="id"
      :episodes="mainEpisodes"
      :default-sort="mediaDefaultSort"
      @changed="refreshBindings"
      @play="playEp"
    />

    <!-- v0.17 R2 资源搜索弹窗（条目级/单集级共用；关闭即销毁状态） -->
    <ResourceSearchModal
      v-if="showResourceModal"
      :show="showResourceModal"
      :subject-id="id"
      :subject-name="subject?.name"
      :subject-name-cn="subject?.name_cn"
      :default-sort="resourceDefaultSort"
      @update:show="showResourceModal = $event"
      @enqueued="onResourceEnqueued"
    />

    <!-- v0.26 HN4/HN8 在线解析弹窗（条目级/单集级共用；关闭即销毁状态） -->
    <HanimeSearchModal
      v-if="showHanimeModal"
      :show="showHanimeModal"
      :subject-id="id"
      :subject-name="subject?.name"
      :subject-name-cn="subject?.name_cn"
      :default-sort="hanimeDefaultSort"
      @update:show="showHanimeModal = $event"
      @played="onHanimePlayed"
      @bound="onHanimeBound"
    />
  </div>
</template>

<style scoped>
/* ═══ v0.12 B6 详情页 Hero 头部 ═══ */
.detail-hero {
  position: relative;
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid var(--av-border);
}

/* 海报放大模糊饱和背板（与主海报同源；无图时退化为占位底色） */
.hero-backdrop {
  position: absolute;
  inset: -70px;
  background-size: cover;
  background-position: center 20%;
  filter: blur(46px) saturate(1.25);
  opacity: 0.34;
  background-color: var(--av-img-placeholder);
}

html.light .hero-backdrop {
  opacity: 0.22;
}

/* 渐变压暗：背板向下融入页面底色（亮/暗两套令牌，styles.css） */
.hero-shade {
  position: absolute;
  inset: 0;
  background: var(--av-hero-shade);
}

.hero-inner {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 22px;
  padding: 26px 28px;
}

.detail-poster {
  width: 200px;
  flex-shrink: 0;
}

/* 前景海报浮起：描边 + 大投影 */
.detail-poster :deep(.poster-frame) {
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: var(--av-shadow-lg);
}

html.light .detail-poster :deep(.poster-frame) {
  border-color: rgba(20, 20, 50, 0.12);
}

/* B6：segment Tabs 精修（分段胶囊，激活位主色渐变） */
:deep(.n-tabs--segment-type .n-tabs-rail) {
  border-radius: 10px;
  padding: 4px;
}

:deep(.n-tabs--segment-type .n-tabs-tab) {
  border-radius: 8px;
}

:deep(.n-tabs--segment-type .n-tabs-tab--active) {
  background: linear-gradient(135deg, rgba(138, 123, 255, 0.4), rgba(138, 123, 255, 0.16)) !important;
}

.detail-meta {
  min-width: 0;
  flex: 1;
}

.detail-title {
  margin: 2px 0 6px;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 0.2px;
}

.detail-sub {
  font-size: 13px;
  color: var(--av-text-tertiary);
  margin-bottom: 14px;
}

.rate-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

/* 大号金色评分 */
.rate-num {
  font-size: 24px;
  font-weight: 800;
  color: var(--av-gold);
  text-shadow: 0 0 18px rgba(255, 215, 94, 0.35);
}

.rate-total {
  font-size: 12px;
  color: var(--av-text-tertiary);
}

.fact-row,
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.tag-clickable {
  cursor: pointer;
}

.tag-clickable:hover {
  color: var(--av-primary-hover);
  border-color: var(--av-primary-hover);
}

.action-box {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.my-review {
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--av-border);
  background: var(--av-surface-grad);
  box-shadow: var(--av-card-shadow);
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 560px;
}

.my-review-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.my-review-private {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  opacity: 0.7;
  cursor: pointer;
  user-select: none;
}

.my-review-rate {
  display: flex;
  align-items: center;
  gap: 10px;
}

.my-review-num {
  font-size: 13px;
  font-weight: 700;
  color: #ffd75e;
}

.my-review-hint {
  font-size: 12px;
  opacity: 0.45;
}

.progress-text {
  font-size: 13px;
  opacity: 0.6;
}

.summary p {
  margin: 0;
  line-height: 1.8;
  opacity: 0.85;
  white-space: pre-wrap;
}

.char-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 16px 12px;
  padding-top: 6px;
}

.char-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  content-visibility: auto;
  contain-intrinsic-size: auto 210px;
}

.char-name {
  font-size: 13px;
  font-weight: 600;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.char-actor {
  font-size: 12px;
  opacity: 0.55;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.char-actor .n-icon {
  flex: none;
}

.btn-icon-row {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.my-review-title {
  font-size: 13px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.char-card-link,
.staff-link {
  cursor: pointer;
}

.char-card-link:hover .char-name,
.staff-link:hover .staff-name {
  color: var(--av-primary-hover);
}

.person-link {
  cursor: pointer;
}

.person-link:hover {
  color: var(--av-primary-hover);
  text-decoration: underline;
}

.immersive-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.immersive-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 34px 20px;
  border-radius: 12px;
  background: var(--av-surface-grad);
  text-align: center;
}

.immersive-sort {
  font-size: 13px;
  font-weight: 700;
  color: var(--av-primary);
  letter-spacing: 1px;
}

.immersive-name {
  font-size: 19px;
  font-weight: 700;
}

.immersive-sub {
  font-size: 13px;
  opacity: 0.55;
}

.immersive-date {
  font-size: 12px;
  opacity: 0.45;
}

.immersive-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  flex-wrap: wrap;
  justify-content: center;
}

.staff-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 10px 16px;
  padding-top: 6px;
}

.staff-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  content-visibility: auto;
  contain-intrinsic-size: auto 32px;
}

.staff-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.related-hint {
  margin: 4px 0 14px;
  font-size: 12px;
  opacity: 0.5;
}

.related-group {
  margin-bottom: 18px;
}

.related-group-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}

.related-group-count {
  font-size: 12px;
  opacity: 0.45;
}

.related-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 16px 12px;
}

.related-card {
  cursor: pointer;
  transition: transform 0.15s ease;
  content-visibility: auto;
  contain-intrinsic-size: auto 210px;
}

.related-card:hover {
  transform: translateY(-3px);
}

.related-poster {
  position: relative;
}

.related-type {
  position: absolute;
  left: 6px;
  top: 6px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 6px;
}

.related-name {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.related-original {
  font-size: 12px;
  opacity: 0.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.eps-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  /* v0.10 P4：小屏允许换行 */
  flex-wrap: wrap;
}

.eps-count {
  font-size: 12px;
  opacity: 0.6;
}

/* v0.19 SU1 追番下载订阅行 */
.eps-sub-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  padding: 8px 12px;
  border: 1px dashed var(--av-border);
  border-radius: 10px;
  flex-wrap: wrap;
}

.eps-sub {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  opacity: 0.85;
}

.eps-sub-state {
  font-size: 11.5px;
  color: var(--av-text-tertiary);
}

/* v0.20 阈值输入：紧凑宽度 */
.eps-sub-score {
  width: 128px;
}

/* H2 章节过滤框：固定宽度避免挤压计数 */
.ep-filter {
  width: 180px;
  margin-left: auto;
}

.ep-list {
  display: flex;
  flex-direction: column;
}

.ep-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 6px;
  border-bottom: 1px solid var(--av-border);
}

.ep-row.watched .ep-name,
.ep-row.watched .ep-sort {
  opacity: 0.45;
  text-decoration: line-through;
}

.ep-sort {
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
  width: 64px;
}

.ep-name {
  font-size: 13px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ep-date {
  font-size: 12px;
  opacity: 0.5;
  flex-shrink: 0;
}

/* v0.13 行内播放按钮 */
.ep-play {
  flex-shrink: 0;
  color: var(--av-primary-hover);
}

/* v0.14 服务媒体库源播放按钮（与本机源同位次，弱化区分） */
.ep-play-svc {
  opacity: 0.85;
}

/* v0.14 媒体库未收录引导 */
.svc-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--av-text-tertiary);
  padding: 6px 10px;
  margin-bottom: 10px;
  border: 1px dashed var(--av-border);
  border-radius: 10px;
}

/* v0.13 单集抽屉本地播放操作区 */
.epd-local-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

/* G1 章节类型分组 chips */
.ep-type-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.ep-type-chip {
  cursor: pointer;
  border: 1px solid var(--av-border);
  background: transparent;
  color: inherit;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}

.ep-type-chip:hover {
  border-color: var(--av-primary);
}

.ep-type-chip.active {
  border-color: var(--av-primary);
  color: var(--av-primary-hover);
  background: var(--av-primary-soft);
}

/* G2/G3 章节行可点击进抽屉 */
.ep-row {
  cursor: pointer;
}

.ep-row:hover {
  background: var(--av-surface-hover);
}

/* 单集详情抽屉 */
.epd-sub {
  font-size: 12px;
  opacity: 0.55;
  margin-bottom: 10px;
  word-break: break-all;
}

.epd-facts {
  margin-bottom: 14px;
}

.epd-label {
  font-size: 12px;
  opacity: 0.6;
  margin-bottom: 4px;
}

.epd-desc {
  font-size: 13px;
  line-height: 1.7;
  margin: 0 0 14px;
  white-space: pre-wrap;
}

/* v0.10 P4 / v0.12 B6：小屏 Hero 纵排（海报上、信息下），标题缩号、内边距收窄 */
@media (max-width: 768px) {
  .hero-inner {
    flex-direction: column;
    gap: 14px;
    padding: 18px 16px;
  }

  .detail-poster {
    width: 150px;
  }

  .detail-title {
    font-size: 20px;
  }
}
</style>
