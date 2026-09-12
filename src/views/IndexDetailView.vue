<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NIcon, NPagination, NResult, NSpin, NTag } from 'naive-ui'
import { ListOutline } from '@vicons/ionicons5'
import { dataSource } from '../api/dataSource'
import { useSettingsStore } from '../stores/settings'
import { coverCardUrl } from '../utils/image'
import type { IndexInfo, IndexSubjectItem } from '../types/bangumi'
import AnimeCard from '../components/AnimeCard.vue'
import EmptyHint from '../components/EmptyHint.vue'

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()

const PAGE_SIZE = 30

const info = ref<IndexInfo | null>(null)
const items = ref<IndexSubjectItem[] | null>(null)
const total = ref(0)
const page = ref(1)
const loading = ref(true)
const listLoading = ref(false)
const error = ref('')
const listError = ref('')

const id = computed(() => Number(route.params.id))

/** 目录整体被标记含 R18 内容时，与详情页同一门控处理 */
const blockedByNsfw = computed(() => !!info.value?.nsfw && settings.hideNsfw)

onMounted(load)
watch(id, load)

async function load() {
  loading.value = true
  error.value = ''
  info.value = null
  items.value = null
  total.value = 0
  page.value = 1
  try {
    info.value = await dataSource.index(id.value)
    if (!blockedByNsfw.value) await loadSubjects(1)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function loadSubjects(p = 1) {
  listLoading.value = true
  listError.value = ''
  page.value = p
  try {
    const res = await dataSource.indexSubjects(id.value, PAGE_SIZE, (p - 1) * PAGE_SIZE)
    items.value = res.data ?? []
    total.value = res.total ?? 0
  } catch (e) {
    listError.value = e instanceof Error ? e.message : String(e)
    items.value = []
    total.value = 0
  } finally {
    listLoading.value = false
  }
}

function open(id: number) {
  router.push({ name: 'subject', params: { id: String(id) } })
}
</script>

<template>
  <div>
    <NButton quaternary size="small" style="margin-bottom: 14px" @click="router.back()">← 返回</NButton>

    <NSpin :show="loading">
      <NAlert v-if="error" type="error" title="加载失败">
        {{ error }} —— 请确认目录 ID 是否正确（目录只能按 ID 查看，官方接口暂无目录列表）。
        <NButton size="tiny" style="margin-left: 8px" @click="load">重试</NButton>
      </NAlert>

      <NResult v-else-if="blockedByNsfw" status="403" title="该目录包含 R18 内容" description="已按「隐藏 R18 内容」设置遮蔽。可在设置中调整开关。">
        <template #footer>
          <NButton quaternary @click="router.push({ name: 'settings' })">前往设置</NButton>
        </template>
      </NResult>

      <template v-else-if="info">
        <div class="index-head">
          <h2 class="index-title"><NIcon :component="ListOutline" />{{ info.title }}</h2>
          <p v-if="info.desc" class="index-desc">{{ info.desc }}</p>
          <div class="index-meta">
            <NTag size="small" :bordered="false">收录 {{ info.total ?? total }} 条</NTag>
            <NTag v-if="info.creator?.nickname || info.creator?.username" size="small" :bordered="false">
              整理：{{ info.creator?.nickname || info.creator?.username }}
            </NTag>
            <a
              class="index-link"
              :href="`https://bgm.tv/index/${info.id}`"
              target="_blank"
              rel="noopener"
            >在 Bangumi 打开 ↗</a>
          </div>
        </div>

        <NAlert v-if="listError" type="error" closable style="margin-bottom: 12px">{{ listError }}</NAlert>

        <NSpin :show="listLoading">
          <EmptyHint v-if="items && !items.length" text="目录暂无条目" />
          <div v-else class="card-grid">
            <AnimeCard
              v-for="it in items ?? []"
              :key="it.id"
              :id="it.id"
              :title="it.name_cn || it.name"
              :original="it.name"
              :poster="coverCardUrl(it.images, settings.imageQuality)"
              :extra="it.comment || (it.date ? `日期 ${it.date}` : '')"
              @open="open"
            />
          </div>
        </NSpin>

        <div v-if="total > PAGE_SIZE" class="pager">
          <NPagination :page="page" :item-count="total" :page-size="PAGE_SIZE" @update:page="loadSubjects" />
        </div>
      </template>
    </NSpin>
  </div>
</template>

<style scoped>
.index-head {
  margin-bottom: 18px;
}

.index-title {
  margin: 0 0 8px;
  font-size: 22px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.index-title .n-icon {
  color: var(--av-primary);
  font-size: 24px;
  flex: none;
}

.index-desc {
  margin: 0 0 12px;
  line-height: 1.8;
  opacity: 0.7;
  white-space: pre-wrap;
  max-width: 780px;
}

.index-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.index-link {
  font-size: 13px;
  color: var(--av-primary);
  text-decoration: none;
}

.index-link:hover {
  text-decoration: underline;
}

.pager {
  display: flex;
  justify-content: center;
  padding: 18px 0 8px;
}
</style>
