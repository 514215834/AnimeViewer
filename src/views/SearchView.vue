<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import {
  NButton,
  NEmpty,
  NInput,
  NPagination,
  NSelect,
  NSpin,
  NTag,
} from 'naive-ui'
import { dataSource } from '../api/dataSource'
import { useSettingsStore } from '../stores/settings'
import { coverCardUrl } from '../utils/image'
import { loadJson, saveJson } from '../utils/storage'
import type { SearchResultItem } from '../types/bangumi'
import AnimeCard from '../components/AnimeCard.vue'

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
const PAGE_SIZE = 24
const HISTORY_KEY = 'animeviewer:search:history'
const CUSTOM_TAGS_KEY = 'animeviewer:search:customTags'

const keyword = ref('')
const tagStates = ref<Record<string, TagState>>({})
const customTags = ref<string[]>(loadJson<string[]>(CUSTOM_TAGS_KEY, []))
const sortBy = ref('match')
const results = ref<SearchResultItem[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const searched = ref(false)
const newTag = ref('')
const history = ref(loadJson<{ k: string; t: string[]; x: string[]; ts: number }[]>(HISTORY_KEY, []))

const selectedTags = computed(() => Object.entries(tagStates.value).filter(([, s]) => s === 'include').map(([t]) => t))
const excludedTags = computed(() => Object.entries(tagStates.value).filter(([, s]) => s === 'exclude').map(([t]) => t))
const hasCondition = computed(() => keyword.value.trim().length > 0 || selectedTags.value.length > 0 || excludedTags.value.length > 0)

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
  keyword.value = h.k
  const states: Record<string, TagState> = {}
  h.t.forEach((t) => (states[t] = 'include'))
  h.x.forEach((t) => {
    states[t] = 'exclude'
    if (!ALL_PRESET_TAGS.includes(t) && !customTags.value.includes(t)) customTags.value = [...customTags.value, t]
  })
  tagStates.value = states
  void doSearch(1)
}

async function doSearch(p = 1) {
  if (!hasCondition.value) {
    message.warning('请输入关键词或选择类型标签')
    return
  }
  page.value = p
  loading.value = true
  searched.value = true
  try {
    const res = await dataSource.search(keyword.value.trim(), selectedTags.value, sortBy.value, PAGE_SIZE, (p - 1) * PAGE_SIZE)
    // 服务端不支持排除标签（-前缀实测返回 0 条），排除在本页结果上客户端过滤
    if (excludedTags.value.length) {
      results.value = res.data.filter(
        (it) => !(it.tags ?? []).some((t) => excludedTags.value.includes(t.name)),
      )
    } else {
      results.value = res.data
    }
    total.value = res.total
    persistHistory({ k: keyword.value.trim(), t: selectedTags.value, x: excludedTags.value })
    if (!res.data.length) message.info('没有找到匹配的结果')
  } catch (e) {
    message.error(e instanceof Error ? `搜索失败：${e.message}` : '搜索失败')
    results.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

// A1 标签联动：详情页点标签 → /search?tag=xxx 自动选中并搜索
function applyRouteTag() {
  const tag = route.query.tag
  if (typeof tag === 'string' && tag.trim()) {
    tagStates.value = { [tag.trim()]: 'include' }
    void doSearch(1)
  }
}
onMounted(applyRouteTag)
watch(() => route.query.tag, applyRouteTag)
// 切换排序后自动重搜（仅在已有搜索条件时）
watch(sortBy, () => {
  if (hasCondition.value) void doSearch(1)
})

function open(id: number) {
  router.push({ name: 'subject', params: { id: String(id) } })
}
</script>

<template>
  <div>
    <div class="page-head">
      <h2>🔍 搜索</h2>
      <span class="page-sub">关键词 + 标签组合筛选；标签支持「含 / 排除」两种状态</span>
    </div>

    <div class="search-bar">
      <NInput
        v-model:value="keyword"
        placeholder="输入动漫名称，回车搜索"
        clearable
        size="large"
        @keyup.enter="doSearch(1)"
      />
      <NSelect v-model:value="sortBy" :options="SORT_OPTIONS" size="large" style="width: 150px" />
      <NButton type="primary" size="large" :loading="loading" @click="doSearch(1)">搜索</NButton>
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

    <div v-if="searched && hasCondition" class="result-meta">
      共 {{ total }} 条结果 · 第 {{ page }} 页 / 每页 {{ 24 }}
      <span v-if="settings.hideNsfw"> · 已排除 R18（R18 过滤会使数量少于站点总数）</span>
    </div>

    <NSpin :show="loading">
      <div v-if="searched && !results.length && !loading" class="empty-hint">
        <NEmpty description="没有找到匹配的动漫" />
      </div>
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
    </NSpin>

    <div v-if="total > PAGE_SIZE" class="pager">
      <NPagination :page="page" :page-count="Math.ceil(total / PAGE_SIZE)" @update:page="doSearch" />
    </div>
  </div>
</template>

<style scoped>
.search-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
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

.pager {
  display: flex;
  justify-content: center;
  padding: 18px 0 8px;
}
</style>
