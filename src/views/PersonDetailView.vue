<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { NAlert, NButton, NIcon, NResult, NSpin, NTag } from 'naive-ui'
import { FilmOutline } from '@vicons/ionicons5'
import { dataSource } from '../api/dataSource'
import { useLibraryStore } from '../stores/library'
import type { PersonDetail, StaffWork } from '../types/bangumi'
import { careerLabel } from '../utils/career'
import PosterImage from '../components/PosterImage.vue'
import EmptyHint from '../components/EmptyHint.vue'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const library = useLibraryStore()

const person = ref<PersonDetail | null>(null)
const works = ref<StaffWork[] | null>(null)
const loading = ref(true)
const error = ref('')

const id = computed(() => Number(route.params.id))
const collected = computed(() => library.hasPerson(id.value))
const avatarUrl = computed(() => {
  const img = person.value?.images
  return img?.large || img?.medium || img?.small || ''
})

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

/** F2 收藏人物：本地即时收藏 + 云端推送（失败保留 dirty 随同步重放） */
function toggleCollect() {
  const p = person.value
  if (!p) return
  if (collected.value) {
    // 云端取消收藏依赖 DELETE /persons/{id}/collect，服务端实测未实现（404 路由未注册），仅移除本地记录
    library.removePerson(p.id)
    message.info('已从本地「我的人物」移除（云端取消收藏功能 Bangumi API 暂未开放）')
    return
  }
  library.addPerson({
    personId: p.id,
    name: p.name,
    nameCn: p.name_cn || p.name,
    image: p.images?.medium || p.images?.large,
    career: p.career,
  })
  void dataSource
    .collectPerson(p.id)
    .then(() => {
      library.markPersonSynced(p.id)
      message.success('已收藏人物，可在「我的追番 → 我的人物」查看')
    })
    .catch((e: unknown) => {
      message.warning(e instanceof Error ? `云端收藏失败，已保留待下次同步重试：${e.message}` : '云端收藏失败，已保留待重试')
    })
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
            <div class="cpage-actions">
              <NButton v-if="!collected" type="primary" size="small" @click="toggleCollect">☆ 收藏人物</NButton>
              <template v-else>
                <NButton size="small" secondary>★ 已收藏</NButton>
                <NButton size="tiny" quaternary type="error" @click="toggleCollect">移出本地</NButton>
              </template>
            </div>
          </div>
        </div>

        <section v-if="person.summary" class="cpage-summary">
          <p>{{ person.summary }}</p>
        </section>
        <EmptyHint v-else text="暂无人物简介" />

        <h3 class="cpage-works-title"><NIcon :component="FilmOutline" />参与作品</h3>
        <NSpin :show="works === null">
          <EmptyHint v-if="works && !works.length" text="暂无参与作品数据" />
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

.cpage-actions {
  display: flex;
  align-items: center;
  gap: 8px;
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
  display: flex;
  align-items: center;
  gap: 6px;
}

.cpage-works-title .n-icon {
  color: var(--av-primary);
  font-size: 18px;
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
