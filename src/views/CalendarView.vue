<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NIcon, NSpin, NTabPane, NTabs, NTag } from 'naive-ui'
import { CalendarOutline } from '@vicons/ionicons5'
import { dataSource } from '../api/dataSource'
import { useNsfwStore } from '../stores/nsfw'
import { useSettingsStore } from '../stores/settings'
import { useLibraryStore } from '../stores/library'
import { coverCardUrl } from '../utils/image'
import { useAirtimes } from '../utils/airtimeStore'
import type { AirTime } from '../utils/airtime'
import type { CalendarDay } from '../types/bangumi'
import AnimeCard from '../components/AnimeCard.vue'
import EmptyHint from '../components/EmptyHint.vue'

const router = useRouter()
const route = useRoute()
const nsfw = useNsfwStore()
const settings = useSettingsStore()
const library = useLibraryStore()

/** v0.12 B5 在追进度线：有总话数的条目返回进度比值（0~1），未开始/无总话数返回 0 不渲染 */
function progressRatio(id: number): number {
  const e = library.entry(id)
  return e && e.epsTotal > 0 ? Math.min(e.progress / e.epsTotal, 1) : 0
}

const days = ref<CalendarDay[]>([])
const loading = ref(true)
const error = ref('')
const activeDay = ref<string | number | undefined>(undefined)

const todayId = computed(() => {
  const d = new Date().getDay()
  return d === 0 ? 7 : d
})

const currentItems = computed(() => {
  const day = Number(activeDay.value)
  return days.value.find((d) => d.weekday.id === day)?.items ?? []
})

/** v0.29 Q1 时刻解析（infobox 随详情缓存走；普查定案现网无时刻数据，全部回退星期粒度） */
const airtimes = useAirtimes(() => currentItems.value.map((i) => i.id))

/** 时刻徽章文本（如「24:30」保留深夜档原貌）；无时刻返回 undefined */
function timeBadge(id: number): string | undefined {
  const t = airtimes.value.get(id)
  if (!t?.timed || t.hour === undefined) return undefined
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`
}

/** 同日按时刻排序（有时刻条目升序在前，无时刻保持原顺序跟后；普查定案下现实数据全部无时刻 → 零回归） */
function timeOrder(id: number): number {
  const t: AirTime | null | undefined = airtimes.value.get(id)
  return t?.timed && t.hour !== undefined ? t.hour * 60 + t.minute : Number.MAX_SAFE_INTEGER
}

const sortedItems = computed(() =>
  currentItems.value
    .map((it, i) => ({ it, i }))
    .sort((a, b) => timeOrder(a.it.id) - timeOrder(b.it.id) || a.i - b.i)
    .map((x) => x.it),
)

/** 应用 R18 过滤后的可见列表 */
const visibleItems = computed(() =>
  settings.hideNsfw ? sortedItems.value.filter((x) => !nsfw.isNsfw(x.id)) : sortedItems.value,
)

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await dataSource.calendar(true)
    days.value = [...data].sort((a, b) => a.weekday.id - b.weekday.id)
    if (route.query.day === 'today') activeDay.value = todayId.value
    if (activeDay.value === undefined) activeDay.value = todayId.value
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

// 当前展示日的条目需要做 nsfw 检查（设置开启时）
watch(
  [currentItems, () => settings.hideNsfw],
  ([items, hide]) => {
    if (hide && items.length) void nsfw.ensure(items.map((x) => x.id))
  },
  { immediate: true },
)

function backToToday() {
  activeDay.value = todayId.value
}

function airText(item: CalendarDay['items'][number]): string {
  const date = item.air_date || item.date
  const eps = item.eps ? ` · ${item.eps} 话` : ''
  return `${date ? `首播 ${date}` : '播出时间待定'}${eps}`
}

function open(id: number) {
  router.push({ name: 'subject', params: { id: String(id) } })
}
</script>

<template>
  <div>
    <div class="page-head">
      <h2><NIcon :component="CalendarOutline" />每周新番时间表</h2>
      <div class="head-row">
        <span class="page-sub">按周一至周日列出本周更新内容，默认定位到今天</span>
        <div class="head-tools">
          <NButton v-if="Number(activeDay) !== todayId" size="small" type="primary" ghost @click="backToToday">
            回到今天
          </NButton>
          <NButton quaternary size="small" :disabled="loading" @click="load">↻ 刷新</NButton>
        </div>
      </div>
    </div>

    <NSpin :show="loading">
      <NAlert v-if="error" type="error" title="加载失败" closable style="margin-bottom: 12px">
        {{ error }} —— 请检查网络/代理，或在「设置」中修改 API 地址、切换演示数据模式。
      </NAlert>

      <NTabs v-else v-model:value="activeDay" type="segment" animated>
        <NTabPane v-for="d in days" :key="d.weekday.id" :name="d.weekday.id">
          <template #tab>
            <span>{{ d.weekday.cn.replace('星期', '周') }}</span>
            <NTag
              v-if="d.weekday.id === todayId"
              size="tiny"
              type="primary"
              :bordered="false"
              round
              style="margin-left: 6px"
            >
              今天
            </NTag>
          </template>

          <EmptyHint v-if="!visibleItems.length" text="当天暂无更新" />
          <div v-else class="card-grid">
            <AnimeCard
              v-for="it in visibleItems"
              :key="it.id"
              :id="it.id"
              :title="it.name_cn || it.name"
              :original="it.name"
              :poster="coverCardUrl(it.images, settings.imageQuality)"
              :score="it.rating?.score"
              :extra="airText(it)"
              :time-badge="timeBadge(it.id)"
              :in-library="library.has(it.id)"
              :progress-ratio="progressRatio(it.id)"
              @open="open"
            />
          </div>
        </NTabPane>
      </NTabs>
    </NSpin>
  </div>
</template>

<style scoped>
.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.head-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
