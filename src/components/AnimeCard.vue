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
      <span class="score-badge">★ {{ scoreText(score) }}</span>
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
  transition: transform 0.15s ease;
  /* 长列表优化：跳过屏外卡片的渲染与布局，高度占位按卡片实际高度估算 */
  content-visibility: auto;
  contain-intrinsic-size: auto 260px;
}

.anime-card:hover {
  transform: translateY(-3px);
}

.poster-wrap {
  position: relative;
}

.score-badge {
  position: absolute;
  right: 6px;
  top: 6px;
  background: rgba(0, 0, 0, 0.65);
  color: #ffd75e;
  font-size: 12px;
  padding: 1px 7px;
  border-radius: 6px;
  font-weight: 600;
}

/* H1 已追徽章 */
.lib-badge {
  position: absolute;
  left: 6px;
  top: 6px;
  background: rgba(138, 123, 255, 0.92);
  color: #fff;
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 6px;
  font-weight: 600;
}

.card-info {
  margin-top: 8px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-sub {
  font-size: 12px;
  opacity: 0.55;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

.card-extra {
  font-size: 12px;
  opacity: 0.45;
  margin-top: 2px;
}
</style>
