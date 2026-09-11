<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import {
  NButton,
  NIcon,
  NInput,
  NInputNumber,
  NPagination,
  NSelect,
  NSpin,
  NTag,
} from 'naive-ui'
import { SearchOutline, FilterOutline, DiamondOutline } from '@vicons/ionicons5'
import { dataSource } from '../api/dataSource'
import EmptyHint from '../components/EmptyHint.vue'
import type { SearchAdvanced } from '../api/bangumi'
import { useSettingsStore } from '../stores/settings'
import { charAvatarUrl, coverCardUrl } from '../utils/image'
import { loadJson, saveJson } from '../utils/storage'
import type { CharacterSearchItem, PersonSearchItem, SearchResultItem } from '../types/bangumi'
import AnimeCard from '../components/AnimeCard.vue'
import PosterImage from '../components/PosterImage.vue'

const router = useRouter()
const route = useRoute()
const message = useMessage()
const settings = useSettingsStore()

/** 预设标签分组 */
const TAG_GROUPS: { label: string; tags: string[] }[] = [
  { label: '题材', tags: ['热血', '科幻', '奇幻', '悬疑', '推理', '冒险', '机战', '运动', '音乐', '美食', '校园'] },
  { label: '情感', tags: ['恋爱', '搞笑', '治愈', '催泪', '日常', '治愈系'] },
  { label: '来源', tags: ['原创', '漫画改', '小说改', '游戏改'] },
]
const ALL_PRESET_TAGS = TAG_GROUPS.flatMap((g) => g.tags)

const SORT_OPTIONS = [
  { label: '相关度排序', value: 'match' },
  { label: '热度排序', value: 'heat' },
  { label: '排名排序', value: 'rank' },
  { label: '评分排序', value: 'score' },
]
type TagState = 'off' | 'include' | 'exclude'
type SearchTarget = 'subject' | 'character' | 'person'
const PAGE_SIZE = 24
const HISTORY_KEY = 'animeviewer:search:history'
const CUSTOM_TAGS_KEY = 'animeviewer:search:customTags'

const TARGET_OPTIONS = [
  { label: '条目', value: 'subject' },
  { label: '角色', value: 'character' },
  { label: '人物', value: 'person' },
]

const target = ref<SearchTarget>('subject')
const keyword = ref('')
const tagStates = ref<Record<string, TagState>>({})
const customTags = ref<string[]>(loadJson<string[]>(CUSTOM_TAGS_KEY, []))
const sortBy = ref('match')
const results = ref<SearchResultItem[]>([])
const characterResults = ref<CharacterSearchItem[]>([])
const personResults = ref<PersonSearchItem[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const searched = ref(false)
const newTag = ref('')
const history = ref(loadJson<{ k: string; t: string[]; x: string[]; ts: number }[]>(HISTORY_KEY, []))

/* ── v0.5 D3：高级筛选（air_date / rating / rating_count / rank） ── */
const showAdvanced = ref(false)
const advFromYear = ref<number | null>(null)
const advToYear = ref<number | null>(null)
const ratingMin = ref<number | null>(null)
const ratingMax = ref<number | null>(null)
const ratingCountMin = ref<number | null>(null)
const rankMax = ref<number | null>(null)

const currentYear = new Date().getFullYear()
const ADV_YEAR_OPTIONS = [
  { label: '不限', value: 0 },
  ...Array.from({ length: currentYear - 1989 }, (_, i) => ({
    label: `${currentYear - i} 年`,
    value: currentYear - i,
  })),
]
const RATING_OPTIONS = [
  { label: '不限', value: 0 },
  ...[6, 6.5, 7, 7.5, 8, 8.5, 9].map((v) => ({ label: `${v} 分+`, value: v })),
]

const selectedTags = computed(() => Object.entries(tagStates.value).filter(([, s]) => s === 'include').map(([t]) => t))
const excludedTags = computed(() => Object.entries(tagStates.value).filter(([, s]) => s === 'exclude').map(([t]) => t))

const advanced = computed<SearchAdvanced | undefined>(() => {
  const adv: SearchAdvanced = {}
  if (advFromYear.value) adv.airDateFrom = `${advFromYear.value}-01-01`
  // airDateTo 为「不含」语义（服务端不支持 air_date 的 <=）：选 2024 年 → <2025-01-01
  if (advToYear.value) adv.airDateTo = `${advToYear.value + 1}-01-01`
  if (ratingMin.value) adv.ratingMin = ratingMin.value
  if (ratingMax.value) adv.ratingMax = ratingMax.value
  if (ratingCountMin.value) adv.ratingCountMin = ratingCountMin.value
  if (rankMax.value) adv.rankMax = rankMax.value
  return Object.keys(adv).length ? adv : undefined
})

const advancedCount = computed(() => (advanced.value ? Object.keys(advanced.value).length : 0))
const hasCondition = computed(
  () =>
    keyword.value.trim().length > 0 ||
    selectedTags.value.length > 0 ||
    excludedTags.value.length > 0 ||
    advancedCount.value > 0,
)

/** 「小众佳作」预设：实测可用的组合（评分人数 200~3000 且 排名前 800）；预设本身即搜索条件，无条件也触发搜索 */
function applyNichePreset() {
  ratingCountMin.value = 200
  rankMax.value = 800
  showAdvanced.value = true
  void doSearch(1)
}

function clearAdvanced() {
  advFromYear.value = null
  advToYear.value = null
  ratingMin.value = null
  ratingMax.value = null
  ratingCountMin.value = null
  rankMax.value = null
  if (hasCondition.value) void doSearch(1)
}

/** 自定义标签（不在预设里的历史勾选/输入） */
const extraTagPool = computed(() => customTags.value.filter((t) => !ALL_PRESET_TAGS.includes(t)))

function tagState(t: string): TagState {
  return tagStates.value[t] ?? 'off'
}

/** 点击循环：未选 → 含 → 排除 → 未选；自定义标签首次使用时记录进本地池 */
function cycleTag(t: string) {
  const cur = tagState(t)
  const next: TagState = cur === 'off' ? 'include' : cur === 'include' ? 'exclude' : 'off'
  if (next === 'off') delete tagStates.value[t]
  else tagStates.value[t] = next
  if (next !== 'off' && !ALL_PRESET_TAGS.includes(t) && !customTags.value.includes(t)) {
    customTags.value = [...customTags.value, t]
    saveJson(CUSTOM_TAGS_KEY, customTags.value)
  }
  if (hasCondition.value) void doSearch(1)
}

function addCustomTag() {
  const t = newTag.value.trim()
  if (!t) return
  newTag.value = ''
  if (tagState(t) === 'off') {
    cycleTag(t) // → 包含态，内部已触发搜索
  } else {
    void doSearch(1) // 已在池中且带状态，直接重搜
  }
}

function tagDisplay(t: string): string {
  const s = tagState(t)
  return s === 'exclude' ? `-${t}` : t
}

function persistHistory(entry: { k: string; t: string[]; x: string[] }) {
  if (!entry.k && !entry.t.length && !entry.x.length) return
  history.value = [
    { ...entry, ts: Date.now() },
    ...history.value.filter((h) => !(h.k === entry.k && h.t.join() === entry.t.join() && h.x.join() === entry.x.join())),
  ].slice(0, 10)
  saveJson(HISTORY_KEY, history.value)
}

function removeHistory(ts: number) {
  history.value = history.value.filter((h) => h.ts !== ts)
  saveJson(HISTORY_KEY, history.value)
}

function clearHistory() {
  history.value = []
  saveJson(HISTORY_KEY, [])
}

function restoreHistory(h: { k: string; t: string[]; x: string[] }) {
  // 历史条目仅记录 关键词+标签 组合：恢复时回到条目搜索并清空高级筛选
  target.value = 'subject'
  keyword.value = h.k
  clearAdvancedSilently()
  const states: Record<string, TagState> = {}
  h.t.forEach((t) => (states[t] = 'include'))
  h.x.forEach((t) => {
    states[t] = 'exclude'
    if (!ALL_PRESET_TAGS.includes(t) && !customTags.value.includes(t)) customTags.value = [...customTags.value, t]
  })
  tagStates.value = states
  void doSearch(1)
}

function clearAdvancedSilently() {
  advFromYear.value = null
  advToYear.value = null
  ratingMin.value = null
  ratingMax.value = null
  ratingCountMin.value = null
  rankMax.value = null
}

async function doSearch(p = 1) {
  if (!hasCondition.value) {
    message.warning('请输入关键词或选择筛选条件')
    return
  }
  page.value = p
  loading.value = true
  searched.value = true
  const kw = keyword.value.trim()
  try {
    if (target.value === 'subject') {
      const res = await dataSource.search(kw, selectedTags.value, sortBy.value, PAGE_SIZE, (p - 1) * PAGE_SIZE, advanced.value)
      // 服务端不支持排除标签（v0.4 实测 -前缀返回 0 条；v0.5 复测 tag/meta_tags 过滤服务端整体不可用），
      // 排除在本页结果上客户端过滤
      if (excludedTags.value.length) {
        results.value = res.data.filter(
          (it) => !(it.tags ?? []).some((t) => excludedTags.value.includes(t.name)),
        )
      } else {
        results.value = res.data
      }
      total.value = res.total
      persistHistory({ k: kw, t: selectedTags.value, x: excludedTags.value })
    } else if (target.value === 'character') {
      const res = await dataSource.searchCharacters(kw, PAGE_SIZE, (p - 1) * PAGE_SIZE)
      characterResults.value = res.data ?? []
      total.value = res.total ?? 0
    } else {
      const res = await dataSource.searchPersons(kw, PAGE_SIZE, (p - 1) * PAGE_SIZE)
      personResults.value = res.data ?? []
      total.value = res.total ?? 0
    }
    if (!total.value) message.info('没有找到匹配的结果')
  } catch (e) {
    message.error(e instanceof Error ? `搜索失败：${e.message}` : '搜索失败')
    results.value = []
    characterResults.value = []
    personResults.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

// 切换搜索目标后清空结果，避免混用旧数据
watch(target, () => {
  searched.value = false
  results.value = []
  characterResults.value = []
  personResults.value = []
  total.value = 0
  page.value = 1
})

// A1 标签联动：详情页点标签 → /search?tag=xxx 自动选中并搜索
function applyRouteTag() {
  const tag = route.query.tag
  if (typeof tag === 'string' && tag.trim()) {
    target.value = 'subject'
    tagStates.value = { [tag.trim()]: 'include' }
    void doSearch(1)
  }
}
onMounted(applyRouteTag)
watch(() => route.query.tag, applyRouteTag)
// 切换排序后自动重搜（仅在条目搜索且已有搜索条件时）
watch(sortBy, () => {
  if (target.value === 'subject' && hasCondition.value) void doSearch(1)
})

function open(id: number) {
  router.push({ name: 'subject', params: { id: String(id) } })
}

/** E3：角色/人物点击进入应用内详情页（v0.6 起） */
function openCharacter(id: number) {
  router.push({ name: 'character', params: { id: String(id) } })
}

function openPerson(id: number) {
  router.push({ name: 'person', params: { id: String(id) } })
}

function characterAvatar(images: CharacterSearchItem['images']): string {
  return charAvatarUrl(images, settings.imageQuality)
}
</script>

<template>
  <div>
    <div class="page-head">
      <h2><NIcon :component="SearchOutline" />搜索</h2>
      <span class="page-sub">条目（关键词 + 标签 + 高级筛选）／ 角色 ／ 人物</span>
    </div>

    <div class="search-bar">
      <NSelect v-model:value="target" :options="TARGET_OPTIONS" size="large" style="width: 110px" />
      <NInput
        v-model:value="keyword"
        :placeholder="target === 'subject' ? '输入动漫名称，回车搜索' : target === 'character' ? '输入角色名，回车搜索' : '输入声优 / 制作人员名，回车搜索'"
        clearable
        size="large"
        @keyup.enter="doSearch(1)"
      />
      <NSelect v-if="target === 'subject'" v-model:value="sortBy" :options="SORT_OPTIONS" size="large" style="width: 150px" />
      <NButton type="primary" size="large" :loading="loading" @click="doSearch(1)">搜索</NButton>
    </div>

    <template v-if="target === 'subject'">
      <div class="advanced-head">
        <NButton size="small" secondary :type="showAdvanced ? 'primary' : 'default'" @click="showAdvanced = !showAdvanced">
          <span class="btn-icon-row"><NIcon :component="FilterOutline" size="14" />高级筛选<template v-if="advancedCount">（{{ advancedCount }}）</template></span>
        </NButton>
        <NButton size="small" quaternary type="primary" title="评分人数 200~3000 且 排名前 800" @click="applyNichePreset">
          <span class="btn-icon-row"><NIcon :component="DiamondOutline" size="14" />小众佳作</span>
        </NButton>
        <NButton v-if="advancedCount" size="small" quaternary @click="clearAdvanced">清空筛选</NButton>
      </div>

      <div v-if="showAdvanced" class="advanced-panel">
        <div class="adv-row">
          <span class="adv-label">年代</span>
          <NSelect v-model:value="advFromYear" :options="ADV_YEAR_OPTIONS" size="small" style="width: 120px" placeholder="起始" />
          <span class="adv-sep">→</span>
          <NSelect v-model:value="advToYear" :options="ADV_YEAR_OPTIONS" size="small" style="width: 120px" placeholder="结束" />
        </div>
        <div class="adv-row">
          <span class="adv-label">评分</span>
          <NSelect v-model:value="ratingMin" :options="RATING_OPTIONS" size="small" style="width: 120px" placeholder="不限" />
          <span class="adv-sep">~</span>
          <NInputNumber v-model:value="ratingMax" size="small" :min="0" :max="10" :step="0.5" style="width: 120px" placeholder="上限" clearable />
        </div>
        <div class="adv-row">
          <span class="adv-label">热度</span>
          <span class="adv-field-label">评分人数 ≥</span>
          <NInputNumber v-model:value="ratingCountMin" size="small" :min="0" :step="100" style="width: 130px" placeholder="不限" clearable />
          <span class="adv-field-label">排名 ≤</span>
          <NInputNumber v-model:value="rankMax" size="small" :min="1" :step="50" style="width: 130px" placeholder="不限" clearable />
        </div>
      </div>

      <div v-if="history.length" class="history-bar">
        <span class="bar-label">最近：</span>
        <NTag
          v-for="h in history"
          :key="h.ts"
          size="small"
          round
          :bordered="false"
          closable
          @click="restoreHistory(h)"
          @close="removeHistory(h.ts)"
        >
          {{ h.k || h.t.join('＋') || h.x.map((x) => '-' + x).join('') }}
        </NTag>
        <NButton size="tiny" quaternary @click="clearHistory">清空</NButton>
      </div>

      <div class="tag-bar">
        <span class="bar-label">标签（点选包含，再点排除，三点取消）：</span>
      </div>
      <div v-for="g in TAG_GROUPS" :key="g.label" class="tag-group">
        <span class="tag-group-label">{{ g.label }}</span>
        <NTag
          v-for="t in g.tags"
          :key="t"
          size="medium"
          round
          :type="tagState(t) === 'include' ? 'primary' : tagState(t) === 'exclude' ? 'error' : 'default'"
          :ghost="tagState(t) === 'off'"
          :bordered="tagState(t) !== 'include'"
          class="tag-chip"
          @click="cycleTag(t)"
        >
          {{ tagDisplay(t) }}
        </NTag>
      </div>
      <div v-if="extraTagPool.length" class="tag-group">
        <span class="tag-group-label">自定义</span>
        <NTag
          v-for="t in extraTagPool"
          :key="t"
          size="medium"
          round
          :type="tagState(t) === 'include' ? 'primary' : tagState(t) === 'exclude' ? 'error' : 'default'"
          :ghost="tagState(t) === 'off'"
          :bordered="tagState(t) !== 'include'"
          class="tag-chip"
          @click="cycleTag(t)"
        >
          {{ tagDisplay(t) }}
        </NTag>
      </div>
      <div class="tag-group">
        <span class="tag-group-label">添加</span>
        <NInput
          v-model:value="newTag"
          size="small"
          placeholder="输入任意标签回车搜索（如：Key、泡面番）"
          style="width: 280px"
          @keyup.enter="addCustomTag"
        />
      </div>
    </template>

    <div v-if="searched && hasCondition" class="result-meta">
      共 {{ total }} 条结果 · 第 {{ page }} 页 / 每页 {{ 24 }}
      <span v-if="target === 'subject' && settings.hideNsfw"> · 已排除 R18（R18 过滤会使数量少于站点总数）</span>
      <span v-if="target === 'subject' && advancedCount"> · 高级筛选 {{ advancedCount }} 项生效</span>
    </div>

    <NSpin :show="loading">
      <!-- 条目结果 -->
      <template v-if="target === 'subject'">
        <EmptyHint v-if="searched && !results.length && !loading" text="没有找到匹配的动漫" />
        <div v-else-if="results.length" class="card-grid">
          <AnimeCard
            v-for="it in results"
            :key="it.id"
            :id="it.id"
            :title="it.name_cn || it.name"
            :original="it.name"
            :poster="coverCardUrl(it.images, settings.imageQuality)"
            :score="it.rating?.score"
            :extra="it.date ? `开播 ${it.date}` : ''"
            @open="open"
          />
        </div>
      </template>

      <!-- 角色结果 -->
      <template v-else-if="target === 'character'">
        <EmptyHint v-if="searched && !characterResults.length && !loading" text="没有找到匹配的角色" />
        <div v-else class="people-grid">
          <div
            v-for="c in characterResults"
            :key="c.id"
            class="people-card"
            :title="`查看角色「${c.name_cn || c.name}」`"
            @click="openCharacter(c.id)"
          >
            <PosterImage :src="characterAvatar(c.images)" :title="c.name_cn || c.name" :subject-id="c.id" />
            <div class="people-name" :title="c.name_cn || c.name">{{ c.name_cn || c.name }}</div>
            <div v-if="c.name_cn" class="people-sub" :title="c.name">{{ c.name }}</div>
          </div>
        </div>
      </template>

      <!-- 人物结果 -->
      <template v-else>
        <EmptyHint v-if="searched && !personResults.length && !loading" text="没有找到匹配的人物" />
        <div v-else class="people-grid">
          <div
            v-for="p in personResults"
            :key="p.id"
            class="people-card"
            :title="`查看人物「${p.name_cn || p.name}」`"
            @click="openPerson(p.id)"
          >
            <PosterImage :src="characterAvatar(p.images)" :title="p.name_cn || p.name" :subject-id="p.id" />
            <div class="people-name" :title="p.name_cn || p.name">{{ p.name_cn || p.name }}</div>
            <div v-if="p.name_cn" class="people-sub" :title="p.name">{{ p.name }}</div>
          </div>
        </div>
      </template>
    </NSpin>

    <div v-if="total > PAGE_SIZE" class="pager">
      <NPagination :page="page" :item-count="total" :page-size="PAGE_SIZE" @update:page="doSearch" />
    </div>
  </div>
</template>

<style scoped>
.btn-icon-row {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.search-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
  /* v0.10 P4：小屏允许换行 */
  flex-wrap: wrap;
}

/* NInput 默认 width:100%，在 wrap 容器中会把每个控件挤成独立一行——
   改为弹性伸缩占满同行剩余空间，小屏放不下时才自然换行 */
.search-bar > .n-input {
  flex: 1 1 180px;
  width: auto;
  min-width: 0;
}

.advanced-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  /* v0.10 P4：小屏允许换行 */
  flex-wrap: wrap;
}

.advanced-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.08);
}

.adv-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.adv-label {
  font-size: 13px;
  opacity: 0.6;
  width: 34px;
  flex-shrink: 0;
}

.adv-sep {
  opacity: 0.45;
  font-size: 13px;
}

.adv-field-label {
  font-size: 12px;
  opacity: 0.55;
}

.history-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.08);
}

.bar-label {
  font-size: 13px;
  opacity: 0.65;
}

.tag-bar {
  margin-bottom: 6px;
}

.tag-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.tag-group-label {
  font-size: 12px;
  opacity: 0.5;
  width: 52px;
  flex-shrink: 0;
}

.tag-chip {
  cursor: pointer;
  user-select: none;
}

.result-meta {
  font-size: 12px;
  opacity: 0.6;
  margin: 10px 0 4px;
}

.people-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 16px 12px;
  padding-top: 6px;
}

.people-card {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  content-visibility: auto;
  contain-intrinsic-size: auto 210px;
}

.people-name {
  font-size: 13px;
  font-weight: 600;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.people-sub {
  font-size: 12px;
  opacity: 0.5;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pager {
  display: flex;
  justify-content: center;
  padding: 18px 0 8px;
}
</style>
