<script setup lang="ts">
import PosterImage from './PosterImage.vue'

defineProps<{
  id: number
  title: string
  original?: string
  poster?: string
  score?: number
  extra?: string
  /** H1 已追标记：该条目在追番库中时于海报左上角显示徽章（由调用方传入，组件不感知 store） */
  inLibrary?: boolean
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
      <span class="score-badge num">★ {{ scoreText(score) }}</span>
      <span v-if="inLibrary" class="lib-badge">已追</span>
    </div>
    <div class="card-info">
      <div class="card-title" :title="title">{{ title }}</div>
      <div v-if="original && original !== title" class="card-sub" :title="original">{{ original }}</div>
      <div v-if="extra" class="card-extra">{{ extra }}</div>
    </div>
  </div>
</template>

<style scoped>
.anime-card {
  cursor: pointer;
  transition: transform 0.18s ease, filter 0.18s ease;
  /* 长列表优化：跳过屏外卡片的渲染与布局，高度占位按卡片实际高度估算 */
  content-visibility: auto;
  contain-intrinsic-size: auto 260px;
  border-radius: var(--av-radius);
}

.anime-card:hover {
  transform: translateY(-3px);
  filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.35));
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
}

/* 海报轻微缩放：作用于图片容器（徽章在容器外不受影响），PosterImage 自带溢出裁剪 */
.anime-card :deep(.poster-frame) {
  transition: transform 0.25s ease;
}

.score-badge {
  position: absolute;
  right: 6px;
  top: 6px;
  background: var(--av-badge-overlay);
  color: var(--av-gold);
  font-size: 12px;
  padding: 1px 7px;
  border-radius: var(--av-radius-sm);
  font-weight: 600;
}

/* H1 已追徽章 */
.lib-badge {
  position: absolute;
  left: 6px;
  top: 6px;
  background: var(--av-primary);
  color: #fff;
  font-size: 11px;
  padding: 1px 7px;
  border-radius: var(--av-radius-sm);
  font-weight: 600;
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
</style>
