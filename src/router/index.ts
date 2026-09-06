import { createRouter, createWebHashHistory } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: MainLayout,
      redirect: '/calendar',
      children: [
        { path: 'calendar', name: 'calendar', component: () => import('../views/CalendarView.vue'), meta: { title: '每周新番' } },
        { path: 'discover', name: 'discover', component: () => import('../views/DiscoverView.vue'), meta: { title: '发现' } },
        { path: 'search', name: 'search', component: () => import('../views/SearchView.vue'), meta: { title: '搜索' } },
        { path: 'library', name: 'library', component: () => import('../views/LibraryView.vue'), meta: { title: '我的追番' } },
        { path: 'settings', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { title: '设置' } },
        { path: 'subject/:id', name: 'subject', component: () => import('../views/DetailView.vue'), meta: { title: '条目详情' } },
        { path: 'index/:id', name: 'index-detail', component: () => import('../views/IndexDetailView.vue'), meta: { title: '目录详情' } },
      ],
    },
    { path: '/oauth-callback', name: 'oauth-callback', component: () => import('../views/OAuthCallbackView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/calendar' },
  ],
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · AnimeViewer` : 'AnimeViewer'
})

export default router
