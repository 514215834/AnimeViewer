<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useMessage } from 'naive-ui'
import {
  NAlert,
  NButton,
  NForm,
  NFormItem,
  NInput,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSwitch,
} from 'naive-ui'
import { DEFAULT_SETTINGS, useSettingsStore } from '../stores/settings'
import type { ImageQuality, SettingsState } from '../stores/settings'
import { useLibraryStore } from '../stores/library'
import { useSyncStore } from '../stores/sync'
import { applyImageMirror } from '../utils/image'
import { bangumiApi, ApiError, clearApiCache } from '../api/bangumi'
import { clearErrLog, formatDiagnostics, readErrLog } from '../utils/errlog'
import type { ErrLogEntry } from '../utils/errlog'

const message = useMessage()
const settings = useSettingsStore()
const library = useLibraryStore()
const sync = useSyncStore()

/** 预置反代选项（可下拉选择，也可直接输入自定义地址——NSelect tag 模式支持创建） */
const API_BASE_OPTIONS = [
  { label: 'https://api.bgm.tv（官方）', value: 'https://api.bgm.tv' },
  { label: 'https://bgmapi.anibt.net', value: 'https://bgmapi.anibt.net' },
]
const IMAGE_BASE_OPTIONS = [{ label: 'https://bgmimg.anibt.net', value: 'https://bgmimg.anibt.net' }]

const draft = reactive<SettingsState>({ ...settings.$state })
const fileInput = ref<HTMLInputElement | null>(null)
const verifyingToken = ref(false)

async function verifyToken() {
  if (verifyingToken.value) return
  verifyingToken.value = true
  try {
    // 先应用当前草稿，保证验证的就是输入框里的值
    settings.applyPatch({
      apiBaseUrl: (draft.apiBaseUrl.trim() || DEFAULT_SETTINGS.apiBaseUrl).replace(/\/+$/, ''),
      accessToken: draft.accessToken.trim(),
    })
    const me = await bangumiApi.me()
    sync.account = me
    message.success(`Token 有效：${me.nickname || me.username || `用户 ${me.id}`}`)
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      message.error('Token 无效或已过期，请到 next.bgm.tv/demo/access-token 重新生成')
    } else {
      message.error(e instanceof Error ? `验证失败：${e.message}` : '验证失败')
    }
  } finally {
    verifyingToken.value = false
  }
}

async function syncNow() {
  const r = await sync.syncNow()
  if (r.ok) message.success(r.message)
  else message.error(r.message)
}

/** 跳转 Bangumi OAuth 授权页（需先填写自建应用的 Client ID） */
function startOAuthLogin() {
  const clientId = draft.oauthClientId.trim()
  if (!clientId) {
    message.warning('请先填写 OAuth Client ID（在 bgm.tv/dev/app 创建应用后获得）')
    return
  }
  // 先保存凭据，回调页要用 client_secret 换取 Token
  applyDraftBase()
  const redirectUri = `${location.origin}/oauth-callback`
  const url =
    `https://bgm.tv/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}`
  window.location.href = url
}

function logout() {
  settings.applyPatch({ accessToken: '', refreshToken: '' })
  Object.assign(draft, settings.$state)
  sync.account = null
  sync.profile = null
  message.info('已退出登录（已清除本地 Token）')
}

/** 保存基础连接配置（Base URL / Token / OAuth 凭据），供各操作按钮在保存前调用 */
function applyDraftBase() {
  // 只 patch 基础字段，并把规范化后的值同步回 draft；
  // 不能用 $state 整体覆盖 draft，否则会把开关等未保存的草稿改动（如 hideNsfw）还原成旧值
  const normalized = {
    apiBaseUrl: (draft.apiBaseUrl.trim() || DEFAULT_SETTINGS.apiBaseUrl).replace(/\/+$/, ''),
    mirrorImageUrl: (draft.mirrorImageUrl || '').trim().replace(/\/+$/, ''),
    accessToken: draft.accessToken.trim(),
    oauthClientId: draft.oauthClientId.trim(),
    oauthClientSecret: draft.oauthClientSecret.trim(),
    refreshToken: draft.refreshToken.trim(),
  }
  settings.applyPatch(normalized)
  Object.assign(draft, normalized)
}

const libraryDirtyCount = computed(() => sync.pendingPushCount)

/* ── H4 诊断信息：本地错误日志只读展示 + 一键复制，不做任何上报 ── */
const appVersion = __APP_VERSION__
const errLogs = ref<ErrLogEntry[]>(readErrLog())
const diagnosticsText = computed(() =>
  formatDiagnostics(
    [
      `AnimeViewer v${appVersion}`,
      `数据源：${settings.isDemo ? '演示数据' : '在线 API'}（${settings.apiBaseUrl}）`,
      `图片反代：${settings.mirrorImageUrl || '官方源'}`,
      `上次同步：${sync.lastSyncText} · 待推送 ${libraryDirtyCount.value} 条 · 追番 ${library.count} 条`,
    ],
    errLogs.value,
  ),
)

async function copyDiagnostics() {
  try {
    await navigator.clipboard.writeText(diagnosticsText.value)
    message.success('诊断信息已复制到剪贴板')
  } catch {
    message.error('复制失败：浏览器未授权剪贴板访问')
  }
}

function clearErrors() {
  clearErrLog()
  errLogs.value = []
  message.info('已清空错误日志')
}

/** E5 资料卡：优先取云端资料，回退到同步缓存的 me */
const profile = computed(() => {
  if (sync.profile) return sync.profile
  if (sync.account) {
    return {
      id: sync.account.id ?? 0,
      username: sync.account.username,
      nickname: sync.account.nickname,
      avatar: sync.account.avatar,
      sign: '',
    }
  }
  return null
})
const profileAvatar = computed(() => {
  const img = profile.value?.avatar
  // 头像统一升 https（Bangumi 头像字段是 http 明文地址），并走可配置图片镜像
  const raw = img?.large || img?.medium || img?.small || ''
  return applyImageMirror(raw.replace(/^http:\/\//, 'https://'))
})

onMounted(() => {
  void sync.ensureProfile()
})

function save() {
  applyDraftBase()
  settings.applyPatch({ dataSource: draft.dataSource, hideNsfw: draft.hideNsfw, imageQuality: draft.imageQuality })
  Object.assign(draft, settings.$state)
  clearApiCache()
  message.success('设置已保存并生效')
}

function reset() {
  settings.resetDefaults()
  Object.assign(draft, settings.$state)
  clearApiCache()
  message.info('已恢复默认设置')
}

function exportLibrary() {
  const payload = {
    app: 'animeviewer',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: library.list,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `animeviewer-library-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  message.success(`已导出 ${library.count} 条收藏`)
}

async function onImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const parsed: unknown = JSON.parse(text)
    const entries = Array.isArray(parsed) ? parsed : (parsed as { entries?: unknown[] })?.entries
    if (!Array.isArray(entries)) throw new Error('文件格式不正确，需要 animeviewer 导出的 JSON')
    const res = library.importEntries(entries)
    message.success(`导入完成：新增 ${res.added} 条，跳过重复/无效 ${res.skipped} 条`)
  } catch (e) {
    message.error(e instanceof Error ? `导入失败：${e.message}` : '导入失败')
  } finally {
    input.value = ''
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <h2>⚙️ 设置</h2>
      <span class="page-sub">所有配置仅保存在本地浏览器 localStorage</span>
    </div>

    <div class="settings-panel">
      <NForm label-placement="top" size="medium">
        <NFormItem label="数据源模式">
          <NRadioGroup v-model:value="draft.dataSource">
            <NRadioButton value="online">在线 Bangumi API</NRadioButton>
            <NRadioButton value="demo">内置演示数据（离线）</NRadioButton>
          </NRadioGroup>
        </NFormItem>
        <NAlert v-if="draft.dataSource === 'online'" type="info" style="margin-bottom: 18px" :show-icon="false">
          在线模式需要浏览器能访问 api.bgm.tv。若当前网络直连超时，可开启代理后重试，
          或自建反向代理并将下方 API 地址指向它。切换到演示模式可离线体验全部界面功能。
        </NAlert>

        <NFormItem label="API Base URL（可配置化：支持自建反向代理 / 镜像，可下拉选择或直接输入）">
          <NSelect
            v-model:value="draft.apiBaseUrl"
            :options="API_BASE_OPTIONS"
            tag
            filterable
            placeholder="https://api.bgm.tv"
          />
        </NFormItem>

        <NFormItem label="Image Base URL（可选：lain.bgm.tv 图片反代，填反代域名或含子路径的前缀）">
          <NSelect
            :value="draft.mirrorImageUrl || null"
            :options="IMAGE_BASE_OPTIONS"
            tag
            filterable
            clearable
            placeholder="留空使用官方图片源，可下拉选择或直接输入"
            @update:value="(v: string | null) => (draft.mirrorImageUrl = v ?? '')"
          />
        </NFormItem>

        <NFormItem label="Access Token（可选，用于提升接口访问限额）">
          <div class="token-row">
            <NInput
              v-model:value="draft.accessToken"
              type="password"
              show-password-on="click"
              placeholder="留空表示匿名访问"
            />
            <NButton secondary :loading="verifyingToken" @click="verifyToken">验证</NButton>
          </div>
        </NFormItem>

        <NFormItem label="内容过滤">
          <div class="switch-row">
            <NSwitch v-model:value="draft.hideNsfw" />
            <span class="switch-label">隐藏 R18 内容（控制所有支持 R18 的接口：每周新番、热门在播、搜索结果、条目详情）</span>
          </div>
        </NFormItem>

        <NFormItem label="图片清晰度（切换后立即生效）">
          <NRadioGroup
            :value="draft.imageQuality"
            @update:value="(v: ImageQuality) => { draft.imageQuality = v; settings.applyPatch({ imageQuality: v }) }"
          >
            <NRadioButton value="extreme">极致（400px）</NRadioButton>
            <NRadioButton value="high">高清（200px）</NRadioButton>
            <NRadioButton value="saver">省流（100px）</NRadioButton>
          </NRadioGroup>
        </NFormItem>

        <NFormItem label="Bangumi 账户与云同步">
          <div class="sync-box">
            <!-- E5 用户资料卡：头像/昵称/签名 -->
            <div v-if="profile" class="profile-card">
              <img v-if="profileAvatar" :src="profileAvatar" class="profile-avatar" alt="头像" />
              <div v-else class="profile-avatar profile-avatar-fallback">{{ (profile.nickname || '?').slice(0, 1) }}</div>
              <div class="profile-info">
                <div class="profile-nickname">
                  {{ profile.nickname || profile.username || profile.id }}
                  <span v-if="profile.username" class="profile-username">@{{ profile.username }}</span>
                </div>
                <div class="profile-sign" :title="profile.sign">{{ profile.sign || '这个人很懒，什么都没写' }}</div>
              </div>
              <a
                v-if="profile.username"
                class="profile-link"
                :href="`https://bgm.tv/user/${profile.username}`"
                target="_blank"
                rel="noopener"
              >个人主页 ↗</a>
            </div>
            <div class="sync-row">
              <span class="sync-account">
                {{ sync.account ? `已登录：${sync.account.nickname || sync.account.username || sync.account.id}` : '未获取账户信息（配置 Token 后可同步）' }}
              </span>
              <span class="sync-meta">待推送 {{ libraryDirtyCount }} 条 · 上次同步：{{ sync.lastSyncText }}</span>
            </div>
            <div class="btn-row">
              <NButton type="primary" secondary :loading="sync.syncing" @click="syncNow">
                ⟳ 立即同步（拉取云端 + 推送本地）
              </NButton>
              <NButton v-if="settings.accessToken" quaternary type="error" @click="logout">退出登录</NButton>
            </div>
            <div v-if="sync.logs.length" class="sync-logs">
              <div v-for="(line, i) in sync.logs.slice(0, 5)" :key="i" class="sync-log-line">{{ line }}</div>
            </div>
          </div>
        </NFormItem>

        <NFormItem label="OAuth 登录（可选：在 bgm.tv/dev/app 创建应用后填写，回调地址填本站根路径）">
          <div class="oauth-box">
            <NInput v-model:value="draft.oauthClientId" placeholder="Client ID" />
            <NInput
              v-model:value="draft.oauthClientSecret"
              type="password"
              show-password-on="click"
              placeholder="Client Secret（仅保存在本地）"
            />
            <NButton secondary @click="startOAuthLogin">通过 Bangumi 授权登录</NButton>
          </div>
        </NFormItem>

        <NFormItem label="收藏数据管理（本地备份 / 迁移）">
          <div class="btn-row">
            <NButton secondary @click="exportLibrary" :disabled="!library.count">
              ⬇ 导出收藏 ({{ library.count }})
            </NButton>
            <NButton secondary @click="fileInput?.click()">⬆ 导入收藏</NButton>
            <input ref="fileInput" type="file" accept="application/json,.json" hidden @change="onImportFile" />
          </div>
        </NFormItem>

        <NFormItem label="诊断信息（仅存本地，不含 Token；遇到异常可复制后反馈）">
          <div class="diag-box">
            <div class="diag-meta">
              <span>AnimeViewer v{{ appVersion }}</span>
              <span>{{ settings.isDemo ? '演示数据' : '在线 API' }} · {{ settings.apiBaseUrl }}</span>
            </div>
            <div v-if="errLogs.length" class="diag-logs">
              <div v-for="(e, i) in errLogs.slice(0, 10)" :key="i" class="sync-log-line">
                [{{ new Date(e.at).toLocaleString('zh-CN') }}] {{ e.source }}: {{ e.message }}
              </div>
            </div>
            <div v-else class="diag-empty">未记录到运行时错误</div>
            <div class="btn-row">
              <NButton secondary size="small" @click="copyDiagnostics">复制诊断信息</NButton>
              <NButton quaternary size="small" :disabled="!errLogs.length" @click="clearErrors">清空错误日志</NButton>
            </div>
          </div>
        </NFormItem>

        <NAlert type="warning" :show-icon="false" style="margin-bottom: 20px">
          说明：Key / Token 只保存在本地浏览器，不会上传到任何服务器；浏览器安全策略不允许自定义
          User-Agent 请求头，如需自定义请在反向代理层注入。
        </NAlert>

        <div class="btn-row">
          <NButton type="primary" @click="save">保存设置</NButton>
          <NButton quaternary @click="reset">恢复默认</NButton>
        </div>
      </NForm>
    </div>
  </div>
</template>

<style scoped>
.settings-panel {
  max-width: 620px;
  padding: 22px 24px;
  border-radius: 12px;
  border: 1px solid rgba(128, 128, 128, 0.22);
}

.btn-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.switch-label {
  font-size: 13px;
  opacity: 0.75;
}

.token-row {
  display: flex;
  gap: 10px;
  width: 100%;
}

.sync-box {
  width: 100%;
}

/* E5 用户资料卡 */
.profile-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  margin-bottom: 10px;
  border-radius: 10px;
  background: rgba(128, 128, 128, 0.08);
}

.profile-avatar {
  width: 52px;
  height: 52px;
  border-radius: 10px;
  object-fit: cover;
  flex-shrink: 0;
}

.profile-avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #8a7bff, #5d4fd8);
}

.profile-info {
  min-width: 0;
  flex: 1;
}

.profile-nickname {
  font-size: 15px;
  font-weight: 700;
}

.profile-username {
  font-size: 12px;
  font-weight: 400;
  opacity: 0.5;
  margin-left: 4px;
}

.profile-sign {
  font-size: 12px;
  opacity: 0.55;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-link {
  font-size: 12px;
  color: #8a7bff;
  text-decoration: none;
  flex-shrink: 0;
}

.profile-link:hover {
  text-decoration: underline;
}

.sync-box {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sync-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.sync-account {
  font-size: 13px;
  font-weight: 600;
}

.sync-meta {
  font-size: 12px;
  opacity: 0.6;
}

.sync-logs {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.1);
  font-family: Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
  opacity: 0.85;
}

.oauth-box {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* H4 诊断面板 */
.diag-box {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.diag-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  opacity: 0.7;
}

.diag-logs {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.1);
  font-family: Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
  opacity: 0.85;
  word-break: break-all;
}

.diag-empty {
  font-size: 12px;
  opacity: 0.5;
}
</style>
