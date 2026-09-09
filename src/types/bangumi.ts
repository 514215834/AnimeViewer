export interface BangumiImage {
  large?: string
  common?: string
  medium?: string
  small?: string
  grid?: string
}

/** /calendar 返回的条目（旧版结构，字段较全） */
export interface CalendarSubject {
  id: number
  name: string
  name_cn: string
  date?: string
  images?: BangumiImage
  summary?: string
  air_date?: string
  air_weekday?: number
  rating?: { score?: number; total?: number; rank?: number }
  rank?: number
  collection?: { wish?: number; doing?: number; done?: number; on_hold?: number; dropped?: number }
  type?: number
  eps?: number
  nsfw?: boolean
  url?: string
}

export interface Weekday {
  id: number
  en: string
  cn: string
  ja: string
}

export interface CalendarDay {
  weekday: Weekday
  items: CalendarSubject[]
}

/** /v0/subjects/{id} 详情 */
export interface SubjectDetail {
  id: number
  name: string
  name_cn: string
  date?: string
  images?: BangumiImage
  summary?: string
  total_episodes?: number
  rating?: { score?: number; total?: number; rank?: number; count?: Record<string, number> }
  collection?: { wish?: number; doing?: number; done?: number; on_hold?: number; dropped?: number }
  tags?: { name: string; count: number }[]
  infobox?: { key: string; value: string | { v: string }[] }[]
  series?: boolean
  platform?: string
  nsfw?: boolean
  type?: number
}

export interface SearchResultItem {
  id: number
  name: string
  name_cn: string
  date?: string
  images?: BangumiImage
  summary?: string
  rating?: { score?: number; total?: number; rank?: number }
  tags?: { name: string; count: number }[]
  total_episodes?: number
  air_weekday?: number
  type?: number
  /** v0 搜索响应实际会带 nsfw 标记 */
  nsfw?: boolean
}

export interface SearchResponse {
  data: SearchResultItem[]
  total: number
  limit: number
  offset: number
}

export interface CharacterActor {
  id?: number
  name: string
  type?: number
  images?: BangumiImage
}

export interface SubjectCharacter {
  id: number
  name: string
  type?: number
  images?: BangumiImage
  relation: string
  actors?: CharacterActor[]
}

export interface SubjectPerson {
  id: number
  name: string
  type?: number
  images?: BangumiImage
  relation: string
}

export interface Episode {
  id: number
  type: number
  name: string
  name_cn?: string
  sort: number
  ep?: number | string
  airdate?: string
  /** 吐槽数（2026-09-09 实测：列表响应已携带，与单集详情端点字段一致） */
  comment?: number
  /** 时长描述（老条目常为空串） */
  duration?: string
  /** 时长（秒） */
  duration_seconds?: number
  /** 章节简介（老条目常为空串，抽屉需空态） */
  desc?: string
  /** 所属光盘卷（仅 DVD/BD 章节有意义） */
  disc?: number
}

export interface Paged<T> {
  data: T[]
  total?: number
  limit?: number
  offset?: number
}

/** GET /v0/subjects/{id}/subjects 关联条目（relation 为开放式中文名：前传/续集/主线/番外/游戏/书籍/联动…） */
export interface RelatedSubject {
  id: number
  type: number
  name: string
  name_cn: string
  images?: BangumiImage
  relation: string
}

/** GET /v0/indices/{id} 目录信息 */
export interface IndexInfo {
  id: number
  title: string
  desc?: string
  total?: number
  creator?: { username?: string; nickname?: string }
  nsfw?: boolean
  updated_at?: string
}

/** GET /v0/indices/{id}/subjects 目录内条目（无评分字段） */
export interface IndexSubjectItem {
  id: number
  type: number
  name: string
  name_cn?: string
  images?: BangumiImage
  date?: string
  comment?: string
}

/** POST /v0/search/characters 结果项 */
export interface CharacterSearchItem {
  id: number
  name: string
  name_cn?: string
  images?: BangumiImage
  nsfw?: boolean
}

/** POST /v0/search/persons 结果项 */
export interface PersonSearchItem {
  id: number
  name: string
  name_cn?: string
  images?: BangumiImage
  career?: string[]
  nsfw?: boolean
}

/** Bangumi 收藏类型：1=想看 2=看过 3=在看 4=搁置 5=抛弃 */
export type ServerCollectionType = 1 | 2 | 3 | 4 | 5

/** PUT /v0/users/-/collections/-/episodes/{episode_id} 的 type：0=未收藏 1=想看 2=看过 3=抛弃 */
export type EpisodeMarkType = 0 | 1 | 2 | 3

/** GET /v0/characters/{id} 角色详情（节选；v0 无 actors 字段，CV 经人物页浏览） */
export interface CharacterDetail {
  id: number
  name: string
  name_cn?: string
  type?: number
  images?: BangumiImage
  summary?: string
  nsfw?: boolean
  gender?: string
  blood_type?: number
  birth_year?: number
  birth_mon?: number
  birth_day?: number
}

/** GET /v0/persons/{id} 人物详情（节选） */
export interface PersonDetail {
  id: number
  name: string
  name_cn?: string
  type?: number
  career?: string[]
  images?: BangumiImage
  summary?: string
  nsfw?: boolean
}

/** GET /v0/characters/{id}/subjects 与 /v0/persons/{id}/subjects 的作品项（image 为单个 URL 字符串） */
export interface StaffWork {
  id: number
  type?: number
  /** 参与身份：主角 / 客串 / 导演 / 艺术家… */
  staff: string
  /** 参与章节/曲目（声优单曲等） */
  eps?: string
  name: string
  name_cn?: string
  image?: string
}

/** GET /v0/users/{username} 用户资料（节选） */
export interface UserProfile {
  id: number
  username?: string
  nickname?: string
  avatar?: BangumiImage
  sign?: string
}

/** GET /v0/users/{username}/collections/-/characters 列表项（自带名称与头像） */
export interface UserCharacterCollection {
  id: number
  name: string
  type?: number
  images?: BangumiImage | null
  created_at?: string
}

/** GET /v0/users/{username}/collections/-/persons 列表项（自带名称/头像/career） */
export interface UserPersonCollection {
  id: number
  name: string
  type?: number
  career?: string[]
  images?: BangumiImage | null
  created_at?: string
}

/** GET /v0/characters/{id}/persons 角色关联声优（每项含所属作品与 staff 身份） */
export interface CharacterPerson {
  id: number
  name: string
  type?: number
  images?: BangumiImage | null
  subject_id: number
  subject_type?: number
  subject_name: string
  subject_name_cn?: string
  staff?: string
}

/** GET /v0/users/-/collections/{subject_id}/episodes 列表项（F1 云端单集状态） */
export interface UserEpisodeCollection {
  episode: Episode
  /** 0=未收藏 1=想看 2=看过 3=抛弃 */
  type: EpisodeMarkType
  /** unix 秒；0=未知（官方注明可能不更新，仅参考） */
  updated_at?: number
}

/** GET /v0/users/{username}/collections 列表项 */
export interface UserSubjectCollection {
  subject_id: number
  subject_type?: number
  rate?: number
  type: ServerCollectionType
  comment?: string
  tags?: string[]
  ep_status?: number
  updated_at?: string
  private?: boolean
}

/** GET /v0/me 响应（节选） */
export interface BangumiMe {
  id?: number
  username?: string
  nickname?: string
  avatar?: BangumiImage
}
