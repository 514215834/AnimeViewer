/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import pkg from './package.json'

export default defineConfig({
  plugins: [vue()],
  define: {
    // H4 诊断面板展示用：注入 package.json 版本号
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    rollupOptions: {
      output: {
        // v0.10 P2：框架与组件库拆独立 chunk，业务代码迭代时浏览器缓存不受影响
        // v0.19：mediaService 显式拆独立 chunk——MainLayout 全局通知轮询急切导入后，
        // 自然分包失效会把全部 API 层吞进业务主包（显式拆分恢复 v0.17 的分包形态）
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          'vendor-naive': ['naive-ui'],
          mediaService: ['./src/api/mediaService'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  // H5 单测基建：happy-dom 提供 localStorage，聚焦 store 纯逻辑（不做网络层 mock）
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
})
