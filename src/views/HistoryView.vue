<script setup lang="ts">
/** v0.15 O5 播放历史：集中展示全部播放进度记录（今日页「继续观看」的全量版）。
 *  数据 = watchPositions（p: 前缀扫描）× bindings（归属反解）；条目名追番库优先、
 *  缺失走 dataSource 详情（TTL 缓存），解析失败显示「未知条目」不阻塞。
 *  续播直达 /watch（服务源经 subjectFiles 反查文件 ID）；批量清理只动进度记录，不碰绑定。 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NCheckbox, NIcon, NPopconfirm, NTag, NSpin } from 'naive-ui'
import { PlayOutline, TimeOutline, TrashOutline } from '@vicons/ionicons5'
import { useMessage } from 'naive-ui'
import { dataSource } from '../api/dataSource'
import { mediaService } from '../api/mediaService'
import { useLibraryStore } from '../stores/library'
import { formatClock, resolvePositionOwner, watchRatio, type HistoryOwner } from '../utils/mediaCore'
import { clearPositions, deletePosition, listAllBindings, listAllPositions } from '../utils/mediaStore'
import EmptyHint from '../components/EmptyHint.vue'

const router = useRouter()
const message = useMessage()
const library = useLibraryStore()

const loading = ref(true)

interface HistoryRow {
  owner: HistoryOwner
  position: number
  duration: number
  updatedAt: number
  ratio: number
  finished: boolean
  /** 条目名与封面（解析失败为空，显示「未知条目」） */
  name: string
  cover: string
}

const rows = ref<HistoryRow[]>([])
const selected = ref<Set<string>>(new Set())
const clearing = ref(false)

const SOURCE_LABEL: Record<HistoryOwner['source'], string> = {
  service: '媒体库',
  file: '本机',
  url: '在线',
  webdav: 'WebDAV',
  demo: '演示',
  online: '在线解析',
}

/** 继续观看（未看完）在前，已看完在后；同组按最近观看倒序 */
const continueRows = computed(() => rows.value.filter((r) => !r.finished))
const finishedRows = computed(() => rows.value.filter((r) => r.finished))

const allSelected = computed(() => rows.value.length > 0 && selected.value.size === rows.value.length)

function fmtWhen(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return sameDay ? `今天 ${time}` : `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${time}`
}

async function resolveMeta(subjectId: number): Promise<{ name: string; cover: string }> {
  const entry = library.entry(subjectId)
  if (entry) return { name: entry.nameCn || entry.name, cover: entry.image ?? '' }
  try {
    const s = await dataSource.subject(subjectId)
    return { name: s.name_cn || s.name, cover: s.images?.common ?? '' }
  } catch {
    return { name: '', cover: '' }
  }
}

async function load() {
  loading.value = true
  try {
    const [positions, bindings] = await Promise.all([listAllPositions(), listAllBindings()])
    const mapped = positions
      .map((p) => ({ p, owner: resolvePositionOwner(p, bindings) }))
      .filter((x): x is { p: (typeof positions)[number]; owner: HistoryOwner } => !!x.owner)
      .sort((a, b) => b.p.updatedAt - a.p.updatedAt)

    // 条目名解析：去重后限并发 4（量级为十级，简单串行池即可）
    const metaCache = new Map<number, { name: string; cover: string }>()
    const ids = [...new Set(mapped.map((x) => x.owner.subjectId))]
    let cursor = 0
    const worker = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++]
        metaCache.set(id, await resolveMeta(id))
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
    if (cursor >= ids.length) {
      rows.value = mapped.map(({ p, owner }) => {
        const meta = metaCache.get(owner.subjectId) ?? { name: '', cover: '' }
        const ratio = watchRatio(p.position, p.duration)
        return {
          owner,
          position: p.position,
          duration: p.duration,
          updatedAt: p.updatedAt,
          ratio,
          finished: p.duration > 0 && ratio >= 0.95,
          name: meta.name,
          cover: meta.cover,
        }
      })
      selected.value = new Set()
    }
  } finally {
    loading.value = false
  }
}

/** 续播直达：服务源需反查文件 ID（?file=），其余类型 /watch 按 subject+sort 解析绑定 */
async function resume(row: HistoryRow) {
  const { subjectId, sort, source } = row.owner
  if (source === 'service') {
    try {
      const files = await mediaService.subjectFiles(subjectId)
      const file = files.find((f) => f.sort === sort)
      if (!file) {
        message.warning('媒体库中已找不到该集文件（可能已移除或改绑）')
        return
      }
      router.push({ path: '/watch', query: { subject: String(subjectId), sort: String(sort), file: String(file.fileId) } })
      return
    } catch {
      message.warning('媒体服务不可达，无法定位该集文件')
      return
    }
  }
  router.push({ path: '/watch', query: { subject: String(subjectId), sort: String(sort) } })
}

function toggle(id: string, checked: boolean) {
  const next = new Set(selected.value)
  if (checked) next.add(id)
  else next.delete(id)
  selected.value = next
}

function toggleAll(checked: boolean) {
  selected.value = checked ? new Set(rows.value.map((r) => r.owner.positionId)) : new Set()
}

async function removeSelected() {
  clearing.value = true
  try {
    for (const id of selected.value) await deletePosition(id)
    message.success(`已清除 ${selected.value.size} 条播放记录（绑定不受影响）`)
    await load()
  } finally {
    clearing.value = false
  }
}

async function removeAll() {
  clearing.value = true
  try {
    await clearPositions()
    message.success('已清空全部播放记录（绑定不受影响）')
    await load()
  } finally {
    clearing.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page-container">
    <div class="page-head">
      <h2><NIcon :component="TimeOutline" /> 播放历史</h2>
      <NCheckbox v-if="rows.length" :checked="allSelected" @update:checked="toggleAll">全选</NCheckbox>
    </div>

    <div v-if="loading" class="hist-state"><NSpin size="medium" /></div>

    <EmptyHint v-else-if="!rows.length" text="还没有播放记录" sub="在剧集 Tab 绑定播放源并开始播放后，观看进度会集中展示在这里">
      <NButton size="small" secondary type="primary" @click="router.push('/today')">去今日页看看</NButton>
    </EmptyHint>

    <template v-else>
      <div v-if="rows.length" class="hist-actions">
        <span class="hist-actions-info">已选 {{ selected.size }} / {{ rows.length }} 条（清除只删进度记忆，绑定与追番数据不受影响）</span>
        <div class="btn-row">
          <NPopconfirm :disabled="!selected.size" @positive-click="removeSelected">
            <template #trigger>
              <NButton size="small" quaternary type="error" :disabled="!selected.size" :loading="clearing">
                <template #icon><NIcon :component="TrashOutline" /></template>
                清除所选
              </NButton>
            </template>
            清除所选的 {{ selected.size }} 条播放进度？
          </NPopconfirm>
          <NPopconfirm @positive-click="removeAll">
            <template #trigger>
              <NButton size="small" quaternary type="error" :loading="clearing">
                <template #icon><NIcon :component="TrashOutline" /></template>
                全部清空
              </NButton>
            </template>
            清空全部播放进度记录？绑定关系仍会保留。
          </NPopconfirm>
        </div>
      </div>

      <section class="hist-section">
        <h3 class="hist-title">继续观看（{{ continueRows.length }}）</h3>
        <div v-if="!continueRows.length" class="hist-none">没有未看完的内容</div>
        <div v-for="row in continueRows" :key="`c-${row.owner.positionId}`" class="hist-row">
          <NCheckbox
            size="small"
            :checked="selected.has(row.owner.positionId)"
            @update:checked="(v: boolean) => toggle(row.owner.positionId, v)"
          />
          <img v-if="row.cover" class="hist-cover" :src="row.cover" alt="" loading="lazy" />
          <div v-else class="hist-cover hist-cover-empty" />
          <div class="hist-main">
            <div class="hist-name-line">
              <span class="hist-name" :title="row.name">{{ row.name || '未知条目' }}</span>
              <span class="hist-ep">第 {{ row.owner.sort }} 话</span>
              <NTag size="tiny" :bordered="false" round>{{ SOURCE_LABEL[row.owner.source] }}</NTag>
            </div>
            <div class="hist-progress-line">
              <span>{{ formatClock(row.position) }}{{ row.duration ? ` / ${formatClock(row.duration)}` : '' }}</span>
              <span class="hist-when">{{ fmtWhen(row.updatedAt) }}</span>
            </div>
          </div>
          <NButton size="tiny" type="primary" secondary round @click="resume(row)">
            <template #icon><NIcon :component="PlayOutline" /></template>
            续播
          </NButton>
        </div>
      </section>

      <section class="hist-section">
        <h3 class="hist-title">已看完（{{ finishedRows.length }}）</h3>
        <div v-if="!finishedRows.length" class="hist-none">还没有看完的记录</div>
        <div v-for="row in finishedRows" :key="`f-${row.owner.positionId}`" class="hist-row done">
          <NCheckbox
            size="small"
            :checked="selected.has(row.owner.positionId)"
            @update:checked="(v: boolean) => toggle(row.owner.positionId, v)"
          />
          <img v-if="row.cover" class="hist-cover" :src="row.cover" alt="" loading="lazy" />
          <div v-else class="hist-cover hist-cover-empty" />
          <div class="hist-main">
            <div class="hist-name-line">
              <span class="hist-name" :title="row.name">{{ row.name || '未知条目' }}</span>
              <span class="hist-ep">第 {{ row.owner.sort }} 话</span>
              <NTag size="tiny" :bordered="false" round>{{ SOURCE_LABEL[row.owner.source] }}</NTag>
            </div>
            <div class="hist-progress-line">
              <span>已看完 · {{ formatClock(row.duration || row.position) }}</span>
              <span class="hist-when">{{ fmtWhen(row.updatedAt) }}</span>
            </div>
          </div>
          <NButton size="tiny" quaternary round @click="resume(row)">再看</NButton>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.hist-state {
  display: flex;
  justify-content: center;
  margin: 60px 0;
}

.hist-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  padding: 8px 12px;
  border: 1px dashed var(--av-border);
  border-radius: 10px;
}

.hist-actions-info {
  font-size: 12px;
  color: var(--av-text-tertiary);
}

.btn-row {
  display: flex;
  gap: 8px;
}

.hist-section {
  margin-bottom: 22px;
}

.hist-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 700;
  color: var(--av-text-secondary);
}

.hist-none {
  font-size: 12px;
  color: var(--av-text-tertiary);
  padding: 6px 0;
}

.hist-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 10px;
  border-radius: 12px;
  transition: background 0.15s ease;
}

.hist-row:hover {
  background: var(--av-primary-soft);
}

.hist-row.done {
  opacity: 0.72;
}

.hist-cover {
  width: 46px;
  height: 62px;
  object-fit: cover;
  border-radius: 8px;
  flex: none;
}

.hist-cover-empty {
  background: var(--av-surface-grad, rgba(128, 128, 128, 0.18));
  border: 1px solid var(--av-border);
}

.hist-main {
  flex: 1;
  min-width: 0;
}

.hist-name-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.hist-name {
  font-size: 13.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hist-ep {
  font-size: 12px;
  color: var(--av-text-secondary);
  flex: none;
}

.hist-progress-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--av-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.hist-when {
  margin-left: auto;
}
</style>
