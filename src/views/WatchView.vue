<script setup lang="ts">
/** v0.13 PL1/PL3 沉浸播放页（独立路由，无侧边栏）：解析绑定 → 拿到可播放源 →
 *  VideoPlayer 播放；进度持久化（续播记忆）+ ≥95% 自然看完自动复用 E1 链路标记看过。
 *  文件型绑定跨会话需恢复授权（浏览器安全模型）：授权失效时给出重授权/重绑引导。
 *  v0.14：新增媒体服务源（?file=服务文件ID）——mp4 直连 Range 流；mkv 等容器走服务端
 *  ffmpeg 转封装「直播式」流，seek 以 ?t= 重拉（seekBase 记录流起点，进度换算回绝对时间）。
 *  v0.15：URL 型绑定扩展为 直链/HLS（hls.js）/WebDAV 三类在线源；直连失败自动经服务代理
 *  重试一次（CORS 容灾）；弹幕按「条目+话数」维度加载与导入（dm: 存储，与源解耦）。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { NButton, NIcon, NSpin } from 'naive-ui'
import { ArrowBackOutline, LinkOutline, PlayOutline } from '@vicons/ionicons5'
import { dataSource } from '../api/dataSource'
import { mediaService, isDirectExt, servicePositionId, type SvcFile } from '../api/mediaService'
import { useLibraryStore } from '../stores/library'
import { useSyncStore } from '../stores/sync'
import { isWatchedComplete, positionIdOf } from '../utils/mediaCore'
import { parseDanmakuXml, type DanmakuItem } from '../utils/danmaku'
import { getBinding, getDanmaku, getFileRecord, getPosition, saveDanmaku, savePosition } from '../utils/mediaStore'
import VideoPlayer from '../components/VideoPlayer.vue'
import EmptyHint from '../components/EmptyHint.vue'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const library = useLibraryStore()
const sync = useSyncStore()

const loading = ref(true)
/** 页面级错误（无绑定 / 句柄丢失 / 授权失败 / 服务不可达）：展示引导而非播放器 */
const fatal = ref('')
/** 授权可恢复（句柄还在，仅本会话未授权）——展示「重新授权」按钮而非重绑 */
const needPermission = ref(false)

const subjectId = computed(() => Number(route.query.subject) || 0)
const sort = computed(() => Number(route.query.sort) || 0)
/** v0.14 服务媒体库文件 ID（存在即走服务源） */
const fileId = computed(() => Number(route.query.file) || 0)

const bindingName = ref('')
const videoTitle = ref('')
const videoSrc = ref('')
const startAt = ref(0)
/** v0.14 是否为服务端转封装流（seek 重拉模式） */
const remux = ref(false)
/** v0.15 O1 在线源（直链/HLS）：原始地址 + 是否已切换为服务代理 */
const urlSource = ref('')
const onlineProxied = ref(false)
/** v0.15 O4 弹幕（按条目+话数加载，全部源类型可用） */
const danmakuItems = ref<DanmakuItem[]>([])
const dmInput = ref<HTMLInputElement | null>(null)
/** 进度持久化的位置标识 */
let positionId = ''
let objectUrl = ''
/** 每次播放会话只自动标记一次 */
let autoMarked = false
/** v0.14 转封装流的起点（绝对时间）：进度 = seekBase + 流内时间 */
let seekBase = 0
/** 最近一次上报的播放位置（代理重试重建播放器时作为续播起点） */
let lastPosition = 0

/** PL5 演示视频资源（用户提供的内置样例，播放时才请求） */
const demoClipUrl = new URL('../assets/demo-clip.mp4', import.meta.url).href

/** 取源序号：参数快速变化时丢弃过期结果，防止旧响应覆盖新状态 */
let loadSeq = 0

async function load() {
  const seq = ++loadSeq
  loading.value = true
  fatal.value = ''
  needPermission.value = false
  autoMarked = false
  videoSrc.value = ''
  startAt.value = 0
  remux.value = false
  urlSource.value = ''
  onlineProxied.value = false
  lastPosition = 0
  seekBase = 0
  try {
    if (!subjectId.value || !sort.value) {
      fatal.value = '缺少条目或集数参数'
      return
    }
    // v0.15 O4 弹幕与源无关，全部源类型可用（导入入口在 meta 行）
    danmakuItems.value = await getDanmaku(subjectId.value, sort.value)
    if (seq !== loadSeq) return
    if (fileId.value) {
      await loadServiceSource(seq)
    } else {
      await loadLocalSource(seq)
    }
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

/** v0.14 服务媒体库源：mp4/m4v/webm 直连 Range；其余容器转封装 fMP4（?t= 起点） */
async function loadServiceSource(seq: number) {
  if (!mediaService.configured()) {
    fatal.value = '媒体服务未配置——请到设置页填写服务地址与 Token'
    return
  }
  let file: SvcFile
  try {
    file = await mediaService.fileDetail(fileId.value)
  } catch (e) {
    fatal.value = e instanceof Error ? e.message : String(e)
    return
  }
  if (seq !== loadSeq) return
  bindingName.value = file.name
  videoTitle.value = `第 ${sort.value} 话 · ${file.name}`
  positionId = servicePositionId(subjectId.value, sort.value)
  remux.value = !isDirectExt(file.ext)

  const pos = await getPosition(positionId)
  let resume = pos && pos.position > 5 ? pos.position : 0
  if (remux.value) {
    // 转封装：续播点直接作为流起点（-ss），进度按 seekBase 换算；
    // 已接近结尾（≥95%）则从头重播（与 direct 的 ready 判定同语义）
    if (resume && file.durationSec && resume >= file.durationSec * 0.95) resume = 0
    seekBase = resume
    videoSrc.value = mediaService.streamUrl(fileId.value, resume || undefined)
  } else {
    // 直连 Range：浏览器原生 seek
    startAt.value = resume
    videoSrc.value = mediaService.streamUrl(fileId.value)
  }
}

/** v0.13 本机文件 / 演示 / URL 三路取源 */
async function loadLocalSource(seq: number) {
  const binding = await getBinding(subjectId.value, sort.value)
  if (seq !== loadSeq) return
  if (!binding) {
    fatal.value = '该集还未绑定播放源——回剧集 Tab 的「本地播放」里绑定'
    return
  }
  bindingName.value = binding.name
  videoTitle.value = `第 ${sort.value} 话 · ${binding.name}`
  positionId = positionIdOf(binding)

  if (binding.type === 'demo') {
    videoSrc.value = demoClipUrl
  } else if (binding.type === 'url') {
    if (binding.webdav) {
      // v0.15 O3 WebDAV 源：凭据在服务端会话（open→streamId），播放地址不含凭据；Range 直连原生 seek
      if (!mediaService.configured()) {
        fatal.value = 'WebDAV 播放需要媒体服务（凭据由服务端会话托管）——请到设置页配置服务与 WebDAV 账号'
        return
      }
      try {
        const open = await mediaService.webdavOpen()
        if (seq !== loadSeq) return
        videoSrc.value = mediaService.webdavStreamUrl(open.streamId)
      } catch (e) {
        fatal.value = e instanceof Error ? e.message : String(e)
        return
      }
    } else {
      // v0.15 O1 直链 / HLS：先直连，失败经服务代理重试一次
      urlSource.value = binding.url ?? ''
      applyOnlineSource()
      if (!videoSrc.value) return
    }
  } else {
    // 文件型：优先 File 对象（拖拽/input 兜底），其次 FSA 句柄（跨会话需恢复授权）
    const rec = binding.fileKey ? await getFileRecord(binding.fileKey) : null
    const storedFile = rec?.file
    if (storedFile instanceof File) {
      objectUrl = URL.createObjectURL(storedFile)
      videoSrc.value = objectUrl
    } else if (!rec?.handle) {
      fatal.value = '文件句柄不存在（可能来自导入备份或已清除）——请回详情页重新绑定本地文件'
      return
    } else {
      const handle = rec.handle as {
        queryPermission?: (d: { mode: string }) => Promise<PermissionState>
        requestPermission?: (d: { mode: string }) => Promise<PermissionState>
        getFile: () => Promise<File>
      }
      let perm: PermissionState = 'denied'
      try {
        perm = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted'
      } catch {
        perm = 'granted'
      }
      if (perm !== 'granted') {
        // 导航进入时用户手势可能已过期——提供显式授权按钮（点击即手势）
        needPermission.value = true
        fatal.value = '浏览器要求每次会话重新授权本地文件访问'
        return
      }
      const file = await handle.getFile()
      objectUrl = URL.createObjectURL(file)
      videoSrc.value = objectUrl
    }
  }

  // PL3 续播记忆
  const pos = await getPosition(positionId)
  if (pos && pos.position > 5) startAt.value = pos.position
}

/** 显式重新授权（按钮点击 = 用户手势） */
async function reauthorize() {
  const binding = await getBinding(subjectId.value, sort.value)
  const rec = binding?.fileKey ? await getFileRecord(binding.fileKey) : null
  const handle = rec?.handle as
    | { requestPermission?: (d: { mode: string }) => Promise<PermissionState> }
    | undefined
  if (!handle) {
    fatal.value = '文件句柄不存在——请回详情页重新绑定本地文件'
    needPermission.value = false
    return
  }
  try {
    const perm = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied'
    if (perm === 'granted') {
      await load()
      return
    }
  } catch {
    // 用户取消授权，维持现状
  }
  message.warning('未获得文件访问授权')
}

/** v0.15 O1 在线源地址解析：直连优先，代理态经服务转发（videoSrc 变化 → :key 重建播放器） */
function applyOnlineSource() {
  const url = urlSource.value
  if (!url) {
    fatal.value = '播放源地址为空'
    return
  }
  if (onlineProxied.value) {
    const proxied = mediaService.proxyUrl(url)
    if (!proxied) {
      fatal.value = '媒体服务未配置，无法经代理播放在线源'
      return
    }
    videoSrc.value = proxied
  } else {
    videoSrc.value = url
  }
}

/** v0.15 O1 在线源加载失败容灾：未代理过且服务可用 → 自动经代理重试一次（结果不粘性记忆） */
function onSourceError() {
  if (!urlSource.value) return
  if (onlineProxied.value) {
    fatal.value = '在线源播放失败（直连与代理均不可用）——请检查地址是否有效，或更换播放源'
    return
  }
  if (!mediaService.configured()) {
    fatal.value = '在线源直连失败（通常是跨域限制）——配置媒体服务后可自动经代理重试'
    return
  }
  onlineProxied.value = true
  if (lastPosition > 5) startAt.value = lastPosition
  applyOnlineSource()
}

/** v0.15 O4 弹幕导入：B 站 XML → 解析 → dm: 存储热更新（整文件失败拒绝导入） */
async function onDanmakuFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const items = parseDanmakuXml(await file.text())
    await saveDanmaku(subjectId.value, sort.value, items)
    danmakuItems.value = items
    message.success(`已导入 ${items.length} 条弹幕`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '弹幕导入失败')
  }
}

/** PL3 进度持久化 + ≥95% 自动标记（复用 E1 单集增量链路，照常进入上云队列）。
 *  v0.14：position/duration 为流内相对值——转封装流按 seekBase 换算回文件绝对时间再存储/判定。 */
async function onProgress(position: number, duration: number) {
  lastPosition = position
  const absPos = seekBase + position
  const absDur = seekBase + duration
  if (positionId) void savePosition(positionId, absPos, absDur)
  if (autoMarked || !isWatchedComplete(absPos, absDur)) return
  autoMarked = true
  try {
    if (!library.has(subjectId.value)) {
      message.info('看完啦！加入追番后可自动标记进度')
      return
    }
    const entry = library.entry(subjectId.value)
    if (entry?.watchedEps?.includes(sort.value)) return
    const episodes = await dataSource.episodes(subjectId.value)
    const ep = episodes.find((e) => e.type === 0 && e.sort === sort.value)
    if (!ep) return
    await sync.markEpisodeWatched(subjectId.value, ep.id, ep.type, ep.sort, true)
    message.success(`自然看完，已自动标记第 ${sort.value} 话看过`)
  } catch {
    // 标记失败静默：不影响观看（下次看完再触发或手动勾选）
  }
}

onMounted(load)
// 同路由不同参数（换集播放）时组件复用——必须重新走取源流程
watch(
  () => `${route.query.subject ?? ''}|${route.query.sort ?? ''}|${route.query.file ?? ''}`,
  () => {
    if (route.name === 'watch') void load()
  },
)
onBeforeUnmount(() => {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = ''
})

/** v0.14 remux seek 重拉：外层以 ?t= 重建流（VideoPlayer 经 key 变更重挂载） */
function onSeekReload(target: number) {
  if (!remux.value || !fileId.value) return
  const abs = seekBase + target
  seekBase = abs
  startAt.value = 0
  videoSrc.value = mediaService.streamUrl(fileId.value, abs || undefined)
}
</script>

<template>
  <div class="watch-page">
    <div class="watch-topbar">
      <NButton quaternary size="small" @click="router.back()">
        <template #icon><NIcon :component="ArrowBackOutline" /></template>
        返回
      </NButton>
      <span class="watch-title">{{ videoTitle || '播放' }}</span>
      <NButton
        v-if="subjectId"
        quaternary
        size="small"
        class="watch-eps-link"
        @click="router.push({ path: `/subject/${subjectId}`, query: { tab: 'eps' } })"
      >
        <template #icon><NIcon :component="LinkOutline" /></template>
        回剧集列表
      </NButton>
    </div>

    <div v-if="loading" class="watch-state"><NSpin size="medium" /></div>

    <div v-else-if="fatal" class="watch-state">
      <EmptyHint text="无法开始播放" :sub="fatal">
        <div class="fatal-actions">
          <NButton v-if="needPermission" type="primary" secondary size="small" @click="reauthorize">
            <template #icon><NIcon :component="PlayOutline" /></template>
            重新授权并播放
          </NButton>
          <NButton v-if="fileId" size="small" @click="load">重试</NButton>
          <NButton v-if="subjectId" quaternary size="small" @click="router.push({ path: `/subject/${subjectId}`, query: { tab: 'eps' } })">
            去剧集 Tab 管理绑定
          </NButton>
        </div>
      </EmptyHint>
    </div>

    <div v-else class="watch-shell">
      <VideoPlayer
        :key="videoSrc"
        :src="videoSrc"
        :title="videoTitle"
        :start-at="startAt"
        :remux="remux"
        :danmaku="danmakuItems"
        @progress="onProgress"
        @seekreload="onSeekReload"
        @sourceerror="onSourceError"
      />
      <div class="watch-meta">
        <span class="watch-name">{{ videoTitle }}</span>
        <span class="watch-source" :title="bindingName">来源：{{ bindingName }}</span>
        <span v-if="onlineProxied" class="watch-source">· 经服务代理</span>
        <span v-if="danmakuItems.length" class="watch-source">弹幕 {{ danmakuItems.length }} 条</span>
        <input ref="dmInput" type="file" accept=".xml,text/xml,application/xml" hidden @change="onDanmakuFile" />
        <NButton size="tiny" quaternary @click="dmInput?.click()">导入弹幕</NButton>
        <span class="watch-hint">
          {{ remux ? '转封装流 · 拖动进度将重新加载' : '空格播放/暂停 · ←→ 快进快退 · F 全屏' }} · 看完 95% 自动标记
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 沉浸页不铺背景面板：透出全局氛围层（body 氛围层在本路由同样生效） */
.watch-page {
  min-height: 100vh;
  padding: 14px clamp(14px, 4vw, 40px) 40px;
}

.watch-topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  max-width: 1100px;
  margin-left: auto;
  margin-right: auto;
}

.watch-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--av-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.watch-eps-link {
  margin-left: auto;
}

.watch-shell {
  max-width: 1100px;
  margin: 0 auto;
}

.watch-state {
  max-width: 1100px;
  margin: 60px auto;
  display: flex;
  justify-content: center;
}

.fatal-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 14px;
}

.watch-meta {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.watch-name {
  font-size: 15px;
  font-weight: 700;
}

.watch-source {
  font-size: 12px;
  color: var(--av-text-tertiary);
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.watch-hint {
  font-size: 12px;
  color: var(--av-text-tertiary);
  margin-left: auto;
}
</style>
