/** v0.15 O4 B 站弹幕 XML 解析（纯逻辑层，供单测；DOMParser 由浏览器/happy-dom 提供）。
 *  支持 <d p="time,mode,size,color,timestamp,pool,uid,dmid">文本</d> 结构（B 站历史 XML 格式）。
 *  mode 映射到 artplayer-plugin-danmuku：1/2/3/6 → 0 滚动，5 → 1 顶部，4 → 2 底部；
 *  7/8/9（高级/代码弹幕）等不在映射内的跳过。解析结果按时间升序、上限截断；
 *  非弹幕 XML / 无弹幕节点整体抛错（整文件拒绝，不做半导入）。 */

/** 弹幕条目（artplayer-plugin-danmuku Danmu 的可序列化子集） */
export interface DanmakuItem {
  time: number
  mode: 0 | 1 | 2
  color?: string
  text: string
  /** 附加内联样式（插件渲染链路最后应用，可覆盖默认描边等；解析器不产出，由播放器层补充） */
  style?: Partial<CSSStyleDeclaration>
  /** 用户经插件发送框发送（本地持久化标记，与导入弹幕区分；渲染无影响） */
  local?: boolean
}

/** 单集弹幕上限：B 站长视频可达数千条，超出截断保护播放器 */
export const DANMAKU_MAX_ITEMS = 5000

/** 解析 B 站弹幕 XML；整体失败抛 Error（message 面向用户） */
export function parseDanmakuXml(xmlText: string): DanmakuItem[] {
  if (!xmlText || !/<d\s/i.test(xmlText)) {
    throw new Error('不是有效的弹幕 XML 文件（缺少 <d> 弹幕节点）')
  }
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('弹幕 XML 解析失败（文件损坏或编码异常）')
  }
  const nodes = doc.getElementsByTagName('d')
  const items: DanmakuItem[] = []
  for (let i = 0; i < nodes.length; i++) {
    const item = parseNode(nodes[i])
    if (item) items.push(item)
  }
  if (!items.length) throw new Error('未找到有效弹幕数据')
  items.sort((a, b) => a.time - b.time)
  return items.length > DANMAKU_MAX_ITEMS ? items.slice(0, DANMAKU_MAX_ITEMS) : items
}

/** v0.15 发送弹幕持久化（纯函数，供单测）：追加进既有弹幕池，带 local 标记，
 *  按时间升序保持（与解析器产出同序），超出上限 FIFO 丢最旧。
 *  item.time 为发送时刻的集内绝对时间——重开播放进度到该时刻时弹幕再次出现。 */
export function appendDanmaku(
  existing: DanmakuItem[],
  item: DanmakuItem,
  max = DANMAKU_MAX_ITEMS,
): DanmakuItem[] {
  const merged = [...existing, { ...item, local: true }]
  merged.sort((a, b) => a.time - b.time)
  return merged.length > max ? merged.slice(merged.length - max) : merged
}

function parseNode(node: Element): DanmakuItem | null {
  const p = node.getAttribute('p')
  const text = (node.textContent ?? '').trim()
  if (!p || !text) return null
  const parts = p.split(',')
  const time = Number.parseFloat(parts[0] ?? '')
  if (!Number.isFinite(time) || time < 0) return null
  const mode = toPluginMode(Number.parseInt(parts[1] ?? '', 10))
  if (mode === null) return null
  const color = toHexColor(Number.parseInt(parts[3] ?? '', 10))
  return { time, mode, ...(color ? { color } : {}), text }
}

/** B 站 mode → 插件 mode（0 滚动 / 1 顶部 / 2 底部）；无映射返回 null（跳过该条） */
function toPluginMode(raw: number): 0 | 1 | 2 | null {
  if (raw === 5) return 1
  if (raw === 4) return 2
  if ((raw >= 1 && raw <= 3) || raw === 6) return 0
  return null
}

/** B 站颜色为十进制整数（如 16777215 = #ffffff）；非法返回 undefined（插件走默认白） */
function toHexColor(raw: number): string | undefined {
  if (!Number.isFinite(raw) || raw < 0 || raw > 0xffffff) return undefined
  return `#${raw.toString(16).padStart(6, '0')}`
}
