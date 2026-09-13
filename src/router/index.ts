import { createRouter, createWebHashHistory } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: MainLayout,
      redirect: '/today',
      children: [
        { path: 'today', name: 'today', component: () => import('../views/TodayView.vue'), meta: { title: '今日' } },
        { path: 'calendar', name: 'calendar', component: () => import('../views/CalendarView.vue'), meta: { title: '每周新番' } },
        { path: 'discover', name: 'discover', component: () => import('../views/DiscoverView.vue'), meta: { title: '发现' } },
        { path: 'search', name: 'search', component: () => import('../views/SearchView.vue'), meta: { title: '搜索' } },
        { path: 'library', name: 'library', component: () => import('../views/LibraryView.vue'), meta: { title: '我的追番' } },
        { path: 'history', name: 'history', component: () => import('../views/HistoryView.vue'), meta: { title: '播放历史' } },
        { path: 'settings', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { title: '设置' } },
        { path: 'subject/:id', name: 'subject', component: () => import('../views/DetailView.vue'), meta: { title: '条目详情' } },
        { path: 'index/:id', name: 'index-detail', component: () => import('../views/IndexDetailView.vue'), meta: { title: '目录详情' } },
        { path: 'character/:id', name: 'character', component: () => import('../views/CharacterDetailView.vue'), meta: { title: '角色详情' } },
        { path: 'person/:id', name: 'person', component: () => import('../views/PersonDetailView.vue'), meta: { title: '人物详情' } },
      ],
    },
    { path: '/oauth-callback', name: 'oauth-callback', component: () => import('../views/OAuthCallbackView.vue') },
    // v0.13 PL1 沉浸播放页：置于 MainLayout 之外（无侧边栏），query: subject / sort
    { path: '/watch', name: 'watch', component: () => import('../views/WatchView.vue'), meta: { title: '播放' } },
    { path: '/:pathMatch(.*)*', redirect: '/today' },
  ],
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · AnimeViewer` : 'AnimeViewer'
})

export default router
