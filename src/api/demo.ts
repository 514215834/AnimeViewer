import type {
  CalendarDay,
  CalendarSubject,
  Episode,
  SearchResponse,
  SearchResultItem,
  SubjectCharacter,
  SubjectDetail,
  SubjectPerson,
} from '../types/bangumi'

interface DemoSubject extends CalendarSubject {
  tags: { name: string; count: number }[]
}

/** 内置演示数据：虚构番剧，用于离线体验与 UI 验证 */
const DEMO_SUBJECTS: DemoSubject[] = [
  {
    id: 900001, name: 'Starlight Pact', name_cn: '星轨之约', type: 2, eps: 12,
    air_date: '2026-07-05', air_weekday: 1, date: '2026-07-05',
    rating: { score: 8.2, total: 3210, rank: 412 }, collection: { wish: 5600, doing: 5200, done: 880 },
    summary: '夜空中突然出现了一条不属于任何星图的轨迹。少女天文社的成员们发现，只有许下约定的人才能看见那条星轨背后隐藏的世界。',
    tags: [{ name: '原创', count: 210 }, { name: '奇幻', count: 180 }, { name: '治愈', count: 96 }],
  },
  {
    id: 900002, name: 'Spicy Hot Pot Girls', name_cn: '麻辣火锅少女', type: 2, eps: 12,
    air_date: '2026-07-05', air_weekday: 1, date: '2026-07-05',
    rating: { score: 7.1, total: 1540, rank: 1980 }, collection: { wish: 2100, doing: 2300, done: 640 },
    summary: '三家火锅店为了争夺老街的黄金铺面，派出各自最擅做火锅的少女展开厨艺对决，却在一次次比赛中变成了最好的朋友。',
    tags: [{ name: '原创', count: 88 }, { name: '搞笑', count: 76 }, { name: '日常', count: 41 }],
  },
  {
    id: 900003, name: 'Pixel Love Song', name_cn: '像素恋歌', type: 2, eps: 13,
    air_date: '2026-07-06', air_weekday: 2, date: '2026-07-06',
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
    rating: { score: 7.4, total: 1980, rank: 1520 }, collection: { wish: 2600, doing: 3100, done: 990 },
    summary: '在被机械蜂群支配的天空下，少年驾驶着最后一台蝶形装甲机，守护着一座仍然相信春天的城市。',
    tags: [{ name: '漫画改', count: 140 }, { name: '热血', count: 122 }, { name: '机战', count: 87 }],
  },
  {
    id: 900006, name: 'Neko Convenience Store', name_cn: '猫咪便利屋', type: 2, eps: 13,
    air_date: '2026-04-03', air_weekday: 3, date: '2026-04-03',
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
      { key: '放送开始', value: s.air_date ?? '未知' },
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
  return Array.from({ length: total }, (_, i) => ({
    id: id * 10000 + i + 1,
    type: 0,
    name: `Episode ${i + 1}`,
    name_cn: `第${i + 1}话`,
    sort: i + 1,
    ep: i + 1,
    airdate: '',
  }))
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
): SearchResponse {
  const kw = keyword.trim().toLowerCase()
  const includes = tags.filter((t) => !t.startsWith('-'))
  const excludes = tags.filter((t) => t.startsWith('-')).map((t) => t.slice(1))
  const hit = DEMO_SUBJECTS.filter((s) => {
    const kwOk = !kw || s.name_cn.toLowerCase().includes(kw) || s.name.toLowerCase().includes(kw)
    const includeOk = includes.every((t) => s.tags.some((x) => x.name === t))
    const excludeOk = !excludes.some((t) => s.tags.some((x) => x.name === t))
    return kwOk && includeOk && excludeOk
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
