<script setup lang="ts">
/** v0.26 HN4 在线解析搜索弹窗（hanime1.me）：条目名预填 → 站内搜索 → 结果行播放/绑定。
 *  复用详情页「资源搜索」弹窗的交互形态（v0.17 R2），但单站点、无站点 chips；
 *  绑定走 MediaBinding online 形态（v0.26 HN8，mediaStore 落库）。
 *  NSFW 门：外层控制入口显隐；本弹窗首次打开二次确认（v0.27 A3c：IndexedDB 记忆，
 *  localStorage 旧值迁移一次）。v0.27 A3b：搜索行新增 genre 分类筛选（站点原生参数透传）。 */
import { computed, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { NAlert, NButton, NEmpty, NIcon, NInput, NModal, NSelect, NSpin, NTag } from 'naive-ui'
import { PlayOutline, SearchOutline, CloudUploadOutline } from '@vicons/ionicons5'
import { mediaService, type SvcHanimeSearchItem } from '../api/mediaService'
import { getHanime18Confirmed, setHanime18Confirmed, setBinding } from '../utils/mediaStore'

/** 缩略图统一经服务端容灾转发（浏览器直连站点 CDN 在 DNS 污染网络不可达，v0.26 补记修复） */
function thumbSrc(url: string): string {
  return mediaService.hanimeThumbUrl(url)
}

const props = defineProps<{
  show: boolean
  subjectId: number
  /** 条目名（预填搜索词：中文名优先） */
  subjectName?: string
  subjectNameCn?: string
  /** 预填集数（null = 条目级入口，隐藏「绑定到此集」） */
  defaultSort?: number | null
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  /** 已发起播放（外层关弹窗并跳 WatchView 在线源） */
  (e: 'played', payload: { videoCode: string; title: string }): void
  /** 已绑定到 defaultSort 对应集（外层刷新绑定状态） */
  (e: 'bound', payload: { videoCode: string; title: string; sort: number }): void
}>()

const message = useMessage()

const CONFIRM_KEY = 'animeviewer:hanime-18-confirmed'
/** v0.27 A3c 18+ 首次确认：IndexedDB 记忆（挂载异步读键；读键完成前不渲染确认框防闪烁）。
 *  v0.26 曾用 localStorage——旧值迁移一次后清理。 */
const confirmed = ref<boolean | null>(null)
{
  const legacy = localStorage.getItem(CONFIRM_KEY) === '1'
  if (legacy) void setHanime18Confirmed()
  void getHanime18Confirmed().then((v) => {
    if (v) {
      confirmed.value = true
      if (legacy) localStorage.removeItem(CONFIRM_KEY)
    } else {
      confirmed.value = false
    }
    maybeAutoSearch()
  })
}

const keyword = ref('')
const sort = ref('最新上市')
// v0.27 A3b 分类筛选：站点原生 genre 参数（2026-09-20 抓包枚举常用档位；站点可随时扩展，
// 不硬编码全量——「不限」= 不传参数返回全部）
const genre = ref('')
const GENRE_OPTIONS = [
  { label: '分类不限', value: '' },
  { label: '2D動畫', value: '2D動畫' },
  { label: '2.5D', value: '2.5D' },
  { label: '3DCG', value: '3DCG' },
  { label: 'AI生成', value: 'AI生成' },
  { label: 'Cosplay', value: 'Cosplay' },
  { label: 'MMD', value: 'MMD' },
  { label: 'Motion Anime', value: 'Motion Anime' },
  { label: '裏番', value: '裏番' },
  { label: '泡麵番', value: '泡麵番' },
  { label: '新番預告', value: '新番預告' },
]
const SORT_OPTIONS = [
  { label: '最新上市', value: '最新上市' },
  { label: '最新上傳', value: '最新上傳' },
  { label: '本日排行', value: '本日排行' },
  { label: '本週排行', value: '本週排行' },
  { label: '本月排行', value: '本月排行' },
  { label: '觀看次數', value: '觀看次數' },
  { label: '讚好比例', value: '讚好比例' },
]

const loading = ref(false)
const error = ref('')
const items = ref<SvcHanimeSearchItem[]>([])
const page = ref(1)
const hasNext = ref(false)
/** 绑定进行中的视频码（行内 loading） */
const bindingCode = ref('')

const prefill = computed(() => (props.subjectNameCn || props.subjectName || '').trim())

// v0.27 A3c：confirmed 由 IDB 异步判定，读取完成后也需补触发首搜（immediate watch 先于 IDB 结果执行）
function maybeAutoSearch() {
  if (!props.show || !confirmed.value) return
  keyword.value = prefill.value
  if (prefill.value && !items.value.length) void doSearch()
}

// 每次打开：预填条目名并自动首搜（条目级入口给「最新」浏览，集级入口搜条目名）。
// v0.26 补记：组件随 v-if 挂载时 show 已为 true——watch 不加 immediate 首次赋值不触发，
// 预填与自动首搜从未执行（用户实测反馈「搜索框没有自动预填」）；immediate 后覆盖挂载即打开的场景
watch(
  () => props.show,
  (v) => {
    if (!v) return
    error.value = ''
    if (items.value.length) return
    keyword.value = prefill.value
    if (prefill.value && confirmed.value) void doSearch()
  },
  { immediate: true },
)

function confirm18() {
  void setHanime18Confirmed()
  confirmed.value = true
  keyword.value = prefill.value
  if (prefill.value) void doSearch()
}

async function doSearch(target = 1) {
  loading.value = true
  error.value = ''
  try {
    const r = await mediaService.hanimeSearch({
      query: keyword.value.trim(),
      sort: sort.value,
      genre: genre.value || undefined,
      page: target,
    })
    items.value = r.items
    page.value = r.page
    hasNext.value = r.hasNext
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    items.value = []
  } finally {
    loading.value = false
  }
}

function play(item: SvcHanimeSearchItem) {
  emit('played', { videoCode: item.videoCode, title: item.title })
}

async function bind(item: SvcHanimeSearchItem) {
  const sortValue = props.defaultSort
  if (!sortValue) return
  bindingCode.value = item.videoCode
  try {
    await setBinding({
      subjectId: props.subjectId,
      sort: sortValue,
      name: item.title,
      type: 'online',
      videoCode: item.videoCode,
      addedAt: Date.now(),
    })
    message.success(`第 ${sortValue} 话已绑定在线源`)
    emit('bound', { videoCode: item.videoCode, title: item.title, sort: sortValue })
  } catch {
    message.error('绑定写入失败，请重试')
  } finally {
    bindingCode.value = ''
  }
}
</script>

<template>
  <NModal
    :show="show"
    @update:show="emit('update:show', $event)"
  >
    <div class="hanime-modal">
      <!-- v0.27 A3c：confirmed 由 IDB 异步判定（null=判定中不渲染任何态防闪烁） -->
      <template v-if="confirmed === false">
        <div class="confirm-box">
          <div class="confirm-title">成人内容提醒</div>
          <p class="confirm-text">
            「在线解析」通过解析第三方站点 hanime1.me 提供在线播放，内容为成人向（R-18）。
            继续使用即表示你已年满 18 周岁（或所在地区法定年龄）并自愿查看此类内容。
          </p>
          <div class="confirm-actions">
            <NButton @click="emit('update:show', false)">返回</NButton>
            <NButton type="primary" @click="confirm18">我已满 18 岁，继续</NButton>
          </div>
        </div>
      </template>
      <template v-else-if="confirmed === true">
        <div class="modal-head">
          <span class="modal-title">在线解析 · hanime1.me</span>
          <NTag v-if="defaultSort" size="small" round :bordered="false">绑定到第 {{ defaultSort }} 话</NTag>
        </div>
        <div class="search-row">
          <NInput
            v-model:value="keyword"
            size="small"
            clearable
            placeholder="搜索词（默认条目名，可改）"
            @keyup.enter="doSearch(1)"
          />
          <!-- v0.27 A3b：genre 分类筛选（站点原生参数；空=不限） -->
          <NSelect v-model:value="genre" size="small" :options="GENRE_OPTIONS" class="genre-select" />
          <NSelect v-model:value="sort" size="small" :options="SORT_OPTIONS" class="sort-select" />
          <NButton size="small" type="primary" secondary :loading="loading" @click="doSearch(1)">
            <template #icon><NIcon :component="SearchOutline" /></template>
            搜索
          </NButton>
        </div>
        <NAlert v-if="error" type="error" size="small" class="err">{{ error }}</NAlert>
        <div class="result-area">
          <NSpin :show="loading">
            <NEmpty
              v-if="!loading && !items.length"
              :description="error ? '搜索失败' : '没有结果——换个关键词或排序试试'"
              class="empty"
            />
            <div v-else class="result-list">
              <div v-for="item in items" :key="item.videoCode" class="result-row">
                <img v-if="item.thumbnail" :src="thumbSrc(item.thumbnail)" class="thumb" loading="lazy" referrerpolicy="no-referrer" />
                <div class="info">
                  <div class="r-title" :title="item.title">{{ item.title }}</div>
                  <div class="r-meta">
                    <span v-if="item.duration">{{ item.duration }}</span>
                    <span v-if="item.brand" class="r-brand">{{ item.brand }}</span>
                    <span v-if="item.likes">{{ item.likes }}</span>
                    <span v-if="item.views">{{ item.views }}</span>
                  </div>
                </div>
                <div class="actions">
                  <NButton
                    size="tiny"
                    type="primary"
                    secondary
                    @click="play(item)"
                  >
                    <template #icon><NIcon :component="PlayOutline" /></template>
                    播放
                  </NButton>
                  <NButton
                    v-if="defaultSort"
                    size="tiny"
                    secondary
                    :loading="bindingCode === item.videoCode"
                    title="把该视频绑定为这一集的在线播放源（重进直达）"
                    @click="bind(item)"
                  >
                    <template #icon><NIcon :component="CloudUploadOutline" /></template>
                    绑定
                  </NButton>
                </div>
              </div>
            </div>
          </NSpin>
        </div>
        <div class="pager">
          <NButton size="tiny" quaternary :disabled="page <= 1 || loading" @click="doSearch(page - 1)">上一页</NButton>
          <span class="page-num">第 {{ page }} 页</span>
          <NButton size="tiny" quaternary :disabled="!hasNext || loading" @click="doSearch(page + 1)">下一页</NButton>
        </div>
      </template>
    </div>
  </NModal>
</template>

<style scoped>
.hanime-modal {
  width: min(860px, 92vw);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  background: var(--av-panel, #1c1c24);
  border: 1px solid var(--av-border);
  border-radius: 14px;
  padding: 16px 18px;
}

.confirm-box {
  padding: 30px 10px;
  text-align: center;
}

.confirm-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 12px;
}

.confirm-text {
  font-size: 13px;
  color: var(--av-text-secondary, #aaa);
  max-width: 460px;
  margin: 0 auto 18px;
  line-height: 1.7;
}

.confirm-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.modal-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.modal-title {
  font-size: 15px;
  font-weight: 700;
}

.search-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.sort-select {
  width: 130px;
}

.genre-select {
  width: 120px;
}

.err {
  margin-bottom: 8px;
}

.result-area {
  min-height: 220px;
  max-height: 52vh;
  overflow-y: auto;
}

.empty {
  margin: 60px 0;
}

.result-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 4px;
  border-bottom: 1px solid var(--av-border, rgba(255, 255, 255, 0.06));
}

.thumb {
  width: 96px;
  height: 54px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
  background: #000;
}

.info {
  flex: 1;
  min-width: 0;
}

.r-title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.r-meta {
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: var(--av-text-tertiary, #888);
  margin-top: 3px;
}

.r-brand {
  color: var(--av-text-secondary, #aaa);
}

.actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding-top: 10px;
}

.page-num {
  font-size: 12px;
  color: var(--av-text-tertiary, #888);
}
</style>
