import { describe, expect, it } from 'vitest'
import { buildStreamUrl, isDirectExt, servicePositionId } from './mediaService'

describe('v0.14 mediaService 纯函数', () => {
  it('buildStreamUrl：基础地址拼接 + 尾斜杠规范化', () => {
    expect(buildStreamUrl('http://127.0.0.1:8787', 'tok', 5)).toBe('http://127.0.0.1:8787/api/stream/5?token=tok')
    expect(buildStreamUrl('http://127.0.0.1:8787/', 'tok', 5)).toBe('http://127.0.0.1:8787/api/stream/5?token=tok')
  })

  it('buildStreamUrl：t>0 时携带 seek 起点（转封装重拉），t=0/负数不携带', () => {
    expect(buildStreamUrl('http://s', 't', 3, 30)).toBe('http://s/api/stream/3?token=t&t=30')
    expect(buildStreamUrl('http://s', 't', 3, 0)).toBe('http://s/api/stream/3?token=t')
    expect(buildStreamUrl('http://s', 't', 3, -5)).toBe('http://s/api/stream/3?token=t')
  })

  it('servicePositionId：按「条目+话数」记忆（换绑/重扫文件后进度不丢）', () => {
    expect(servicePositionId(2045, 1)).toBe('svc:2045:1')
  })

  it('isDirectExt：mp4/m4v/webm 直连，容器大小写不敏感，其余走转封装', () => {
    expect(isDirectExt('mp4')).toBe(true)
    expect(isDirectExt('M4V')).toBe(true)
    expect(isDirectExt('webm')).toBe(true)
    expect(isDirectExt('mkv')).toBe(false)
    expect(isDirectExt('avi')).toBe(false)
    expect(isDirectExt(undefined)).toBe(false)
    expect(isDirectExt('')).toBe(false)
  })
})

/* ── v0.15 O1 流代理 / O3 WebDAV 地址构造 ── */

import { buildProxyUrl, buildWebdavStreamUrl } from './mediaService'

describe('v0.15 mediaService 纯函数', () => {
  it('buildProxyUrl：目标 URL 整体编码、尾斜杠规范化', () => {
    expect(buildProxyUrl('http://s:8787/', 't0k', 'https://a.com/v/EP01.mp4?sign=x')).toBe(
      'http://s:8787/api/proxy?token=t0k&url=https%3A%2F%2Fa.com%2Fv%2FEP01.mp4%3Fsign%3Dx',
    )
  })

  it('buildWebdavStreamUrl：streamId 编码拼接', () => {
    expect(buildWebdavStreamUrl('http://s:8787', 't', 'abc123')).toBe(
      'http://s:8787/api/webdav/stream/abc123?token=t',
    )
  })
})

/* ── v0.16 DN3 下载中心 ── */

import { formatBytes, formatSpeed, parseMagnet } from './mediaService'

describe('v0.16 下载中心纯函数', () => {
  it('parseMagnet：infohash/dn 显示名/tracker 计数', () => {
    const m = parseMagnet(
      'magnet:?xt=urn:btih:d160b8d8ea35a5b4e52837468fc8f03d55cef1f7' +
        '&dn=%E5%90%8D%E4%BE%A6%E6%8E%A2' +
        '&tr=' +
        encodeURIComponent('http://t1/announce') +
        '&tr=' +
        encodeURIComponent('http://t2/announce'),
    )
    expect(m.infoHash).toBe('d160b8d8ea35a5b4e52837468fc8f03d55cef1f7')
    expect(m.displayName).toBe('名侦探')
    expect(m.trackers).toBe(2)
  })

  it('parseMagnet：无 dn/tr 的裸磁力与非磁力输入', () => {
    const bare = parseMagnet(`magnet:?xt=urn:btih:${'a'.repeat(40)}`)
    expect(bare.infoHash).toBe('a'.repeat(40))
    expect(bare.displayName).toBeUndefined()
    expect(bare.trackers).toBe(0)
    expect(parseMagnet('https://example.com/a.torrent').infoHash).toBeUndefined()
    expect(parseMagnet('').trackers).toBe(0)
  })

  it('formatBytes / formatSpeed：分级换算与零值', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 1024 * 5)).toBe('5.0 MB')
    expect(formatSpeed(0)).toBe('0 B/s')
    expect(formatSpeed(1024 * 1024 * 16)).toBe('16.0 MB/s')
  })
})
