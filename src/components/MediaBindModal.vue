<script setup lang="ts">
/** v0.13 PL2 本地播放绑定弹窗：
 *  ① 目录扫描（showDirectoryPicker，句柄持久化、跨会话恢复授权）② 多选文件
 *  ③ 拖拽兜底（全浏览器）④ 演示模式内置样例视频；
 *  文件 → 集数为手动绑定（集数自动猜测仅作预填，正式识别在 v0.14 服务端）。
 *  兼容性：File System Access API 仅 Chromium；Firefox/Safari 走 <input type=file> + 拖拽。
 *  v0.15 O1/O3：新增「添加在线源」（直链 / m3u8，URL 文件名段猜测集数）与
 *  WebDAV 浏览（账号在设置页配置，服务端 PROPFIND 列目录，绑定记 webdav 元数据）。 */
import { computed, ref, watch } from 'vue'
import { NButton, NIcon, NInput, NModal, NSelect, NTag } from 'naive-ui'
import { CloudOutline, FolderOpenOutline, FolderOutline, PlayOutline, TrashOutline, VideocamOutline } from '@vicons/ionicons5'
import type { Episode } from '../types/bangumi'
import { useSettingsStore } from '../stores/settings'
import { useMessage } from 'naive-ui'
import { mediaService, type SvcWebdavEntry } from '../api/mediaService'
import {
  fileKeyOf,
  guessEpisodeSort,
  isVideoName,
  urlFileName,
  type MediaBinding,
} from '../utils/mediaCore'
import {
  getLastDir,
  getBinding,
  listBindings,
  putFileRecord,
  removeBinding,
  setBinding,
  setLastDir,
} from '../utils/mediaStore'

const props = defineProps<{
  show: boolean
  subjectId: number
  /** 正篇剧集列表（绑定目标选项） */
  episodes: Episode[]
  /** 打开时预选的集数（从单集抽屉进入时带上） */
  defaultSort?: number
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'changed'): void
  (e: 'play', sort: number): void
}>()

const settings = useSettingsStore()
const message = useMessage()

/** 待绑定文件（目录扫描 / 多选 / 拖拽汇入同一列表） */
interface PendingFile {
  name: string
  size: number
  /** File System Access 句柄（Chromium，可持久化） */
  handle?: unknown
  /** File 对象（拖拽 / input 兜底；Chrome 可持久化文件引用，其他浏览器仅本会话可用） */
  file?: File
  /** 预填集数猜测 */
  guess: number | null
  /** 行内选择的绑定集数 */
  sort: number | null
}

const pending = ref<PendingFile[]>([])
const dirName = ref('')
const lastDirName = ref('')
const lastDirHandle = ref<unknown>(null)
const bindings = ref<MediaBinding[]>([])
const scanning = ref(false)
const dropActive = ref(false)

/* 最小化的句柄接口（避免依赖 lib.dom 的 FSA 类型差异） */
interface FileHandleLike {
  kind: 'file'
  name: string
  getFile: () => Promise<File>
}
interface DirHandleLike {
  kind: 'directory'
  name: string
  values: () => AsyncIterableIterator<FileHandleLike | { kind: 'directory'; name: string }>
}
type PickerWindow = {
  showDirectoryPicker?: () => Promise<DirHandleLike>
  showOpenFilePicker?: (opts?: { multiple?: boolean; types?: unknown[] }) => Promise<FileHandleLike[]>
}

const sortOptions = () =>
  props.episodes.map((e) => ({
    label: `第 ${e.sort} 话${e.name_cn ? ` · ${e.name_cn}` : ''}`,
    value: e.sort,
  }))

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

async function refreshBindings() {
  bindings.value = await listBindings(props.subjectId)
}

watch(
  () => props.show,
  async (show) => {
    if (!show) return
    pending.value = []
    dirName.value = ''
    await refreshBindings()
    const last = await getLastDir()
    lastDirName.value = last?.name ?? ''
    lastDirHandle.value = last?.handle ?? null
  },
)

async function addFiles(list: { name: string; size: number; handle?: unknown; file?: File }[]) {
  const videos = list.filter((f) => isVideoName(f.name))
  const skipped = list.length - videos.length
  if (skipped > 0) message.info(`已跳过 ${skipped} 个非视频文件`)
  if (!videos.length) return
  const existing = new Set(pending.value.map((p) => `${p.name}:${p.size}`))
  for (const f of videos) {
    const key = `${f.name}:${f.size}`
    if (existing.has(key)) continue
    existing.add(key)
    const guess = guessEpisodeSort(f.name)
    pending.value.push({ ...f, guess, sort: guess })
  }
}

async function pickDirectory() {
  const w = window as PickerWindow
  if (!w.showDirectoryPicker) {
    message.warning('当前浏览器不支持目录选择（需 Chrome/Edge），可使用「选择文件」或拖拽')
    return
  }
  try {
    scanning.value = true
    const dir = await w.showDirectoryPicker()
    await setLastDir(dir.name, dir)
    lastDirName.value = dir.name
    lastDirHandle.value = dir
    dirName.value = dir.name
    await scanDir(dir)
  } catch {
    // 用户取消选择
  } finally {
    scanning.value = false
  }
}

async function restoreDir() {
  const handle = lastDirHandle.value as DirHandleLike | null
  if (!handle) return
  try {
    scanning.value = true
    const anyHandle = handle as unknown as {
      queryPermission?: (d: { mode: string }) => Promise<PermissionState>
      requestPermission?: (d: { mode: string }) => Promise<PermissionState>
    }
    let perm: PermissionState = 'granted'
    try {
      perm = (await anyHandle.queryPermission?.({ mode: 'read' })) ?? 'granted'
    } catch {
      perm = 'granted'
    }
    if (perm !== 'granted') {
      perm = (await anyHandle.requestPermission?.({ mode: 'read' })) ?? 'denied'
    }
    if (perm !== 'granted') {
      message.warning('未获得目录访问授权')
      return
    }
    dirName.value = handle.name
    await scanDir(handle)
  } finally {
    scanning.value = false
  }
}

async function scanDir(dir: DirHandleLike) {
  const list: { name: string; size: number; handle: unknown }[] = []
  try {
    for await (const entry of dir.values()) {
      if (entry.kind !== 'file' || !isVideoName(entry.name)) continue
      if (list.length >= 500) {
        message.warning('目录文件过多，仅列前 500 个视频')
        break
      }
      const file = await entry.getFile()
      list.push({ name: entry.name, size: file.size, handle: entry })
    }
  } catch {
    message.error('目录读取失败')
  }
  await addFiles(list)
  if (list.length) message.success(`已扫描 ${list.length} 个视频文件`)
  else message.info('目录中没有视频文件')
}

async function pickFiles() {
  const w = window as PickerWindow
  if (w.showOpenFilePicker) {
    try {
      const handles = await w.showOpenFilePicker({ multiple: true })
      const list: { name: string; size: number; handle: unknown }[] = []
      for (const h of handles) {
        const file = await h.getFile()
        list.push({ name: file.name, size: file.size, handle: h })
      }
      await addFiles(list)
    } catch {
      // 用户取消
    }
    return
  }
  // 非 Chromium 兜底：隐藏 input
  fileInput.value?.click()
}

const fileInput = ref<HTMLInputElement | null>(null)

function onInputFiles(ev: Event) {
  const input = ev.target as HTMLInputElement
  const files = Array.from(input.files ?? []).map((f) => ({ name: f.name, size: f.size, file: f }))
  void addFiles(files)
  input.value = ''
}

function onDrop(ev: DragEvent) {
  dropActive.value = false
  const files = Array.from(ev.dataTransfer?.files ?? []).map((f) => ({ name: f.name, size: f.size, file: f }))
  void addFiles(files)
}

async function bindRow(row: PendingFile) {
  if (!row.sort) {
    message.warning('请先选择要绑定到的集数')
    return
  }
  const fileKey = fileKeyOf(row.name, row.size)
  await putFileRecord({ fileKey, name: row.name, size: row.size, handle: row.handle, file: row.file })
  await setBinding({
    subjectId: props.subjectId,
    sort: row.sort,
    name: row.name,
    type: 'file',
    fileKey,
    addedAt: Date.now(),
  })
  message.success(`已绑定到第 ${row.sort} 话`)
  pending.value = pending.value.filter((p) => p !== row)
  await refreshBindings()
  emit('changed')
}

async function bindDemo() {
  await setBinding({
    subjectId: props.subjectId,
    sort: props.defaultSort ?? 1,
    name: '演示视频（内置样例）',
    type: 'demo',
    addedAt: Date.now(),
  })
  message.success(`演示视频已绑定到第 ${props.defaultSort ?? 1} 话`)
  await refreshBindings()
  emit('changed')
}

async function unbind(sort: number) {
  await removeBinding(props.subjectId, sort)
  message.info(`已解绑第 ${sort} 话`)
  await refreshBindings()
  emit('changed')
}

/* ── v0.15 O1 添加在线源（直链 / m3u8）── */

const urlDraft = ref('')
const urlName = ref('')
const urlSort = ref<number | null>(null)
const urlReady = computed(() => /^https?:\/\//i.test(urlDraft.value.trim()))

watch(urlDraft, (v) => {
  // 地址输入时从文件名段预填集数（如 episode-03.mp4 → 3），可人工修正
  urlSort.value = urlReady.value ? guessEpisodeSort(urlFileName(v)) : null
})

async function bindUrl() {
  const url = urlDraft.value.trim()
  if (!/^https?:\/\//i.test(url)) {
    message.warning('请输入 http(s):// 开头的播放地址')
    return
  }
  if (!urlSort.value) {
    message.warning('请先选择要绑定到的集数')
    return
  }
  await setBinding({
    subjectId: props.subjectId,
    sort: urlSort.value,
    name: urlName.value.trim() || urlFileName(url) || '在线源',
    type: 'url',
    url,
    addedAt: Date.now(),
  })
  message.success(`在线源已绑定到第 ${urlSort.value} 话`)
  urlDraft.value = ''
  urlName.value = ''
  urlSort.value = null
  await refreshBindings()
  emit('changed')
}

/* ── v0.15 O3 WebDAV 浏览（账号在设置页配置；凭据只在服务端 POST 体流转）── */

const davLoading = ref(false)
const davPath = ref('/')
const davList = ref<SvcWebdavEntry[]>([])
const davSorts = ref<Record<string, number | null>>({})
const davCrumb = computed(() => davPath.value.split('/').filter(Boolean))

async function browseDav(path: string) {
  if (!settings.webdavEnabled) {
    message.warning('请先在设置页配置 WebDAV 账号')
    return
  }
  davLoading.value = true
  try {
    const res = await mediaService.webdavBrowse(path)
    davPath.value = res.path
    davList.value = res.list
    const sorts: Record<string, number | null> = {}
    for (const e of res.list) if (!e.dir) sorts[e.name] = guessEpisodeSort(e.name)
    davSorts.value = sorts
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'WebDAV 浏览失败')
  } finally {
    davLoading.value = false
  }
}

function davEnter(entry: SvcWebdavEntry) {
  void browseDav(`${davPath.value === '/' ? '' : davPath.value}/${entry.name}`)
}

/** 绑定记录的 url 字段 = WebDAV 文件完整地址（仅作标识与进度键；播放走 open→streamId 会话流） */
function davFileUrl(filePath: string): string {
  return `${settings.webdavRoot}${filePath}`
}

async function bindDavFile(entry: SvcWebdavEntry) {
  const sort = davSorts.value[entry.name] ?? guessEpisodeSort(entry.name)
  if (!sort) {
    message.warning('请先选择要绑定到的集数')
    return
  }
  const filePath = `${davPath.value === '/' ? '' : davPath.value}/${entry.name}`
  await setBinding({
    subjectId: props.subjectId,
    sort,
    name: entry.name,
    type: 'url',
    url: davFileUrl(filePath),
    webdav: { path: filePath },
    addedAt: Date.now(),
  })
  message.success(`WebDAV 文件已绑定到第 ${sort} 话`)
  await refreshBindings()
  emit('changed')
}

async function playBound(sort: number) {
  // 直接校验绑定仍存在（句柄授权在播放页处理）
  const b = await getBinding(props.subjectId, sort)
  if (!b) return
  close()
  emit('play', sort)
}

function close() {
  emit('update:show', false)
}
</script>

<template>
  <NModal :show="show" preset="card" style="width: 720px; max-width: 94vw" title="本地播放 · 绑定视频文件" :bordered="false" @update:show="close">
    <div class="mb-body">
      <!-- 已绑定 -->
      <section class="mb-section">
        <h4 class="mb-title">已绑定（{{ bindings.length }}）</h4>
        <div v-if="!bindings.length" class="mb-empty">还没有绑定——从下方添加视频文件</div>
        <div v-for="b in bindings" :key="b.sort" class="mb-bound-row">
          <NTag size="small" :bordered="false" type="primary" round>第 {{ b.sort }} 话</NTag>
          <span class="mb-bound-name" :title="b.name">{{ b.name }}</span>
          <NButton size="tiny" type="primary" secondary round @click="playBound(b.sort)">
            <template #icon><NIcon :component="PlayOutline" /></template>
            播放
          </NButton>
          <NButton size="tiny" quaternary type="error" @click="unbind(b.sort)">
            <template #icon><NIcon :component="TrashOutline" /></template>
            解绑
          </NButton>
        </div>
      </section>

      <!-- 添加 -->
      <section class="mb-section">
        <h4 class="mb-title">添加文件</h4>
        <div class="mb-actions">
          <NButton size="small" secondary @click="pickDirectory">
            <template #icon><NIcon :component="FolderOpenOutline" /></template>
            选择目录（批量）
          </NButton>
          <NButton size="small" secondary @click="pickFiles">
            <template #icon><NIcon :component="VideocamOutline" /></template>
            选择文件（多选）
          </NButton>
          <NButton v-if="settings.isDemo" size="small" secondary type="primary" @click="bindDemo">
            <template #icon><NIcon :component="PlayOutline" /></template>
            使用演示视频（绑到第 {{ defaultSort ?? 1 }} 话）
          </NButton>
        </div>
        <NButton v-if="lastDirName && !dirName" size="tiny" quaternary style="margin-top: 8px" @click="restoreDir">
          恢复上次目录：{{ lastDirName }}（需重新授权）
        </NButton>

        <!-- 非 Chromium 兜底：隐藏 input 多选 -->
        <input ref="fileInput" type="file" multiple accept="video/*,.mkv,.ts,.m2ts" hidden @change="onInputFiles" />

        <!-- 拖拽区 -->
        <div
          class="mb-drop"
          :class="{ active: dropActive }"
          @dragover.prevent="dropActive = true"
          @dragleave="dropActive = false"
          @drop.prevent="onDrop"
        >
          拖拽视频文件到此处（{{ dirName ? `已扫描目录：${dirName}` : '或使用上方按钮选择' }}）
        </div>

        <!-- 待绑定列表 -->
        <div v-if="pending.length" class="mb-pending">
          <div v-for="(row, i) in pending" :key="`${row.name}:${row.size}`" class="mb-pending-row">
            <span class="mb-file-name" :title="row.name">{{ row.name }}</span>
            <span class="mb-file-size">{{ fmtSize(row.size) }}</span>
            <NSelect
              v-model:value="row.sort"
              size="tiny"
              filterable
              placeholder="绑定到"
              style="width: 200px"
              :options="sortOptions()"
              :consistent-menu-width="false"
            />
            <NButton size="tiny" type="primary" :secondary="row.guess === null" @click="bindRow(row)">绑定</NButton>
            <NButton size="tiny" quaternary @click="pending.splice(i, 1)">移除</NButton>
          </div>
        </div>
      </section>

      <!-- v0.15 O1/O3 添加在线源 -->
      <section class="mb-section">
        <h4 class="mb-title">添加在线源（用户自备）</h4>
        <div class="mb-url-row">
          <NInput
            v-model:value="urlDraft"
            size="small"
            clearable
            placeholder="视频直链（mp4/webm）或 m3u8 地址，http(s):// 开头"
          />
          <NSelect
            v-model:value="urlSort"
            size="small"
            filterable
            placeholder="绑定到"
            style="width: 190px"
            :options="sortOptions()"
            :consistent-menu-width="false"
          />
        </div>
        <div class="mb-url-row" style="margin-top: 8px">
          <NInput v-model:value="urlName" size="small" clearable placeholder="名称（可选，默认取地址文件名）" />
          <NButton size="small" type="primary" secondary :disabled="!urlReady || !urlSort" @click="bindUrl">
            <template #icon><NIcon :component="CloudOutline" /></template>
            绑定
          </NButton>
        </div>

        <!-- WebDAV 浏览 -->
        <div v-if="settings.webdavEnabled" class="mb-dav">
          <div class="mb-dav-head">
            <NButton size="tiny" secondary @click="browseDav('/')">
              <template #icon><NIcon :component="CloudOutline" /></template>
              浏览 WebDAV
            </NButton>
            <span v-if="davList.length" class="mb-dav-crumb">
              <a @click="browseDav('/')">根目录</a>
              <template v-for="(seg, i) in davCrumb" :key="i">
                /
                <a @click="browseDav(`/${davCrumb.slice(0, i + 1).join('/')}`)">{{ seg }}</a>
              </template>
            </span>
          </div>
          <div v-if="davLoading" class="mb-empty">加载中…</div>
          <div v-else-if="davList.length" class="mb-dav-list">
            <div v-for="entry in davList" :key="`${davPath}:${entry.name}`" class="mb-pending-row">
              <NIcon :component="entry.dir ? FolderOutline : VideocamOutline" size="14" />
              <a v-if="entry.dir" class="mb-file-name mb-dav-dir" :title="entry.name" @click="davEnter(entry)">{{ entry.name }}</a>
              <span v-else class="mb-file-name" :title="entry.name">{{ entry.name }}</span>
              <span v-if="!entry.dir && entry.size" class="mb-file-size">{{ fmtSize(entry.size) }}</span>
              <template v-if="!entry.dir">
                <NSelect
                  v-model:value="davSorts[entry.name]"
                  size="tiny"
                  filterable
                  placeholder="绑定到"
                  style="width: 190px"
                  :options="sortOptions()"
                  :consistent-menu-width="false"
                />
                <NButton size="tiny" type="primary" secondary @click="bindDavFile(entry)">绑定</NButton>
              </template>
            </div>
          </div>
          <div v-else class="mb-empty">点「浏览 WebDAV」列出根目录</div>
        </div>
        <p v-else class="mb-inline-hint">配置 WebDAV 账号后（设置页 · WebDAV 账号）可在此浏览并绑定网络存储中的视频。</p>
      </section>

      <p class="mb-hint">
        句柄保存在本机浏览器，每次会话需重新授权（浏览器安全策略）；支持 mp4 / webm 直播，mkv / avi
        等容器浏览器暂不支持播放（v0.14 服务端转封装解决）。Firefox/Safari 不支持目录选择，可多选文件或拖拽。
        在线源仅限用户自备地址；m3u8 经 hls.js 播放，直链跨域受限且已配置媒体服务时自动经服务代理。
      </p>
    </div>
  </NModal>
</template>

<style scoped>
.mb-section {
  margin-bottom: 16px;
}

.mb-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--av-text-secondary);
}

.mb-empty {
  font-size: 12px;
  color: var(--av-text-tertiary);
  padding: 6px 0;
}

.mb-bound-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}

.mb-bound-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* v0.15 在线源行 */
.mb-url-row {
  display: flex;
  gap: 8px;
}

.mb-inline-hint {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--av-text-tertiary);
}

.mb-dav {
  margin-top: 12px;
  border-top: 1px dashed var(--av-border);
  padding-top: 10px;
}

.mb-dav-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.mb-dav-crumb {
  font-size: 12px;
  color: var(--av-text-tertiary);
}

.mb-dav-crumb a {
  color: var(--av-primary);
  cursor: pointer;
}

.mb-dav-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
}

.mb-dav-dir {
  color: var(--av-primary);
  cursor: pointer;
}

.mb-drop {
  margin-top: 10px;
  padding: 18px 14px;
  border: 1px dashed var(--av-border);
  border-radius: 10px;
  text-align: center;
  font-size: 12px;
  color: var(--av-text-tertiary);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.mb-drop.active {
  border-color: var(--av-primary);
  background: var(--av-primary-soft);
  color: var(--av-primary-hover);
}

.mb-pending {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
}

.mb-pending-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mb-file-name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-file-size {
  flex: none;
  font-size: 11px;
  color: var(--av-text-tertiary);
}

.mb-hint {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--av-text-tertiary);
}
</style>
