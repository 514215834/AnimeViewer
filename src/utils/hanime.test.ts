/** v0.26 HN3/HN7/HN8 在线解析前端纯函数用例：流地址构造 / 图片转发地址 / 在线绑定位置标识 / 历史归属反解 */
import { describe, expect, it } from 'vitest'
import { buildHanimeStreamUrl, buildHanimeThumbUrl } from '../api/mediaService'
import { positionIdOf, resolvePositionOwner, type MediaBinding, type WatchPosition } from './mediaCore'

describe('buildHanimeStreamUrl', () => {
  it('构造带 token 的流转发地址（含分辨率）', () => {
    expect(buildHanimeStreamUrl('http://127.0.0.1:8787/', 'tok en', '408185', 1080)).toBe(
      'http://127.0.0.1:8787/api/hanime/stream/408185?token=tok+en&res=1080',
    )
  })

  it('不带 res 时播服务端默认档（最高）', () => {
    expect(buildHanimeStreamUrl('http://127.0.0.1:8787', 't', 'abc123')).toBe(
      'http://127.0.0.1:8787/api/hanime/stream/abc123?token=t',
    )
  })

  it('res≤0 不进查询串', () => {
    const url = buildHanimeStreamUrl('http://x', 't', '1', 0)
    expect(url).toBe('http://x/api/hanime/stream/1?token=t')
  })
})

describe('buildHanimeThumbUrl（v0.26 补记：图片经服务端容灾转发）', () => {
  it('构造带 token 的图片转发地址（URL 编码）', () => {
    expect(buildHanimeThumbUrl('http://127.0.0.1:8787', 't', 'https://vdownload.hembed.com/i/1l.jpg?secure=a==,1')).toBe(
      'http://127.0.0.1:8787/api/hanime/thumb?url=https%3A%2F%2Fvdownload.hembed.com%2Fi%2F1l.jpg%3Fsecure%3Da%3D%3D%2C1&token=t',
    )
  })
})

describe('在线绑定（type=online）', () => {
  const binding: MediaBinding = {
    subjectId: 900001,
    sort: 3,
    name: '[Ubermation] Mona Full 4K/1080 + Alt ver.',
    type: 'online',
    videoCode: '408185',
    addedAt: 1,
  }

  it('位置标识 = o:{videoCode}', () => {
    expect(positionIdOf(binding)).toBe('o:408185')
  })

  it('历史归属按绑定 videoCode 反解为 online 来源', () => {
    const pos: WatchPosition = { id: 'o:408185', position: 100, duration: 334, updatedAt: 2 }
    const owner = resolvePositionOwner(pos, [binding])
    expect(owner).toEqual({ subjectId: 900001, sort: 3, source: 'online', positionId: 'o:408185' })
  })

  it('在线绑定缺失时归属为 null（u: 前缀不误判）', () => {
    const pos: WatchPosition = { id: 'o:unknown', position: 1, duration: 2, updatedAt: 3 }
    expect(resolvePositionOwner(pos, [binding])).toBeNull()
  })
})
