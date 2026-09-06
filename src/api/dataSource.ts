import { useSettingsStore } from '../stores/settings'
import { bangumiApi } from './bangumi'
import { demoCalendar, demoCharacters, demoDetail, demoEpisodes, demoPersons, demoSearch } from './demo'
import type {
  CalendarDay,
  Episode,
  SearchResponse,
  SubjectCharacter,
  SubjectDetail,
  SubjectPerson,
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
  search(keyword: string, tags: string[], sort = 'match', limit?: number, offset?: number): Promise<SearchResponse> {
    if (useSettingsStore().isDemo) return Promise.resolve(demoSearch(keyword, tags, sort, limit, offset))
    return bangumiApi.search(keyword, tags, sort, limit, offset)
  },
}
