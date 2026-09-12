<script setup lang="ts">
/** v0.13 PL1 播放器组件：封装 ArtPlayer（动态 import 独立 chunk，不进业务主包）。
 *  职责边界：本组件只管「播 + 报进度」——进度持久化、续播定位、完播自动标记由 WatchView 决策；
 *  键盘：空格/←→/↑↓ 由 ArtPlayer hotkey 承担（播放器聚焦时），F 全屏为本组件自定义。
 *  v0.14：remux 模式（服务端 ffmpeg 转封装「直播式」流）不支持随机跳转——
 *  拦截 seek：目标在已缓冲区间内放行原生 seek，否则向外交付「seek 重拉」（外层以 ?t= 重建流）。 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type Artplayer from 'artplayer'
import { formatClock } from '../utils/mediaCore'

const props = defineProps<{
  src: string
  title?: string
  /** 续播起点（秒）；>5s 且未到 95% 时自动 seek 并提示 */
  startAt?: number
  /** v0.14 服务端转封装流：seek 需重拉 */
  remux?: boolean
}>()

const emit = defineEmits<{
  (e: 'ready', duration: number): void
  /** 播放进度（节流 ≈3s 一次；暂停/结束/卸载时兜底补发），外层负责持久化与完播判定 */
  (e: 'progress', position: number, duration: number): void
  (e: 'ended'): void
  /** v0.14 remux：用户 seek 超出已缓冲区间 → 请求外层以 t=target 重建流 */
  (e: 'seekreload', target: number): void
}>()

const container = ref<HTMLDivElement | null>(null)
let art: Artplayer | null = null
let lastEmitAt = 0
let fKeyHandler: ((e: KeyboardEvent) => void) | null = null
/** 程序性 seek（续播定位）不触发重拉的时间窗 */
let suppressSeekUntil = 0
/** 卸载中标记：销毁流程内的 seek 一律不再重拉 */
let destroyed = false

function emitProgress(force = false) {
  if (!art) return
  const now = Date.now()
  if (!force && now - lastEmitAt < 3000) return
  lastEmitAt = now
  emit('progress', Number(art.currentTime) || 0, Number(art.duration) || 0)
}

onMounted(async () => {
  if (!container.value) return
  suppressSeekUntil = Date.now() + 1500
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
    if (props.remux) {
      // 转封装流：起点由 URL ?t= 决定，流内 currentTime 已归零，不再 seek
      if (art && start > 5) art.notice.show = `已从 ${formatClock(start)} 继续播放`
      suppressSeekUntil = Date.now() + 1500
    } else if (start > 5 && (!duration || start < duration * 0.95)) {
      // 续播定位：起点有效（>5s）且未接近结尾（<95%），否则从 0 开始自然重播
      if (art) {
        suppressSeekUntil = Date.now() + 1500
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
  // v0.14 remux seek 重拉：fMP4 无索引，浏览器把超出 seekable=[0,0] 的 seek 静默钳制到 0，
  // 事后（video:seeking）读到的 currentTime 已非用户意图。ArtPlayer 的进度条拖拽 / 热键 / seek
  // 全部经过实例的 currentTime setter——在其上拦截，拿到的才是原始目标时间。
  if (props.remux) {
    const proto = Object.getPrototypeOf(art)
    const desc = Object.getOwnPropertyDescriptor(proto, 'currentTime')
    if (desc?.set && desc.get) {
      Object.defineProperty(art, 'currentTime', {
        configurable: true,
        get() {
          return desc.get!.call(art)
        },
        set(t: number) {
          if (destroyed || Date.now() < suppressSeekUntil) {
            desc.set!.call(art, Number(t) || 0)
            return
          }
          emit('seekreload', Number(t) || 0)
        },
      })
    }
  }
  // 兜底：绕过 ArtPlayer 直接操作 video 元素的 seek（钳制后目标失真，按当前值重拉）
  const seekingHandler = () => {
    if (!props.remux || !art || destroyed) return
    if (Date.now() < suppressSeekUntil) return
    const target = Number(art.currentTime) || 0
    try {
      const v = art.video as HTMLVideoElement
      if (v.seekable.length) {
        const seekableEnd = v.seekable.end(v.seekable.length - 1)
        if (target >= 0 && target < seekableEnd - 0.3) return
      }
    } catch {
      /* seekable 读取失败则一律重拉 */
    }
    emit('seekreload', target)
  }
  ;(art.video as HTMLVideoElement).addEventListener('seeking', seekingHandler)

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
  destroyed = true
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
