<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NIcon, NInput, NPagination, NSelect, NSpin, NTabPane, NTabs } from 'naive-ui'
import { CompassOutline } from '@vicons/ionicons5'
import { dataSource } from '../api/dataSource'
import { useNsfwStore } from '../stores/nsfw'
import { useSettingsStore } from '../stores/settings'
import { useLibraryStore } from '../stores/library'
import { coverCardUrl } from '../utils/image'
import type { CalendarDay, SearchResultItem } from '../types/bangumi'
import AnimeCard from '../components/AnimeCard.vue'
import EmptyHint from '../components/EmptyHint.vue'

const router = useRouter()
const settings = useSettingsStore()
const nsfw = useNsfwStore()
const library = useLibraryStore()

const activeTab = ref('hot')

/* ── 热门在播（原有能力） ── */
const days = ref<CalendarDay[]>([])
const hotLoading = ref(true)
const hotError = ref('')
const sortBy = ref<'score' | 'doing'>('score')

const sortOptions = [
  { label: '按评分排序', value: 'score' },
  { label: '按追番人数排序', value: 'doing' },
]

const top = computed(() => {
  const arr = days.value.flatMap((d) => d.items)
  arr.sort((a, b) =>
    sortBy.value === 'score'
      ? (b.rating?.score ?? 0) - (a.rating?.score ?? 0)
      : (b.collection?.doing ?? 0) - (a.collection?.doing ?? 0),
  )
  return arr.slice(0, 30)
})

// legacy 周历数据无 nsfw 字段：沿用 nsfw store 异步探测过滤；年代浏览（v0 数据）自带 nsfw 直接过滤
const visibleTop = computed(() => (settings.hideNsfw ? top.value.filter((x) => !nsfw.isNsfw(x.id)) : top.value))

onMounted(load)

async function load() {
  hotLoading.value = true
  hotError.value = ''
  try {
    days.value = await dataSource.calendar()
  } catch (e) {
    hotError.value = e instanceof Error ? e.message : String(e)
  } finally {
    hotLoading.value = false
  }
}

/* ── v0.5 D1：按年代浏览（GET /v0/subjects，结果自带 nsfw 可直接过滤） ── */
const PAGE_SIZE = 24
const browseLoading = ref(false)
const browseError = ref('')
const browseLoaded = ref(false)
const browseItems = ref<SearchResultItem[]>([])
const browseTotal = ref(0)
const browsePage = ref(1)
const browseSort = ref<'date' | 'rank'>('date')
const currentYear = new Date().getFullYear()
const browseYear = ref<number | null>(currentYear)
const browseMonth = ref<number | null>(0)

// 从今年回溯到 1990 年；月度选「全年」
const yearOptions = Array.from({ length: currentYear - 1990 + 1 }, (_, i) => ({
  label: `${currentYear - i} 年`,
  value: currentYear - i,
}))
const monthOptions = [
  { label: '全年', value: 0 },
  ...Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1} 月`, value: i + 1 })),
]
const browseSortOptions = [
  { label: '按开播日期', value: 'date' },
  { label: '按排名', value: 'rank' },
]

async function loadBrowse(p = 1) {
  if (!browseYear.value) return
  browsePage.value = p
  browseLoading.value = true
  browseError.value = ''
  try {
    const res = await dataSource.browseSubjects({
      year: browseYear.value,
      month: browseMonth.value || undefined,
      sort: browseSort.value,
      limit: PAGE_SIZE,
      offset: (p - 1) * PAGE_SIZE,
    })
    browseItems.value = res.data ?? []
    browseTotal.value = res.total ?? 0
    browseLoaded.value = true
  } catch (e) {
    browseError.value = e instanceof Error ? e.message : String(e)
    browseItems.value = []
    browseTotal.value = 0
  } finally {
    browseLoading.value = false
  }
}

const visibleBrowse = computed(() =>
  settings.hideNsfw ? browseItems.value.filter((x) => !x.nsfw) : browseItems.value,
)

// 切到年代 Tab 时首次加载；条件变化自动重搜；数据源切换（演示/在线）后强制重载
watch(activeTab, (t) => {
  if (t === 'era' && !browseLoaded.value) void loadBrowse(1)
})
watch(
  () => settings.isDemo,
  () => {
    browseLoaded.value = false
    if (activeTab.value === 'era') void loadBrowse(1)
  },
)
watch([browseYear, browseMonth, browseSort], () => {
  if (browseYear.value) void loadBrowse(1)
})

/* ── v0.5 D5：目录片单（v0 API 无目录列表端点，按 ID/链接查看） ── */
const indexInput = ref('')

/** 支持粘贴 bgm.tv 目录链接或纯数字 ID，提取目录 ID */
function parseIndexId(input: string): number | null {
  const s = input.trim()
  if (!s) return null
  const m = s.match(/index\/(\d+)/) || s.match(/^#?\/?index\/(\d+)/)
  if (m) return Number(m[1])
  return /^\d+$/.test(s) ? Number(s) : null
}

function openIndex() {
  const id = parseIndexId(indexInput.value)
  if (!id) return
  router.push({ name: 'index-detail', params: { id: String(id) } })
}

function open(id: number) {
  router.push({ name: 'subject', params: { id: String(id) } })
}
</script>

<template>
  <div>
    <div class="page-head">
      <h2><NIcon :component="CompassOutline" />发现</h2>
      <span class="page-sub">热门在播 · 按年代回顾历史番剧 · 目录片单</span>
    </div>

    <NTabs v-model:value="activeTab" type="line" animated>
      <NTabPane name="hot" tab="热门在播">
        <div class="head-row">
          <span class="page-sub">正在播出的番剧中人气最高的作品（Top 30）</span>
          <div class="head-tools">
            <NSelect v-model:value="sortBy" :options="sortOptions" size="small" style="width: 170px" />
            <NButton quaternary size="small" :disabled="hotLoading" @click="load">↻ 刷新</NButton>
          </div>
        </div>

        <NSpin :show="hotLoading">
          <NAlert v-if="hotError" type="error" title="加载失败" closable style="margin-bottom: 12px">
            {{ hotError }} —— 请检查网络/代理，或在「设置」中修改 API 地址、切换演示数据模式。
          </NAlert>
          <EmptyHint v-else-if="!visibleTop.length" text="暂无在播数据" />
          <div v-else class="card-grid">
            <AnimeCard
              v-for="it in visibleTop"
              :key="it.id"
              :id="it.id"
              :title="it.name_cn || it.name"
              :original="it.name"
              :poster="coverCardUrl(it.images, settings.imageQuality)"
              :score="it.rating?.score"
              :extra="`${(it.collection?.doing ?? 0).toLocaleString()} 人在追`"
              :in-library="library.has(it.id)"
              @open="open"
            />
          </div>
        </NSpin>
      </NTabPane>

      <NTabPane name="era" tab="按年代浏览">
        <div class="era-bar">
          <NSelect v-model:value="browseYear" :options="yearOptions" size="small" style="width: 120px" />
          <NSelect v-model:value="browseMonth" :options="monthOptions" size="small" style="width: 110px" />
          <NSelect v-model:value="browseSort" :options="browseSortOptions" size="small" style="width: 140px" />
        </div>

        <NSpin :show="browseLoading">
          <NAlert v-if="browseError" type="error" title="加载失败" closable style="margin-bottom: 12px">
            {{ browseError }} —— 请检查网络/代理，或在「设置」中修改 API 地址、切换演示数据模式。
          </NAlert>
          <EmptyHint v-else-if="browseLoaded && !browseItems.length" text="该年代没有收录的动画条目" />
          <div v-else-if="browseItems.length" class="card-grid">
            <AnimeCard
              v-for="it in visibleBrowse"
              :key="it.id"
              :id="it.id"
              :title="it.name_cn || it.name"
              :original="it.name"
              :poster="coverCardUrl(it.images, settings.imageQuality)"
              :score="it.rating?.score"
              :extra="it.date ? `开播 ${it.date}` : ''"
              :in-library="library.has(it.id)"
              @open="open"
            />
          </div>
        </NSpin>

        <div v-if="browseTotal > PAGE_SIZE" class="pager">
          <NPagination
            :page="browsePage"
            :item-count="browseTotal"
            :page-size="PAGE_SIZE"
            @update:page="(p: number) => loadBrowse(p)"
          />
          <span class="total-hint">共 {{ browseTotal }} 条</span>
        </div>
      </NTabPane>

      <NTabPane name="index" tab="目录片单">
        <div class="index-intro">
          <p>
            目录是 Bangumi 用户整理的主题片单。官方 v0 接口暂未提供目录列表，
            在 bgm.tv 找到感兴趣的目录后，把<strong>链接或目录 ID</strong> 粘贴到这里，即可在应用内浏览目录条目并直接加追。
          </p>
          <div class="index-input-row">
            <NInput
              v-model:value="indexInput"
              size="large"
              clearable
              placeholder="如：https://bgm.tv/index/9 或直接输入 9"
              @keyup.enter="openIndex"
            />
            <NButton type="primary" size="large" @click="openIndex">查看目录</NButton>
          </div>
          <div class="index-example">
            示例：
            <NButton size="tiny" quaternary type="primary" @click="indexInput = '9'">腐向小清新（目录 9）</NButton>
          </div>
        </div>
      </NTabPane>
    </NTabs>
  </div>
</template>

<style scoped>
.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
  /* v0.10 P4：小屏允许换行 */
  flex-wrap: wrap;
}

.head-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.era-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
  /* v0.10 P4：小屏允许换行 */
  flex-wrap: wrap;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 18px 0 8px;
}

.total-hint {
  font-size: 12px;
  opacity: 0.55;
}

.index-intro p {
  margin: 4px 0 14px;
  line-height: 1.8;
  opacity: 0.75;
  max-width: 720px;
}

.index-input-row {
  display: flex;
  gap: 10px;
  max-width: 560px;
}

.index-example {
  margin-top: 10px;
  font-size: 12px;
  opacity: 0.6;
}
</style>
