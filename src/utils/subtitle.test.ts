import { describe, expect, it } from 'vitest'
import {
  clampSubtitleFontSize,
  matchSubtitle,
  pickDefaultTrack,
  srtToVtt,
  SUBTITLE_FONT_SIZE,
  trackLabel,
  zhTrackScore,
  type SubtitleTrack,
} from './subtitle'

describe('v0.23 SB2 srtToVtt', () => {
  it('标准 srt：WEBVTT 头 + 时间戳逗号转点 + 序号行丢弃 + 正文保留', () => {
    const srt = '1\n00:00:01,000 --> 00:00:04,000\n第一句\n\n2\n00:00:05,000 --> 00:00:08,000\n第二句 <i>斜体</i>\n'
    expect(srtToVtt(srt)).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n第一句\n\n00:00:05.000 --> 00:00:08.000\n第二句 <i>斜体</i>\n')
  })

  it('CRLF 行尾与 BOM 兼容', () => {
    const srt = '\uFEFF1\r\n00:00:01,000 --> 00:00:04,000\r\n带 BOM 与 CRLF\r\n\r\n'
    expect(srtToVtt(srt)).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n带 BOM 与 CRLF\n')
  })

  it('mm:ss,xxx 短时间戳形态也接受', () => {
    const srt = '1\n00:05,500 --> 00:08,250\n短时间戳\n\n'
    expect(srtToVtt(srt)).toBe('WEBVTT\n\n00:05.500 --> 00:08.250\n短时间戳\n')
  })

  it('多行 cue 正文原样合并保留', () => {
    const srt = '1\n00:00:01,000 --> 00:00:04,000\n第一行\n第二行\n\n'
    expect(srtToVtt(srt)).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n第一行\n第二行\n')
  })

  it('无有效 cue 输入（空串/纯文本）返回仅头部的空 vtt', () => {
    expect(srtToVtt('')).toBe('WEBVTT\n\n')
    expect(srtToVtt('随便一段文字')).toBe('WEBVTT\n\n')
  })
})

describe('v0.23 SB2 matchSubtitle', () => {
  it('完全同名优先（.srt 与 .vtt）', () => {
    expect(matchSubtitle('EP01.mkv', ['EP01.ass', 'EP01.srt'])).toBe('EP01.srt')
    expect(matchSubtitle('EP01.mkv', ['EP01.vtt'])).toBe('EP01.vtt')
    expect(matchSubtitle('[Group] Title - 01 [1080p].mkv', ['[Group] Title - 01 [1080p].srt'])).toBe(
      '[Group] Title - 01 [1080p].srt',
    )
  })

  it('中文语言后缀变体命中且按优先级（简在前）', () => {
    expect(matchSubtitle('EP01.mkv', ['EP01.cht.srt', 'EP01.chs.srt'])).toBe('EP01.chs.srt')
    // 精确同名（EP01.vtt）优先于语言后缀变体——换无同名冲突的兄弟文件验证后缀命中
    expect(matchSubtitle('EP01.mkv', ['EP01.zh.srt', 'EP02.vtt'])).toBe('EP01.zh.srt')
    expect(matchSubtitle('EP01.mkv', ['EP01.tc.vtt'])).toBe('EP01.tc.vtt')
  })

  it('大小写不敏感；无匹配返回 null；非字幕文件忽略', () => {
    expect(matchSubtitle('EP01.mkv', ['ep01.SRT'])).toBe('ep01.SRT')
    expect(matchSubtitle('EP01.mkv', ['EP02.srt', 'cover.jpg'])).toBeNull()
    expect(matchSubtitle('EP01.mkv', [])).toBeNull()
  })
})

describe('v0.23 SB1 默认轨启发式（zhTrackScore / pickDefaultTrack）', () => {
  const t = (index: number, language?: string | null, title?: string | null): SubtitleTrack => ({
    index,
    codec: 'ass',
    language: language ?? undefined,
    title: title ?? undefined,
  })

  it('ISO 中文码与民间码均判中文', () => {
    expect(zhTrackScore(t(0, 'zh'))).toBe(1)
    expect(zhTrackScore(t(0, 'chi'))).toBe(1)
    expect(zhTrackScore(t(0, 'chs'))).toBe(2)
    expect(zhTrackScore(t(0, 'cht'))).toBe(0.5)
    expect(zhTrackScore(t(0, 'eng'))).toBe(0)
    expect(zhTrackScore(t(0, undefined, '简体中文'))).toBe(2)
    expect(zhTrackScore(t(0, undefined, '繁體中文'))).toBe(0.5)
  })

  it('简体 > 泛中文 > 繁体；同分取先出现轨', () => {
    expect(pickDefaultTrack([t(0, 'chs'), t(1, 'zht')])!.index).toBe(0)
    expect(pickDefaultTrack([t(0, 'chi'), t(1, 'eng')])!.index).toBe(0)
    expect(pickDefaultTrack([t(0, 'zh-hans'), t(1, 'zht')])!.index).toBe(0)
    expect(pickDefaultTrack([t(0, 'zht'), t(1, 'zh')])!.index).toBe(1) // 泛中文排在繁体前
  })

  it('无中文轨取第一条；空列表返回 null', () => {
    expect(pickDefaultTrack([t(0, 'eng'), t(1, 'jpn')])!.index).toBe(0)
    expect(pickDefaultTrack([])).toBeNull()
  })

  it('无语言轨（language 缺失）按 title 兜底判断', () => {
    expect(pickDefaultTrack([t(0, undefined, undefined), t(1, undefined, '简体中文')])!.index).toBe(1)
  })
})

describe('v0.23 反馈 clampSubtitleFontSize', () => {
  it('范围内取整返回；越界收敛到 20~72；非法/缺省回默认 40', () => {
    expect(clampSubtitleFontSize(36)).toBe(36)
    expect(clampSubtitleFontSize(39.6)).toBe(40) // 四舍五入
    expect(clampSubtitleFontSize(10)).toBe(SUBTITLE_FONT_SIZE.min)
    expect(clampSubtitleFontSize(100)).toBe(SUBTITLE_FONT_SIZE.max)
    expect(clampSubtitleFontSize(NaN)).toBe(SUBTITLE_FONT_SIZE.default)
    expect(clampSubtitleFontSize(null)).toBe(SUBTITLE_FONT_SIZE.default)
    expect(clampSubtitleFontSize(undefined)).toBe(SUBTITLE_FONT_SIZE.default)
  })

  it('默认值 40（ArtPlayer 出厂 20px 偏小，实测反馈调大）', () => {
    expect(SUBTITLE_FONT_SIZE.default).toBe(40)
  })
})

describe('v0.23 SB1 trackLabel', () => {
  it('title 优先；无 title 退语言+编码；全空退字幕轨 N', () => {
    expect(trackLabel({ index: 0, codec: 'ass', language: 'chs', title: '简体中文' })).toBe('简体中文 · ass')
    expect(trackLabel({ index: 1, codec: 'subrip', language: 'eng' })).toBe('eng · subrip')
    expect(trackLabel({ index: 2, codec: null, language: null, title: null })).toBe('字幕轨 3')
  })
})
