<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { NButton, NIcon, NInputNumber, NPagination, NPopconfirm, NRadioButton, NRadioGroup, NSelect, NTag } from 'naive-ui'
import { LibraryOutline, TvOutline, PersonOutline, PeopleOutline } from '@vicons/ionicons5'
import { useLibraryStore } from '../stores/library'
import { useSettingsStore } from '../stores/settings'
import { useSyncStore } from '../stores/sync'
import type { CollectedCharacter, CollectedPerson, WatchStatus } from '../stores/library'
import { isDemoCharacterId, isDemoPersonId } from '../api/demoIds'
import { upgradeStoredCover } from '../utils/image'
import { careerLabel } from '../utils/career'
import PosterImage from '../components/PosterImage.vue'
import EmptyHint from '../components/EmptyHint.vue'

const router = useRouter()
const message = useMessage()
const library = useLibraryStore()
const settings = useSettingsStore()
const sync = useSyncStore()

const view = ref<'anime' | 'character' | 'person'>('anime')
const filter = ref<'all' | WatchStatus>('all')
const sortBy = ref<'added' | 'score' | 'name'>('added')
const tagFilter = ref<string | null>(null)

/** E6/F2 角色与人物收藏分页（每页 24） */
const LIB_PAGE_SIZE = 24
const charPage = ref(1)
const personPage = ref(1)

const statusOptions = [
  { label: '想看', value: 'wish' },
  { label: '在看', value: 'doing' },
  { label: '看完', value: 'done' },
]

const sortOptions = [
  { label: '按添加时间', value: 'added' },
  { label: '按评分', value: 'score' },
  { label: '按名称', value: 'name' },
]

const statusText: Record<WatchStatus, string> = { wish: '想看', doing: '在看', done: '看完' }

/** 库内标签池（按出现次数取前 15） */
const tagPool = computed(() => {
  const count = new Map<string, number>()
  for (const e of library.list) {
    for (const t of e.tags ?? []) count.set(t, (count.get(t) ?? 0) + 1)
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t, n]) => ({ t, n }))
})

const shown = computed(() => {
  const base = library.list.filter((e) => {
    const statusOk = filter.value === 'all' || e.status === filter.value
    const tagOk = tagFilter.value === null || (e.tags ?? []).includes(tagFilter.value)
    return statusOk && tagOk
  })
  const arr = [...base]
  if (sortBy.value === 'score') {
    arr.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  } else if (sortBy.value === 'name') {
    arr.sort((a, b) => (a.nameCn || a.name).localeCompare(b.nameCn || b.name, 'zh-Hans-CN'))
  } else {
    arr.sort((a, b) => b.addedAt - a.addedAt)
  }
  return arr
})

function open(id: number) {
  router.push({ name: 'subject', params: { id: String(id) } })
}

function openCharacter(id: number) {
  router.push({ name: 'character', params: { id: String(id) } })
}

function removeEntry(id: number, title: string) {
  // 先清待推单集队列，再移除（移除会记墓碑，云同步拉取不再复活该条目）
  sync.purgePendingEpisodeMarks(id)
  library.remove(id)
  message.success(`已将「${title}」移出本地追番列表（Bangumi 暂不支持删除云端收藏，同步不会恢复）`)
}

/** E6/F2 收藏头像 URL（存的是 URL 字符串，http→https 升级交给 PosterImage 统一处理） */
function collectImg(img: string | undefined): string {
  return img ?? ''
}

const scopedCharacters = computed<CollectedCharacter[]>(() =>
  settings.isDemo ? library.characterList.filter((c) => isDemoCharacterId(c.characterId)) : library.characterList,
)
const scopedPersons = computed<CollectedPerson[]>(() =>
  settings.isDemo ? library.personList.filter((p) => isDemoPersonId(p.personId)) : library.personList,
)
const characterTotal = computed(() => scopedCharacters.value.length)
const hiddenCharacterCount = computed(() => (settings.isDemo ? library.characterCount - characterTotal.value : 0))
const hiddenPersonCount = computed(() => (settings.isDemo ? library.personCount - scopedPersons.value.length : 0))

const charTotal = computed(() => characterTotal.value)
const charShown = computed(() =>
  scopedCharacters.value.slice((charPage.value - 1) * LIB_PAGE_SIZE, charPage.value * LIB_PAGE_SIZE),
)

function removeCharacter(id: number, title: string) {
  library.removeCharacter(id)
  message.info(`已将「${title}」移出本地角色收藏（云端取消收藏功能 Bangumi API 暂未开放）`)
}

/* ── F2 我的人物 ── */
function openPerson(id: number) {
  router.push({ name: 'person', params: { id: String(id) } })
}

const personTotal = computed(() => scopedPersons.value.length)
const personShown = computed(() =>
  scopedPersons.value.slice((personPage.value - 1) * LIB_PAGE_SIZE, personPage.value * LIB_PAGE_SIZE),
)

function removePerson(id: number, title: string) {
  library.removePerson(id)
  message.info(`已将「${title}」移出本地人物收藏（云端取消收藏功能 Bangumi API 暂未开放）`)
}
</script>

<template>
  <div>
    <div class="page-head">
      <h2><NIcon :component="LibraryOutline" />我的追番</h2>
      <span class="page-sub">共 {{ library.count }} 部 · 数据保存在本地浏览器</span>
    </div>

    <!-- E6/F2 分区切换：追番 / 我的角色 / 我的人物 -->
    <div class="view-switch">
      <NRadioGroup v-model:value="view" size="small">
        <NRadioButton value="anime"><span class="radio-icon-row"><NIcon :component="TvOutline" size="14" />追番 ({{ library.count }})</span></NRadioButton>
        <NRadioButton value="character"><span class="radio-icon-row"><NIcon :component="PersonOutline" size="14" />我的角色 ({{ characterTotal }})</span></NRadioButton>
        <NRadioButton value="person"><span class="radio-icon-row"><NIcon :component="PeopleOutline" size="14" />我的人物 ({{ scopedPersons.length }})</span></NRadioButton>
      </NRadioGroup>
    </div>

    <template v-if="view === 'anime'">
    <div class="toolbar">
      <NRadioGroup v-model:value="filter" size="small">
        <NRadioButton value="all">全部 ({{ library.count }})</NRadioButton>
        <NRadioButton v-for="o in statusOptions" :key="o.value" :value="o.value">
          {{ o.label }} ({{ library.list.filter((e) => e.status === o.value).length }})
        </NRadioButton>
      </NRadioGroup>
      <NSelect v-model:value="sortBy" size="small" :options="sortOptions" style="width: 140px" />
    </div>

    <div v-if="tagPool.length" class="lib-tag-bar">
      <span class="lib-tag-label">标签：</span>
      <NTag
        size="small"
        round
        :type="tagFilter === null ? 'primary' : 'default'"
        :bordered="tagFilter !== null"
        class="lib-tag-chip"
        @click="tagFilter = null"
      >
        全部
      </NTag>
      <NTag
        v-for="{ t, n } in tagPool"
        :key="t"
        size="small"
        round
        :type="tagFilter === t ? 'primary' : 'default'"
        :bordered="tagFilter !== t"
        class="lib-tag-chip"
        @click="tagFilter = tagFilter === t ? null : t"
      >
        {{ t }} ({{ n }})
      </NTag>
    </div>

    <EmptyHint v-if="!shown.length" text="这里还是空的" sub="去「每周新番」或「搜索」里添加吧" />

    <div v-else class="lib-grid">
      <div v-for="e in shown" :key="e.subjectId" class="lib-card">
        <div class="lib-poster" @click="open(e.subjectId)">
          <PosterImage
            :src="upgradeStoredCover(e.image, settings.imageQuality)"
            :title="e.nameCn || e.name"
            :subject-id="e.subjectId"
          />
        </div>
        <div class="lib-info">
          <div class="lib-title-row">
            <span class="lib-title" :title="e.nameCn || e.name" @click="open(e.subjectId)">
              {{ e.nameCn || e.name }}
            </span>
            <span v-if="e.score" class="lib-score">★ {{ e.score.toFixed(1) }}</span>
            <span v-if="e.myRate" class="lib-mine" title="我的评分">我的 ★{{ e.myRate }}</span>
          </div>
          <div class="lib-controls">
            <NSelect
              size="tiny"
              :value="e.status"
              :options="statusOptions"
              style="width: 86px"
              @update:value="(v: WatchStatus) => library.setStatus(e.subjectId, v)"
            />
            <div class="progress-row">
              <span class="progress-label">{{ statusText[e.status] }}</span>
              <NInputNumber
                size="tiny"
                :value="e.progress"
                :min="0"
                :max="e.epsTotal > 0 ? e.epsTotal : 9999"
                button-placement="both"
                style="width: 104px"
                @update:value="(v: number | null) => library.setProgress(e.subjectId, v ?? 0)"
              />
              <span class="progress-label">/ {{ e.epsTotal > 0 ? e.epsTotal : '?' }} 话</span>
            </div>
            <NPopconfirm @positive-click="removeEntry(e.subjectId, e.nameCn || e.name)">
              <template #trigger>
                <NButton size="tiny" quaternary type="error" style="align-self: flex-start">移除</NButton>
              </template>
              确定将「{{ e.nameCn || e.name }}」移出追番列表？
            </NPopconfirm>
          </div>
        </div>
      </div>
    </div>
    </template>

    <!-- E6 我的角色 -->
    <template v-else-if="view === 'character'">
      <div v-if="hiddenCharacterCount" class="demo-filter-hint">
        演示（离线）模式：已隐藏 {{ hiddenCharacterCount }} 个在线收藏的角色，切换到在线模式可继续查看
      </div>
      <EmptyHint v-if="!characterTotal" text="还没有收藏角色" sub="去条目详情的「角色」页或搜索角色页点「收藏角色」吧" />
      <template v-else>
        <div class="char-lib-grid">
          <div v-for="c in charShown" :key="c.characterId" class="char-lib-card">
            <div class="char-lib-poster" @click="openCharacter(c.characterId)">
              <PosterImage :src="collectImg(c.image)" :title="c.nameCn || c.name" :subject-id="c.characterId" />
            </div>
            <div class="char-lib-info">
              <span class="char-lib-name" :title="c.nameCn || c.name" @click="openCharacter(c.characterId)">
                {{ c.nameCn || c.name }}
              </span>
              <span v-if="c.dirty" class="char-lib-pending">待推送</span>
              <NPopconfirm @positive-click="removeCharacter(c.characterId, c.nameCn || c.name)">
                <template #trigger>
                  <NButton size="tiny" quaternary type="error" style="align-self: flex-start">移出本地</NButton>
                </template>
                仅移出本地记录（云端取消收藏暂不受支持），确定移出「{{ c.nameCn || c.name }}」？
              </NPopconfirm>
            </div>
          </div>
        </div>
        <div v-if="charTotal > LIB_PAGE_SIZE" class="char-pager">
          <NPagination
            :page="charPage"
            :item-count="charTotal"
            :page-size="LIB_PAGE_SIZE"
            @update:page="(p: number) => (charPage = p)"
          />
        </div>
      </template>
    </template>

    <!-- F2 我的声优 -->
    <template v-else>
      <div v-if="hiddenPersonCount" class="demo-filter-hint">
        演示（离线）模式：已隐藏 {{ hiddenPersonCount }} 位在线收藏的人物，切换到在线模式可继续查看
      </div>
      <EmptyHint v-if="!personTotal" text="还没有收藏人物" sub="去条目详情的「制作人员」页或搜索人物页点「收藏人物」吧" />
      <template v-else>
        <div class="char-lib-grid">
          <div v-for="p in personShown" :key="p.personId" class="char-lib-card">
            <div class="char-lib-poster" @click="openPerson(p.personId)">
              <PosterImage :src="collectImg(p.image)" :title="p.nameCn || p.name" :subject-id="p.personId" />
            </div>
            <div class="char-lib-info">
              <span class="char-lib-name" :title="p.nameCn || p.name" @click="openPerson(p.personId)">
                {{ p.nameCn || p.name }}
              </span>
              <span v-if="p.dirty" class="char-lib-pending">待推送</span>
              <div v-if="p.career?.length" class="person-career">
                <NTag v-for="c in p.career.slice(0, 3)" :key="c" size="tiny" :bordered="false" type="info">{{ careerLabel(c) }}</NTag>
              </div>
              <NPopconfirm @positive-click="removePerson(p.personId, p.nameCn || p.name)">
                <template #trigger>
                  <NButton size="tiny" quaternary type="error" style="align-self: flex-start">移出本地</NButton>
                </template>
                仅移出本地记录（云端取消收藏暂不受支持），确定移出「{{ p.nameCn || p.name }}」？
              </NPopconfirm>
            </div>
          </div>
        </div>
        <div v-if="personTotal > LIB_PAGE_SIZE" class="char-pager">
          <NPagination
            :page="personPage"
            :item-count="personTotal"
            :page-size="LIB_PAGE_SIZE"
            @update:page="(p: number) => (personPage = p)"
          />
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.view-switch {
  margin-bottom: 12px;
}

.radio-icon-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.char-lib-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 14px;
}

.char-lib-card {
  display: flex;
  gap: 12px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid rgba(128, 128, 128, 0.22);
  content-visibility: auto;
  contain-intrinsic-size: auto 120px;
}

.char-lib-poster {
  width: 84px;
  flex-shrink: 0;
  cursor: pointer;
}

.char-lib-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.char-lib-name {
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.char-lib-name:hover {
  color: #8a7bff;
}

.char-lib-pending {
  font-size: 11px;
  color: #e6a23c;
}

.person-career {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.char-pager {
  display: flex;
  justify-content: center;
  padding: 18px 0 8px;
}

.lib-mine {
  font-size: 11px;
  font-weight: 600;
  color: #8a7bff;
  flex-shrink: 0;
  white-space: nowrap;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.lib-tag-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.lib-tag-label {
  font-size: 12px;
  opacity: 0.5;
}

.demo-filter-hint {
  margin: 0 0 14px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  color: #d99a2b;
  background: rgba(217, 154, 43, 0.12);
}

.lib-tag-chip {
  cursor: pointer;
  user-select: none;
}

.lib-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

.lib-card {
  display: flex;
  gap: 12px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid rgba(128, 128, 128, 0.22);
  content-visibility: auto;
  contain-intrinsic-size: auto 130px;
}

.lib-poster {
  width: 90px;
  flex-shrink: 0;
  cursor: pointer;
}

.lib-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.lib-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.lib-title {
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.lib-title:hover {
  color: #8a7bff;
}

.lib-score {
  font-size: 12px;
  font-weight: 600;
  color: #ffd75e;
  flex-shrink: 0;
}

.lib-controls {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: auto;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.progress-label {
  font-size: 12px;
  opacity: 0.6;
  white-space: nowrap;
}
</style>
