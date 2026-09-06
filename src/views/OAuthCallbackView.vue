<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NSpin } from 'naive-ui'
import { useSettingsStore } from '../stores/settings'

const router = useRouter()
const settings = useSettingsStore()

const status = ref<'working' | 'ok' | 'error'>('working')
const detail = ref('正在使用授权码换取 Token…')

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  if (!code) {
    status.value = 'error'
    detail.value = '回调地址中未找到授权码（code）。请从 Bangumi 授权页重新发起登录。'
    return
  }
  const clientId = settings.oauthClientId.trim()
  const clientSecret = settings.oauthClientSecret.trim()
  if (!clientId || !clientSecret) {
    status.value = 'error'
    detail.value = '本地未配置 OAuth Client ID / Secret，无法换取 Token。请到「设置」补填后重新登录。'
    return
  }
  try {
    // Bangumi Token 端点与 API 网关不同域，若浏览器 CORS 受限可能失败，此时可回退手动粘贴 Token
    const res = await fetch('https://bgm.tv/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${location.origin}/oauth-callback`,
      }).toString(),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const data = (await res.json()) as { access_token?: string; refresh_token?: string }
    if (!data.access_token) throw new Error('响应中没有 access_token')
    settings.applyPatch({ accessToken: data.access_token, refreshToken: data.refresh_token ?? '' })
    status.value = 'ok'
    detail.value = '登录成功，正在返回设置页…'
    setTimeout(() => router.replace({ name: 'settings' }), 1200)
  } catch (e) {
    status.value = 'error'
    detail.value =
      `换取 Token 失败：${e instanceof Error ? e.message : String(e)}。` +
      '该端点可能不允许浏览器跨域调用；可改为在 next.bgm.tv/demo/access-token 生成个人 Token 后手动粘贴到「设置」。'
  }
})
</script>

<template>
  <div class="oauth-callback">
    <NSpin :show="status === 'working'">
      <div class="card">
        <h2>Bangumi 授权登录</h2>
        <NAlert v-if="status === 'ok'" type="success">{{ detail }}</NAlert>
        <NAlert v-else-if="status === 'error'" type="error">{{ detail }}</NAlert>
        <p v-else class="pending">{{ detail }}</p>
        <NButton v-if="status === 'error'" @click="router.replace({ name: 'settings' })">返回设置</NButton>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.oauth-callback {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.card {
  width: 520px;
  max-width: 92vw;
  padding: 26px 28px;
  border-radius: 12px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.card h2 {
  margin: 0;
  font-size: 18px;
}

.pending {
  margin: 0;
  opacity: 0.7;
  font-size: 13px;
}
</style>
