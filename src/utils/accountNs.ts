import { loadJson } from './storage'

/**
 * v0.31 G1 账户命名空间（§5S 立项）：账户级本地数据键统一后缀 `:{accountKey}`，
 * `{accountKey}` = `u{me.id}`（已登录）/ `local`（匿名）。
 * demo 库（`:demo`）是数据源模式维度，与本账户维度正交（§4F / §5R 补记六）。
 * 账户级键共 6 个：追番库 / 角色收藏 / 人物收藏 / 移除墓碑（library.ts）
 * + 单集待推队列 / 上次同步时间（sync.ts）。其余存储（播放数据 IndexedDB、搜索历史、
 * settings 其余字段等）为设备级语义，不参与本命名空间。
 */

export const SETTINGS_STORAGE_KEY = 'animeviewer:settings'
/** v0.31 G2 一次性收编标记：存在即视为旧无后缀键已处置（先写标记再迁移删旧键，崩溃不重复收编） */
export const ADOPTED_KEY = 'animeviewer:account:adopted'
export const LOCAL_NS = 'local'

/** 升级前的旧无后缀账户级键（收编后删除） */
export const LEGACY_ACCOUNT_KEYS = [
  'animeviewer:library',
  'animeviewer:characters',
  'animeviewer:persons',
  'animeviewer:removedSubjects',
  'animeviewer:sync:pendingEps',
  'animeviewer:sync:lastAt',
] as const

export interface AdoptionMarker {
  at: number
  adoptedBy: string
}

/** 收编输入快照（与 library/sync 存储形态同构，泛化 object 以避免与 store 类型互相依赖） */
export interface LegacySnapshot {
  items: Record<string, object>
  characters: Record<string, object>
  persons: Record<string, object>
  removed: Record<string, number>
  pendingEps: object[]
  lastSyncAt: number | null
}

export interface AdoptionPlan extends LegacySnapshot {}

/**
 * store 初始化期直接读持久化 settings 里的 accountKey——Pinia 跨 store 不能在 state() 内
 * 建其他 store，库/队列装载只读这一处持久化 JSON（applyPatch 变更后与 store 值一致）。
 */
export function persistedAccountNs(): string {
  const raw = loadJson<Partial<{ accountKey: string }>>(SETTINGS_STORAGE_KEY, {})
  return raw.accountKey || LOCAL_NS
}

/** 基础键 + 命名空间 → 实际存储键 */
export function nsKey(base: string, ns: string): string {
  return `${base}:${ns}`
}

/** me.id → 真实账户命名空间（`u{id}`）；id 缺失（匿名/异常）返回 null 交由调用方保持现状 */
export function realNsOfMeId(meId: number | null | undefined): string | null {
  return meId != null && meId > 0 ? `u${meId}` : null
}

/** 未推送改动计数（弹窗与直接收编的判据）：条目 dirty + 角色/人物 dirty + 单集待推队列长度 */
export function countLegacyPending(legacy: LegacySnapshot): number {
  const dirtyOf = (objs: Record<string, object>) =>
    Object.values(objs).filter((o) => (o as { dirty?: boolean }).dirty === true).length
  return (
    dirtyOf(legacy.items) +
    dirtyOf(legacy.characters) +
    dirtyOf(legacy.persons) +
    legacy.pendingEps.length
  )
}

/**
 * 收编纯函数：legacy 快照 → 目标命名空间数据。
 * push=true 原样并入（dirty 保留，随后由同步引擎推送到真实账户/维持现状）；
 * push=false「保留本地不推送」语义：清 dirty/dirtyAt、清空单集待推队列（永不重放）。
 * 目标命名空间保证为空（收编只发生在首次绑定），此处不做合并。
 */
export function planAdoption(legacy: LegacySnapshot, push: boolean): AdoptionPlan {
  if (push) return { ...legacy }
  const strip = (objs: Record<string, object>): Record<string, object> => {
    const out: Record<string, object> = {}
    for (const [k, o] of Object.entries(objs)) {
      const { dirty: _d, dirtyAt: _da, ...rest } = o as Record<string, unknown>
      out[k] = rest
    }
    return out
  }
  return {
    items: strip(legacy.items),
    characters: strip(legacy.characters),
    persons: strip(legacy.persons),
    removed: legacy.removed,
    pendingEps: [],
    lastSyncAt: legacy.lastSyncAt,
  }
}
