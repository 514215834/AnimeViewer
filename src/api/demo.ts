import type {
  CalendarDay,
  CalendarSubject,
  CharacterDetail,
  CharacterPerson,
  CharacterSearchItem,
  Episode,
  IndexInfo,
  IndexSubjectItem,
  Paged,
  PersonDetail,
  PersonSearchItem,
  RelatedSubject,
  SearchResponse,
  SearchResultItem,
  StaffWork,
  SubjectCharacter,
  SubjectDetail,
  SubjectPerson,
  UserCharacterCollection,
  UserProfile,
  UserPersonCollection,
} from '../types/bangumi'
import type { SearchAdvanced } from './bangumi'
import type { LibraryEntry } from '../stores/library'
import { isDemoCharacterId, isDemoPersonId, isDemoSubjectId } from './demoIds'

// ID 段判断已拆至 demoIds.ts（纯函数零数据依赖）；此处转发导出维持既有引用路径与测试兼容
export { isDemoCharacterId, isDemoPersonId, isDemoSubjectId }

interface DemoSubject extends CalendarSubject {
  tags: { name: string; count: number }[]
  /** v0.29 Q1 演示用放送时刻原文（如「2026-07-05 星期一 24:30」）；缺省回退 air_date（对应现网无时刻数据的回退态走查） */
  airTimeText?: string
}

/** 内置演示数据：虚构番剧，用于离线体验与 UI 验证 */
const DEMO_SUBJECTS: DemoSubject[] = [
  {
    id: 900001, name: 'Starlight Pact', name_cn: '星轨之约', type: 2, eps: 12,
    air_date: '2026-07-05', air_weekday: 1, date: '2026-07-05',
    airTimeText: '2026-07-05 星期一 24:30',
    rating: { score: 8.2, total: 3210, rank: 412 }, collection: { wish: 5600, doing: 5200, done: 880 },
    summary: '夜空中突然出现了一条不属于任何星图的轨迹。少女天文社的成员们发现，只有许下约定的人才能看见那条星轨背后隐藏的世界。',
    tags: [{ name: '原创', count: 210 }, { name: '奇幻', count: 180 }, { name: '治愈', count: 96 }],
  },
  {
    id: 900002, name: 'Spicy Hot Pot Girls', name_cn: '麻辣火锅少女', type: 2, eps: 12,
    air_date: '2026-07-05', air_weekday: 1, date: '2026-07-05',
    airTimeText: '2026-07-05 21:00',
    rating: { score: 7.1, total: 1540, rank: 1980 }, collection: { wish: 2100, doing: 2300, done: 640 },
    summary: '三家火锅店为了争夺老街的黄金铺面，派出各自最擅做火锅的少女展开厨艺对决，却在一次次比赛中变成了最好的朋友。',
    tags: [{ name: '原创', count: 88 }, { name: '搞笑', count: 76 }, { name: '日常', count: 41 }],
  },
  {
    id: 900003, name: 'Pixel Love Song', name_cn: '像素恋歌', type: 2, eps: 13,
    air_date: '2026-07-06', air_weekday: 2, date: '2026-07-06',
    airTimeText: '2026年7月6日 23:30',
    rating: { score: 7.8, total: 2210, rank: 980 }, collection: { wish: 3300, doing: 4100, done: 1120 },
    summary: '一台只会输出像素画的老旧街机，竟能让玩家进入游戏内部世界。男主角在游戏里遇见了只能存在于 8-bit 世界中的女孩。',
    tags: [{ name: '游戏改', count: 132 }, { name: '恋爱', count: 118 }, { name: '科幻', count: 55 }],
  },
  {
    id: 900004, name: 'Deep Sea Library', name_cn: '深海图书馆', type: 2, eps: 12,
    air_date: '2026-07-06', air_weekday: 2, date: '2026-07-06',
    rating: { score: 8.6, total: 4890, rank: 187 }, collection: { wish: 8100, doing: 8800, done: 2340 },
    summary: '沉入海底的城市里藏着一座会呼吸的图书馆，每本书都是一个尚未被讲完的梦。新任管理员一页页翻开了这座城市的记忆。',
    tags: [{ name: '小说改', count: 260 }, { name: '奇幻', count: 198 }, { name: '悬疑', count: 143 }],
  },
  {
    id: 900005, name: 'Iron Swallowtail', name_cn: '钢铁燕尾蝶', type: 2, eps: 24,
    air_date: '2026-04-03', air_weekday: 3, date: '2026-04-03',
    airTimeText: '2026年4月3日 25:30',
    rating: { score: 7.4, total: 1980, rank: 1520 }, collection: { wish: 2600, doing: 3100, done: 990 },
    summary: '在被机械蜂群支配的天空下，少年驾驶着最后一台蝶形装甲机，守护着一座仍然相信春天的城市。',
    tags: [{ name: '漫画改', count: 140 }, { name: '热血', count: 122 }, { name: '机战', count: 87 }],
  },
  {
    id: 900006, name: 'Neko Convenience Store', name_cn: '猫咪便利屋', type: 2, eps: 13,
    air_date: '2026-04-03', air_weekday: 3, date: '2026-04-03',
    airTimeText: '2026年4月3日 12:00',
    rating: { score: 8.0, total: 3010, rank: 655 }, collection: { wish: 4200, doing: 5600, done: 1780 },
    summary: '只在深夜营业的便利屋里，店长是一只戴着领结的猫。每位深夜到访的客人，都会带着一个烦恼进来，带着一份温暖离开。',
    tags: [{ name: '漫画改', count: 165 }, { name: '治愈', count: 150 }, { name: '日常', count: 121 }],
  },
  {
    id: 900007, name: 'Midnight Radio Zero', name_cn: '零点电台', type: 2, eps: 12,
    air_date: '2026-07-07', air_weekday: 4, date: '2026-07-07',
    rating: { score: 6.9, total: 870, rank: 2600 }, collection: { wish: 1200, doing: 1500, done: 380 },
    summary: '一个只在凌晨零点出现的神秘电台，专门接收来自「过去的自己」的点歌请求。主播每晚决定是否替未来的你传达这句话。',
    tags: [{ name: '原创', count: 60 }, { name: '音乐', count: 48 }, { name: '治愈', count: 35 }],
  },
  {
    id: 900008, name: 'Sky Expedition', name_cn: '苍穹远征队', type: 2, eps: 24,
    air_date: '2026-07-07', air_weekday: 4, date: '2026-07-07',
    rating: { score: 8.9, total: 7320, rank: 95 }, collection: { wish: 9900, doing: 12300, done: 3100 },
    summary: '大陆悬浮于云海之上，边缘正在一块块剥落。远征队驾驶飞艇向着传说中的「天空之根」进发，那是拯救世界最后的线索。',
    tags: [{ name: '原创', count: 310 }, { name: '热血', count: 268 }, { name: '冒险', count: 240 }],
  },
  {
    id: 900009, name: 'Patissier and Witch', name_cn: '甜点师与魔女', type: 2, eps: 12,
    air_date: '2026-07-08', air_weekday: 5, date: '2026-07-08',
    rating: { score: 7.6, total: 1720, rank: 1310 }, collection: { wish: 2300, doing: 2800, done: 760 },
    summary: '不会用魔法的魔女开了一家甜品店，发现人类世界的糖分比任何咒语都更能治愈人心。直到某天，一位不肯吃甜点的猎人推门而入。',
    tags: [{ name: '漫画改', count: 98 }, { name: '奇幻', count: 84 }, { name: '美食', count: 52 }],
  },
  {
    id: 900010, name: 'Rainy Season Robot', name_cn: '雨季的机器人', type: 2, eps: 13,
    air_date: '2026-07-08', air_weekday: 5, date: '2026-07-08',
    rating: { score: 8.4, total: 4020, rank: 253 }, collection: { wish: 6200, doing: 7400, done: 2010 },
    summary: '梅雨季节，废弃工厂里的旧机器人被小女孩重新启动。它记得雨的味道，也记得三十年前把它的主人再也没能回来的那个雨天。',
    tags: [{ name: '原创', count: 205 }, { name: '科幻', count: 187 }, { name: '治愈', count: 160 }],
  },
  {
    id: 900011, name: 'Blade and Verse', name_cn: '刃与诗', type: 2, eps: 24,
    air_date: '2026-07-09', air_weekday: 6, date: '2026-07-09',
    rating: { score: 8.1, total: 3540, rank: 480 }, collection: { wish: 5300, doing: 6900, done: 1450 },
    summary: '在这个世界，拔剑者必须吟诗。剑术即是韵律，诗歌即是剑谱。一位五音不全的天才剑客，与一位写不出诗的宫廷诗人相遇了。',
    tags: [{ name: '小说改', count: 230 }, { name: '奇幻', count: 198 }, { name: '热血', count: 172 }],
  },
  {
    id: 900012, name: 'My Neighbor Is Not Human', name_cn: '我的邻居不是人', type: 2, eps: 12,
    air_date: '2026-07-09', air_weekday: 6, date: '2026-07-09', nsfw: true,
    rating: { score: 7.2, total: 1890, rank: 1750 }, collection: { wish: 2500, doing: 3300, done: 820 },
    summary: '隔壁搬来了一位完美邻居：准时倒垃圾、礼貌问候、从不制造噪音。太完美了，完美到让人怀疑——他到底是不是人类？（演示：此条目带 R18 标记，用于测试内容过滤）',
    tags: [{ name: '漫画改', count: 110 }, { name: '搞笑', count: 95 }, { name: '悬疑', count: 66 }],
  },
  {
    id: 900013, name: 'Aurora Express', name_cn: '极光列车', type: 2, eps: 13,
    air_date: '2026-07-10', air_weekday: 7, date: '2026-07-10',
    rating: { score: 8.8, total: 6180, rank: 121 }, collection: { wish: 8700, doing: 10200, done: 2870 },
    summary: '每周日午夜，一辆穿过极光的列车会停靠在雪原的小站。它不卖票，只收取一段回忆作为车费，目的地是「你想再见一次的地方」。',
    tags: [{ name: '原创', count: 288 }, { name: '冒险', count: 233 }, { name: '科幻', count: 201 }],
  },
  {
    id: 900014, name: 'Sunday Desk', name_cn: '周日的写字台', type: 2, eps: 12,
    air_date: '2026-07-10', air_weekday: 7, date: '2026-07-10',
    rating: { score: 6.5, total: 540, rank: 3120 }, collection: { wish: 780, doing: 900, done: 260 },
    summary: '一张能在周日与「上周日的自己」共享文字的写字台。两人用便签约定了一整周的计划，却发现计划总赶不上变化。',
    tags: [{ name: '原创', count: 45 }, { name: '日常', count: 38 }, { name: '恋爱', count: 30 }],
  },
]

function toDetail(s: DemoSubject): SubjectDetail {
  return {
    id: s.id,
    name: s.name,
    name_cn: s.name_cn,
    date: s.air_date,
    images: s.images,
    summary: s.summary,
    total_episodes: s.eps,
    rating: s.rating,
    collection: s.collection,
    tags: s.tags,
    infobox: [
      { key: '中文名', value: s.name_cn },
      { key: '话数', value: String(s.eps) },
      { key: '放送开始', value: s.airTimeText ?? s.air_date ?? '未知' },
      { key: '制作', value: 'DEMO STUDIO（演示数据）' },
    ],
    series: false,
    platform: 'TV',
    nsfw: !!s.nsfw,
    type: 2,
  }
}

const WEEKDAYS: Record<number, { en: string; cn: string; ja: string }> = {
  1: { en: 'Monday', cn: '星期一', ja: '月曜日' },
  2: { en: 'Tuesday', cn: '星期二', ja: '火曜日' },
  3: { en: 'Wednesday', cn: '星期三', ja: '水曜日' },
  4: { en: 'Thursday', cn: '星期四', ja: '木曜日' },
  5: { en: 'Friday', cn: '星期五', ja: '金曜日' },
  6: { en: 'Saturday', cn: '星期六', ja: '土曜日' },
  7: { en: 'Sunday', cn: '星期日', ja: '日曜日' },
}

export function demoCalendar(): CalendarDay[] {
  return [1, 2, 3, 4, 5, 6, 7].map((id) => ({
    weekday: { id, ...WEEKDAYS[id] },
    items: DEMO_SUBJECTS.filter((s) => s.air_weekday === id),
  }))
}

export function demoCharacters(id: number): SubjectCharacter[] {
  const relations = ['主角', '主角', '配角', '配角']
  return relations.map((relation, i) => ({
    id: id * 10 + i,
    name: `演示角色 ${i + 1}`,
    type: 1,
    relation,
    actors: [{ id: id * 100 + i, name: `演示声优 ${String.fromCharCode(65 + i)}`, type: 1 }],
  }))
}

export function demoPersons(id: number): SubjectPerson[] {
  return [
    { id: id * 1000 + 1, name: '演示监督', type: 2, relation: '导演' },
    { id: id * 1000 + 2, name: '演示系列构成', type: 2, relation: '脚本' },
    { id: id * 1000 + 3, name: 'DEMO STUDIO', type: 2, relation: '动画制作' },
  ]
}

export function demoEpisodes(id: number): Episode[] {
  const s = DEMO_SUBJECTS.find((x) => x.id === id)
  const total = s?.eps ?? 12
  const eps: Episode[] = Array.from({ length: total }, (_, i) => ({
    id: id * 10000 + i + 1,
    type: 0,
    name: `Episode ${i + 1}`,
    name_cn: `第${i + 1}话`,
    sort: i + 1,
    ep: i + 1,
    airdate: '',
    // G4：章节详情字段（在线列表实测已携带同构字段，演示数据保持一致结构）
    comment: 3 + ((i * 7) % 17),
    duration: '24m',
    duration_seconds: 1440,
    desc: i === 0 ? '第 1 话剧情简介（演示数据）：用于验证单集详情抽屉的完整态展示。' : '',
  }))
  // G4：SP/OP/ED 样例（EpType 1/2/3），保证章节类型分组在演示模式可演示
  const extra = id * 10000 + total + 900
  eps.push(
    {
      id: extra + 1,
      type: 1,
      name: 'SP',
      name_cn: '特别篇 · 演示',
      sort: 1,
      ep: 0,
      airdate: '',
      comment: 5,
      duration: '24m',
      duration_seconds: 1440,
      desc: '演示特别篇章节简介。',
    },
    {
      id: extra + 2,
      type: 2,
      name: 'OP',
      name_cn: '片头曲 · 演示',
      sort: 1,
      ep: 0,
      airdate: '',
      comment: 0,
      duration: '1m30s',
      duration_seconds: 90,
      desc: '',
    },
    {
      id: extra + 3,
      type: 3,
      name: 'ED',
      name_cn: '片尾曲 · 演示',
      sort: 1,
      ep: 0,
      airdate: '',
      comment: 0,
      duration: '1m30s',
      duration_seconds: 90,
      desc: '',
    },
  )
  return eps
}

export function demoDetail(id: number): SubjectDetail {
  const s = DEMO_SUBJECTS.find((x) => x.id === id)
  if (!s) throw new Error('演示数据中不存在该条目')
  return toDetail(s)
}

export function demoSearch(
  keyword: string,
  tags: string[],
  sort = 'match',
  limit = 24,
  offset = 0,
  advanced?: SearchAdvanced,
): SearchResponse {
  const kw = keyword.trim().toLowerCase()
  const includes = tags.filter((t) => !t.startsWith('-'))
  const excludes = tags.filter((t) => t.startsWith('-')).map((t) => t.slice(1))
  const hit = DEMO_SUBJECTS.filter((s) => {
    const kwOk = !kw || s.name_cn.toLowerCase().includes(kw) || s.name.toLowerCase().includes(kw)
    const includeOk = includes.every((t) => s.tags.some((x) => x.name === t))
    const excludeOk = !excludes.some((t) => s.tags.some((x) => x.name === t))
    if (!kwOk || !includeOk || !excludeOk) return false
    // D3 高级筛选在演示数据上同样生效（air_date 为 YYYY-MM-DD，可直接字符串比较）
    if (advanced?.airDateFrom && (s.air_date ?? '') < advanced.airDateFrom) return false
    if (advanced?.airDateTo && (s.air_date ?? '') >= advanced.airDateTo) return false
    const score = s.rating?.score ?? 0
    if (advanced?.ratingMin !== undefined && score < advanced.ratingMin) return false
    if (advanced?.ratingMax !== undefined && score > advanced.ratingMax) return false
    const ratingTotal = s.rating?.total ?? 0
    if (advanced?.ratingCountMin !== undefined && ratingTotal < advanced.ratingCountMin) return false
    if (advanced?.ratingCountMax !== undefined && ratingTotal > advanced.ratingCountMax) return false
    if (advanced?.rankMax !== undefined && (s.rating?.rank ?? Infinity) > advanced.rankMax) return false
    return true
  })
  let sorted = [...hit]
  if (sort === 'heat') sorted.sort((a, b) => (b.collection?.doing ?? 0) - (a.collection?.doing ?? 0))
  else if (sort === 'rank') sorted.sort((a, b) => (a.rating?.rank ?? 99999) - (b.rating?.rank ?? 99999))
  else sorted.sort((a, b) => (b.rating?.score ?? 0) - (a.rating?.score ?? 0)) // match / score
  return {
    data: sorted.slice(offset, offset + limit) as SearchResultItem[],
    total: sorted.length,
    limit,
    offset,
  }
}

/** D1 演示：按年代浏览（与在线接口同构：type=2 动画 + year/month + date/rank 排序） */
export function demoBrowseSubjects(opts: {
  year: number
  month?: number
  sort?: 'date' | 'rank'
  limit?: number
  offset?: number
}): Paged<SearchResultItem> {
  const limit = opts.limit ?? 24
  const offset = opts.offset ?? 0
  const hit = DEMO_SUBJECTS.filter((s) => {
    if (!s.air_date?.startsWith(String(opts.year))) return false
    if (opts.month && Number(s.air_date.slice(5, 7)) !== opts.month) return false
    return true
  })
  const sorted = [...hit]
  if (opts.sort === 'rank') sorted.sort((a, b) => (a.rating?.rank ?? 99999) - (b.rating?.rank ?? 99999))
  else sorted.sort((a, b) => (b.air_date ?? '').localeCompare(a.air_date ?? ''))
  return {
    data: sorted.slice(offset, offset + limit) as SearchResultItem[],
    total: sorted.length,
    limit,
    offset,
  }
}

/** D2 演示：关联条目（确定性映射到演示库中相邻条目，保证演示模式下可跳转） */
const DEMO_RELATIONS = ['续集', '前传', '番外篇', '不同演绎']
export function demoRelatedSubjects(id: number): RelatedSubject[] {
  const idx = DEMO_SUBJECTS.findIndex((s) => s.id === id)
  if (idx < 0) return []
  return DEMO_RELATIONS.map((relation, i) => {
    const s = DEMO_SUBJECTS[(idx + i + 1) % DEMO_SUBJECTS.length]
    return { id: s.id, type: 2, name: s.name, name_cn: s.name_cn, images: s.images, relation }
  })
}

/** D5 演示：按 ID 查看目录（任意 ID 返回同一演示目录） */
export function demoIndex(id: number): IndexInfo {
  return {
    id,
    title: '演示目录：闭眼入的治愈系片单',
    desc: '演示模式下内置的目录示例：收录了演示库里口碑最好的治愈向作品，适合周末补番。（在线模式可在 bgm.tv 找到目录后粘贴链接查看）',
    total: DEMO_SUBJECTS.length - 1,
    creator: { username: 'demo', nickname: '演示管理员' },
    nsfw: false,
    updated_at: '2026-08-30T10:00:00+08:00',
  }
}

export function demoIndexSubjects(id: number, limit = 30, offset = 0): Paged<IndexSubjectItem> {
  void id // 演示模式任意 ID 返回同一目录内容
  const items: IndexSubjectItem[] = DEMO_SUBJECTS.filter((s) => (s.rating?.score ?? 0) >= 7.5).map((s, i) => ({
    id: s.id,
    type: 2,
    name: s.name,
    name_cn: s.name_cn,
    images: s.images,
    date: s.air_date,
    comment: ['口碑佳作', '安心补番', '适合二刷', '氛围拉满'][i % 4],
  }))
  return { data: items.slice(offset, offset + limit), total: items.length, limit, offset }
}

/** D6 演示：角色/人物搜索（固定结果，头像走 PosterImage 渐变占位） */
export function demoSearchCharacters(keyword: string, limit = 24, offset = 0): Paged<CharacterSearchItem> {
  void keyword
  const items: CharacterSearchItem[] = Array.from({ length: 6 }, (_, i) => ({
    id: 800001 + i,
    name: `演示角色 ${i + 1}`,
    name_cn: `演示角色 ${i + 1}（命中「${keyword || '任意'}」）`,
    nsfw: false,
  }))
  return { data: items.slice(offset, offset + limit), total: items.length, limit, offset }
}

export function demoSearchPersons(keyword: string, limit = 24, offset = 0): Paged<PersonSearchItem> {
  void keyword
  const items: PersonSearchItem[] = Array.from({ length: 5 }, (_, i) => ({
    id: 900001 + i,
    name: `演示声优 ${i + 1}`,
    name_cn: `演示声优 ${i + 1}（命中「${keyword || '任意'}」）`,
    career: i % 2 ? ['声优', '演员'] : ['声优'],
    nsfw: false,
  }))
  return { data: items.slice(offset, offset + limit), total: items.length, limit, offset }
}

/* ── v0.6 演示兜底 ── */

/** E3 角色详情：确定性映射到演示库条目名，便于演示模式串联跳转 */
export function demoCharacterDetail(id: number): CharacterDetail {
  const s = DEMO_SUBJECTS[Math.abs(id) % DEMO_SUBJECTS.length]
  return {
    id,
    name: `Demo Character ${id % 100}`,
    name_cn: `演示角色（${s.name_cn} 主演）`,
    type: 1,
    summary: `这是演示模式下生成的角色简介。角色出现在《${s.name_cn}》中，拥有独特的性格与故事线，其声优的代表作可在人物页中浏览。（在线模式此处展示 Bangumi 官方角色简介）`,
    gender: id % 2 ? '女性' : '男性',
    birth_mon: (id % 12) + 1,
    birth_day: (id % 27) + 1,
  }
}

export function demoPersonDetail(id: number): PersonDetail {
  const careers = ['声优', '艺术家', '演员', '导演']
  return {
    id,
    name: `Demo Person ${id % 100}`,
    name_cn: `演示人物 ${id % 100}`,
    type: 1,
    career: careers.slice(0, (id % 3) + 1),
    summary: `这是演示模式下生成的人物简介。演示人物参与过多部作品的配音与制作，点击下方作品卡片可继续跳转到对应条目详情。（在线模式此处展示 Bangumi 官方人物简介）`,
  }
}

function demoStaffWorks(prefix: string): StaffWork[] {
  return DEMO_SUBJECTS.slice(0, 6).map((s, i) => ({
    id: s.id,
    type: 2,
    staff: i === 0 ? `${prefix}·主演` : i === 1 ? `${prefix}·客串` : prefix,
    name: s.name,
    name_cn: s.name_cn,
    image: s.images?.common,
  }))
}

export function demoCharacterSubjects(id: number): StaffWork[] {
  void id
  return demoStaffWorks('出演')
}

export function demoPersonSubjects(id: number): StaffWork[] {
  void id
  return demoStaffWorks('参与')
}

export function demoUserProfile(username: string): UserProfile {
  return {
    id: 250726,
    username,
    nickname: '演示用户',
    sign: '这是演示模式下的签名（在线模式展示 Bangumi 个人签名）',
  }
}

export function demoMyCharacters(): Paged<UserCharacterCollection> {
  const items: UserCharacterCollection[] = Array.from({ length: 4 }, (_, i) => ({
    id: 800001 + i,
    name: `演示角色 ${i + 1}`,
    type: 1,
    images: null,
  }))
  return { data: items, total: items.length, limit: 100, offset: 0 }
}

/* ── v0.7 演示兜底 ── */

/** F2 演示：收藏的人物列表（与演示声优 ID 段一致，便于演示模式串联） */
export function demoMyPersons(): Paged<UserPersonCollection> {
  const items: UserPersonCollection[] = Array.from({ length: 3 }, (_, i) => ({
    id: 900001 + i,
    name: `演示声优 ${String.fromCharCode(65 + i)}`,
    type: 1,
    career: ['声优'],
    images: null,
  }))
  return { data: items, total: items.length, limit: 100, offset: 0 }
}

/** F3 演示：角色关联声优（确定性映射到演示库条目，保证可跳转）。
 *  id 落在演示人物合法区间（isDemoPersonId：条目 ID×1000+序号），否则收藏后会在追番库「我的人物」被演示过滤隐藏 */
export function demoCharacterPersons(id: number): CharacterPerson[] {
  const idx = Math.abs(id)
  const a = DEMO_SUBJECTS[idx % DEMO_SUBJECTS.length]
  const b = DEMO_SUBJECTS[(idx + 1) % DEMO_SUBJECTS.length]
  return [
    {
      id: a.id * 1000 + 100,
      name: `演示声优 A`,
      type: 1,
      images: null,
      subject_id: a.id,
      subject_type: 2,
      subject_name: a.name,
      subject_name_cn: a.name_cn,
      staff: '主角 CV',
    },
    {
      id: b.id * 1000 + 200,
      name: `演示声优 B`,
      type: 1,
      images: null,
      subject_id: b.id,
      subject_type: 2,
      subject_name: b.name,
      subject_name_cn: b.name_cn,
      staff: '配角 CV',
    },
  ]
}

/** 演示库种子：离线模式下「我的追番」的内置演示收藏。
 *  与在线收藏完全隔离（独立存储 animeviewer:library:demo），首次进入演示模式时播种到本地 */
export function demoLibrary(): LibraryEntry[] {
  const seed = [
    { id: 900001, status: 'doing' as const, progress: 2, myRate: 8, myComment: '演示收藏：评分与笔记示例' },
    { id: 900003, status: 'wish' as const, progress: 0, myRate: undefined, myComment: undefined },
    { id: 900013, status: 'doing' as const, progress: 2, myRate: undefined, myComment: undefined },
    { id: 900014, status: 'done' as const, progress: 12, myRate: undefined, myComment: undefined },
  ]
  return seed.map((x, i) => {
    const s = DEMO_SUBJECTS.find((d) => d.id === x.id)
    if (!s) throw new Error(`演示库种子引用了不存在的条目 ${x.id}`)
    return {
      subjectId: s.id,
      name: s.name,
      nameCn: s.name_cn,
      image: s.images?.common || s.images?.large,
      status: x.status,
      progress: x.progress,
      epsTotal: s.eps ?? 0,
      watchedEps: Array.from({ length: x.progress }, (_, k) => k + 1),
      score: s.rating?.score,
      tags: (s.tags ?? []).slice(0, 5).map((t) => t.name),
      myRate: x.myRate,
      myComment: x.myComment,
      addedAt: 1757376000000 + i,
    }
  })
}
