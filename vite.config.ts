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
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          'vendor-naive': ['naive-ui'],
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
