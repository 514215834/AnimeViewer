<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { NAlert, NButton, NIcon, NResult, NSpin, NTag } from 'naive-ui'
import { MicOutline, FilmOutline } from '@vicons/ionicons5'
import { dataSource } from '../api/dataSource'
import { bangumiApi } from '../api/bangumi'
import { useLibraryStore } from '../stores/library'
import { useSettingsStore } from '../stores/settings'
import { useSyncStore } from '../stores/sync'
import type { CharacterDetail, CharacterPerson, StaffWork } from '../types/bangumi'
import PosterImage from '../components/PosterImage.vue'
import EmptyHint from '../components/EmptyHint.vue'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const library = useLibraryStore()
const settings = useSettingsStore()
const sync = useSyncStore()

const character = ref<CharacterDetail | null>(null)
const works = ref<StaffWork[] | null>(null)
const actors = ref<CharacterPerson[] | null>(null)
const loading = ref(true)
const error = ref('')

const id = computed(() => Number(route.params.id))
const collected = computed(() => library.hasCharacter(id.value))

/** 角色头像：crt 图片路径 */
const avatarUrl = computed(() => {
  const img = character.value?.images
  return img?.large || img?.medium || img?.small || ''
})

onMounted(load)
watch(id, load)

async function load() {
  loading.value = true
  error.value = ''
  character.value = null
  works.value = null
  actors.value = null
  try {
    character.value = await dataSource.characterDetail(id.value)
    works.value = await dataSource.characterSubjects(id.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
  // F3 演绎声优：独立加载，失败不影响主页面
  try {
    actors.value = await dataSource.characterPersons(id.value)
  } catch {
    actors.value = []
  }
  void pullCloudCollectState()
}

/** v0.27 B2 云端单角色收藏状态回读：仅增量补录（本地有 dirty 记录不动、云端无记录不移除——
 *  与同步引擎不打架），修复「换设备收藏后本页不回读」的缺口；演示模式/无 Token/无账号缓存跳过 */
async function pullCloudCollectState() {
  if (settings.isDemo || !settings.accessToken.trim() || library.hasCharacter(id.value)) return
  const account = sync.account
  const username = account?.username || (account ? String(account.id) : '')
  if (!username) return
  try {
    const cloud = await bangumiApi.characterCollectState(username, id.value)
    if (cloud) {
      library.upsertCharacterFromServer({
        characterId: id.value,
        name: cloud.name,
        image: cloud.images?.medium || cloud.images?.large || cloud.images?.small || '',
      })
    }
  } catch {
    /* 回读失败静默（本地状态不因网络问题被扰动） */
  }
}

function toggleCollect() {
  const c = character.value
  if (!c) return
  if (collected.value) {
    // 云端取消收藏依赖 DELETE /characters/{id}/collect，服务端实测未实现（404 路由未注册），仅移除本地记录
    library.removeCharacter(c.id)
    message.info('已从本地「我的角色」移除（云端取消收藏功能 Bangumi API 暂未开放）')
    return
  }
  library.addCharacter({
    characterId: c.id,
    name: c.name,
    nameCn: c.name_cn || c.name,
    image: c.images?.medium || c.images?.large,
  })
  void dataSource
    .collectCharacter(c.id)
    .then(() => {
      library.markCharacterSynced(c.id)
      message.success('已收藏角色，可在「我的追番 → 我的角色」查看')
    })
    .catch((e: unknown) => {
      message.warning(e instanceof Error ? `云端收藏失败，已保留待下次同步重试：${e.message}` : '云端收藏失败，已保留待重试')
    })
}

function openSubject(subjectId: number) {
  router.push({ name: 'subject', params: { id: String(subjectId) } })
}

/** F3 声优头像 URL（images 可能为 null，交给 PosterImage 占位） */
function actorImg(images?: CharacterPerson['images']): string {
  return images?.medium || images?.large || images?.small || ''
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

      <div v-else-if="character" class="cpage">
        <div class="cpage-head">
          <div class="cpage-avatar">
            <PosterImage :src="avatarUrl" :title="character.name_cn || character.name" :subject-id="character.id" />
          </div>
          <div class="cpage-meta">
            <h2 class="cpage-title">{{ character.name_cn || character.name }}</h2>
            <div v-if="character.name_cn && character.name !== character.name_cn" class="cpage-sub">{{ character.name }}</div>
            <div class="fact-row">
              <NTag v-if="character.gender" size="small" :bordered="false">{{ character.gender }}</NTag>
              <NTag v-if="character.birth_year" size="small" :bordered="false">
                生日 {{ character.birth_mon ?? '?' }}-{{ character.birth_day ?? '?' }}
              </NTag>
            </div>
            <div class="cpage-actions">
              <NButton v-if="!collected" type="primary" size="small" @click="toggleCollect">☆ 收藏角色</NButton>
              <template v-else>
                <NButton size="small" secondary>★ 已收藏</NButton>
                <NButton size="tiny" quaternary type="error" @click="toggleCollect">移出本地</NButton>
              </template>
            </div>
          </div>
        </div>

        <section v-if="character.summary" class="cpage-summary">
          <p>{{ character.summary }}</p>
        </section>
        <EmptyHint v-else text="暂无角色简介" />

        <!-- F3 演绎声优：该角色在各作品中的配音演员，点击跳人物页 -->
        <h3 class="cpage-works-title"><NIcon :component="MicOutline" />演绎声优</h3>
        <NSpin :show="actors === null">
          <EmptyHint v-if="actors && !actors.length" text="暂无声优关联数据" />
          <div v-else class="actor-grid">
            <div
              v-for="a in actors ?? []"
              :key="`${a.id}-${a.subject_id}`"
              class="actor-card"
              :title="`查看人物「${a.name}」`"
              @click="router.push({ name: 'person', params: { id: String(a.id) } })"
            >
              <div class="actor-avatar">
                <PosterImage :src="actorImg(a.images)" :title="a.name" :subject-id="a.id" />
                <span v-if="a.staff" class="actor-staff">{{ a.staff }}</span>
              </div>
              <div class="actor-name" :title="a.name">{{ a.name }}</div>
              <div class="actor-subject" :title="a.subject_name_cn || a.subject_name">
                {{ a.subject_name_cn || a.subject_name }}
              </div>
            </div>
          </div>
        </NSpin>

        <h3 class="cpage-works-title"><NIcon :component="FilmOutline" />出演作品</h3>
        <NSpin :show="works === null">
          <EmptyHint v-if="works && !works.length" text="暂无出演作品数据" />
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

      <NResult v-else status="404" title="角色不存在" />
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

.actor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 14px 10px;
  margin-bottom: 22px;
}

.actor-card {
  cursor: pointer;
  transition: transform 0.15s ease;
  content-visibility: auto;
  contain-intrinsic-size: auto 180px;
}

.actor-card:hover {
  transform: translateY(-3px);
}

.actor-card:hover .actor-name {
  color: var(--av-primary);
}

.actor-avatar {
  position: relative;
}

.actor-staff {
  position: absolute;
  left: 6px;
  top: 6px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 6px;
}

.actor-name {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actor-subject {
  font-size: 12px;
  opacity: 0.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
