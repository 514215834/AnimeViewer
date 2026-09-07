import type { BangumiImage } from '../types/bangumi'
import type { ImageQuality } from '../stores/settings'
import { useSettingsStore } from '../stores/settings'

/**
 * 可配置图片镜像（设置页「图片镜像地址」）：
 * 将 lain.bgm.tv 主机替换为配置的镜像地址（路径保留，可含子路径），留空时原样返回。
 * 墙内环境 lain.bgm.tv 常不可直连，与 API Base URL 一样支持自建反向代理。
 */
export function applyImageMirror(url: string): string {
  if (!url) return url
  const mirror = (useSettingsStore().mirrorImageUrl || '').trim().replace(/\/+$/, '')
  if (!mirror) return url
  return url.replace(/^https?:\/\/lain\.bgm\.tv/, mirror)
}

/**
 * 封面 URL 规范化工具。
 *
 * 关键事实：Bangumi 不同接口返回的 images 字段语义不一致——
 * legacy /calendar 的 common 是 150px 小图，而 v0 搜索的 common 是 400px、large 是原图、medium 是 800px。
 * 因此档位映射不能依赖字段名，必须统一取 l/ 原图路径后注入目标缩放前缀。
 * lain 封面支持 /r/100、/r/200、/r/400 三档缩放（官方字段背书）。
 */

/** 剥离全部缩放前缀并统一到 l/ 原图路径 */
function toCoverBase(url: string): string {
  return url
    .replace(/(?:\/r\/\d+)+(?=\/pic\/cover\/)/g, '')
    .replace('/pic/cover/c/', '/pic/cover/l/')
}

function injectCoverResize(url: string, size: 100 | 200 | 400): string {
  return toCoverBase(url).replace('/pic/cover/l/', `/r/${size}/pic/cover/l/`)
}

/** 列表卡片封面 URL（周历 / 热门在播 / 搜索）：极致 400 / 高清 200 / 省流 100 */
export function coverCardUrl(images: BangumiImage | undefined, quality: ImageQuality): string {
  const base = images?.large || images?.medium || images?.common || ''
  if (!base) return ''
  const size = quality === 'extreme' ? 400 : quality === 'high' ? 200 : 100
  return injectCoverResize(base, size)
}

/** 已存储的封面 URL 按清晰度升级（用于追番卡片与详情主图；省流档不低于 200 保证主图可看） */
export function upgradeStoredCover(url: string | undefined, quality: ImageQuality): string {
  if (!url) return ''
  const base = toCoverBase(url)
  if (!base.includes('/pic/cover/l/')) return url // 非 l 源的未知格式原样返回
  const size = quality === 'extreme' ? 400 : 200
  return injectCoverResize(base, size)
}

/** 角色头像：crt 路径仅支持 /r/100、/r/200、/r/400；三档映射 400/200/100 */
export function charAvatarUrl(images: BangumiImage | undefined, quality: ImageQuality): string {
  const base = images?.large || images?.medium || ''
  if (!base) return images?.small || ''
  const size = quality === 'extreme' ? 400 : quality === 'high' ? 200 : 100
  const bare = base.replace(/(?:\/r\/\d+)+(?=\/pic\/crt\/)/g, '')
  return bare.replace('/pic/crt/', `/r/${size}/pic/crt/`)
}
