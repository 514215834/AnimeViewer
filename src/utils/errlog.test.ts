import { beforeEach, describe, expect, it } from 'vitest'
import { clearErrLog, formatDiagnostics, readErrLog, recordError } from './errlog'

beforeEach(() => clearErrLog())

describe('H4 全局错误环形日志', () => {
  it('追加记录并带来源与堆栈', () => {
    recordError('app', new Error('boom'))
    const log = readErrLog()
    expect(log).toHaveLength(1)
    expect(log[0].source).toBe('app')
    expect(log[0].message).toBe('boom')
    expect(log[0].stack).toContain('Error: boom')
  })

  it('相同消息去重（重复错误不刷屏）', () => {
    recordError('app', new Error('same'))
    recordError('promise', new Error('same'))
    const log = readErrLog()
    expect(log).toHaveLength(1)
    expect(log[0].source).toBe('promise') // 新者在前
  })

  it('容量上限 50 条（旧的被裁剪）', () => {
    for (let i = 0; i < 55; i++) recordError('app', new Error(`e-${i}`))
    const log = readErrLog()
    expect(log).toHaveLength(50)
    expect(log[0].message).toBe('e-54')
    expect(log.some((x) => x.message === 'e-0')).toBe(false)
  })

  it('formatDiagnostics 汇总环境行与错误列表；无错误时空态', () => {
    const empty = formatDiagnostics(['AnimeViewer v0.9.0'], [])
    expect(empty).toContain('AnimeViewer v0.9.0')
    expect(empty).toContain('（无记录）')
    const text = formatDiagnostics(['AnimeViewer v0.9.0'], [{ at: 0, source: 'router', message: 'nav fail' }])
    expect(text).toContain('router: nav fail')
  })
})
