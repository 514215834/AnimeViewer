import { useSettingsStore } from '../stores/settings'
import { bangumiApi } from './bangumi'
import type { SearchAdvanced } from './bangumi'
import type {
  CalendarDay,
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

/** v0.10 P1：演示数据模块类型（仅动态加载） */
type DemoModule = typeof import('./demo')

let demoPromise: Promise<DemoModule> | null = null

/** 演示数据按需加载：仅演示模式才拉取 demo chunk，在线模式主包不含内置数据 */
function loadDemo(): Promise<DemoModule> {
  demoPromise ??= import('./demo')
  return demoPromise
}

/** 统一数据入口：根据设置在「在线 Bangumi API」与「内置演示数据」间切换 */
export const dataSource = {
  calendar(force = false): Promise<CalendarDay[]> {
    return useSettingsStore().isDemo ? loadDemo().then((m) => m.demoCalendar()) : bangumiApi.calendar(force)
  },
  subject(id: number): Promise<SubjectDetail> {
    return useSettingsStore().isDemo ? loadDemo().then((m) => m.demoDetail(id)) : bangumiApi.subject(id)
  },
  characters(id: number): Promise<SubjectCharacter[]> {
    return useSettingsStore().isDemo ? loadDemo().then((m) => m.demoCharacters(id)) : bangumiApi.characters(id)
  },
  persons(id: number): Promise<SubjectPerson[]> {
    return useSettingsStore().isDemo ? loadDemo().then((m) => m.demoPersons(id)) : bangumiApi.persons(id)
  },
  episodes(subjectId: number): Promise<Episode[]> {
    return useSettingsStore().isDemo ? loadDemo().then((m) => m.demoEpisodes(subjectId)) : bangumiApi.episodes(subjectId)
  },
  search(
    keyword: string,
    tags: string[],
    sort = 'match',
    limit?: number,
    offset?: number,
    advanced?: SearchAdvanced,
  ): Promise<SearchResponse> {
    if (useSettingsStore().isDemo) {
      return loadDemo().then((m) => m.demoSearch(keyword, tags, sort, limit, offset, advanced))
    }
    return bangumiApi.search(keyword, tags, sort, limit, offset, advanced)
  },
  /** v0.5 D1：按年代浏览（结果项含 nsfw 字段，R18 过滤在前端直接完成，无需额外请求） */
  browseSubjects(opts: {
    year: number
    month?: number
    sort?: 'date' | 'rank'
    limit?: number
    offset?: number
  }): Promise<Paged<SearchResultItem>> {
    return useSettingsStore().isDemo
      ? loadDemo().then((m) => m.demoBrowseSubjects(opts))
      : bangumiApi.browseSubjects(opts)
  },
  /** v0.5 D2：关联条目（系列作品导航） */
  relatedSubjects(id: number): Promise<RelatedSubject[]> {
    return useSettingsStore().isDemo
      ? loadDemo().then((m) => m.demoRelatedSubjects(id))
      : bangumiApi.relatedSubjects(id)
  },
  /** v0.5 D5：按 ID 查看目录 */
  index(id: number): Promise<IndexInfo> {
    return useSettingsStore().isDemo ? loadDemo().then((m) => m.demoIndex(id)) : bangumiApi.index(id)
  },
  indexSubjects(id: number, limit = 30, offset = 0): Promise<Paged<IndexSubjectItem>> {
    return useSettingsStore().isDemo
      ? loadDemo().then((m) => m.demoIndexSubjects(id, limit, offset))
      : bangumiApi.indexSubjects(id, limit, offset)
  },
  /** v0.5 D6：角色/人物搜索 */
  searchCharacters(keyword: string, limit = 24, offset = 0): Promise<Paged<CharacterSearchItem>> {
    return useSettingsStore().isDemo
      ? loadDemo().then((m) => m.demoSearchCharacters(keyword, limit, offset))
      : bangumiApi.searchCharacters(keyword, limit, offset)
  },
  searchPersons(keyword: string, limit = 24, offset = 0): Promise<Paged<PersonSearchItem>> {
    return useSettingsStore().isDemo
      ? loadDemo().then((m) => m.demoSearchPersons(keyword, limit, offset))
      : bangumiApi.searchPersons(keyword, limit, offset)
  },
  /* ── v0.6 ── */
  /** E3 角色详情 */
  characterDetail(id: number): Promise<CharacterDetail> {
    return useSettingsStore().isDemo
      ? loadDemo().then((m) => m.demoCharacterDetail(id))
      : bangumiApi.characterDetail(id)
  },
  /** E3 人物详情 */
  personDetail(id: number): Promise<PersonDetail> {
    return useSettingsStore().isDemo
      ? loadDemo().then((m) => m.demoPersonDetail(id))
      : bangumiApi.personDetail(id)
  },
  /** E3 角色/人物参与作品 */
  characterSubjects(id: number): Promise<StaffWork[]> {
    return useSettingsStore().isDemo
      ? loadDemo().then((m) => m.demoCharacterSubjects(id))
      : bangumiApi.characterSubjects(id)
  },
  personSubjects(id: number): Promise<StaffWork[]> {
    return useSettingsStore().isDemo
      ? loadDemo().then((m) => m.demoPersonSubjects(id))
      : bangumiApi.personSubjects(id)
  },
  /** E5 用户资料 */
  userProfile(username: string): Promise<UserProfile> {
    return useSettingsStore().isDemo
      ? loadDemo().then((m) => m.demoUserProfile(username))
      : bangumiApi.userProfile(username)
  },
  /** E6 我的角色收藏列表 */
  myCharacterCollections(username: string): Promise<Paged<UserCharacterCollection>> {
    return useSettingsStore().isDemo
      ? loadDemo().then((m) => m.demoMyCharacters())
      : bangumiApi.myCharacterCollections(username)
  },
  /** E6 收藏角色（演示模式 no-op） */
  collectCharacter(characterId: number): Promise<void> {
    return useSettingsStore().isDemo
      ? Promise.resolve()
      : bangumiApi.collectCharacter(characterId)
  },
  /* ── v0.7 ── */
  /** F3 角色关联声优 */
  characterPersons(id: number): Promise<CharacterPerson[]> {
    return useSettingsStore().isDemo
      ? loadDemo().then((m) => m.demoCharacterPersons(id))
      : bangumiApi.characterPersons(id)
  },
  /** F2 我的人物收藏列表 */
  myPersonCollections(username: string): Promise<Paged<UserPersonCollection>> {
    return useSettingsStore().isDemo
      ? loadDemo().then((m) => m.demoMyPersons())
      : bangumiApi.myPersonCollections(username)
  },
  /** F2 收藏人物（演示模式 no-op） */
  collectPerson(personId: number): Promise<void> {
    return useSettingsStore().isDemo
      ? Promise.resolve()
      : bangumiApi.collectPerson(personId)
  },
}
