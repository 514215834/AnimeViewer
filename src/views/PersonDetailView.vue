<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NEmpty, NResult, NSpin, NTag } from 'naive-ui'
import { dataSource } from '../api/dataSource'
import type { PersonDetail, StaffWork } from '../types/bangumi'
import PosterImage from '../components/PosterImage.vue'

const route = useRoute()
const router = useRouter()

const person = ref<PersonDetail | null>(null)
const works = ref<StaffWork[] | null>(null)
const loading = ref(true)
const error = ref('')

const id = computed(() => Number(route.params.id))
const avatarUrl = computed(() => {
  const img = person.value?.images
  return img?.large || img?.medium || img?.small || ''
})

const CAREER_LABELS: Record<string, string> = {
  声优: '🎙 声优',
  艺术家: '🎵 艺术家',
  演员: '🎭 演员',
  导演: '🎬 导演',
  制片人: '💼 制片人',
  写手: '✍️ 写手',
  漫画家: '📝 漫画家',
  插画家: '🎨 插画家',
}

function careerLabel(c: string): string {
  return CAREER_LABELS[c] ?? c
}

onMounted(load)
watch(id, load)

async function load() {
  loading.value = true
  error.value = ''
  person.value = null
  works.value = null
  try {
    person.value = await dataSource.personDetail(id.value)
    works.value = await dataSource.personSubjects(id.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function openSubject(subjectId: number) {
  router.push({ name: 'subject', params: { id: String(subjectId) } })
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

      <div v-else-if="person" class="cpage">
        <div class="cpage-head">
          <div class="cpage-avatar">
            <PosterImage :src="avatarUrl" :title="person.name_cn || person.name" :subject-id="person.id" />
          </div>
          <div class="cpage-meta">
            <h2 class="cpage-title">{{ person.name_cn || person.name }}</h2>
            <div v-if="person.name_cn && person.name !== person.name_cn" class="cpage-sub">{{ person.name }}</div>
            <div v-if="person.career?.length" class="fact-row">
              <NTag v-for="c in person.career" :key="c" size="small" :bordered="false" type="info">
                {{ careerLabel(c) }}
              </NTag>
            </div>
          </div>
        </div>

        <section v-if="person.summary" class="cpage-summary">
          <p>{{ person.summary }}</p>
        </section>
        <div v-else class="empty-hint">暂无人物简介</div>

        <h3 class="cpage-works-title">🎬 参与作品</h3>
        <NSpin :show="works === null">
          <div v-if="works && !works.length" class="empty-hint">
            <NEmpty description="暂无参与作品数据" />
          </div>
          <div v-else class="works-grid">
            <div
              v-for="w in works ?? []"
              :key="w.id"
              class="work-card"
              :title="`${w.name_cn || w.name}（${w.staff}）`"
              @click="openSubject(w.id)"
            >
              <div class="work-poster">
                <PosterImage :src="w.image || ''" :title="w.name_cn || w.name" :subject-id="w.id" />
                <span class="work-staff">{{ w.staff }}</span>
              </div>
              <div class="work-name">{{ w.name_cn || w.name }}</div>
              <div v-if="w.eps" class="work-eps" :title="w.eps">参与：{{ w.eps }}</div>
            </div>
          </div>
        </NSpin>
      </div>

      <NResult v-else status="404" title="人物不存在" />
    </NSpin>
  </div>
</template>

<style scoped>
.cpage-head {
  display: flex;
  gap: 22px;
}

.cpage-avatar {
  width: 180px;
  flex-shrink: 0;
}

.cpage-meta {
  min-width: 0;
  flex: 1;
}

.cpage-title {
  margin: 0 0 6px;
  font-size: 24px;
}

.cpage-sub {
  font-size: 13px;
  opacity: 0.55;
  margin-bottom: 10px;
}

.fact-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.cpage-summary p {
  margin: 18px 0;
  line-height: 1.8;
  opacity: 0.85;
  white-space: pre-wrap;
}

.cpage-works-title {
  margin: 8px 0 12px;
  font-size: 16px;
}

.works-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 16px 12px;
}

.work-card {
  cursor: pointer;
  transition: transform 0.15s ease;
  content-visibility: auto;
  contain-intrinsic-size: auto 210px;
}

.work-card:hover {
  transform: translateY(-3px);
}

.work-poster {
  position: relative;
}

.work-staff {
  position: absolute;
  left: 6px;
  top: 6px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 6px;
}

.work-name {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.work-eps {
  font-size: 12px;
  opacity: 0.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
