import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IdbStats } from './idbCache'

/* ── 极小内存版 IndexedDB 假实现：只覆盖 idbCache 用到的 open/get/put/clear/openCursor 面 ──
 *  真实 IDB 回调也是异步事件，这里统一 setTimeout(0) 派发，用真实计时器 flush 等待完成。
 *  （不用 vi fake timers：vitest 5 的 runAllTimersAsync 返回的 Promise 不会 settle，会挂死用例） */
interface FakeEnv {
  supported?: boolean
  failOpen?: boolean
  failOp?: boolean
}

function createFakeIdb(env: FakeEnv) {
  const store = new Map<string, unknown>()
  type Req = { result?: unknown; error: Error | null; onsuccess?: () => void; onerror?: () => void }
  const makeReq = (): Req => ({ error: null })
  const ok = (req: Req, result: unknown) => {
    setTimeout(() => {
      req.result = result
      req.onsuccess?.()
    }, 0)
  }
  const fail = (req: Req) => {
    setTimeout(() => {
      req.error = new Error('idb fail')
      req.onerror?.()
    }, 0)
  }
  const indexedDB = {
    open(_name: string, _version: number) {
      const req = makeReq()
      setTimeout(() => {
        if (env.supported === false || env.failOpen) {
          fail(req)
          return
        }
        req.result = {
          objectStoreNames: { contains: () => true },
          transaction: () => {
            // 注意：模块先取 transaction() 返回值再赋 tx.oncomplete 等回调，
            // 因此必须返回同一个对象（不能展开拷贝），否则赋值落不到闭包引用上
            const tx = { oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null }
            const writes: Array<[string, unknown]> = []
            let cleared = false
            const schedule = () =>
              setTimeout(() => {
                if (env.failOp) {
                  tx.onerror?.()
                  tx.onabort?.()
                  return
                }
                if (cleared) store.clear()
                writes.forEach(([k, v]) => store.set(k, v))
                tx.oncomplete?.()
              }, 0)
            return Object.assign(tx, {
              objectStore: () => ({
                get(key: string) {
                  const req = makeReq()
                  if (env.failOp) fail(req)
                  else ok(req, store.get(key))
                  return req
                },
                put(value: unknown, key: string) {
                  writes.push([key, JSON.parse(JSON.stringify(value))])
                  schedule()
                  return {}
                },
                clear() {
                  cleared = true
                  schedule()
                  return {}
                },
                openCursor() {
                  const req: Req = makeReq()
                  const entries = [...store.entries()]
                  let i = 0
                  const step = () =>
                    setTimeout(() => {
                      if (env.failOp) {
                        fail(req)
                        return
                      }
                      if (i >= entries.length) {
                        req.result = null
                      } else {
                        const [key, value] = entries[i]
                        i += 1
                        req.result = { key, value, continue: step }
                      }
                      req.onsuccess?.()
                    }, 0)
                  step()
                  return req
                },
              }),
            })
          },
        }
        req.onsuccess?.()
      }, 0)
      return req
    },
  }
  return { indexedDB, store }
}

let fake_store: Map<string, unknown> = new Map()

async function loadModule(env: FakeEnv) {
  vi.resetModules()
  if (env.supported === false) {
    vi.stubGlobal('indexedDB', undefined) // typeof → 'undefined'，走环境不支持分支
  } else {
    const fake = createFakeIdb(env)
    fake_store = fake.store
    vi.stubGlobal('indexedDB', fake.indexedDB)
  }
  return { ...(await import('./idbCache')), store: fake_store }
}

/** 等待假 IDB 的 0ms 定时器链全部跑完（含链式 cursor.continue），再取回操作结果 */
async function settled<T>(p: Promise<T>): Promise<T> {
  await new Promise((r) => setTimeout(r, 25))
  return await p
}

describe('idbCache（IndexedDB 持久层）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('set→get 往返一致；超过 TTL 后视为未命中', async () => {
    const m = await loadModule({})
    await settled(m.idbSet('k1', { a: 1 }))
    expect(await settled(m.idbGet('k1'))).toEqual({ a: 1 })
    // 直接把记录时间戳拨到 24h 前（PERSIST_TTL_MS），比 mock 系统时钟更直接
    const rec = m.store.get('k1') as { at: number }
    rec.at = Date.now() - 25 * 60 * 60 * 1000
    expect(await settled(m.idbGet('k1'))).toBeUndefined()
  })

  it('idbStats 统计条目数与估算体积；clear 后归零且 get 未命中', async () => {
    const m = await loadModule({})
    await settled(m.idbSet('c1:subject:921', { id: 921, name: 'x'.repeat(100) }))
    await settled(m.idbSet('c1:nsfw-flags', { 1: true }))
    const stats: IdbStats = await settled(m.idbStats())
    expect(stats.count).toBe(2)
    expect(stats.bytes).toBeGreaterThan(0)
    await settled(m.idbClear())
    expect((await settled(m.idbStats())).count).toBe(0)
    expect(await settled(m.idbGet('c1:subject:921'))).toBeUndefined()
  })

  it('环境不支持（无 indexedDB）与打开/读写失败一律静默降级，不抛错', async () => {
    const none = await loadModule({ supported: false })
    await settled(none.idbSet('k', 1))
    expect(await settled(none.idbGet('k'))).toBeUndefined()
    expect(await settled(none.idbStats())).toEqual({ count: 0, bytes: 0 })

    const broken = await loadModule({ failOpen: true })
    expect(await settled(broken.idbGet('k'))).toBeUndefined()
    expect(await settled(broken.idbStats())).toEqual({ count: 0, bytes: 0 })

    const failing = await loadModule({ failOp: true })
    await settled(failing.idbSet('k', 1))
    expect(await settled(failing.idbGet('k'))).toBeUndefined()
    expect(await settled(failing.idbStats())).toEqual({ count: 0, bytes: 0 })
  })
})
