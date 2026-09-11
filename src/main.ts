import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { recordError } from './utils/errlog'
import './styles.css'

const app = createApp(App)

// H4 全局错误兜底：捕获后写入本地环形日志（设置页「诊断信息」可查看），不阻断应用
app.config.errorHandler = (err) => {
  recordError('app', err)
  console.error(err)
}
window.addEventListener('error', (ev) => {
  recordError('app', ev.error ?? ev.message)
})
window.addEventListener('unhandledrejection', (ev) => {
  recordError('promise', ev.reason)
})
router.onError((err) => {
  recordError('router', err)
})

app.use(createPinia()).use(router).mount('#app')
