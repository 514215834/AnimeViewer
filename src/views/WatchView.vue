<script setup lang="ts">
/** v0.13 PL1/PL3 沉浸播放页（独立路由，无侧边栏）：解析绑定 → 拿到可播放源 →
 *  VideoPlayer 播放；进度持久化（续播记忆）+ ≥95% 自然看完自动复用 E1 链路标记看过。
 *  文件型绑定跨会话需恢复授权（浏览器安全模型）：授权失效时给出重授权/重绑引导。 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { NButton, NIcon, NSpin } from 'naive-ui'
import { ArrowBackOutline, LinkOutline, PlayOutline } from '@vicons/ionicons5'
import { dataSource } from '../api/dataSource'
import { useLibraryStore } from '../stores/library'
import { useSyncStore } from '../stores/sync'
import { isWatchedComplete, positionIdOf } from '../utils/mediaCore'
import { getBinding, getFileRecord, getPosition, savePosition } from '../utils/mediaStore'
import VideoPlayer from '../components/VideoPlayer.vue'
import EmptyHint from '../components/EmptyHint.vue'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const library = useLibraryStore()
const sync = useSyncStore()

const loading = ref(true)
/** 页面级错误（无绑定 / 句柄丢失 / 授权失败）：展示引导而非播放器 */
const fatal = ref('')
/** 授权可恢复（句柄还在，仅本会话未授权）——展示「重新授权」按钮而非重绑 */
const needPermission = ref(false)

const subjectId = computed(() => Number(route.query.subject) || 0)
const sort = computed(() => Number(route.query.sort) || 0)

const bindingName = ref('')
const videoTitle = ref('')
const videoSrc = ref('')
const startAt = ref(0)
/** 进度持久化的位置标识 */
let positionId = ''
let objectUrl = ''
/** 每次播放会话只自动标记一次 */
let autoMarked = false

/** PL5 演示视频资源（用户提供的内置样例，播放时才请求） */
const demoClipUrl = new URL('../assets/demo-clip.mp4', import.meta.url).href

async function load() {
  loading.value = true
  fatal.value = ''
  needPermission.value = false
  autoMarked = false
  videoSrc.value = ''
  startAt.value = 0
  try {
    if (!subjectId.value || !sort.value) {
      fatal.value = '缺少条目或集数参数'
      return
    }
    const binding = await getBinding(subjectId.value, sort.value)
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
      videoSrc.value = binding.url ?? ''
      if (!videoSrc.value) {
        fatal.value = '播放源地址为空'
        return
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
  } finally {
    loading.value = false
  }
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

/** PL3 进度持久化 + ≥95% 自动标记（复用 E1 单集增量链路，照常进入上云队列） */
async function onProgress(position: number, duration: number) {
  if (positionId) void savePosition(positionId, position, duration)
  if (autoMarked || !isWatchedComplete(position, duration)) return
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
onBeforeUnmount(() => {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = ''
})
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
          <NButton v-if="subjectId" quaternary size="small" @click="router.push({ path: `/subject/${subjectId}`, query: { tab: 'eps' } })">
            去剧集 Tab 管理绑定
          </NButton>
        </div>
      </EmptyHint>
    </div>

    <div v-else class="watch-shell">
      <VideoPlayer :src="videoSrc" :title="videoTitle" :start-at="startAt" @progress="onProgress" />
      <div class="watch-meta">
        <span class="watch-name">{{ videoTitle }}</span>
        <span class="watch-source" :title="bindingName">来源：{{ bindingName }}</span>
        <span class="watch-hint">空格播放/暂停 · ←→ 快进快退 · F 全屏 · 看完 95% 自动标记</span>
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
