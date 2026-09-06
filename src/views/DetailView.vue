<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import {
  NAlert,
  NButton,
  NCheckbox,
  NDescriptions,
  NDescriptionsItem,
  NInputNumber,
  NRate,
  NResult,
  NSelect,
  NSpin,
  NTabPane,
  NTabs,
  NTag,
} from 'naive-ui'
import { dataSource } from '../api/dataSource'
import { useLibraryStore } from '../stores/library'
import { useSettingsStore } from '../stores/settings'
import type { WatchStatus } from '../stores/library'
import { charAvatarUrl, upgradeStoredCover } from '../utils/image'
import type { Episode, SubjectCharacter, SubjectDetail, SubjectPerson } from '../types/bangumi'
import PosterImage from '../components/PosterImage.vue'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const library = useLibraryStore()
const settings = useSettingsStore()

const subject = ref<SubjectDetail | null>(null)
const loading = ref(true)
const error = ref('')
const revealed = ref(false)

/** R18 门控：开关隐藏 R18 且条目被官方标记、且未显式揭示时，遮蔽条目内容 */
const blockedByNsfw = computed(
  () => !!subject.value?.nsfw && settings.hideNsfw && !revealed.value,
)

const activeTab = ref('info')
const characters = ref<SubjectCharacter[] | null>(null)
const persons = ref<SubjectPerson[] | null>(null)
const episodes = ref<Episode[] | null>(null)
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

onMounted(load)
watch(id, load)

async function load() {
  loading.value = true
  error.value = ''
  subject.value = null
  characters.value = null
  persons.value = null
  episodes.value = null
  activeTab.value = 'info'
  tabError.value = ''
  revealed.value = false
  try {
    subject.value = await dataSource.subject(id.value)
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
    }
  } catch (e) {
    tabError.value = e instanceof Error ? e.message : String(e)
  }
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
  library.remove(id.value)
  message.info('已移出追番列表')
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
  return entry.value?.watchedEps?.includes(ep.sort) ?? false
}

function toggleEp(ep: Episode, watched: boolean) {
  if (!entry.value) return
  library.setEpisodeWatched(entry.value.subjectId, ep.sort, watched)
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
        <div class="detail-head">
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
              <NTag v-if="subject.total_episodes" size="small" :bordered="false">
                共 {{ subject.total_episodes }} 话
              </NTag>
              <NTag v-if="subject.date" size="small" :bordered="false">开播 {{ subject.date }}</NTag>
              <NTag v-if="subject.platform" size="small" :bordered="false">{{ subject.platform }}</NTag>
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
                <NButton type="primary" @click="add">➕ 加入追番</NButton>
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
                <NButton size="small" quaternary type="error" @click="remove">移除</NButton>
              </template>
            </div>
          </div>
        </div>

        <NTabs v-model:value="activeTab" type="line" style="margin-top: 18px" animated>
          <NTabPane name="info" tab="简介">
            <NDescriptions v-if="infoboxRows.length" :column="2" bordered size="small" style="margin-bottom: 18px">
              <NDescriptionsItem v-for="row in infoboxRows" :key="row.key" :label="row.key">
                {{ row.value }}
              </NDescriptionsItem>
            </NDescriptions>
            <section v-if="subject.summary" class="summary">
              <p>{{ subject.summary }}</p>
            </section>
            <div v-else class="empty-hint">暂无简介</div>
          </NTabPane>

          <NTabPane name="chars" tab="角色">
            <NAlert v-if="tabError" type="error" size="small">{{ tabError }}</NAlert>
            <NSpin :show="characters === null" v-if="activeTab === 'chars'">
              <div v-if="characters && !characters.length" class="empty-hint">暂无角色数据</div>
              <div v-else-if="characters" class="char-grid">
                <div v-for="c in characters" :key="c.id" class="char-card">
                  <PosterImage :src="charAvatar(c.images)" :title="c.name" :subject-id="c.id" />
                  <div class="char-name" :title="c.name">{{ c.name }}</div>
                  <NTag size="tiny" :bordered="false" type="info">{{ c.relation || '角色' }}</NTag>
                  <div v-if="c.actors?.length" class="char-actor" :title="c.actors.map((a) => a.name).join(' / ')">
                    🎙 {{ c.actors.map((a) => a.name).join(' / ') }}
                  </div>
                </div>
              </div>
            </NSpin>
          </NTabPane>

          <NTabPane name="staff" tab="制作人员">
            <NAlert v-if="tabError" type="error" size="small">{{ tabError }}</NAlert>
            <NSpin :show="persons === null" v-if="activeTab === 'staff'">
              <div v-if="persons && !persons.length" class="empty-hint">暂无制作人员数据</div>
              <div v-else-if="persons" class="staff-grid">
                <div v-for="p in persons" :key="p.id" class="staff-row">
                  <span class="staff-name">{{ p.name }}</span>
                  <NTag size="tiny" :bordered="false">{{ p.relation || 'Staff' }}</NTag>
                </div>
              </div>
            </NSpin>
          </NTabPane>

          <NTabPane name="eps" tab="剧集">
            <NAlert v-if="tabError" type="error" size="small">{{ tabError }}</NAlert>
            <div v-if="!inLibrary" class="empty-hint">加入追番后，可在这里勾选单集记录进度</div>
            <template v-else>
              <div class="eps-tools">
                <NButton size="tiny" secondary @click="markAllEps(true)">全部看过</NButton>
                <NButton size="tiny" secondary @click="markAllEps(false)">清空</NButton>
                <span class="eps-count">
                  已看 {{ entry?.watchedEps?.length ?? 0 }} / {{ mainEpisodes.length }} 话
                </span>
              </div>
              <NSpin :show="episodes === null && activeTab === 'eps'">
                <div v-if="episodes && !mainEpisodes.length" class="empty-hint">暂无剧集数据</div>
                <div v-else class="ep-list">
                  <div
                    v-for="ep in mainEpisodes"
                    :key="ep.id"
                    class="ep-row"
                    :class="{ watched: isEpWatched(ep) }"
                  >
                    <NCheckbox :checked="isEpWatched(ep)" @update:checked="(v: boolean) => toggleEp(ep, v)" />
                    <span class="ep-sort">第 {{ ep.sort }} 话</span>
                    <span class="ep-name" :title="ep.name_cn || ep.name">{{ ep.name_cn || ep.name }}</span>
                    <span v-if="ep.airdate" class="ep-date">{{ ep.airdate }}</span>
                  </div>
                </div>
              </NSpin>
            </template>
          </NTabPane>
        </NTabs>
        </template>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.detail-head {
  display: flex;
  gap: 22px;
}

.detail-poster {
  width: 210px;
  flex-shrink: 0;
}

.detail-meta {
  min-width: 0;
  flex: 1;
}

.detail-title {
  margin: 0 0 6px;
  font-size: 24px;
}

.detail-sub {
  font-size: 13px;
  opacity: 0.55;
  margin-bottom: 12px;
}

.rate-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.rate-num {
  font-size: 16px;
  font-weight: 700;
  color: #ffd75e;
}

.rate-total {
  font-size: 12px;
  opacity: 0.5;
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
  color: #8a7bff;
  border-color: #8a7bff;
}

.action-box {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  flex-wrap: wrap;
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

.eps-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.eps-count {
  font-size: 12px;
  opacity: 0.6;
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
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
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
</style>
