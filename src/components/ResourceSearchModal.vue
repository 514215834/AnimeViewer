<script setup lang="ts">
/** v0.17 R2/R3 条目「资源搜索」弹窗：
 *  关键词策略（中文名/原名双查询合并、infohash 去重——服务端已做，前端可编辑搜索词）→
 *  结果列表（标题/字幕组/大小/日期/分类，字幕组 chips 快捷过滤 + 偏好 localStorage 记忆）→
 *  确认弹窗（guessEpisodeSortFromTitle 预填集数 + 关联条目自动带入）→ 一键入下载队列（复用 v0.16 链路）。
 *  服务未配置/引擎不可用时降级「一键复制磁力」。 */
import { computed, ref, watch } from 'vue'
import {
  NButton,
  NCheckbox,
  NEmpty,
  NIcon,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpin,
  NTag,
  useMessage,
} from 'naive-ui'
import { CopyOutline, DownloadOutline, SearchOutline, SettingsOutline } from '@vicons/ionicons5'
import { clipboard } from '../utils/clipboard'
import {
  extractFansub,
  guessEpisodeSortFromTitle,
  mediaService,
  ServiceError,
  searchKeywords,
  type SvcResourceItem,
  type SvcResourceSite,
} from '../api/mediaService'
import { loadJson, saveJson } from '../utils/storage'
import ResourceSiteManager from './ResourceSiteManager.vue'

const props = defineProps<{
  show: boolean
  /** 关联条目（确认弹窗自动带入） */
  subjectId?: number
  subjectName?: string
  subjectNameCn?: string
  /** 从单集抽屉进入时预填集数 */
  defaultSort?: number | null
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'enqueued', payload: { episodeSort?: number }): void
}>()

const message = useMessage()

/* ── 搜索状态 ── */

const keyword = ref('')
const searching = ref(false)
const items = ref<SvcResourceItem[]>([])
const sites = ref<SvcResourceSite[]>([])
const searchError = ref('')
const partialError = ref('')

/* ── v0.21 RS1 站点选择器：null=全部混合搜索（默认）；数组=指定站点（单选/多选子集）── */

const siteList = ref<SvcResourceSite[]>([])
const selectedSiteKeys = ref<string[] | null>(null)

/** 传给服务端的站点参数：null 或全选 = 不传（混合）；选中子集 = 指定站点 */
function siteKeysParam(): string[] | undefined {
  if (!selectedSiteKeys.value?.length) return undefined
  if (selectedSiteKeys.value.length === siteList.value.length) return undefined
  return selectedSiteKeys.value
}

async function loadSites() {
  if (siteList.value.length) return
  try {
    siteList.value = await mediaService.resourceSites()
  } catch {
    // RS3 容错：站点列表拉取失败静默降级（仅「全部」态可用）
    siteList.value = []
  }
}

/** v0.24 SM1/SM4 站点管理：管理弹窗（添加/编辑/删除/启停）changed 后即时刷新 chips（siteKeys 失效态重置为全部） */
const siteManagerShow = ref(false)

function onSitesChanged(sites: SvcResourceSite[]) {
  siteList.value = sites
  const enabledKeys = sites.filter((s) => s.enabled !== false).map((s) => s.key)
  if (selectedSiteKeys.value && !selectedSiteKeys.value.some((k) => enabledKeys.includes(k))) {
    selectedSiteKeys.value = null // 所选站点全部失效 → 退回全部态
  }
}

/** v0.24 SM5：chips 只显示启用站点（停用站点在管理弹窗重新启用） */
const enabledSites = computed(() => siteList.value.filter((s) => s.enabled !== false))

/** 选择语义：全部态（null）点站点 = 从空集起指定；子集增减；子集扩大到全集时退化为全部态（v0.24：全集=启用站点） */
function toggleSite(key: string | null) {
  if (!key) {
    selectedSiteKeys.value = null
  } else {
    const cur = new Set(selectedSiteKeys.value ?? [])
    if (cur.has(key)) cur.delete(key)
    else cur.add(key)
    if (cur.size === 0 || cur.size === enabledSites.value.length) selectedSiteKeys.value = null
    else selectedSiteKeys.value = [...cur]
  }
  // RS2 联动重搜：有关键词即以当前关键词重搜
  if (keyword.value.trim()) void runSearch(keyword.value)
}

/** 字幕组偏好记忆（localStorage：点选过的组名置顶排序） */
const FANSUB_KEY = 'animeviewer:resource-fansub'
const preferredFansubs = ref<string[]>(loadJson<string[]>(FANSUB_KEY, []))

function rememberFansub(name: string) {
  if (!name) return
  const next = [name, ...preferredFansubs.value.filter((x) => x !== name)].slice(0, 12)
  preferredFansubs.value = next
  saveJson(FANSUB_KEY, next)
}

/* ── R3 过滤：字幕组 chips + 关键词行内过滤 ── */

const activeFansub = ref<string | null>(null)
const filterText = ref('')

const fansubCounts = computed(() => {
  const map = new Map<string, number>()
  for (const it of items.value) {
    const g = extractFansub(it.title)
    if (g) map.set(g, (map.get(g) ?? 0) + 1)
  }
  return [...map.entries()].sort((a, b) => {
    // 偏好记忆组置顶，其次按出现数
    const pa = preferredFansubs.value.indexOf(a[0])
    const pb = preferredFansubs.value.indexOf(b[0])
    if (pa >= 0 || pb >= 0) return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb)
    return b[1] - a[1]
  })
})

const filteredItems = computed(() => {
  let list = items.value
  if (activeFansub.value) list = list.filter((it) => extractFansub(it.title) === activeFansub.value)
  const kw = filterText.value.trim().toLowerCase()
  if (kw) list = list.filter((it) => it.title.toLowerCase().includes(kw))
  return list
})

function toggleFansub(name: string | null) {
  activeFansub.value = activeFansub.value === name ? null : name
  if (name) rememberFansub(name)
}

/* ── 确认入队 ── */

interface ConfirmState {
  item: SvcResourceItem
  sort: number | null
  alsoBind: boolean
}

const confirmState = ref<ConfirmState | null>(null)
const enqueueBusy = ref(false)

/** 条目候选（当前条目自动带入；单条目固定选择） */
const subjectOptions = computed(() => {
  if (!props.subjectId) return []
  const label = props.subjectNameCn || props.subjectName || `条目 ${props.subjectId}`
  return [{ label, value: props.subjectId }]
})

function openConfirm(it: SvcResourceItem) {
  confirmState.value = {
    item: it,
    sort: props.defaultSort ?? guessEpisodeSortFromTitle(it.title),
    alsoBind: props.subjectId != null,
  }
}

/** 入队链接（v0.24 SE3）：磁力优先、种子直链兜底（后端 MagnetParser.isSupported 双通） */
function itemUri(it: SvcResourceItem): string {
  return (it.magnet ?? it.torrentUrl ?? '').trim()
}

async function submitEnqueue() {
  const st = confirmState.value
  if (!st || enqueueBusy.value) return
  enqueueBusy.value = true
  try {
    await mediaService.enqueueResource({
      magnet: itemUri(st.item),
      subjectId: st.alsoBind ? (props.subjectId ?? undefined) : undefined,
      subjectName: st.alsoBind ? (props.subjectName || undefined) : undefined,
      subjectNameCn: st.alsoBind ? (props.subjectNameCn || undefined) : undefined,
      episodeSort: st.sort ?? undefined,
    })
    message.success('资源已加入下载队列，完成后自动入库匹配')
    rememberFansub(extractFansub(st.item.title) ?? '')
    confirmState.value = null
    emit('enqueued', { episodeSort: st.sort ?? undefined })
  } catch (e) {
    if (e instanceof ServiceError && e.kind === 'busy') {
      message.warning('该资源已在下载队列中')
    } else {
      message.error(e instanceof ServiceError ? e.message : '入队失败')
    }
  } finally {
    enqueueBusy.value = false
  }
}

/** 复制链接（v0.24 SE3：磁力优先，种子直链自适应） */
async function copyItemUri(it: SvcResourceItem) {
  await clipboard.write(itemUri(it))
  message.success(it.magnet ? '磁力链接已复制，可粘贴到外部 BT 客户端' : '种子链接已复制，可粘贴到外部 BT 客户端或浏览器下载')
}

/* ── 搜索执行 ── */

async function runSearch(kw: string) {
  const q = kw.trim()
  if (!q || searching.value) return
  searching.value = true
  searchError.value = ''
  partialError.value = ''
  activeFansub.value = null
  filterText.value = ''
  try {
    const res = await mediaService.resourceSearch(q, siteKeysParam())
    items.value = res.items
    sites.value = res.sites
    partialError.value = res.error ?? ''
    if (!res.items.length) searchError.value = res.error || '没有找到匹配的资源'
  } catch (e) {
    items.value = []
    searchError.value = e instanceof ServiceError ? e.message : '资源搜索失败'
  } finally {
    searching.value = false
  }
}

/** 双查询合并：中文名/原名依次查询（第一词结果 ≥3 条即止；服务端已做单源去重，此处跨词 infohash 去重） */
async function autoDualSearch(kws: string[]) {
  searching.value = true
  const collected: SvcResourceItem[] = []
  let lastSites: SvcResourceSite[] = []
  let lastError = ''
  try {
    for (const kw of kws) {
      keyword.value = kw
      try {
        const res = await mediaService.resourceSearch(kw, siteKeysParam())
        collected.push(...res.items)
        lastSites = res.sites
        if (res.error) lastError = res.error
      } catch (e) {
        lastError = e instanceof ServiceError ? e.message : '搜索失败'
      }
      if (collected.length >= 3) break
    }
    const seen = new Set<string>()
    items.value = collected.filter((it) => {
      // v0.24 SE1 去重键扩展对齐服务端：infoHash > magnet > torrentUrl
      const key = it.infoHash || it.magnet || it.torrentUrl
      if (!key) return false
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    sites.value = lastSites
    partialError.value = lastError
    if (!items.value.length) searchError.value = lastError || '没有找到匹配的资源'
  } finally {
    searching.value = false
  }
}

watch(
  () => props.show,
  (show) => {
    if (!show) return
    // v-if 挂载时 show 已为 true,无 immediate 则首开永不触发
  
    confirmState.value = null
    items.value = []
    sites.value = []
    searchError.value = ''
    partialError.value = ''
    activeFansub.value = null
    filterText.value = ''
    // v0.21 RS1：弹窗打开时与搜索并行拉取站点列表（失败静默降级为仅「全部」态）
    void loadSites()
    // 首开自动按关键词策略搜索（中文名优先，原名兜底）
    const kws = searchKeywords(props.subjectNameCn, props.subjectName)
    if (!kws.length) return
    keyword.value = kws[0]
    void autoDualSearch(kws)
  },
  { immediate: true },
)

function fmtWhen(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function closeConfirm(v: boolean) {
  if (!v) confirmState.value = null
}

defineExpose({ runSearch })
</script>

<template>
  <NModal
    :show="show"
    transform-origin="center"
    preset="card"
    title="资源搜索（RSS 站点）"
    class="rs-modal"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="rs-search-bar">
      <NInput
        v-model:value="keyword"
        clearable
        placeholder="搜索关键词（中文名 / 原名 / 罗马字）"
        @keydown.enter="runSearch(keyword)"
      >
        <template #prefix><NIcon :component="SearchOutline" /></template>
      </NInput>
      <NButton type="primary" secondary :loading="searching" @click="runSearch(keyword)">搜索</NButton>
    </div>

    <!-- v0.21 RS1 站点选择器：全部=混合搜索；单选/多选=指定站点（v0.24 SM5：仅启用站点） -->
    <div v-if="enabledSites.length" class="rs-sites">
      <NButton
        size="tiny"
        round
        :secondary="selectedSiteKeys == null"
        :type="selectedSiteKeys == null ? 'primary' : 'default'"
        class="rs-site-chip"
        @click="toggleSite(null)"
      >
        全部
      </NButton>
      <NButton
        v-for="s in enabledSites"
        :key="s.key"
        size="tiny"
        round
        :secondary="selectedSiteKeys != null && selectedSiteKeys.includes(s.key)"
        :type="selectedSiteKeys != null && selectedSiteKeys.includes(s.key) ? 'primary' : 'default'"
        class="rs-site-chip"
        :title="s.builtin ? `${s.name}（内置站点）` : s.name"
        @click="toggleSite(s.key)"
      >
        {{ s.key }}{{ s.builtin ? '' : '（自定义）' }}
      </NButton>
      <!-- v0.24 SM1 站点管理入口 -->
      <NButton size="tiny" round quaternary class="rs-site-chip rs-manage" title="管理 RSS 站点（添加/编辑/启停）" @click="siteManagerShow = true">
        <template #icon><NIcon :component="SettingsOutline" /></template>
        管理
      </NButton>
    </div>

    <NSpin :show="searching">
      <NEmpty
        v-if="!items.length && !searching"
        :description="searchError || '输入关键词开始搜索'"
        size="small"
        class="rs-empty"
      >
        <template v-if="searchError" #extra>
          <div class="rs-guide dim">可尝试：换关键词（原名 / 罗马字）· 换站点源 · 检查服务端代理设置</div>
        </template>
      </NEmpty>

      <template v-else-if="items.length">
        <div v-if="partialError" class="rs-partial dim">部分站点失败：{{ partialError }}</div>

        <!-- R3 字幕组 chips（偏好记忆置顶） -->
        <div v-if="fansubCounts.length" class="rs-chips">
          <button type="button" class="rs-chip" :class="{ active: activeFansub === null }" @click="toggleFansub(null)">
            全部 {{ items.length }}
          </button>
          <button
            v-for="[name, count] in fansubCounts.slice(0, 8)"
            :key="name"
            type="button"
            class="rs-chip"
            :class="{ active: activeFansub === name }"
            :title="preferredFansubs.includes(name) ? '偏好的字幕组' : name"
            @click="toggleFansub(name)"
          >
            {{ name }} {{ count }}<span v-if="preferredFansubs.includes(name)" class="rs-chip-star">★</span>
          </button>
        </div>
        <NInput v-if="items.length > 6" v-model:value="filterText" size="tiny" clearable placeholder="行内过滤标题关键词" class="rs-filter" />

        <div class="rs-list">
          <div v-for="it in filteredItems" :key="it.infoHash || it.magnet || it.torrentUrl" class="rs-row">
            <div class="rs-main">
              <div class="rs-title" :title="it.title">{{ it.title }}</div>
              <div class="rs-meta">
                <NTag v-if="extractFansub(it.title)" size="tiny" round :bordered="false" type="info">
                  {{ extractFansub(it.title) }}
                </NTag>
                <NTag v-if="it.category" size="tiny" round :bordered="false">{{ it.category }}</NTag>
                <span v-if="it.size" class="dim">{{ it.size }}</span>
                <span v-if="it.pubDate" class="dim">{{ fmtWhen(it.pubDate) }}</span>
                <span class="dim rs-site">{{ it.site }}</span>
              </div>
            </div>
            <div class="rs-ops">
              <NButton size="tiny" quaternary circle :title="it.magnet ? '复制磁力链接' : '复制种子链接'" @click="copyItemUri(it)">
                <template #icon><NIcon :component="CopyOutline" /></template>
              </NButton>
              <NButton size="tiny" type="primary" secondary @click="openConfirm(it)">
                <template #icon><NIcon :component="DownloadOutline" /></template>
                下载
              </NButton>
            </div>
          </div>
          <div v-if="!filteredItems.length" class="rs-none dim">没有匹配当前过滤条件的资源</div>
        </div>
      </template>
    </NSpin>

    <!-- 确认入队弹窗 -->
    <NModal
      :show="!!confirmState"
      transform-origin="center"
      preset="card"
      title="确认下载"
      class="rs-confirm"
      @update:show="(v: boolean) => closeConfirm(v)"
    >
      <div v-if="confirmState">
        <div class="rs-confirm-title" :title="confirmState.item.title">{{ confirmState.item.title }}</div>
        <div class="rs-confirm-meta dim">
          <NTag
            v-if="!confirmState.item.magnet && confirmState.item.torrentUrl"
            size="tiny"
            round
            :bordered="false"
            type="info"
          >
            种子直链
          </NTag>
          <span v-if="confirmState.item.size">{{ confirmState.item.size }}</span>
          <span v-if="confirmState.item.publisher">{{ confirmState.item.publisher }}</span>
          <span v-if="confirmState.item.infoHash">BT {{ confirmState.item.infoHash.slice(0, 16) }}…</span>
        </div>

        <div class="rs-confirm-field">
          <NCheckbox v-model:checked="confirmState.alsoBind" :disabled="!props.subjectId">
            关联追番条目（完成后自动入库匹配绑定）
          </NCheckbox>
          <NSelect
            v-if="confirmState.alsoBind && subjectOptions.length"
            :value="props.subjectId"
            :options="subjectOptions"
            disabled
            size="small"
          />
        </div>

        <div class="rs-confirm-field">
          <span class="rs-confirm-label">集数（整季包可留空，按文件名自动解析）</span>
          <NInputNumber v-model:value="confirmState.sort" :min="1" size="small" placeholder="自动" class="rs-sort" />
          <span v-if="confirmState.sort" class="dim">预填自标题解析</span>
        </div>
      </div>

      <template #footer>
        <div class="rs-confirm-footer">
          <NButton quaternary :disabled="!confirmState" @click="confirmState = null">取消</NButton>
          <NButton type="primary" round :disabled="!confirmState" :loading="enqueueBusy" @click="submitEnqueue">
            加入下载队列
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- v0.24 SM1/SM2/SM4/SM5 站点管理弹窗（changed 即时刷新 chips） -->
    <ResourceSiteManager
      v-model:show="siteManagerShow"
      :sites="siteList"
      :default-keyword="keyword.trim() || props.subjectNameCn || props.subjectName || ''"
      @changed="onSitesChanged"
    />
  </NModal>
</template>

<style scoped>
.rs-modal {
  width: 680px;
  max-width: calc(100vw - 32px);
}

.rs-sites {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0 4px;
}

.rs-site-chip {
  user-select: none;
}

.rs-manage {
  margin-left: auto;
}

.rs-search-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.rs-empty {
  padding: 30px 0;
}

.rs-guide {
  margin-top: 6px;
}

.rs-partial {
  margin-bottom: 6px;
}

.rs-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.rs-chip {
  border: 1px solid var(--av-border);
  background: transparent;
  color: var(--av-text-secondary);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 11.5px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.rs-chip:hover {
  border-color: var(--av-primary);
}

.rs-chip.active {
  background: var(--av-primary-soft);
  border-color: var(--av-primary);
  color: var(--av-primary);
}

.rs-chip-star {
  margin-left: 3px;
  color: #e6b800;
}

.rs-filter {
  margin-bottom: 8px;
}

.rs-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 420px;
  overflow: auto;
}

.rs-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  transition: background 0.15s ease;
}

.rs-row:hover {
  background: var(--av-primary-soft);
}

.rs-main {
  flex: 1;
  min-width: 0;
}

.rs-title {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rs-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 3px;
  font-size: 11.5px;
  flex-wrap: wrap;
}

.rs-site {
  margin-left: auto;
}

.rs-ops {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.rs-none {
  padding: 12px 0;
  text-align: center;
}

.dim {
  color: var(--av-text-tertiary);
  font-size: 11.5px;
}

.rs-confirm {
  width: 520px;
  max-width: calc(100vw - 32px);
}

.rs-confirm-title {
  font-size: 13.5px;
  font-weight: 600;
  word-break: break-all;
}

.rs-confirm-meta {
  display: flex;
  gap: 12px;
  margin: 6px 0 14px;
  flex-wrap: wrap;
}

.rs-confirm-field {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.rs-confirm-field > :first-child {
  flex: 1 1 100%;
}

.rs-confirm-label {
  font-size: 12px;
  color: var(--av-text-secondary);
}

.rs-sort {
  width: 120px;
}

.rs-confirm-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
