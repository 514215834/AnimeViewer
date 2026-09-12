<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { applyImageMirror } from '../utils/image'

const props = withDefaults(
  defineProps<{
    src?: string
    title: string
    subjectId?: number
  }>(),
  { src: '', subjectId: 0 },
)

const settings = useSettingsStore()

type Phase = 'loading' | 'ok' | 'failed'

const phase = ref<Phase>(props.src ? 'loading' : 'failed')
const retryKey = ref(0)
const retriedOnce = ref(false)
let retryTimer: ReturnType<typeof setTimeout> | undefined

const realSrc = computed(() => {
  if (!props.src) return ''
  // Bangumi 部分图片字段是 http:// 明文地址，统一升级为 https（避免混合内容并复用连接）；
  // 最终防线：历史数据可能带堆叠的缩放前缀（/r/200/r/400/...），折叠为最后一层；
  // 配置了图片镜像时，lain.bgm.tv 主机被替换为镜像地址（镜像自身协议原样保留）
  const normalized = applyImageMirror(
    props.src
      .replace(/^http:\/\/(lain\.bgm\.tv)\//, 'https://$1/')
      .replace(/(?:\/r\/\d+)+(?=\/pic\/)/g, (m) => {
        const parts = m.match(/\/r\/\d+/g)
        return parts ? parts[parts.length - 1] : m
      }),
  )
  return retryKey.value > 0 ? `${normalized}${normalized.includes('?') ? '&' : '?'}r=${retryKey.value}` : normalized
})

// 镜像地址变更时重置图片加载状态，立即按新源重载
watch(
  () => settings.mirrorImageUrl,
  () => {
    phase.value = props.src ? 'loading' : 'failed'
    retriedOnce.value = false
    retryKey.value = 0
  },
)

watch(
  () => props.src,
  () => {
    phase.value = props.src ? 'loading' : 'failed'
    retriedOnce.value = false
    retryKey.value = 0
  },
)

const initial = computed(() => (props.title || '?').trim().charAt(0))

const gradient = computed(() => {
  let h = 0
  for (const ch of String(props.subjectId || props.title)) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `linear-gradient(135deg, hsl(${h} 50% 34%), hsl(${(h + 55) % 360} 50% 22%))`
})

function onLoad() {
  phase.value = 'ok'
}

function onError() {
  // 加载失败自动重试一次（瞬时网络抖动兜底），仍失败再显示占位
  if (!retriedOnce.value && props.src) {
    retriedOnce.value = true
    retryTimer = setTimeout(() => {
      retryKey.value += 1
      phase.value = 'loading'
    }, 1200)
  } else {
    phase.value = 'failed'
  }
}

onBeforeUnmount(() => {
  if (retryTimer) clearTimeout(retryTimer)
})
</script>

<template>
  <div class="poster-frame">
    <!-- 注意：img 必须始终持有真实布局盒子。display:none/v-show 隐藏会导致
         loading="lazy" 的图片永远无法进入视口判定而卡在加载中 -->
    <img
      v-if="realSrc && phase !== 'failed'"
      :key="realSrc"
      :src="realSrc"
      :alt="title"
      loading="lazy"
      decoding="async"
      :class="{ 'is-loaded': phase === 'ok' }"
      @load="onLoad"
      @error="onError"
    />
    <div v-if="phase === 'loading' && realSrc" class="poster-skeleton" />
    <div v-if="phase === 'failed' || !realSrc" class="poster-fallback" :style="{ background: gradient }">
      <span class="poster-initial">{{ initial }}</span>
    </div>
  </div>
</template>

<style scoped>
.poster-frame {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: var(--av-radius);
  overflow: hidden;
  background: var(--av-img-placeholder);
}

.poster-frame img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  opacity: 0;
  transition: opacity 0.25s ease;
}

.poster-frame img.is-loaded {
  opacity: 1;
}

.poster-skeleton {
  position: absolute;
  inset: 0;
  /* v0.12 B7：扫光升级——灰底上主色细亮带扫过 */
  background: linear-gradient(
    100deg,
    rgba(128, 128, 128, 0.1) 35%,
    rgba(138, 123, 255, 0.1) 48%,
    rgba(255, 255, 255, 0.12) 50%,
    rgba(138, 123, 255, 0.1) 52%,
    rgba(128, 128, 128, 0.1) 65%
  );
  background-size: 200% 100%;
  animation: poster-shimmer 1.4s ease infinite;
}

@keyframes poster-shimmer {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -80% 0;
  }
}

.poster-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.poster-initial {
  font-size: 44px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
}
</style>
