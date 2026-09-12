<script setup lang="ts">
/** v0.13 PL1 播放器组件：封装 ArtPlayer（动态 import 独立 chunk，不进业务主包）。
 *  职责边界：本组件只管「播 + 报进度」——进度持久化、续播定位、完播自动标记由 WatchView 决策；
 *  键盘：空格/←→/↑↓ 由 ArtPlayer hotkey 承担（播放器聚焦时），F 全屏为本组件自定义。 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type Artplayer from 'artplayer'
import { formatClock } from '../utils/mediaCore'

const props = defineProps<{
  src: string
  title?: string
  /** 续播起点（秒）；>5s 且未到 95% 时自动 seek 并提示 */
  startAt?: number
}>()

const emit = defineEmits<{
  (e: 'ready', duration: number): void
  /** 播放进度（节流 ≈3s 一次；暂停/结束/卸载时兜底补发），外层负责持久化与完播判定 */
  (e: 'progress', position: number, duration: number): void
  (e: 'ended'): void
}>()

const container = ref<HTMLDivElement | null>(null)
let art: Artplayer | null = null
let lastEmitAt = 0
let fKeyHandler: ((e: KeyboardEvent) => void) | null = null

function emitProgress(force = false) {
  if (!art) return
  const now = Date.now()
  if (!force && now - lastEmitAt < 3000) return
  lastEmitAt = now
  emit('progress', Number(art.currentTime) || 0, Number(art.duration) || 0)
}

onMounted(async () => {
  if (!container.value) return
  const { default: ArtplayerCtor } = await import('artplayer')
  art = new ArtplayerCtor({
    container: container.value,
    url: props.src,
    volume: 0.8,
    autoplay: true,
    setting: true,
    playbackRate: true,
    aspectRatio: true,
    flip: true,
    screenshot: true,
    pip: true,
    fullscreen: true,
    fullscreenWeb: true,
    miniProgressBar: true,
    hotkey: true,
    mutex: true,
    theme: '#8a7bff',
    lang: 'zh-cn',
    controls: [
      {
        name: 'av-theater',
        position: 'right',
        index: 5,
        html: '剧场',
        tooltip: '剧场模式（网页全屏）',
        click: () => {
          if (art) art.fullscreenWeb = !art.fullscreenWeb
        },
      },
      {
        name: 'av-pip',
        position: 'right',
        index: 6,
        html: '画中画',
        tooltip: '画中画',
        click: () => {
          if (art) art.pip = !art.pip
        },
      },
    ],
  })

  art.on('ready', () => {
    const duration = Number(art?.duration) || 0
    const start = props.startAt ?? 0
    // 续播定位：起点有效（>5s）且未接近结尾（<95%），否则从 0 开始自然重播
    if (start > 5 && (!duration || start < duration * 0.95)) {
      if (art) {
        art.seek = start
        art.notice.show = `已从 ${formatClock(start)} 继续播放`
      }
    }
    emit('ready', duration)
  })
  art.on('video:timeupdate', () => emitProgress())
  art.on('video:pause', () => emitProgress(true))
  art.on('video:ended', () => {
    emitProgress(true)
    emit('ended')
  })

  // 自定义快捷键：F 全屏（空格/←→/↑↓ 由 ArtPlayer hotkey 处理）
  fKeyHandler = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== 'f') return
    const target = e.target as HTMLElement | null
    if (target?.closest('input, textarea, [contenteditable]')) return
    if (art) art.fullscreen = !art.fullscreen
  }
  window.addEventListener('keydown', fKeyHandler)
})

onBeforeUnmount(() => {
  // 卸载兜底：补发最后一次进度（外层持久化），再销毁播放器
  emitProgress(true)
  if (fKeyHandler) window.removeEventListener('keydown', fKeyHandler)
  fKeyHandler = null
  art?.destroy(false)
  art = null
})
</script>

<template>
  <div ref="container" class="video-player" />
</template>

<style scoped>
.video-player {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
  box-shadow: var(--av-shadow-md);
}
</style>
