<script setup lang="ts">
/** v0.14 S5 媒体库管理抽屉：服务状态 / 扫描控制 / 目录管理 / 文件列表与匹配操作。
 *  数据全部来自 AnimeViewerService API；服务未配置/不可达时展示引导态。 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NIcon,
  NInput,
  NModal,
  NPopconfirm,
  NSelect,
  NSpin,
  NTag,
} from 'naive-ui'
import { CloudDownloadOutline, RefreshOutline, SearchOutline, TrashOutline } from '@vicons/ionicons5'
import {
  mediaService,
  type SvcBangumiEpisode,
  type SvcBangumiSubject,
  type SvcDirectory,
  type SvcFile,
  type SvcMatchState,
  type SvcStatus,
} from '../api/mediaService'
import { useMessage } from 'naive-ui'
import EmptyHint from './EmptyHint.vue'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()
const message = useMessage()

const loading = ref(false)
const loadError = ref('')
const status = ref<SvcStatus | null>(null)
const dirs = ref<SvcDirectory[]>([])
const files = ref<SvcFile[]>([])
const total = ref(0)
const page = ref(0)
const PAGE_SIZE = 20
const stateFilter = ref<SvcMatchState | ''>('')
const keyword = ref('')
const appliedKeyword = ref('')
const newDirPath = ref('')
const addingDir = ref(false)

/* ── 改绑弹窗 ── */
const rebindFile = ref<SvcFile | null>(null)
const subjectOptions = ref<{ label: string; value: number }[]>([])
const subjectSearching = ref(false)
const pickedSubjectId = ref<number | null>(null)
const episodeOptions = ref<{ label: string; value: number }[]>([])
const episodeLoading = ref(false)
const pickedSort = ref<number | null>(null)
const binding = ref(false)

/* ── 扫描状态轮询（抽屉打开期间持续轮询；扫描运行中列表近实时刷新） ── */
let pollTimer: ReturnType<typeof setInterval> | null = null
let refreshing = false
/** 已「消费」过完成提示的扫描代际（startedAt）：轮询间隔可能错过整个快扫描的运行期，
 *  以 startedAt 变化判定「有一轮扫描结束了」，对快/慢扫描都可靠；null=有扫描在途 */
let seenFinishedScanAt: number | null | undefined = undefined

const scanRunning = computed(() => !!status.value?.scan.running)
const scanText = computed(() => {
  const s = status.value?.scan
  if (!s) return ''
  if (s.running) {
    if (s.phase === 'matching') {
      return `Bangumi 匹配中 ${s.matchDone}/${s.matchTotal} · 已自动绑定 ${s.matched}${s.currentPath ? ` · 正在匹配：${shortPath(s.currentPath)}` : ''}`
    }
    return `扫描中：已处理 ${s.scanned} · 新增 ${s.added} · 更新 ${s.updated}${s.currentPath ? ` · ${shortPath(s.currentPath)}` : ''}`
  }
  if (s.finishedAt) {
    return `上次完成：处理 ${s.scanned} · 新增 ${s.added} · 更新 ${s.updated} · 移除 ${s.removed} · 自动绑定 ${s.matched}${s.lastError ? ` · 错误：${s.lastError}` : ''}`
  }
  return '尚未执行过扫描'
})

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts.length > 2 ? `…/${parts[parts.length - 1]}` : p
}

function fmtSize(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

function fmtDuration(sec?: number): string {
  if (!sec || sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const STATE_META: Record<SvcMatchState, { label: string; type: 'default' | 'warning' | 'success' }> = {
  unmatched: { label: '未识别', type: 'default' },
  pending: { label: '待确认', type: 'warning' },
  bound: { label: '已绑定', type: 'success' },
}

const stateOptions = [
  { label: '全部状态', value: '' },
  { label: '未识别', value: 'unmatched' },
  { label: '待确认', value: 'pending' },
  { label: '已绑定', value: 'bound' },
]

async function refreshAll() {
  loading.value = true
  loadError.value = ''
  try {
    const [st, ds] = await Promise.all([mediaService.status(), mediaService.directories()])
    status.value = st
    dirs.value = ds
    // 打开时有扫描在途 → seen 置 null，确保其完成时仍会触发提示；否则记录当前代际（不误报历史完成）
    seenFinishedScanAt = st.scan.running ? null : (st.scan.startedAt ?? null)
    await refreshFiles()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function refreshDirs() {
  try {
    dirs.value = await mediaService.directories()
  } catch {
    /* 目录计数刷新失败静默 */
  }
}

/** 列表增量刷新：运行中每 2s 调用，上一帧未返回则跳过本帧（防请求堆积） */
async function refreshFiles() {
  if (refreshing) return
  refreshing = true
  try {
    const res = await mediaService.files({
      state: stateFilter.value || undefined,
      q: appliedKeyword.value || undefined,
      limit: PAGE_SIZE,
      offset: page.value * PAGE_SIZE,
    })
    files.value = res.items
    total.value = res.total
  } catch (e) {
    // 列表刷新失败不打断整体（保留状态区错误展示职责）
    message.warning(e instanceof Error ? e.message : '文件列表加载失败')
  } finally {
    refreshing = false
  }
}

async function search() {
  appliedKeyword.value = keyword.value.trim()
  page.value = 0
  await refreshFiles()
}

async function addDir() {
  const p = newDirPath.value.trim()
  if (!p) return
  addingDir.value = true
  try {
    await mediaService.addDirectory(p)
    newDirPath.value = ''
    message.success('已添加目录，开始扫描')
    await refreshAll()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '添加失败')
  } finally {
    addingDir.value = false
  }
}

async function removeDir(d: SvcDirectory) {
  try {
    await mediaService.removeDirectory(d.id)
    message.success('已移除目录及其索引')
    await refreshAll()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '移除失败')
  }
}

async function triggerScan(full: boolean) {
  try {
    await mediaService.scan(full)
    message.success(full ? '全量重扫已开始' : '增量扫描已开始')
    startPolling()
  } catch (e) {
    message.warning(e instanceof Error ? e.message : '触发失败')
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const st = await mediaService.status()
      status.value = st
      if (!st.scan.running) {
        // 完成判定：扫描代际（startedAt）变化 → 有一轮扫描结束（快扫描两次轮询间开始并结束也能捕获）
        const startedAt = st.scan.startedAt ?? null
        if (seenFinishedScanAt !== undefined && startedAt !== null && startedAt !== seenFinishedScanAt) {
          message.success(
            `扫描完成：处理 ${st.scan.scanned} · 新增 ${st.scan.added} · 自动绑定 ${st.scan.matched}` +
              (st.scan.lastError ? ` · 错误：${st.scan.lastError}` : ''),
          )
          await Promise.all([refreshFiles(), refreshDirs()])
        }
        if (startedAt !== null) seenFinishedScanAt = startedAt
      } else if (!rebindFile.value) {
        // 运行中：文件列表近实时刷新（改绑弹窗打开时暂停，避免干扰选择）
        await refreshFiles()
      }
    } catch {
      /* 轮询失败静默 */
    }
  }, 2000)
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

/* ── 匹配操作 ── */

async function confirmMatch(f: SvcFile) {
  if (!f.subjectId) {
    await openRebind(f)
    return
  }
  try {
    await mediaService.match(f.id, f.subjectId, f.parsedEpisode ?? 1)
    message.success(`已绑定《${f.subjectNameCn || f.subjectName}》第 ${f.parsedEpisode ?? 1} 话`)
    await Promise.all([refreshFiles(), refreshStatusOnly()])
  } catch (e) {
    message.error(e instanceof Error ? e.message : '绑定失败')
  }
}

async function rematch(f: SvcFile) {
  try {
    const r = await mediaService.rematch(f.id)
    message.info(r.state === 'bound' ? `自动绑定《${r.subjectNameCn || r.subjectName}》` : r.message || '已重新匹配')
    await Promise.all([refreshFiles(), refreshStatusOnly()])
  } catch (e) {
    message.error(e instanceof Error ? e.message : '匹配失败')
  }
}

async function unbind(f: SvcFile) {
  try {
    await mediaService.unbind(f.id)
    message.success('已解绑')
    await Promise.all([refreshFiles(), refreshStatusOnly()])
  } catch (e) {
    message.error(e instanceof Error ? e.message : '解绑失败')
  }
}

async function refreshStatusOnly() {
  try {
    status.value = await mediaService.status()
  } catch {
    /* 忽略 */
  }
}

/* ── 改绑弹窗 ── */

async function openRebind(f: SvcFile) {
  rebindFile.value = f
  subjectOptions.value = []
  episodeOptions.value = []
  pickedSubjectId.value = f.subjectId ?? null
  pickedSort.value = null
  if (f.subjectId && f.subjectNameCn) {
    subjectOptions.value = [{ label: `《${f.subjectNameCn || f.subjectName}》`, value: f.subjectId }]
    await loadEpisodes(f.subjectId)
    pickedSort.value = f.parsedEpisode ?? null
  }
}

async function searchSubjects(kw: string) {
  if (!kw.trim()) return
  subjectSearching.value = true
  try {
    const list = await mediaService.bangumiSearch(kw.trim())
    subjectOptions.value = list.map((s: SvcBangumiSubject) => ({
      label: `《${s.nameCn || s.name || s.subjectId}》${s.name && s.name !== s.nameCn ? ` ${s.name}` : ''}${s.date ? ` (${s.date.slice(0, 4)})` : ''}`,
      value: s.subjectId,
    }))
  } catch (e) {
    message.error(e instanceof Error ? e.message : '搜索失败')
  } finally {
    subjectSearching.value = false
  }
}

async function onSubjectPicked(subjectId: number) {
  pickedSubjectId.value = subjectId
  pickedSort.value = null
  episodeOptions.value = []
  await loadEpisodes(subjectId)
}

async function loadEpisodes(subjectId: number) {
  episodeLoading.value = true
  try {
    const list = await mediaService.bangumiEpisodes(subjectId)
    const TYPE_LABELS: Record<number, string> = { 0: '本篇', 1: 'SP', 2: 'OP', 3: 'ED', 4: '预告' }
    episodeOptions.value = list.map((e: SvcBangumiEpisode) => ({
      label: `[${TYPE_LABELS[e.type] ?? '其他'} ${e.sort}] ${e.nameCn || e.name || e.sort}`,
      value: e.sort,
    }))
  } catch (e) {
    message.error(e instanceof Error ? e.message : '剧集列表加载失败')
  } finally {
    episodeLoading.value = false
  }
}

async function submitRebind() {
  const f = rebindFile.value
  if (!f || !pickedSubjectId.value || !pickedSort.value) return
  binding.value = true
  try {
    await mediaService.match(f.id, pickedSubjectId.value, pickedSort.value)
    message.success('已改绑')
    rebindFile.value = null
    await Promise.all([refreshFiles(), refreshStatusOnly()])
  } catch (e) {
    message.error(e instanceof Error ? e.message : '改绑失败')
  } finally {
    binding.value = false
  }
}

watch(
  () => props.show,
  (show) => {
    if (show) {
      void refreshAll()
      startPolling()
    } else {
      stopPolling()
    }
  },
)

onBeforeUnmount(stopPolling)
</script>

<template>
  <NDrawer :show="props.show" :width="520" placement="right" @update:show="(v: boolean) => emit('update:show', v)">
    <NDrawerContent title="媒体库管理（AnimeViewerService）" closable>
      <NSpin :show="loading">
        <NAlert v-if="loadError" type="error" size="small" style="margin-bottom: 12px">{{ loadError }}</NAlert>

        <template v-if="status">
          <!-- 服务状态 -->
          <div class="svc-card">
            <div class="svc-line">
              <span class="svc-strong">v{{ status.version }}</span>
              <NTag size="tiny" round :type="status.ffmpeg ? 'success' : 'error'" :bordered="false">ffmpeg {{ status.ffmpeg ? '可用' : '未找到' }}</NTag>
              <NTag size="tiny" round :type="status.ffprobe ? 'success' : 'error'" :bordered="false">ffprobe {{ status.ffprobe ? '可用' : '未找到' }}</NTag>
            </div>
            <div class="svc-line svc-meta">
              文件 {{ status.files }} · 已绑定 {{ status.bound }} · 待确认 {{ status.pending }} · 未识别 {{ status.unmatched }}
            </div>
            <div class="svc-line svc-meta">{{ scanText }}</div>
            <div class="btn-row">
              <NButton size="small" secondary type="primary" :loading="scanRunning" @click="triggerScan(false)">
                <template #icon><NIcon :component="RefreshOutline" /></template>
                增量扫描
              </NButton>
              <NButton size="small" secondary :disabled="scanRunning" @click="triggerScan(true)">全量重扫</NButton>
            </div>
          </div>

          <!-- 目录管理 -->
          <div class="svc-card">
            <div class="svc-title">扫描目录</div>
            <div v-for="d in dirs" :key="d.id" class="dir-row">
              <span class="dir-path" :title="d.path">{{ d.path }}</span>
              <span class="dir-count">{{ d.fileCount }} 个</span>
              <NPopconfirm @positive-click="removeDir(d)">
                <template #trigger>
                  <NButton size="tiny" quaternary type="error">
                    <template #icon><NIcon :component="TrashOutline" /></template>
                  </NButton>
                </template>
                移除目录会同时删除其文件索引（不动磁盘文件）。
              </NPopconfirm>
            </div>
            <EmptyHint v-if="!dirs.length" text="还没有扫描目录" sub="添加一个包含视频文件的文件夹开始建库" />
            <div class="dir-add">
              <NInput v-model:value="newDirPath" size="small" placeholder="输入本机目录绝对路径，如 D:\Anime" @keyup.enter="addDir" />
              <NButton size="small" secondary :loading="addingDir" @click="addDir">添加并扫描</NButton>
            </div>
          </div>

          <!-- 文件列表 -->
          <div class="svc-card">
            <div class="svc-title">媒体文件</div>
            <div class="file-filter">
              <NSelect v-model:value="stateFilter" size="small" :options="stateOptions" class="state-select" @update:value="search" />
              <NInput v-model:value="keyword" size="small" clearable placeholder="文件名 / 标题" @keyup.enter="search" />
              <NButton size="small" secondary @click="search">
                <template #icon><NIcon :component="SearchOutline" /></template>
              </NButton>
            </div>
            <EmptyHint v-if="!files.length" text="没有匹配的文件" sub="先添加扫描目录，或调整筛选条件" />
            <div v-for="f in files" :key="f.id" class="file-row">
              <div class="file-main">
                <span class="file-name" :title="f.path">{{ f.name }}</span>
                <span class="file-meta">
                  {{ f.ext.toUpperCase() }} · {{ fmtSize(f.size) }}{{ fmtDuration(f.durationSec) ? ` · ${fmtDuration(f.durationSec)}` : '' }}
                  <template v-if="f.width"> · {{ f.width }}×{{ f.height }}</template>
                </span>
                <span v-if="f.downloadTaskName" class="file-src">
                  <NIcon :component="CloudDownloadOutline" /> 来自下载任务：{{ f.downloadTaskName }}
                </span>
                <span class="file-parse">
                  <template v-if="f.parsedTitle">识别：{{ f.parsedTitle }}<template v-if="f.parsedEpisode"> 第 {{ f.parsedEpisode }} 话</template></template>
                  <template v-else>未识别出标题</template>
                  <template v-if="f.matchState === 'bound' && f.subjectNameCn">
                    → 《{{ f.subjectNameCn }}》第 {{ f.episodeSort }} 话{{ f.autoBound ? '（自动）' : '' }}
                  </template>
                  <template v-else-if="f.matchState === 'pending' && f.subjectNameCn">
                    · 疑似《{{ f.subjectNameCn }}》
                  </template>
                </span>
                <span v-if="f.error" class="file-error">{{ f.error }}</span>
              </div>
              <div class="file-actions">
                <NTag size="tiny" round :type="STATE_META[f.matchState].type" :bordered="false">{{ STATE_META[f.matchState].label }}</NTag>
                <NButton
                  v-if="f.matchState === 'pending'"
                  size="tiny"
                  type="primary"
                  secondary
                  @click="confirmMatch(f)"
                >确认</NButton>
                <NButton v-if="f.matchState === 'unmatched' && f.parsedTitle" size="tiny" quaternary @click="rematch(f)">匹配</NButton>
                <NButton size="tiny" quaternary @click="openRebind(f)">{{ f.matchState === 'bound' ? '改绑' : '绑定' }}</NButton>
                <NPopconfirm v-if="f.matchState === 'bound'" @positive-click="unbind(f)">
                  <template #trigger>
                    <NButton size="tiny" quaternary type="error">解绑</NButton>
                  </template>
                  解除该文件与条目的绑定？
                </NPopconfirm>
              </div>
            </div>
            <div v-if="total > PAGE_SIZE" class="pager">
              <NButton size="tiny" quaternary :disabled="page === 0" @click="page--; refreshFiles()">上一页</NButton>
              <span class="pager-text">{{ page + 1 }} / {{ Math.ceil(total / PAGE_SIZE) }} · 共 {{ total }} 个</span>
              <NButton size="tiny" quaternary :disabled="(page + 1) * PAGE_SIZE >= total" @click="page++; refreshFiles()">下一页</NButton>
            </div>
          </div>
        </template>
      </NSpin>
    </NDrawerContent>
  </NDrawer>

  <!-- 改绑弹窗 -->
  <NModal
    :show="!!rebindFile"
    preset="card"
    style="max-width: 480px"
    title="绑定到 Bangumi 条目"
    @update:show="(v: boolean) => { if (!v) rebindFile = null }"
  >
    <NForm size="small" label-placement="top">
      <div class="rebind-file" :title="rebindFile?.path">{{ rebindFile?.name }}</div>
      <NFormItem label="1. 搜索并选择条目">
        <NSelect
          :value="pickedSubjectId"
          filterable
          remote
          clearable
          :options="subjectOptions"
          :loading="subjectSearching"
          placeholder="输入条目名搜索（走服务端直连 Bangumi）"
          @search="searchSubjects"
          @update:value="(v: number | null) => (v ? onSubjectPicked(v) : (pickedSubjectId = null))"
        />
      </NFormItem>
      <NFormItem label="2. 选择话数（sort）">
        <NSelect
          v-model:value="pickedSort"
          filterable
          :options="episodeOptions"
          :loading="episodeLoading"
          :disabled="!pickedSubjectId"
          placeholder="先选择条目"
        />
      </NFormItem>
    </NForm>
    <template #footer>
      <div class="btn-row" style="justify-content: flex-end">
        <NButton quaternary @click="rebindFile = null">取消</NButton>
        <NButton type="primary" secondary :loading="binding" :disabled="!pickedSubjectId || !pickedSort" @click="submitRebind">
          绑定
        </NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.svc-card {
  border: 1px solid var(--av-border);
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--av-surface);
}

.svc-title {
  font-size: 13px;
  font-weight: 700;
}

.svc-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
}

.svc-strong {
  font-weight: 700;
}

.svc-meta {
  font-size: 12px;
  color: var(--av-text-secondary);
}

.btn-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.dir-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 8px;
  background: var(--av-surface-hover);
}

.dir-path {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dir-count {
  font-size: 12px;
  color: var(--av-text-tertiary);
  flex-shrink: 0;
}

.dir-add {
  display: flex;
  gap: 8px;
}

.file-filter {
  display: flex;
  gap: 8px;
  align-items: center;
}

.state-select {
  width: 110px;
  flex-shrink: 0;
}

.file-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 6px;
  border-bottom: 1px dashed var(--av-border);
}

.file-row:last-child {
  border-bottom: none;
}

.file-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.file-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta,
.file-parse {
  font-size: 12px;
  color: var(--av-text-secondary);
}

/* v0.16 DN5 来源下载任务溯源 */
.file-src {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--av-primary);
}

.file-src .n-icon {
  font-size: 12px;
}

.file-error {
  font-size: 11px;
  color: var(--av-danger, #e05c5c);
}

.file-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
  flex-shrink: 0;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 8px;
}

.pager-text {
  font-size: 12px;
  color: var(--av-text-tertiary);
}

.rebind-file {
  font-size: 12px;
  color: var(--av-text-secondary);
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--av-surface-hover);
  margin-bottom: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
