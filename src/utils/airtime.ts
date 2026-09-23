/**
 * v0.29 Q1 放送时刻解析（纯函数，零依赖）。
 *
 * 来源：详情页 infobox「放送开始」字段（随既有详情缓存走，无新增请求）。
 * 2026-09-23 全量普查 258 个真实样本（在播 111 + 2024 冬 49 + 2023 秋 49 + 深夜档抽查）：
 * 现实数据均为日期形态（「2024年1月22日」/「2024-01-25」），无一含时刻——
 * 时刻解析按防御设计落地（覆盖 24+ 深夜档等潜在形态），无数据时上层一律回退星期粒度。
 */

/** 解析结果：raw 保持原值展示；hour/minute 为 24h 归一时刻（24:xx → 次日 0:xx） */
export interface AirTime {
  /** 归一前小时数（0~47，24:30 → 30；纯日期无时刻为 undefined） */
  hour?: number
  minute: number
  /** 原文（如「2024-10-05 星期六 24:30」，供展示原貌） */
  raw: string
  /** 是否为日期形态（供周历「首播 第 N 周」推算） */
  date?: string
  /** true = 有具体时刻（hour 已含 24+ 归一语义） */
  timed: boolean
}

/**
 * 从 infobox「放送开始」原文解析放送日期与时刻。
 *
 * 已知形态：
 * - 「2024年1月22日」中文年月日（实测主流形态）
 * - 「2024-01-25」ISO 日期
 * - 「2024-10-05 星期六 24:30」带星期 + 深夜档 24+ 时刻（防御覆盖）
 * - 「2024-10-05 24:30」「24:30」裸时刻（防御覆盖）
 */
export function parseAirTime(raw: unknown): AirTime | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text) return null

  // 日期：中文年月日 或 ISO
  const cnDate = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  const isoDate = text.match(/(\d{4})-(\d{2})-(\d{2})/)
  const date = cnDate ? `${cnDate[1]}-${cnDate[2].padStart(2, '0')}-${cnDate[3].padStart(2, '0')}` : isoDate?.[0]

  // 时刻：最大匹配（防止 2024 之类的年份数字被误当 24h 时；「时|分|:」限定）
  const times = [...text.matchAll(/(\d{1,2})[时:：](\d{1,2})[分]?/g)].map((m) => ({
    h: Number(m[1]),
    m: Number(m[2]),
  }))
  // 只认 HH:MM 语义中 MM<60、HH≤47（24+ 深夜档归一）；45:00 拒绝（非法）
  const valid = times.filter((t) => t.m < 60 && t.h <= 47 && t.h > 0)
  const time = valid.length ? valid[valid.length - 1] : undefined

  if (!date && !time) return null
  return {
    hour: time?.h,
    minute: time?.m ?? 0,
    raw: text,
    date,
    timed: time !== undefined,
  }
}

/** 深夜档 24+ 时刻归一：24:30 → 次日 00:30。返回 [偏移天数, 0~23 时] */
export function normalizeHour(hour: number): [number, number] {
  return [Math.floor(hour / 24), hour % 24]
}

/** 时刻展示（保留 24+ 原貌，如「24:30」） */
export function airTimeBadge(raw: string): string | null {
  const t = parseAirTime(raw)
  if (!t?.timed) return null
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`
}

/** infobox 中「放送开始」的值（string 或 {v}[] 双形态）展平为单字符串 */
export function infoboxText(v: string | { v: string }[]): string {
  return Array.isArray(v) ? v.map((x) => x.v).join(' / ') : v
}

/**
 * 从 SubjectDetail.infobox 提取放送开始原文（键精确匹配「放送开始」）。
 * 未命中返回 null——上层回退星期粒度。
 */
export function airDateInfoBoxed(infobox: { key: string; value: string | { v: string }[] }[] | undefined): string | null {
  const row = (infobox ?? []).find((r) => r.key === '放送开始')
  if (!row) return null
  const v = infoboxText(row.value)
  return v.trim() || null
}

/**
 * 周历归属日与「具体时刻」的排序键：日期 + 归一偏移的绝对分钟数。
 * 同日内 24:30（→ 次日 0:30 排序值为 date+1）大于 23:59，保证深夜档排次日深夜段排序在前——
 * 站点归属日惯例：周历不减日（24:30 仍挂放送日），排序时用归一值。
 */
export function airSortKey(date: string, hour: number, minute: number): number {
  const base = Date.parse(`${date}T00:00:00`)
  if (Number.isNaN(base)) return Number.MAX_SAFE_INTEGER
  const [dayOffset, h] = normalizeHour(hour)
  return base + dayOffset * 86_400_000 + h * 3_600_000 + minute * 60_000
}
