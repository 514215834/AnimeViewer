<script setup lang="ts">
import PosterImage from './PosterImage.vue'

defineProps<{
  id: number
  title: string
  original?: string
  poster?: string
  score?: number
  extra?: string
  /** v0.29 Q1 放送时刻徽章（如「24:30」，无时刻数据不渲染） */
  timeBadge?: string
  /** H1 已追标记：该条目在追番库中时于海报左上角显示徽章（由调用方传入，组件不感知 store） */
  inLibrary?: boolean
  /** v0.12 B5 在追进度线：progress/epsTotal 比值（0~1），>0 时海报底部渲染渐变进度条（纯展示） */
  progressRatio?: number
}>()

const emit = defineEmits<{ (e: 'open', id: number): void }>()

function scoreText(score?: number): string {
  if (score === undefined || score <= 0) return '—'
  return score.toFixed(1)
}
</script>

<template>
  <div class="anime-card" @click="emit('open', id)">
    <div class="poster-wrap">
      <PosterImage :src="poster" :title="title" :subject-id="id" />
      <!-- v0.12 B5 海报底部渐变遮罩：仅在渲染进度线时出现（搜索/发现页海报保持原貌），不拦截点击 -->
      <span v-if="!!progressRatio && progressRatio > 0" class="poster-shade" aria-hidden="true" />
      <span
        v-if="!!progressRatio && progressRatio > 0"
        class="poster-progress"
        :style="{ width: `${Math.min(progressRatio, 1) * 100}%` }"
        aria-hidden="true"
      />
      <span class="score-badge num">★ {{ scoreText(score) }}</span>
      <span v-if="inLibrary" class="lib-badge">已追</span>
    </div>
    <div class="card-info">
      <div class="card-title" :title="title">{{ title }}</div>
      <div v-if="original && original !== title" class="card-sub" :title="original">{{ original }}</div>
      <div v-if="timeBadge" class="card-time-badge">{{ timeBadge }}</div>
      <div v-if="extra" class="card-extra">{{ extra }}</div>
    </div>
  </div>
</template>

<style scoped>
.anime-card {
  cursor: pointer;
  transition: transform 0.18s ease;
  /* 长列表优化：跳过屏外卡片的渲染与布局，高度占位按卡片实际高度估算 */
  content-visibility: auto;
  contain-intrinsic-size: auto 260px;
  border-radius: var(--av-radius);
}

.anime-card:hover {
  transform: translateY(-4px);
}

/* v0.12 B5 hover 主色光环：投影升级为 1px 描边光环 + 深投影（光环在 poster-wrap 上，不随海报缩放） */
.anime-card:hover .poster-wrap {
  box-shadow: 0 0 0 1px var(--av-ring), var(--av-shadow-lg);
}

.anime-card:hover :deep(.poster-frame) {
  transform: scale(1.03);
}

.anime-card:hover .card-title {
  color: var(--av-primary-hover);
}

.poster-wrap {
  position: relative;
  border-radius: var(--av-radius);
  transition: box-shadow 0.2s ease;
}

/* 海报轻微缩放：作用于图片容器（徽章在容器外不受影响），PosterImage 自带溢出裁剪 */
.anime-card :deep(.poster-frame) {
  transition: transform 0.25s ease;
}

/* v0.12 B5 底部渐变遮罩：提升进度线可读性 */
.poster-shade {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 42%;
  border-radius: 0 0 var(--av-radius) var(--av-radius);
  background: linear-gradient(180deg, transparent, rgba(10, 10, 16, 0.55));
  pointer-events: none;
}

html.light .poster-shade {
  background: linear-gradient(180deg, transparent, rgba(20, 20, 50, 0.4));
}

/* 在追进度线：3px 主色渐变 + 光晕（宽度由调用方传入比值） */
.poster-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  max-width: 100%;
  border-radius: 0 0 0 var(--av-radius);
  background: var(--av-progress-grad);
  box-shadow: 0 0 8px rgba(138, 123, 255, 0.7);
  pointer-events: none;
}

/* 评分徽章：毛玻璃胶囊 */
.score-badge {
  position: absolute;
  right: 8px;
  top: 8px;
  display: inline-flex;
  align-items: center;
  background: rgba(12, 12, 20, 0.55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: var(--av-gold);
  font-size: 11.5px;
  padding: 2px 9px;
  border-radius: 999px;
  font-weight: 700;
}

html.light .score-badge {
  background: rgba(255, 255, 255, 0.65);
  border-color: rgba(20, 20, 50, 0.1);
  color: #a07c00;
}

/* H1 已追徽章：渐变胶囊 */
.lib-badge {
  position: absolute;
  left: 8px;
  top: 8px;
  background: var(--av-badge-grad);
  color: #fff;
  font-size: 11px;
  padding: 2px 9px;
  border-radius: 999px;
  font-weight: 600;
  box-shadow: 0 2px 10px rgba(138, 123, 255, 0.45);
}

.card-info {
  margin-top: 8px;
  padding: 0 2px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--av-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.18s ease;
}

.card-sub {
  font-size: 12px;
  color: var(--av-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

.card-extra {
  font-size: 12px;
  color: var(--av-text-tertiary);
  margin-top: 2px;
}

/* v0.29 Q1 放送时刻徽章：主色描边小胶囊 */
.card-time-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--av-primary);
  border: 1px solid var(--av-ring);
  background: var(--av-primary-soft);
  border-radius: 999px;
  padding: 1px 8px;
  margin-top: 6px;
}
</style>
