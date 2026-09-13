import { describe, expect, it } from 'vitest'
import {
  bindingKey,
  fileKeyOf,
  formatClock,
  guessEpisodeSort,
  isVideoName,
  isWatchedComplete,
  mergeMediaImport,
  positionIdOf,
  positionKey,
  watchRatio,
  WATCH_COMPLETE_RATIO,
  type MediaBinding,
  type WatchPosition,
} from './mediaCore'

describe('mediaCore 键规则', () => {
  it('bindingKey 为 subjectId+sort 复合键', () => {
    expect(bindingKey(900013, 3)).toBe('b:900013:3')
    expect(bindingKey(1, 12)).not.toBe(bindingKey(12, 1))
  })

  it('fileKeyOf 由文件名+大小决定（同名同大小稳定）', () => {
    expect(fileKeyOf('EP01.mp4', 1024)).toBe('f:EP01.mp4:1024')
    expect(fileKeyOf('a.mkv', 1)).toBe(fileKeyOf('a.mkv', 1))
    expect(fileKeyOf('a.mkv', 1)).not.toBe(fileKeyOf('a.mkv', 2))
  })

  it('positionKey / positionIdOf 按绑定类型路由', () => {
    expect(positionKey('x')).toBe('p:x')
    expect(positionIdOf({ type: 'file', fileKey: 'f:a:1' })).toBe('f:a:1')
    expect(positionIdOf({ type: 'demo' })).toBe('demo-clip')
    expect(positionIdOf({ type: 'url', url: 'http://x/v.mp4' })).toBe('u:http://x/v.mp4')
    expect(positionIdOf({ type: 'url' })).toBe('u:')
  })
})

describe('mediaCore 完播判定（PL3 ≥95%）', () => {
  it('阈值边界：94.9% 未完成 / 95% 完成', () => {
    expect(isWatchedComplete(94.9, 100)).toBe(false)
    expect(isWatchedComplete(95, 100)).toBe(true)
    expect(isWatchedComplete(96, 100)).toBe(true)
    expect(WATCH_COMPLETE_RATIO).toBe(0.95)
  })

  it('时长未知 / 非法输入一律不判定', () => {
    expect(isWatchedComplete(100, 0)).toBe(false)
    expect(isWatchedComplete(Number.NaN, 100)).toBe(false)
    expect(isWatchedComplete(-1, 100)).toBe(false)
  })

  it('watchRatio 归一化并钳制到 0~1', () => {
    expect(watchRatio(50, 100)).toBe(0.5)
    expect(watchRatio(120, 100)).toBe(1)
    expect(watchRatio(10, 0)).toBe(0)
    expect(watchRatio(-5, 100)).toBe(0)
  })

  it('formatClock 输出 mm:ss / h:mm:ss', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(3675)).toBe('1:01:15')
    expect(formatClock(Number.NaN)).toBe('0:00')
  })
})

describe('mediaCore 文件名识别（PL2 猜测预填）', () => {
  it('常规命名取最后一个 1~999 数字组', () => {
    expect(guessEpisodeSort('[SubGroup] Title - 05 [1080p].mkv')).toBe(5)
    expect(guessEpisodeSort('S01E03 some name.mp4')).toBe(3)
    expect(guessEpisodeSort('动画 第13话 WebRip.mp4')).toBe(13)
    expect(guessEpisodeSort('EP 47 [END].mkv')).toBe(47)
  })

  it('分辨率/年份/无数字不误判', () => {
    // 1080p/720p 被排除
    expect(guessEpisodeSort('Movie [1080p].mkv')).toBeNull()
    expect(guessEpisodeSort('Show [720p].mkv')).toBeNull()
    // 年份 ≥1000 被排除（仅剩年份时返回 null）
    expect(guessEpisodeSort('Show 2023.mkv')).toBeNull()
    expect(guessEpisodeSort('没有任何数字.webm')).toBeNull()
  })

  it('isVideoName 按扩展名过滤', () => {
    expect(isVideoName('a.MP4')).toBe(true)
    expect(isVideoName('b.mkv')).toBe(true)
    expect(isVideoName('c.txt')).toBe(false)
    expect(isVideoName('noext')).toBe(false)
  })
})

describe('mediaCore 导出合并（PL4 向后兼容）', () => {
  const existingBindings: MediaBinding[] = [
    { subjectId: 1, sort: 1, name: '本机已有.mp4', type: 'file', fileKey: 'f:a:1', addedAt: 100 },
  ]
  const existingPositions: WatchPosition[] = [
    { id: 'f:a:1', position: 60, duration: 100, updatedAt: 100 },
  ]

  it('绑定键已存在时不覆盖本机现状', () => {
    const r = mergeMediaImport(
      { bindings: existingBindings, positions: existingPositions },
      { bindings: [{ subjectId: 1, sort: 1, name: '导入的.mp4', type: 'file', fileKey: 'f:b:2', addedAt: 200 }] },
    )
    expect(r.result.bindingsAdded).toBe(0)
    expect(r.bindings[0].name).toBe('本机已有.mp4')
  })

  it('新绑定追加；播放位置按 updatedAt 新者覆盖', () => {
    const r = mergeMediaImport(
      { bindings: existingBindings, positions: existingPositions },
      {
        bindings: [{ subjectId: 2, sort: 3, name: 'x.mp4', type: 'file', fileKey: 'f:x:9', addedAt: 1 }],
        positions: [
          { id: 'f:a:1', position: 90, duration: 100, updatedAt: 200 },
          { id: 'f:a:1', position: 10, duration: 100, updatedAt: 50 },
        ],
      },
    )
    expect(r.result.bindingsAdded).toBe(1)
    expect(r.result.positionsMerged).toBe(1)
    expect(r.bindings).toHaveLength(2)
    expect(r.positions.find((p) => p.id === 'f:a:1')?.position).toBe(90)
  })

  it('非法条目跳过；空段返回原状且计数为 0（旧备份无 media 段兼容）', () => {
    const r = mergeMediaImport(
      { bindings: existingBindings, positions: existingPositions },
      { bindings: [null as unknown as MediaBinding, { sort: 1 } as unknown as MediaBinding], positions: undefined },
    )
    expect(r.result.bindingsAdded).toBe(0)
    expect(r.result.positionsMerged).toBe(0)
    expect(r.bindings).toHaveLength(1)
    expect(r.positions).toHaveLength(1)

    const empty = mergeMediaImport({ bindings: existingBindings, positions: existingPositions }, undefined)
    expect(empty.result.bindingsAdded).toBe(0)
    expect(empty.bindings).toHaveLength(1)
  })
})

/* ── v0.15 O1 在线源 / O5 播放历史 ── */

import { isHlsUrl, resolvePositionOwner, urlFileName } from './mediaCore'

describe('v0.15 在线源与播放历史（mediaCore 扩展）', () => {
  it('isHlsUrl：路径 .m3u8 判定（大小写/查询串不敏感），其余直链与非法输入为 false', () => {
    expect(isHlsUrl('https://cdn.example.com/live/index.m3u8?sign=abc')).toBe(true)
    expect(isHlsUrl('https://cdn.example.com/live/INDEX.M3U8')).toBe(true)
    expect(isHlsUrl('https://cdn.example.com/video.mp4')).toBe(false)
    expect(isHlsUrl('https://cdn.example.com/watch/123')).toBe(false)
    expect(isHlsUrl('')).toBe(false)
    // 非法 URL 退化为宽松正则（带查询串）
    expect(isHlsUrl('not a url but has .m3u8?x=1')).toBe(true)
    expect(isHlsUrl('no-extension-here')).toBe(false)
  })

  it('urlFileName：取最后一段并百分号解码，去查询串/哈希', () => {
    expect(urlFileName('https://a.com/v/EP01.mp4?sign=x')).toBe('EP01.mp4')
    expect(urlFileName('https://a.com/v/%E7%AC%AC01%E8%AF%9D.mkv')).toBe('第01话.mkv')
    expect(urlFileName('https://a.com/')).toBe('')
    // 非 URL 输入走宽松回退：按斜杠取末段
    expect(urlFileName('not a url/EP02.mp4')).toBe('EP02.mp4')
  })

  it('resolvePositionOwner：svc:/u:/demo/file 四类位置标识反解归属', () => {
    const bindings: MediaBinding[] = [
      { subjectId: 1, sort: 2, name: '本地', type: 'file', fileKey: 'f:a:1', addedAt: 1 },
      { subjectId: 2, sort: 3, name: '直链', type: 'url', url: 'https://a.com/x.mp4', addedAt: 1 },
      { subjectId: 3, sort: 4, name: 'webdav', type: 'url', url: 'https://dav/x.mkv', webdav: { path: '/x.mkv' }, addedAt: 1 },
      { subjectId: 4, sort: 5, name: '演示', type: 'demo', addedAt: 1 },
    ]
    const pos = (id: string): WatchPosition => ({ id, position: 1, duration: 2, updatedAt: 3 })

    expect(resolvePositionOwner(pos('svc:2045:2'), bindings)).toMatchObject({ subjectId: 2045, sort: 2, source: 'service' })
    expect(resolvePositionOwner(pos('u:https://a.com/x.mp4'), bindings)).toMatchObject({ subjectId: 2, sort: 3, source: 'url' })
    expect(resolvePositionOwner(pos('u:https://dav/x.mkv'), bindings)).toMatchObject({ subjectId: 3, sort: 4, source: 'webdav' })
    expect(resolvePositionOwner(pos('demo-clip'), bindings)).toMatchObject({ subjectId: 4, sort: 5, source: 'demo' })
    expect(resolvePositionOwner(pos('f:a:1'), bindings)).toMatchObject({ subjectId: 1, sort: 2, source: 'file' })
  })

  it('resolvePositionOwner：无法归属（绑定已解/未知格式）返回 null', () => {
    const pos = (id: string): WatchPosition => ({ id, position: 1, duration: 2, updatedAt: 3 })
    expect(resolvePositionOwner(pos('u:https://gone.com/x.mp4'), [])).toBeNull()
    expect(resolvePositionOwner(pos('svc:x:y'), [])).toBeNull()
    expect(resolvePositionOwner(pos('demo-clip'), [])).toBeNull()
    expect(resolvePositionOwner(pos('f:missing:1'), [])).toBeNull()
    expect(resolvePositionOwner(pos(''), [])).toBeNull()
  })
})
