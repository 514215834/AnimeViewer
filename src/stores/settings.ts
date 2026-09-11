import { defineStore } from 'pinia'
import { loadJson, saveJson } from '../utils/storage'

export type DataSource = 'online' | 'demo'
export type ThemeMode = 'dark' | 'light'
/** 图片清晰度：极致=400px 高清=200px 省流=150px（lain 封面仅支持 200/400 两档缩放 + 150px common） */
export type ImageQuality = 'extreme' | 'high' | 'saver'

export interface SettingsState {
  theme: ThemeMode
  dataSource: DataSource
  apiBaseUrl: string
  /** 图片镜像地址：将 lain.bgm.tv 主机替换为该地址（保留路径），留空使用官方源 */
  mirrorImageUrl: string
  accessToken: string
  hideNsfw: boolean
  imageQuality: ImageQuality
  /** 可选：自建 Bangumi 应用的 OAuth 凭据（bgm.tv/dev/app 注册后获得） */
  oauthClientId: string
  oauthClientSecret: string
  refreshToken: string
}

const STORAGE_KEY = 'animeviewer:settings'

// Access Token 默认留空（匿名访问）：提升限额的 Token 由使用者在设置页自填（仅存本地）。
// 历史版本曾将真实 Token 硬编码为默认值，v0.10 起清除——已入库的本地配置不受影响，新装用户需自填
export const DEFAULT_ACCESS_TOKEN = ''

export const DEFAULT_SETTINGS: SettingsState = {
  theme: 'dark',
  dataSource: 'online',
  apiBaseUrl: 'https://api.bgm.tv',
  mirrorImageUrl: '',
  accessToken: DEFAULT_ACCESS_TOKEN,
  hideNsfw: true,
  imageQuality: 'extreme',
  oauthClientId: '',
  oauthClientSecret: '',
  refreshToken: '',
}

export const useSettingsStore = defineStore('settings', {
  // 与默认值合并：老版本持久化的配置缺少新增字段（如 mirrorImageUrl）时补齐默认值
  state: (): SettingsState => ({ ...DEFAULT_SETTINGS, ...loadJson<Partial<SettingsState>>(STORAGE_KEY, {}) }),
  getters: {
    isDemo: (s) => s.dataSource === 'demo',
  },
  actions: {
    persist() {
      saveJson(STORAGE_KEY, { ...this.$state })
    },
    applyPatch(patch: Partial<SettingsState>) {
      this.$patch(patch)
      this.persist()
    },
    resetDefaults() {
      this.$patch({ ...DEFAULT_SETTINGS })
      this.persist()
    },
    toggleTheme() {
      this.applyPatch({ theme: this.theme === 'dark' ? 'light' : 'dark' })
    },
  },
})
