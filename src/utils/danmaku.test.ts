import { describe, expect, it } from 'vitest'
import { DANMAKU_MAX_ITEMS, parseDanmakuXml } from './danmaku'

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<i>
  <chatserver>chat.bilibili.com</chatserver>
  <maxlimit>1000</maxlimit>
  <d p="12.345,1,25,16777215,1700000000,0,uid1,1001">普通滚动弹幕</d>
  <d p="3.5,5,25,16711680,1700000001,0,uid1,1002">顶部弹幕</d>
  <d p="7.0,4,25,65280,1700000002,0,uid1,1003">底部弹幕</d>
  <d p="9.9,6,25,255,1700000003,0,uid1,1004">逆向滚动</d>
  <d p="11.0,7,25,255,1700000004,0,uid1,1005">高级弹幕应跳过</d>
  <d p="bad,1,25,255,1700000005,0,uid1,1006">时间非法应跳过</d>
  <d p="13.0,1,25,255,1700000006,0,uid1,1007">   </d>
  <d p="1.0,1,25,notanumber,1700000007,0,uid1,1008">颜色非法走默认</d>
</i>`

describe('v0.15 O4 B 站弹幕 XML 解析', () => {
  it('解析 time/mode/color 并映射到插件模式；按时间升序', () => {
    const items = parseDanmakuXml(SAMPLE)
    // 8 条中：mode=7 高级弹幕、时间非法、空白文本被跳过 → 5 条有效
    expect(items).toHaveLength(5)
    expect(items[0].time).toBe(1.0)
    expect(items[0].mode).toBe(0) // mode=1 滚动 → 0
    expect(items[0].color).toBeUndefined() // 非法颜色 → 默认
    const byTime = (t: number) => items.find((x) => x.time === t)
    expect(byTime(3.5)).toMatchObject({ mode: 1, color: '#ff0000', text: '顶部弹幕' }) // 5 → 1 顶部
    expect(byTime(7.0)).toMatchObject({ mode: 2, color: '#00ff00', text: '底部弹幕' }) // 4 → 2 底部
    expect(byTime(9.9)).toMatchObject({ mode: 0, color: '#0000ff', text: '逆向滚动' }) // 6 → 0
    expect(byTime(12.345)).toMatchObject({ mode: 0, color: '#ffffff' })
  })

  it('非弹幕 XML / 无 d 节点 / 解析失败整体抛错（拒绝半导入）', () => {
    expect(() => parseDanmakuXml('<html><body>不是弹幕</body></html>')).toThrow(/不是有效的弹幕 XML/)
    expect(() => parseDanmakuXml('')).toThrow()
    expect(() => parseDanmakuXml('<?xml version="1.0"?><i><x>没有弹幕节点</x></i>')).toThrow(/不是有效的弹幕 XML/)
    // 有 d 节点但全部无效 → 未找到有效弹幕数据
    expect(() =>
      parseDanmakuXml('<?xml version="1.0"?><i><d p="bad,1,25,255,1,0,u,1">时间非法</d></i>'),
    ).toThrow(/未找到有效弹幕数据/)
  })

  it('数量上限截断保护', () => {
    const rows: string[] = []
    for (let i = 0; i < DANMAKU_MAX_ITEMS + 100; i++) {
      rows.push(`<d p="${i * 0.5},1,25,16777215,1,0,u,${i}">d${i}</d>`)
    }
    const xml = `<?xml version="1.0"?><i>${rows.join('')}</i>`
    const items = parseDanmakuXml(xml)
    expect(items).toHaveLength(DANMAKU_MAX_ITEMS)
    expect(items[0].text).toBe('d0')
  })
})

/* ── v0.15 发送弹幕持久化（appendDanmaku）── */

import { appendDanmaku } from './danmaku'

describe('v0.15 发送弹幕追加（appendDanmaku）', () => {
  it('追加条目带 local 标记并按时间升序插入', () => {
    const existing = [
      { time: 5, mode: 0 as const, text: '导入A' },
      { time: 15, mode: 0 as const, text: '导入B' },
    ]
    const out = appendDanmaku(existing, { time: 9, mode: 0, color: '#ffffff', text: '发送1' })
    expect(out.map((d) => [d.time, d.text, d.local])).toEqual([
      [5, '导入A', undefined],
      [9, '发送1', true],
      [15, '导入B', undefined],
    ])
    // 原数组不被修改
    expect(existing).toHaveLength(2)
  })

  it('超出上限 FIFO 丢最旧（保最新发送）', () => {
    const existing = Array.from({ length: 8 }, (_, i) => ({ time: i, mode: 0 as const, text: `d${i}` }))
    const out = appendDanmaku(existing, { time: 100, mode: 0, text: '最新' }, 5)
    expect(out).toHaveLength(5)
    expect(out[0].text).toBe('d4')
    expect(out[out.length - 1]).toMatchObject({ text: '最新', local: true })
  })

  it('空池追加成单条', () => {
    expect(appendDanmaku([], { time: 3, mode: 2, text: '首条' })).toEqual([
      { time: 3, mode: 2, text: '首条', local: true },
    ])
  })
})
