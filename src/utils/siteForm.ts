/** v0.24 SM2 自定义 RSS 站点表单校验与预设模板（纯函数，vitest 护航；规则与
 *  服务端 ResourceService.saveSite 同口径：key 1~24 位小写字母/数字/连字符/下划线、
 *  baseUrl 须 http(s)、搜索模板必须含 {kw} 占位符）。 */

export interface SitePreset {
  key: string
  name: string
  baseUrl: string
  searchTemplate: string
  /** 类型说明（种子直链型 / 磁力同构型） */
  hint?: string
}

/** 预设模板：内置同构站直填 + 种子型站点（nyaa 2026-09-19 实测可用：nyaa:infoHash 直接构造磁力） */
export const SITE_PRESETS: SitePreset[] = [
  {
    key: 'acgnx',
    name: '末日動漫資源庫（acgnx 同构站）',
    baseUrl: 'https://share.acgnx.se',
    searchTemplate: 'rss.xml?keyword={kw}',
    hint: '磁力 enclosure',
  },
  {
    key: 'dmhy',
    name: '動漫花園（dmhy 同构站）',
    baseUrl: 'https://share.dmhy.org',
    searchTemplate: 'topics/rss/rss.xml?keyword={kw}',
    hint: '磁力 enclosure',
  },
  {
    key: 'nyaa',
    name: 'Nyaa（nyaa.si）',
    baseUrl: 'https://nyaa.si',
    searchTemplate: '?page=rss&q={kw}&c=0_0&f=0&c=1_2',
    hint: '种子直链 + infoHash',
  },
]

export interface SiteForm {
  key: string
  name: string
  baseUrl: string
  searchTemplate: string
}

export interface SiteFormErrors {
  key?: string
  baseUrl?: string
  searchTemplate?: string
}

const KEY_RE = /^[a-z0-9_-]{1,24}$/

/** 表单校验（服务端保存前的前端前置；全部通过返回空对象） */
export function validateSiteForm(form: SiteForm): SiteFormErrors {
  const key = form.key.trim().toLowerCase()
  const baseUrl = form.baseUrl.trim()
  const template = form.searchTemplate.trim()
  const errors: SiteFormErrors = {}
  if (!KEY_RE.test(key)) errors.key = '站点标识需为 1~24 位小写字母/数字/连字符/下划线'
  if (!/^https?:\/\//.test(baseUrl)) errors.baseUrl = '站点地址需以 http(s):// 开头'
  if (!template.includes('{kw}')) errors.searchTemplate = '搜索模板需包含 {kw} 占位符'
  return errors
}

/** 校验是否全通过 */
export function siteFormValid(form: SiteForm): boolean {
  const errs = validateSiteForm(form)
  return !errs.key && !errs.baseUrl && !errs.searchTemplate
}
