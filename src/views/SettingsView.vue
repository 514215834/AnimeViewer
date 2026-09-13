<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useMessage } from 'naive-ui'
import {
  NAlert,
  NButton,
  NForm,
  NFormItem,
  NIcon,
  NInput,
  NInputNumber,
  NPopconfirm,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSwitch,
} from 'naive-ui'
import { SettingsOutline, ServerOutline, TrashOutline } from '@vicons/ionicons5'
import { DEFAULT_SETTINGS, useSettingsStore } from '../stores/settings'
import type { ImageQuality, SettingsState } from '../stores/settings'
import { useLibraryStore } from '../stores/library'
import { useNsfwStore } from '../stores/nsfw'
import { useSyncStore } from '../stores/sync'
import { applyImageMirror } from '../utils/image'
import { bangumiApi, ApiError, clearApiCache } from '../api/bangumi'
import { idbClear, idbStats } from '../utils/idbCache'
import type { IdbStats } from '../utils/idbCache'
import { clearErrLog, formatDiagnostics, readErrLog } from '../utils/errlog'
import type { ErrLogEntry } from '../utils/errlog'
import { exportMedia, importMedia } from '../utils/mediaStore'
import { mediaService, ServiceError, type SvcDownloadEngine, type SvcHealth, type SvcStatus } from '../api/mediaService'
import MediaLibraryDrawer from '../components/MediaLibraryDrawer.vue'

const message = useMessage()
const settings = useSettingsStore()
const library = useLibraryStore()
const sync = useSyncStore()
const nsfw = useNsfwStore()

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
    svcUrl: (draft.svcUrl || '').trim().replace(/\/+$/, ''),
    svcToken: (draft.svcToken || '').trim(),
    webdavUrl: (draft.webdavUrl || '').trim().replace(/\/+$/, ''),
    webdavUser: (draft.webdavUser || '').trim(),
    webdavPass: (draft.webdavPass || '').trim(),
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

/* ── v0.11 缓存管理：持久层统计 + 一键清除（内存层刷新页面即清，这里连带清掉当前会话） ── */
const cacheStats = ref<IdbStats | null>(null)
const clearingCache = ref(false)

async function refreshCacheStats() {
  cacheStats.value = await idbStats()
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

async function clearCaches() {
  if (clearingCache.value) return
  clearingCache.value = true
  try {
    clearApiCache() // 内存层 11 个 TTL 缓存 + fire-and-forget 持久层清理
    nsfw.flags = {} // R18 探测结果与会话状态一并复位，下次进入重新探测
    nsfw.restored = false
    await idbClear() // 显式等待持久层清空，确保下方统计读到清空后的值
    await refreshCacheStats()
    message.success('缓存已清除，浏览时将按需重新加载')
  } finally {
    clearingCache.value = false
  }
}

/* ── v0.14 S5 媒体服务（AnimeViewerService）：连接测试 / 状态展示 / 媒体库管理抽屉 ── */
const svcTesting = ref(false)
const svcHealth = ref<SvcHealth | null>(null)
const svcStatus = ref<SvcStatus | null>(null)
const svcError = ref('')
const showMediaLibrary = ref(false)

async function testService(silent = false) {
  // 测试前先把草稿中的地址/Token 落盘（媒体服务配置即时生效，与图片清晰度同策略）
  settings.applyPatch({ svcUrl: (draft.svcUrl || '').trim().replace(/\/+$/, ''), svcToken: (draft.svcToken || '').trim() })
  Object.assign(draft, { svcUrl: settings.svcUrl, svcToken: settings.svcToken })
  svcTesting.value = true
  svcError.value = ''
  try {
    svcHealth.value = await mediaService.health()
    if (settings.svcEnabled) svcStatus.value = await mediaService.status()
  } catch (e) {
    svcHealth.value = null
    svcStatus.value = null
    if (!silent) svcError.value = e instanceof ServiceError ? e.message : String(e)
  } finally {
    svcTesting.value = false
  }
}

function openMediaLibrary() {
  showMediaLibrary.value = true
}

/* ── v0.16 DN4 下载设置（配置存服务端 SQLite settings 表，前端表单直读直写） ── */
const dlSaving = ref(false)
const dlEngine = ref<SvcDownloadEngine | null>(null)
const dlError = ref('')
const dl = reactive({
  engineType: 'aria2-managed' as import('../api/mediaService').DownloadEngineType,
  enginePath: 'aria2c',
  engineUrl: '',
  engineSecret: '',
  rpcPort: 16800,
  qbPath: '',
  downloadDir: './data/downloads',
  maxConcurrent: 2,
  uploadLimit: '',
  trackersText: '',
  autoScan: true,
  seedTimeMinutes: 0,
  checkCertificate: false,
})

/** v0.18 引擎类型选项（qBittorrent = 外部应用直开，用户定案不用 WebUI） */
const ENGINE_TYPE_OPTIONS = [
  { label: 'aria2 · 托管拉起', value: 'aria2-managed' },
  { label: 'aria2 · 外部实例', value: 'aria2-external' },
  { label: 'qBittorrent · 外部应用直开', value: 'qbittorrent' },
]
const isQb = computed(() => dl.engineType === 'qbittorrent')
const isAria2Managed = computed(() => dl.engineType === 'aria2-managed')

async function loadDownloadSettings() {
  if (!settings.svcEnabled) return
  dlError.value = ''
  try {
    const s = await mediaService.downloadSettings()
    Object.assign(dl, {
      engineType: s.engineType,
      enginePath: s.enginePath,
      engineUrl: s.engineUrl,
      engineSecret: s.engineSecret,
      rpcPort: s.rpcPort,
      qbPath: s.qbPath,
      downloadDir: s.downloadDir,
      maxConcurrent: s.maxConcurrent,
      uploadLimit: s.uploadLimit,
      trackersText: s.trackers.join('\n'),
      autoScan: s.autoScan,
      seedTimeMinutes: s.seedTimeMinutes,
      checkCertificate: s.checkCertificate,
    })
    dlEngine.value = await mediaService.downloadEngine()
  } catch (e) {
    dlError.value = e instanceof ServiceError ? e.message : String(e)
  }
}

async function saveDownloadSettings() {
  dlSaving.value = true
  dlError.value = ''
  try {
    const s = await mediaService.saveDownloadSettings({
      engineType: dl.engineType,
      enginePath: dl.enginePath.trim(),
      engineUrl: dl.engineUrl.trim(),
      engineSecret: dl.engineSecret.trim(),
      rpcPort: Number(dl.rpcPort) || 16800,
      qbPath: dl.qbPath.trim(),
      downloadDir: dl.downloadDir.trim(),
      maxConcurrent: Number(dl.maxConcurrent) || 2,
      uploadLimit: dl.uploadLimit.trim(),
      trackers: dl.trackersText
        .split(/[\n,]+/)
        .map((x) => x.trim())
        .filter(Boolean),
      autoScan: dl.autoScan,
      seedTimeMinutes: Number(dl.seedTimeMinutes) || 0,
      checkCertificate: dl.checkCertificate,
    })
    Object.assign(dl, { ...s, trackersText: s.trackers.join('\n') })
    dlEngine.value = await mediaService.downloadEngine()
    message.success(dlEngine.value.available ? '下载设置已保存，引擎就绪' : `设置已保存，但引擎未就绪：${dlEngine.value.error ?? ''}`)
  } catch (e) {
    dlError.value = e instanceof ServiceError ? e.message : String(e)
  } finally {
    dlSaving.value = false
  }
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
  void refreshCacheStats()
  if (settings.svcEnabled) void testService(true)
  void loadDownloadSettings()
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

async function exportLibrary() {
  // v0.13 PL4：附带媒体绑定与播放进度（可选段；句柄不导出，恢复后播放时引导重选文件）
  const media = await exportMedia()
  const payload = {
    app: 'animeviewer',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: library.list,
    ...(media.bindings.length || media.positions.length ? { media } : {}),
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `animeviewer-library-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  message.success(`已导出 ${library.count} 条收藏${media.bindings.length ? ` · ${media.bindings.length} 条播放绑定` : ''}`)
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
    let mediaNote = ''
    const mediaSection = (parsed as { media?: unknown }).media
    if (mediaSection && typeof mediaSection === 'object') {
      const r = await importMedia(mediaSection as Parameters<typeof importMedia>[0])
      mediaNote = ` · 媒体绑定 +${r.bindingsAdded} · 播放进度 +${r.positionsMerged}`
    }
    message.success(`导入完成：新增 ${res.added} 条，跳过重复/无效 ${res.skipped} 条${mediaNote}`)
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
      <h2><NIcon :component="SettingsOutline" />设置</h2>
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

        <NFormItem label="缓存管理（详情/子资源/R18 探测的离线缓存，不影响收藏与设置数据）">
          <div class="cache-box">
            <div class="cache-meta">
              <span>
                IndexedDB 持久缓存：{{ cacheStats ? `${cacheStats.count} 条 · 约 ${formatBytes(cacheStats.bytes)}` : '统计中…' }}
              </span>
              <span>清除后下次浏览相同条目会重新请求；追番记录、评分笔记与各项设置不受影响</span>
            </div>
            <div class="btn-row">
              <NButton secondary size="small" @click="refreshCacheStats">刷新统计</NButton>
              <NPopconfirm @positive-click="clearCaches">
                <template #trigger>
                  <NButton quaternary type="error" size="small" :loading="clearingCache">
                    <template #icon><NIcon :component="TrashOutline" /></template>
                    清除缓存
                  </NButton>
                </template>
                清空内存与 IndexedDB 中的接口缓存？追番记录和设置不会丢失。
              </NPopconfirm>
            </div>
          </div>
        </NFormItem>

        <NFormItem label="媒体服务（可选：AnimeViewerService 本地媒体库——自动扫描匹配、mkv 转封装播放、局域网观看）">
          <div class="svc-box">
            <div class="svc-grid">
              <NInput v-model:value="draft.svcUrl" placeholder="服务地址，如 http://127.0.0.1:8787" clearable />
              <NInput
                v-model:value="draft.svcToken"
                type="password"
                show-password-on="click"
                placeholder="配对 Token（服务首次启动时打印到控制台并写入 data/token）"
              />
            </div>
            <div class="svc-status">
              <template v-if="svcError">
                <span class="svc-err">{{ svcError }}</span>
              </template>
              <template v-else-if="svcHealth">
                <span>AnimeViewerService v{{ svcHealth.version }}</span>
                <span>ffmpeg {{ svcHealth.ffmpeg ? '可用' : '未配置（mp4 直连可用，mkv 转封装不可用）' }}</span>
                <span v-if="svcStatus">文件 {{ svcStatus.files }} · 已绑定 {{ svcStatus.bound }} · 待确认 {{ svcStatus.pending }}</span>
              </template>
              <span v-else class="svc-muted">未连接——填写地址与 Token 后点「连接测试」（配置即时生效）</span>
            </div>
            <div class="btn-row">
              <NButton secondary size="small" :loading="svcTesting" @click="testService()">连接测试</NButton>
              <NButton secondary size="small" :disabled="!settings.svcEnabled" @click="openMediaLibrary">
                <template #icon><NIcon :component="ServerOutline" /></template>
                媒体库管理
              </NButton>
            </div>
            <div class="svc-tip">
              服务默认地址 http://127.0.0.1:8787，默认仅本机可访问；部署与局域网开启方式见服务端 README。
              配置后剧集 Tab 会显示媒体库已收录集的播放按钮。
            </div>
          </div>
        </NFormItem>

        <NFormItem label="WebDAV 账号（可选：浏览并播放自备网络存储中的视频；凭据仅存本机，播放凭据由媒体服务会话托管）">
          <div class="svc-box">
            <div class="svc-grid">
              <NInput v-model:value="draft.webdavUrl" placeholder="WebDAV 地址，如 https://dav.example.com/dav" clearable />
              <NInput v-model:value="draft.webdavUser" placeholder="账号（匿名服务可留空）" clearable />
              <NInput
                v-model:value="draft.webdavPass"
                type="password"
                show-password-on="click"
                placeholder="密码"
                clearable
              />
            </div>
            <div class="svc-tip">
              填写地址后即可在剧集 Tab「本地播放」弹窗中浏览 WebDAV 目录并绑定集数；播放需同时配置上方媒体服务。
              仅支持只读浏览，不做上传/删除等写操作。
            </div>
          </div>
        </NFormItem>

        <NFormItem label="BT 下载（可选：aria2 引擎托管下载，或直开本机 qBittorrent 下载）">
          <div class="svc-box">
            <div class="svc-grid dl-grid">
              <NSelect v-model:value="dl.engineType" :options="ENGINE_TYPE_OPTIONS" placeholder="引擎类型" />
              <template v-if="isQb">
                <NInput v-model:value="dl.qbPath" placeholder="qBittorrent 可执行文件完整路径（如 G:/qbittorrent/qbittorrent.exe）" clearable />
              </template>
              <template v-else>
                <NInput v-if="isAria2Managed" v-model:value="dl.enginePath" placeholder="aria2c 可执行文件（PATH 探测；未入 PATH 填完整路径，如 G:/aria2/aria2c.exe）" clearable />
                <NInput v-if="!isAria2Managed" v-model:value="dl.engineUrl" placeholder="外部实例 RPC 地址（如 http://127.0.0.1:6800/rpc）" clearable />
                <NInput
                  v-if="!isAria2Managed"
                  v-model:value="dl.engineSecret"
                  type="password"
                  show-password-on="click"
                  placeholder="外部实例 rpc-secret（选填）"
                  clearable
                />
                <NInputNumber v-if="isAria2Managed" v-model:value="dl.rpcPort" :min="1" :max="65535" placeholder="RPC 端口">
                  <template #prefix>RPC</template>
                </NInputNumber>
                <div class="dl-row2">
                  <NInputNumber v-model:value="dl.maxConcurrent" :min="1" :max="10" placeholder="并发任务">
                    <template #prefix>并发</template>
                  </NInputNumber>
                  <NInputNumber v-model:value="dl.seedTimeMinutes" :min="0" :max="100000" placeholder="做种分钟">
                    <template #prefix>做种</template>
                  </NInputNumber>
                  <NInput v-model:value="dl.uploadLimit" placeholder="上传限速（如 2M，留空不限）" clearable />
                </div>
              </template>
              <NInput v-model:value="dl.downloadDir" placeholder="下载目录（相对服务工作目录，默认 ./data/downloads）" />
              <NInput
                v-model:value="dl.trackersText"
                type="textarea"
                :rows="2"
                placeholder="注入磁力的公共 tracker（每行一个；无 tracker 磁力仅靠 DHT，元数据解析极慢）"
              />
              <div class="dl-switches">
                <span class="dl-switch-item">完成后自动入库扫描 <NSwitch v-model:value="dl.autoScan" size="small" /></span>
                <span v-if="!isQb" class="dl-switch-item">aria2 证书校验 <NSwitch v-model:value="dl.checkCertificate" size="small" /></span>
              </div>
            </div>
            <div class="svc-status">
              <template v-if="dlError">
                <span class="svc-err">{{ dlError }}</span>
              </template>
              <template v-else-if="dlEngine">
                <span>
                  {{ dlEngine.available
                    ? (dlEngine.mode === 'external-app' ? 'qBittorrent 直开就绪' : `aria2 ${dlEngine.version ?? ''}（${dlEngine.mode === 'external' ? '外部实例' : '托管模式'}）`)
                    : '引擎不可用' }}
                </span>
                <span v-if="dlEngine.available">目录 {{ dlEngine.downloadDir }}</span>
                <span v-else class="svc-err">{{ dlEngine.error }}</span>
              </template>
              <span v-else class="svc-muted">引擎状态未知——保存设置后自动探测</span>
              <div class="btn-row">
                <NButton secondary size="small" :loading="dlSaving" @click="saveDownloadSettings">保存并应用</NButton>
                <NButton quaternary size="small" :disabled="!settings.svcEnabled" @click="loadDownloadSettings">重新读取</NButton>
              </div>
            </div>
            <div class="svc-tip">
              {{ isQb
                ? 'qBittorrent 直开（用户定案，不用 WebUI）：添加磁力时服务端直接拉起本机 qBittorrent 并带上磁力参数，下载进度与文件管理全部在 qBt 内进行（本页下载中心仅保留任务台账，无进度同步）；已开着的 qBt 实例会由其单实例机制接收任务。种子直链会暂存为临时 .torrent 后拉起。'
                : '下载中心（侧边栏「下载」）粘贴磁力/种子直链即可下载；完成后自动触发媒体库增量扫描并按文件名匹配绑定，剧集 Tab 随即出现播放按钮。Windows 下 aria2 建议关闭证书校验（schannel 吊销检查会导致 HTTPS tracker 握手失败）。' }}
            </div>
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

    <!-- v0.14 S5 媒体库管理抽屉（服务状态 / 扫描 / 目录 / 文件匹配） -->
    <MediaLibraryDrawer v-model:show="showMediaLibrary" />
  </div>
</template>

<style scoped>
.settings-panel {
  max-width: 620px;
  padding: 22px 24px;
  border-radius: 12px;
  border: 1px solid var(--av-border);
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
  background: var(--av-surface-hover);
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
  background: linear-gradient(135deg, var(--av-primary), #5d4fd8);
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
  color: var(--av-primary);
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
  background: var(--av-surface-hover);
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

/* v0.11 缓存管理 */
.cache-box {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* v0.14 S5 媒体服务 */
.svc-box {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.svc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 480px) {
  .svc-grid {
    grid-template-columns: 1fr;
  }
}

/* v0.16 DN4 下载设置 */
.dl-grid > :first-child,
.dl-grid > :nth-child(4),
.dl-grid > :nth-child(5),
.dl-grid > :nth-child(6) {
  grid-column: 1 / -1;
}

.dl-row2 {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr 1.5fr;
  gap: 10px;
}

@media (max-width: 640px) {
  .dl-row2 {
    grid-template-columns: 1fr 1fr;
  }
}

.dl-switches {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
  grid-column: 1 / -1;
}

.dl-switch-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--av-text-secondary);
}


.svc-status {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--av-text-secondary);
}

.svc-err {
  color: var(--av-danger, #e05c5c);
}

.svc-muted {
  opacity: 0.65;
}

.svc-tip {
  font-size: 12px;
  opacity: 0.55;
  line-height: 1.6;
}

.cache-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  opacity: 0.7;
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
  background: var(--av-surface-hover);
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
