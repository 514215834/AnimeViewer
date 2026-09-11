<script setup lang="ts">
import { NIcon } from 'naive-ui'
import { FileTrayOutline } from '@vicons/ionicons5'

withDefaults(
  defineProps<{
    /** 主文案 */
    text: string
    /** 次文案（可选，显示在主文案下方） */
    sub?: string
  }>(),
  { sub: '' },
)
</script>

<template>
  <div class="ehint">
    <NIcon class="ehint-icon" :component="FileTrayOutline" :size="36" />
    <div class="ehint-text">
      {{ text }}
      <!-- 富内容插槽：内嵌跳转链接等 -->
      <slot />
    </div>
    <div v-if="sub" class="ehint-sub">{{ sub }}</div>
  </div>
</template>

<style scoped>
.ehint {
  padding: 56px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  color: var(--av-text-tertiary);
}

.ehint-icon {
  opacity: 0.5;
}

.ehint-text {
  font-size: 14px;
  color: var(--av-text-secondary);
  line-height: 1.6;
}

.ehint-text a {
  color: var(--av-primary);
  cursor: pointer;
}

.ehint-sub {
  font-size: 12px;
  color: var(--av-text-tertiary);
  line-height: 1.5;
}
</style>
