<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NIcon, NTag } from 'naive-ui'
import { HomeOutline, PlayOutline } from '@vicons/ionicons5'
import { dataSource } from '../api/dataSource'
import { useNsfwStore } from '../stores/nsfw'
import { useSettingsStore } from '../stores/settings'
import { useLibraryStore } from '../stores/library'
import type { WatchStatus } from '../stores/library'
import type { CalendarDay, CalendarSubject } from '../types/bangumi'
import { coverCardUrl } from '../utils/image'
import PosterImage from '../components/PosterImage.vue'
import EmptyHint from '../components/EmptyHint.vue'

/**
 * H1 今日仪表盘（v0.9，新默认首页）：
 * ① 今日更新 = 周历 ∩ 追番库（复用 legacy /calendar 5min TTL 缓存，零新增请求）；
 * ② 继续观看 = 在看且未看完条目（纯本地数据）；
 * ③ 追番概览 = 本地统计。今日无更新时自动展开本周分组视图。
 */
const router = useRouter()
const nsfw = useNsfwStore()
const settings = useSettingsStore()
const library = useLibraryStore()

const days = ref<CalendarDay[]>([])
const loading = ref(true)
const error = ref('')

const todayId = computed(() => {
  const d = new Date().getDay()
  return d === 0 ? 7 : d
})
const todayText = computed(() => {
  const now = new Date()
  const wd = ['', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'][now.getDay() || 7]
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} · ${wd}`
})

interface TrackedItem {
  cal: CalendarSubject
  status: WatchStatus
  progress: number
  epsTotal: number
  myRate?: number
  addedAt: number
  dirtyAt?: number
}

/** 周历条目 → 追番库条目连接（按 subjectId）；返回 null 表示未加追 */
function joinEntry(cal: CalendarSubject): TrackedItem | null {
  const e = library.entry(cal.id)
  if (!e) return null
  return {
    cal,
    status: e.status,
    progress: e.progress,
    epsTotal: e.epsTotal,
    myRate: e.myRate,
    addedAt: e.addedAt,
    dirtyAt: e.dirtyAt,
  }
}

/** R18 过滤后的追番库命中条目 */
function visibleMatches(items: CalendarSubject[]): TrackedItem[] {
  const list = items.map(joinEntry).filter((x): x is TrackedItem => x !== null)
  return settings.hideNsfw ? list.filter((x) => !nsfw.isNsfw(x.cal.id)) : list
}

const STATUS_ORDER: Record<WatchStatus, number> = { doing: 0, wish: 1, done: 2 }
const STATUS_LABEL: Record<WatchStatus, string> = { wish: '想看', doing: '在看', done: '看完' }

const todayItems = computed(() =>
  visibleMatches(days.value.find((d) => d.weekday.id === todayId.value)?.items ?? []).sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.addedAt - a.addedAt,
  ),
)

/** 本周各天的追番命中（今日为空时展示） */
const weekGroups = computed(() =>
  [...days.value]
    .sort((a, b) => a.weekday.id - b.weekday.id)
    .map((d) => ({ id: d.weekday.id, cn: d.weekday.cn.replace('星期', '周'), items: visibleMatches(d.items) }))
    .filter((g) => g.items.length),
)

/** 继续观看：在看且未看完，按最近操作时间倒序 */
const continueItems = computed(() =>
  library.list
    .filter((e) => e.status === 'doing' && (e.epsTotal > 0 ? e.progress < e.epsTotal : true))
    .sort((a, b) => (b.dirtyAt ?? b.addedAt) - (a.dirtyAt ?? a.addedAt))
    .slice(0, 8),
)

/** 追番概览（纯本地统计） */
const stats = computed(() => {
  const list = library.list
  const byStatus = { wish: 0, doing: 0, done: 0 } as Record<WatchStatus, number>
  let watchedEps = 0
  let ratedCount = 0
  let rateSum = 0
  for (const e of list) {
    byStatus[e.status]++
    watchedEps += e.watchedEps?.length ?? e.progress ?? 0
    if (e.myRate && e.myRate > 0) {
      ratedCount++
      rateSum += e.myRate
    }
  }
  const weekCount = weekGroups.value.reduce((n, g) => n + g.items.length, 0)
  return {
    ...byStatus,
    watchedEps,
    ratedCount,
    rateAvg: ratedCount ? (rateSum / ratedCount).toFixed(1) : '—',
    weekCount,
  }
})

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    days.value = [...(await dataSource.calendar(true))].sort((a, b) => a.weekday.id - b.weekday.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

// 今日 + 本周命中的条目做 nsfw 预探测（设置开启时）
watch(
  [days, () => settings.hideNsfw],
  ([d, hide]) => {
    if (!hide || !d.length) return
    void nsfw.ensure(d.flatMap((x) => x.items.map((i) => i.id)))
  },
  { immediate: true },
)

function nextEpText(item: TrackedItem): string {
  if (item.epsTotal > 0 && item.progress >= item.epsTotal) return '已看完本季'
  if (item.progress <= 0) return item.epsTotal > 0 ? `更新 ${item.epsTotal} 话` : '尚未开始观看'
  return `看到第 ${item.progress} 话 · 下一话 第 ${item.progress + 1} 话`
}

function open(id: number) {
  router.push({ name: 'subject', params: { id: String(id) } })
}

function continueWatch(id: number) {
  router.push({ name: 'subject', params: { id: String(id) }, query: { tab: 'eps' } })
}
</script>

<template>
  <div>
    <div class="page-head">
      <h2><NIcon :component="HomeOutline" />今日</h2>
      <div class="head-row">
        <span class="page-sub">{{ todayText }} · 你的追番更新与观看进度</span>
        <NButton quaternary size="small" :disabled="loading" @click="load">↻ 刷新</NButton>
      </div>
    </div>

    <NAlert v-if="error" type="error" title="加载失败" closable style="margin-bottom: 12px">
      {{ error }} —— 请检查网络/代理，或在「设置」中修改 API 地址、切换演示数据模式。
    </NAlert>

    <!-- ① 追番概览（纯本地，不依赖周历加载结果） -->
    <section class="stat-grid">
      <div class="stat-card"><div class="stat-num">{{ stats.doing }}</div><div class="stat-label">在看</div></div>
      <div class="stat-card"><div class="stat-num">{{ stats.wish }}</div><div class="stat-label">想看</div></div>
      <div class="stat-card"><div class="stat-num">{{ stats.done }}</div><div class="stat-label">看完</div></div>
      <div class="stat-card"><div class="stat-num">{{ stats.watchedEps }}</div><div class="stat-label">累计观看话数</div></div>
      <div class="stat-card"><div class="stat-num">{{ stats.rateAvg }}</div><div class="stat-label">我的均分（{{ stats.ratedCount }} 部）</div></div>
      <div class="stat-card"><div class="stat-num">{{ stats.weekCount }}</div><div class="stat-label">本周更新部数</div></div>
    </section>

    <!-- ② 今日更新：周历 ∩ 追番库 -->
    <section class="today-section">
      <h3 class="section-title">
        今日更新
        <NTag v-if="todayItems.length" size="tiny" :bordered="false" round>{{ todayItems.length }}</NTag>
      </h3>
      <template v-if="todayItems.length">
        <div v-for="it in todayItems" :key="it.cal.id" class="today-row" @click="open(it.cal.id)">
          <div class="row-poster">
            <PosterImage :src="coverCardUrl(it.cal.images, settings.imageQuality)" :title="it.cal.name_cn || it.cal.name" :subject-id="it.cal.id" />
          </div>
          <div class="row-info">
            <div class="row-title">
              {{ it.cal.name_cn || it.cal.name }}
              <NTag size="tiny" :type="it.status === 'doing' ? 'success' : it.status === 'wish' ? 'info' : 'default'" :bordered="false">
                {{ STATUS_LABEL[it.status] }}
              </NTag>
              <NTag v-if="it.myRate && it.myRate > 0" size="tiny" type="warning" :bordered="false" round>我的 ★{{ it.myRate }}</NTag>
            </div>
            <div class="row-sub">
              进度 {{ it.progress }}{{ it.epsTotal > 0 ? ` / ${it.epsTotal}` : '' }} 话 · {{ nextEpText(it) }}
            </div>
          </div>
          <span class="row-arrow">›</span>
        </div>
      </template>
      <EmptyHint v-else-if="!loading" text="今天没有追番更新" sub="看看本周其他日子 ↓" />

      <!-- 今日为空时展开本周分组 -->
      <template v-if="!todayItems.length && weekGroups.length">
        <div v-for="g in weekGroups" :key="g.id" class="week-group">
          <div class="week-day">
            {{ g.cn }}
            <NTag v-if="g.id === todayId" size="tiny" type="primary" :bordered="false" round>今天</NTag>
          </div>
          <div class="week-items">
            <span v-for="it in g.items" :key="it.cal.id" class="week-item" @click="open(it.cal.id)">
              {{ it.cal.name_cn || it.cal.name }}
              <em>{{ STATUS_LABEL[it.status] }}</em>
            </span>
          </div>
        </div>
      </template>
    </section>

    <!-- ③ 继续观看：在看且未看完（纯本地，不依赖周历） -->
    <section v-if="continueItems.length" class="today-section">
      <h3 class="section-title">继续观看</h3>
        <div v-for="e in continueItems" :key="e.subjectId" class="today-row compact" @click="open(e.subjectId)">
          <div class="row-info">
            <div class="row-title">{{ e.nameCn || e.name }}</div>
            <div class="row-sub">
              {{ e.progress > 0 ? `上次看到第 ${e.progress}${e.epsTotal > 0 ? ` / ${e.epsTotal}` : ''} 话` : '尚未开始观看' }}
            </div>
          </div>
          <NButton size="tiny" type="primary" secondary @click.stop="continueWatch(e.subjectId)"><span class="btn-icon-row"><NIcon :component="PlayOutline" size="12" />继续</span></NButton>
        </div>
    </section>

    <EmptyHint v-if="!library.count && !loading" text="追番库还是空的">
      去 <a @click="router.push({ name: 'search' })">搜索</a> 或
      <a @click="router.push({ name: 'discover' })">发现</a> 页把感兴趣的番加进来吧。
    </EmptyHint>
  </div>
</template>

<style scoped>
.btn-icon-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  /* v0.10 P4：小屏允许换行 */
  flex-wrap: wrap;
}

/* 追番概览统计 */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 12px;
  margin-bottom: 22px;
}

.stat-card {
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(128, 128, 128, 0.18);
  background: rgba(128, 128, 128, 0.06);
}

.stat-num {
  font-size: 24px;
  font-weight: 700;
}

.stat-label {
  font-size: 12px;
  opacity: 0.6;
  margin-top: 2px;
}

.today-section {
  margin-bottom: 26px;
}

.section-title {
  font-size: 16px;
  margin: 0 0 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.today-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(128, 128, 128, 0.18);
  margin-bottom: 10px;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.today-row:hover {
  transform: translateY(-2px);
  border-color: rgba(138, 123, 255, 0.55);
}

.today-row.compact {
  padding: 10px 14px;
}

.row-poster {
  width: 56px;
  flex-shrink: 0;
}

.row-info {
  flex: 1;
  min-width: 0;
}

.row-title {
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.row-sub {
  font-size: 12px;
  opacity: 0.6;
  margin-top: 3px;
}

.row-arrow {
  font-size: 22px;
  opacity: 0.35;
}

.week-group {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 4px;
  border-bottom: 1px dashed rgba(128, 128, 128, 0.2);
}

.week-day {
  font-size: 13px;
  font-weight: 700;
  width: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.week-items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}

.week-item {
  font-size: 13px;
  cursor: pointer;
}

.week-item:hover {
  color: #8a7bff;
}

.week-item em {
  font-style: normal;
  font-size: 11px;
  opacity: 0.5;
  margin-left: 4px;
}
</style>
