<script setup lang="ts">
/** v0.13 PL1 播放器组件：封装 ArtPlayer（动态 import 独立 chunk，不进业务主包）。
 *  职责边界：本组件只管「播 + 报进度」——进度持久化、续播定位、完播自动标记由 WatchView 决策；
 *  键盘：空格/←→/↑↓ 由 ArtPlayer hotkey 承担（播放器聚焦时），F 全屏为本组件自定义。
 *  v0.14：remux 模式（服务端 ffmpeg 转封装「直播式」流）不支持随机跳转——
 *  拦截 seek：目标在已缓冲区间内放行原生 seek，否则向外交付「seek 重拉」（外层以 ?t= 重建流）。
 *  v0.15 O1：m3u8 源经 hls.js（MSE）播放，独立动态 chunk，原生 seek 不走重拉；
 *  在线源加载失败（网络/跨域）向外交付 sourceerror，由外层决定是否经服务代理重试。
 *  v0.15 O4：artplayer-plugin-danmuku 弹幕（独立 chunk，仅播放页下载）；
 *  弹幕源以 props 传入，导入后变化经插件 load() 热更新。 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type Artplayer from 'artplayer'
import type { Result as DanmukuResult } from 'artplayer-plugin-danmuku'
import type { DanmakuItem } from '../utils/danmaku'
import { formatClock, isHlsUrl } from '../utils/mediaCore'

const props = defineProps<{
  src: string
  title?: string
  /** 续播起点（秒）；>5s 且未到 95% 时自动 seek 并提示 */
  startAt?: number
  /** v0.14 服务端转封装流：seek 需重拉 */
  remux?: boolean
  /** v0.15 O4 弹幕数据（按「条目+话数」维度，空数组 = 无弹幕） */
  danmaku?: DanmakuItem[]
  /** v0.15 发送弹幕持久化回调（函数 prop 直调，绕开组件 emit 的事件查找链） */
  persistDanmuku?: (item: DanmakuItem) => void
}>()

const emit = defineEmits<{
  (e: 'ready', duration: number): void
  /** 播放进度（节流 ≈3s 一次；暂停/结束/卸载时兜底补发），外层负责持久化与完播判定 */
  (e: 'progress', position: number, duration: number): void
  (e: 'ended'): void
  /** v0.14 remux：用户 seek 超出已缓冲区间 → 请求外层以 t=target 重建流 */
  (e: 'seekreload', target: number): void
  /** v0.15 O1 在线源加载失败（HLS fatal 错误 / video 网络错误），外层可经代理重试 */
  (e: 'sourceerror'): void
}>()

const container = ref<HTMLDivElement | null>(null)
let art: Artplayer | null = null
let danmuku: DanmukuResult | null = null
let hls: { destroy: () => void } | null = null
let lastEmitAt = 0
let fKeyHandler: ((e: KeyboardEvent) => void) | null = null
let videoErrorHandler: (() => void) | null = null
/** 程序性 seek（续播定位）不触发重拉的时间窗 */
let suppressSeekUntil = 0
/** 卸载中标记：销毁流程内的 seek 一律不再重拉、不再上报错误 */
let destroyed = false
/** sourceerror 只上报一次（外层换源重建组件） */
let sourceErrored = false

function emitProgress(force = false) {
  if (!art) return
  const now = Date.now()
  if (!force && now - lastEmitAt < 3000) return
  lastEmitAt = now
  emit('progress', Number(art.currentTime) || 0, Number(art.duration) || 0)
}

function emitSourceError() {
  if (destroyed || sourceErrored) return
  sourceErrored = true
  emit('sourceerror')
}

onMounted(async () => {
  if (!container.value) return
  suppressSeekUntil = Date.now() + 1500
  const { default: ArtplayerCtor } = await import('artplayer')
  // v0.15 O4 弹幕插件与 ArtPlayer 同批动态 import（Option.danmuku 传函数，导入后经 load() 热更新）
  const { default: danmukuFactory } = await import('artplayer-plugin-danmuku')
  const hlsSrc = isHlsUrl(props.src)

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
    plugins: [
      danmukuFactory({
        danmuku: () => Promise.resolve(props.danmaku ?? []),
        speed: 5,
        margin: [10, '25%'],
        opacity: 1,
        color: '#FFFFFF',
        antiOverlap: true,
        // 弹幕统一去描边/边框/半透明底（用户反馈「弹幕有边框」）：插件默认模板带四向 1px 黑色
        // text-shadow；自带「发送弹幕」更是硬编码 danmu.border=true（彩色边框 + 半透明黑底）且
        // emitter 直调引擎 emit、绕过公开 Result 包装——filter 是引擎入队前对同一 danmu 引用的
        // 公共必经点，在此 mutate 即覆盖 导入/发送/外部 emit 全部来源
        filter: (danmu) => {
          danmu.border = false
          danmu.style = { ...danmu.style, textShadow: 'none' }
          return true
        },
        // 发送弹幕持久化：beforeEmit 仅在 emitter 发送路径调用，此时 danmu.time 仍为发送时刻的
        // 集内绝对时间（emitter 随后才 delete time 改为立即飘出）——交外层追加进 dm: 存储，
        // 下次进入自动加载；返回 true 不拦截本次发送
        beforeEmit: (danmu) => {
          props.persistDanmuku?.({
            time: danmu.time ?? 0,
            mode: danmu.mode ?? 0,
            color: danmu.color,
            text: danmu.text,
          })
          return true
        },
      }),
    ],
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
      {
        name: 'av-danmuku',
        position: 'right',
        index: 7,
        html: '弹幕',
        tooltip: '弹幕开关',
        click: () => {
          if (!danmuku) return
          if (danmuku.isHide) danmuku.show()
          else danmuku.hide()
        },
      },
    ],
    ...(hlsSrc
      ? {
          type: 'm3u8',
          customType: {
            m3u8: async (video: HTMLVideoElement, url: string) => {
              const { default: Hls } = await import('hls.js')
              if (Hls.isSupported()) {
                const inst = new Hls()
                inst.on(Hls.Events.ERROR, (_evt, data) => {
                  // 仅 fatal 网络类错误触发外层容灾（解码类错误重试无意义，但也只报一次不刷屏）
                  if (data.fatal && data.type === Hls.ErrorTypes.NETWORK_ERROR) emitSourceError()
                })
                hls = inst
                inst.loadSource(url)
                inst.attachMedia(video)
              } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url // 无 MSE 的老 Safari 原生 HLS 兜底
              } else {
                emitSourceError()
              }
            },
          },
        }
      : {}),
  })
  danmuku = (art as unknown as { danmuku?: DanmukuResult }).danmuku ?? null

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

  // v0.15 O1 直链（非 HLS）加载失败上报：MEDIA_ERR_NETWORK(2) / MEDIA_ERR_SRC_NOT_SUPPORTED(4)
  // 覆盖跨域拒绝与地址失效；HLS 走 hls.js 错误通道。只报一次。
  if (!hlsSrc) {
    videoErrorHandler = () => {
      const code = (art?.video as HTMLVideoElement | undefined)?.error?.code
      if (code === 2 || code === 4) emitSourceError()
    }
    ;(art.video as HTMLVideoElement).addEventListener('error', videoErrorHandler)
  }

  // 自定义快捷键：F 全屏（空格/←→/↑↓ 由 ArtPlayer hotkey 处理）
  fKeyHandler = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== 'f') return
    const target = e.target as HTMLElement | null
    if (target?.closest('input, textarea, [contenteditable]')) return
    if (art) art.fullscreen = !art.fullscreen
  }
  window.addEventListener('keydown', fKeyHandler)
})

// v0.15 O4 导入弹幕后热更新（插件已在构造时挂载；样式统一由 option.filter 收敛）
watch(
  () => props.danmaku,
  (items) => {
    if (danmuku) void danmuku.load(items ?? [])
  },
)

onBeforeUnmount(() => {
  // 卸载兜底：补发最后一次进度（外层持久化），再销毁播放器
  destroyed = true
  emitProgress(true)
  if (fKeyHandler) window.removeEventListener('keydown', fKeyHandler)
  fKeyHandler = null
  if (videoErrorHandler && art) (art.video as HTMLVideoElement).removeEventListener('error', videoErrorHandler)
  videoErrorHandler = null
  hls?.destroy()
  hls = null
  danmuku = null
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
