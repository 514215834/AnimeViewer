import { useSettingsStore } from '../stores/settings'
import { bangumiApi } from './bangumi'
import type { SearchAdvanced } from './bangumi'
import {
  demoBrowseSubjects,
  demoCalendar,
  demoCharacterDetail,
  demoCharacterSubjects,
  demoCharacters,
  demoDetail,
  demoEpisodes,
  demoIndex,
  demoIndexSubjects,
  demoMyCharacters,
  demoPersonDetail,
  demoPersonSubjects,
  demoPersons,
  demoRelatedSubjects,
  demoSearch,
  demoSearchCharacters,
  demoSearchPersons,
  demoUserProfile,
} from './demo'
import type {
  CalendarDay,
  CharacterDetail,
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
} from '../types/bangumi'

/** 统一数据入口：根据设置在「在线 Bangumi API」与「内置演示数据」间切换 */
export const dataSource = {
  calendar(force = false): Promise<CalendarDay[]> {
    return useSettingsStore().isDemo ? Promise.resolve(demoCalendar()) : bangumiApi.calendar(force)
  },
  subject(id: number): Promise<SubjectDetail> {
    return useSettingsStore().isDemo ? Promise.resolve(demoDetail(id)) : bangumiApi.subject(id)
  },
  characters(id: number): Promise<SubjectCharacter[]> {
    return useSettingsStore().isDemo ? Promise.resolve(demoCharacters(id)) : bangumiApi.characters(id)
  },
  persons(id: number): Promise<SubjectPerson[]> {
    return useSettingsStore().isDemo ? Promise.resolve(demoPersons(id)) : bangumiApi.persons(id)
  },
  episodes(subjectId: number): Promise<Episode[]> {
    return useSettingsStore().isDemo ? Promise.resolve(demoEpisodes(subjectId)) : bangumiApi.episodes(subjectId)
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
      return Promise.resolve(demoSearch(keyword, tags, sort, limit, offset, advanced))
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
      ? Promise.resolve(demoBrowseSubjects(opts))
      : bangumiApi.browseSubjects(opts)
  },
  /** v0.5 D2：关联条目（系列作品导航） */
  relatedSubjects(id: number): Promise<RelatedSubject[]> {
    return useSettingsStore().isDemo ? Promise.resolve(demoRelatedSubjects(id)) : bangumiApi.relatedSubjects(id)
  },
  /** v0.5 D5：按 ID 查看目录 */
  index(id: number): Promise<IndexInfo> {
    return useSettingsStore().isDemo ? Promise.resolve(demoIndex(id)) : bangumiApi.index(id)
  },
  indexSubjects(id: number, limit = 30, offset = 0): Promise<Paged<IndexSubjectItem>> {
    return useSettingsStore().isDemo
      ? Promise.resolve(demoIndexSubjects(id, limit, offset))
      : bangumiApi.indexSubjects(id, limit, offset)
  },
  /** v0.5 D6：角色/人物搜索 */
  searchCharacters(keyword: string, limit = 24, offset = 0): Promise<Paged<CharacterSearchItem>> {
    return useSettingsStore().isDemo
      ? Promise.resolve(demoSearchCharacters(keyword, limit, offset))
      : bangumiApi.searchCharacters(keyword, limit, offset)
  },
  searchPersons(keyword: string, limit = 24, offset = 0): Promise<Paged<PersonSearchItem>> {
    return useSettingsStore().isDemo
      ? Promise.resolve(demoSearchPersons(keyword, limit, offset))
      : bangumiApi.searchPersons(keyword, limit, offset)
  },
  /* ── v0.6 ── */
  /** E3 角色详情 */
  characterDetail(id: number): Promise<CharacterDetail> {
    return useSettingsStore().isDemo ? Promise.resolve(demoCharacterDetail(id)) : bangumiApi.characterDetail(id)
  },
  /** E3 人物详情 */
  personDetail(id: number): Promise<PersonDetail> {
    return useSettingsStore().isDemo ? Promise.resolve(demoPersonDetail(id)) : bangumiApi.personDetail(id)
  },
  /** E3 角色/人物参与作品 */
  characterSubjects(id: number): Promise<StaffWork[]> {
    return useSettingsStore().isDemo
      ? Promise.resolve(demoCharacterSubjects(id))
      : bangumiApi.characterSubjects(id)
  },
  personSubjects(id: number): Promise<StaffWork[]> {
    return useSettingsStore().isDemo ? Promise.resolve(demoPersonSubjects(id)) : bangumiApi.personSubjects(id)
  },
  /** E5 用户资料 */
  userProfile(username: string): Promise<UserProfile> {
    return useSettingsStore().isDemo
      ? Promise.resolve(demoUserProfile(username))
      : bangumiApi.userProfile(username)
  },
  /** E6 我的角色收藏列表 */
  myCharacterCollections(username: string): Promise<Paged<UserCharacterCollection>> {
    return useSettingsStore().isDemo
      ? Promise.resolve(demoMyCharacters())
      : bangumiApi.myCharacterCollections(username)
  },
  /** E6 收藏角色（演示模式 no-op） */
  collectCharacter(characterId: number): Promise<void> {
    return useSettingsStore().isDemo
      ? Promise.resolve()
      : bangumiApi.collectCharacter(characterId)
  },
}
