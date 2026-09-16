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

/* ── v0.17 R2/R3 资源发现 ── */

import { extractFansub, searchKeywords } from './mediaService'

describe('v0.17 资源发现纯函数', () => {
  it('extractFansub：行首 [组名] 优先', () => {
    expect(extractFansub('[雪飘工作室][名探偵プリキュア！][1080p][33]')).toBe('雪飘工作室')
    expect(extractFansub('[SubGroup] Title - 05 [1080p]')).toBe('SubGroup')
    expect(extractFansub('[组名超长超过三十个字符的非法形态不该匹配xxxxxxxxxxxxxxxx]')).toBeNull()
  })

  it('extractFansub：acgnx 官方发布「镜像站 | 标题」形态取镜像名', () => {
    expect(extractFansub('萌番組鏡像 | 名侦探光之美少女！ - EP33 [简／繁]')).toBe('萌番組鏡像')
    expect(extractFansub('動漫花園鏡像|[Title][01]')).toBe('動漫花園鏡像')
  })

  it('extractFansub：无组名形态返回 null', () => {
    expect(extractFansub('名侦探光之美少女！ - EP33')).toBeNull()
    expect(extractFansub('')).toBeNull()
  })

  it('searchKeywords：中文名/原名双查询候选（去重、非空）', () => {
    expect(searchKeywords('名侦探光之美少女！', '名探偵プリキュア！')).toEqual([
      '名侦探光之美少女！',
      '名探偵プリキュア！',
    ])
    expect(searchKeywords('同一名字', '同一名字')).toEqual(['同一名字'])
    expect(searchKeywords('  只有中文名  ', '')).toEqual(['只有中文名'])
    expect(searchKeywords('', undefined)).toEqual([])
  })
})

import { guessEpisodeSortFromTitle, hitAiLabel, hitAiVerdict } from './mediaService'

describe('v0.17 资源标题集数猜测', () => {
  it('EP33 / 第33话 显式标记优先', () => {
    expect(guessEpisodeSortFromTitle('名侦探光之美少女！ - EP33 [简／繁] (1080p)')).toBe(33)
    expect(guessEpisodeSortFromTitle('[Group][Title][05][1080p]')).toBe(5)
    expect(guessEpisodeSortFromTitle('动画 第13话 WebRip')).toBe(13)
  })

  it('退化：最后一个非年份非分辨率数字', () => {
    expect(guessEpisodeSortFromTitle('[Group] Title 07 (2026) [1080p]')).toBe(7)
    expect(guessEpisodeSortFromTitle('Movie 2019 1080p')).toBeNull()
  })

  it('无数字返回 null', () => {
    expect(guessEpisodeSortFromTitle('完整季播合集')).toBeNull()
  })

  // v0.21 补记（2026-09-16 订阅 #29 实测事故，与服务端 SubscriptionFilter.parseEpisode 同夹具逐字对齐）：
  // LoliHouse 裸数字集数标题（无「第N话」）此前被尾部 HEVC-10bit 劫持——11 条全解析成 10，
  // 配合同集数 pending 占位唯一把其余 10 条全挡掉
  it('v0.21 修复：单位尾数（10bit/48kHz/60fps）不再劫持裸数字集数', () => {
    expect(guessEpisodeSortFromTitle('[LoliHouse] 孤独摇滚！ - 08 [WebRip 1080p HEVC-10bit]')).toBe(8)
    expect(guessEpisodeSortFromTitle(
      '[LoliHouse] 转校生美少女竟是我曾经认为是男孩子的青梅竹马 / 轉學後班上的清純可愛美少女，竟是小時候玩在一起的哥兒們'
      + ' / 転校先の清楚可憐な美少女が、昔男子と思って一緒に遊んだ幼馴染だった件 / てんびん - 11'
      + ' [WebRip 1080p HEVC-10bit AAC][简繁内封字幕]')).toBe(11)
    expect(guessEpisodeSortFromTitle(
      '[LoliHouse] 転校先の清楚可憐な美少女が、昔男子と思って一緒に遊んだ幼馴染だった件 / てんびん - 09'
      + ' [WebRip 1080p HEVC-10bit AAC][简繁内封字幕]')).toBe(9)
    expect(guessEpisodeSortFromTitle(
      '[LoliHouse] 転校先の清楚可憐な美少女が、昔男子と思って一緒に遊んだ幼馴染だった件 / てんびん - 01'
      + ' [WebRip 1080p HEVC-10bit AAC][简繁内封字幕]')).toBe(1)
    expect(guessEpisodeSortFromTitle('[Group] Title - 05 [1080p 60fps]')).toBe(5)
  })

  it('v0.21 修复：点分日期/H.264/Vol.12 与连字符范围包作废为 null', () => {
    expect(guessEpisodeSortFromTitle(
      '[JMAX] [2026.07.08] TVアニメ「転校先の清楚可憐な美少女が、昔男子と思って一緒に遊んだ幼馴染だった件」'
      + 'EDテーマ「Tilt」／harmoe [FLAC 48kHz/24bit]')).toBeNull()
    expect(guessEpisodeSortFromTitle(
      '[JMAX] [2026.07.08] TVアニメ「転校先の清楚可憐な美少女が、昔男子と思って一緒に遊んだ幼馴染だった件」'
      + 'OPテーマ「夏に重ねて」／DIALOGUE+ [FLAC 96kHz/24bit]')).toBeNull()
    expect(guessEpisodeSortFromTitle(
      '転校先の清楚可憐な美少女が、昔男子と思って一緒に遊んだ幼馴染だった件 raw 第01-04巻')).toBeNull()
    expect(guessEpisodeSortFromTitle(
      '(ラノベ)[雲雀湯] 転校先の清楚可憐な美少女が、昔男子と思って一緒に遊んだ幼馴染だった件 1-3 epub')).toBeNull()
    expect(guessEpisodeSortFromTitle('孤独摇滚 Vol.12 2026 H.264')).toBeNull()
  })
})

describe('v0.22 AI1 命中语义判定徽章（hitAiVerdict 纯函数）', () => {
  it('标准判定 JSON → 视图对象', () => {
    const v = hitAiVerdict('{"type":"episode","episode":11,"isMainline":true,"reason":"标题含 第11话"}')
    expect(v?.type).toBe('episode')
    expect(v?.episode).toBe(11)
    expect(v?.isMainline).toBe(true)
    expect(hitAiLabel(v!)).toBe('AI 本篇')
  })

  it('非本篇判定：op/ed → 主题曲警示，other → 非本篇红标', () => {
    expect(hitAiLabel(hitAiVerdict('{"type":"op","isMainline":false}')!)).toBe('AI 主题曲')
    const other = hitAiVerdict('{"type":"whatever","isMainline":false,"reason":"轻小说 epub"}')
    expect(other?.type).toBe('other')
    expect(hitAiLabel(other!)).toBe('AI 非本篇')
    expect(other?.reason).toBe('轻小说 epub')
  })

  it('损坏/空判定返回 null；episode 越界归 null；type 非法归一 other', () => {
    expect(hitAiVerdict(null)).toBeNull()
    expect(hitAiVerdict('')).toBeNull()
    expect(hitAiVerdict('{broken')).toBeNull()
    expect(hitAiVerdict('{"type":"episode","episode":1080}')?.episode).toBeNull()
    expect(hitAiVerdict('{"type":"unknown"}')?.type).toBe('other')
    expect(hitAiVerdict('{"type":"other"}')?.isMainline).toBe(false)
  })
})

import { maxWatched } from './mediaService'

describe('v0.19 订阅观看基线（maxWatched 纯函数）', () => {
  it('取已看最大话数', () => {
    expect(maxWatched([1, 2, 8])).toBe(8)
    expect(maxWatched([5])).toBe(5)
  })

  it('空列表 / undefined / null 返回 0', () => {
    expect(maxWatched([])).toBe(0)
    expect(maxWatched(undefined)).toBe(0)
    expect(maxWatched(null)).toBe(0)
  })

  it('忽略非正数与非有限值（脏数据兜底）', () => {
    expect(maxWatched([3, NaN, 0, -1])).toBe(3)
    expect(maxWatched([Infinity])).toBe(0)
  })
})
