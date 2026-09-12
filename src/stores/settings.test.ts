import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { DEFAULT_ACCESS_TOKEN, DEFAULT_SETTINGS, useSettingsStore } from './settings'

/**
 * 技术债「settings 持久化」清账单测：默认值与安全默认 Token、老配置字段合并迁移、
 * applyPatch/toggleTheme/resetDefaults 落盘读回、损坏 JSON 兜底。
 * happy-dom 提供 localStorage；每例重建 pinia + 清空存储，保证互不污染。
 */
function freshEnv(seed?: Record<string, unknown>) {
  localStorage.clear()
  if (seed) localStorage.setItem('animeviewer:settings', JSON.stringify(seed))
  setActivePinia(createPinia())
}

describe('settings 持久化', () => {
  beforeEach(() => freshEnv())

  it('无持久化记录时返回完整默认值，且默认 Token 为空（v0.10 安全默认）', () => {
    const s = useSettingsStore()
    expect(s.$state).toEqual({ ...DEFAULT_SETTINGS })
    expect(DEFAULT_ACCESS_TOKEN).toBe('')
    expect(s.accessToken).toBe('')
    expect(s.isDemo).toBe(false)
  })

  it('老版本持久化缺新增字段时按默认值补齐（迁移），用户已有字段不被覆盖', () => {
    // 模拟 v0.3 时代的配置：无 mirrorImageUrl / imageQuality / oauth* 字段
    freshEnv({ theme: 'light', accessToken: 'user-token', dataSource: 'demo' })
    const s = useSettingsStore()
    expect(s.theme).toBe('light')
    expect(s.accessToken).toBe('user-token')
    expect(s.isDemo).toBe(true)
    expect(s.mirrorImageUrl).toBe('')
    expect(s.imageQuality).toBe('extreme')
    expect(s.oauthClientId).toBe('')
    expect(s.hideNsfw).toBe(true)
    // T3 桌面通知默认关闭（2026-09-12 评审决议：默认不通知）
    expect(s.desktopNotifyEnabled).toBe(false)
    expect(s.desktopNotifyScope).toBe('doing')
    expect(s.desktopNotifyIntervalMin).toBe(60)
  })

  it('applyPatch 写状态并落盘，重建 store 后读回（模拟刷新）', () => {
    useSettingsStore().applyPatch({ dataSource: 'demo', imageQuality: 'saver', apiBaseUrl: 'https://mirror.example' })
    setActivePinia(createPinia())
    const s2 = useSettingsStore()
    expect(s2.dataSource).toBe('demo')
    expect(s2.imageQuality).toBe('saver')
    expect(s2.apiBaseUrl).toBe('https://mirror.example')
  })

  it('toggleTheme 在暗/亮间往返并各自持久化', () => {
    const s = useSettingsStore()
    expect(s.theme).toBe('dark')
    s.toggleTheme()
    expect(s.theme).toBe('light')
    setActivePinia(createPinia())
    expect(useSettingsStore().theme).toBe('light')
    useSettingsStore().toggleTheme()
    setActivePinia(createPinia())
    expect(useSettingsStore().theme).toBe('dark')
  })

  it('resetDefaults 恢复默认并清除持久化的自定义值（含自定义 Token）', () => {
    const s = useSettingsStore()
    s.applyPatch({ theme: 'light', accessToken: 'custom-token', mirrorImageUrl: 'https://img.example' })
    s.resetDefaults()
    expect(s.theme).toBe('dark')
    expect(s.accessToken).toBe('')
    expect(s.mirrorImageUrl).toBe('')
    const raw = JSON.parse(localStorage.getItem('animeviewer:settings') ?? '{}')
    expect(raw.theme).toBe('dark')
    expect(raw.accessToken).toBe('')
    expect(raw.mirrorImageUrl).toBe('')
  })

  it('损坏的持久化 JSON 静默回退默认值，不抛错', () => {
    localStorage.setItem('animeviewer:settings', '{not-valid-json')
    setActivePinia(createPinia())
    const s = useSettingsStore()
    expect(s.theme).toBe('dark')
    expect(s.dataSource).toBe('online')
    expect(s.accessToken).toBe('')
  })
})
