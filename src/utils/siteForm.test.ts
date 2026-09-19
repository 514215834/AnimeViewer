/** v0.24 SM2 站点表单校验用例：规则与后端 ResourceService.saveSite 同口径（key/baseUrl/模板 {kw}）。 */
import { describe, expect, it } from 'vitest'
import { SITE_PRESETS, siteFormValid, validateSiteForm } from './siteForm'

const okForm = {
  key: 'nyaa',
  name: 'Nyaa',
  baseUrl: 'https://nyaa.si',
  searchTemplate: '?page=rss&q={kw}',
}

describe('validateSiteForm', () => {
  it('合法表单零错误', () => {
    expect(validateSiteForm(okForm)).toEqual({})
    expect(siteFormValid(okForm)).toBe(true)
  })

  it('key 归一（trim+小写）后校验：大写合法、超长/空/非法字符拒绝', () => {
    // 与后端 saveSite 同口径：先 trim+lowercase 再校验——大写自动归一通过
    expect(validateSiteForm({ ...okForm, key: 'NYAA' })).toEqual({})
    expect(validateSiteForm({ ...okForm, key: 'a'.repeat(25) }).key).toBeTruthy()
    expect(validateSiteForm({ ...okForm, key: '' }).key).toBeTruthy()
    expect(validateSiteForm({ ...okForm, key: '站点1' }).key).toBeTruthy()
    // 合法形态：小写/数字/连字符/下划线
    expect(validateSiteForm({ ...okForm, key: 'dmhy-backup_1' })).toEqual({})
  })

  it('baseUrl 必须以 http(s):// 开头', () => {
    expect(validateSiteForm({ ...okForm, baseUrl: 'nyaa.si' }).baseUrl).toBeTruthy()
    expect(validateSiteForm({ ...okForm, baseUrl: 'ftp://x' }).baseUrl).toBeTruthy()
    expect(validateSiteForm({ ...okForm, baseUrl: 'http://localhost:8080' })).toEqual({})
  })

  it('搜索模板必须含 {kw} 占位符', () => {
    expect(validateSiteForm({ ...okForm, searchTemplate: '?page=rss&q=' }).searchTemplate).toBeTruthy()
    expect(validateSiteForm({ ...okForm, searchTemplate: 'rss.xml?keyword={kw}' })).toEqual({})
  })

  it('预设模板自带合法 key/地址/模板（一键填入即通过）', () => {
    for (const p of SITE_PRESETS) {
      expect(validateSiteForm({ key: p.key, name: p.name, baseUrl: p.baseUrl, searchTemplate: p.searchTemplate })).toEqual({})
      // 预设模板拼 baseUrl 后（urlFor 语义）路径可寻
      expect(p.baseUrl).toMatch(/^https?:\/\//)
      expect(p.searchTemplate).toContain('{kw}')
    }
  })
})
