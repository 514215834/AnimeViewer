<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NSelect, NSpin } from 'naive-ui'
import { dataSource } from '../api/dataSource'
import { useNsfwStore } from '../stores/nsfw'
import { useSettingsStore } from '../stores/settings'
import { coverCardUrl } from '../utils/image'
import type { CalendarDay } from '../types/bangumi'
import AnimeCard from '../components/AnimeCard.vue'

const router = useRouter()
const nsfw = useNsfwStore()
const settings = useSettingsStore()

const days = ref<CalendarDay[]>([])
const loading = ref(true)
const error = ref('')
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

const visibleTop = computed(() => (settings.hideNsfw ? top.value.filter((x) => !nsfw.isNsfw(x.id)) : top.value))

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    days.value = await dataSource.calendar()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watch(
  [top, () => settings.hideNsfw],
  ([items, hide]) => {
    if (hide && items.length) void nsfw.ensure(items.map((x) => x.id))
  },
  { immediate: true },
)

function open(id: number) {
  router.push({ name: 'subject', params: { id: String(id) } })
}
</script>

<template>
  <div>
    <div class="page-head">
      <h2>🔥 热门在播</h2>
      <div class="head-row">
        <span class="page-sub">正在播出的番剧中人气最高的作品（Top 30）</span>
        <div class="head-tools">
          <NSelect v-model:value="sortBy" :options="sortOptions" size="small" style="width: 170px" />
          <NButton quaternary size="small" :disabled="loading" @click="load">↻ 刷新</NButton>
        </div>
      </div>
    </div>

    <NSpin :show="loading">
      <NAlert v-if="error" type="error" title="加载失败" closable style="margin-bottom: 12px">
        {{ error }} —— 请检查网络/代理，或在「设置」中修改 API 地址、切换演示数据模式。
      </NAlert>

      <div v-else-if="!visibleTop.length" class="empty-hint">暂无在播数据</div>
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
          @open="open"
        />
      </div>
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
