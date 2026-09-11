/**
 * v0.10 P1：从 demo.ts 拆出的纯 ID 段判断。
 * 单独成模块（不引演示数据），使 library/视图可静态引入而不把演示数据拖进主包；
 * demo.ts 数据函数改为按需动态加载（见 dataSource.loadDemo）。
 */

/** 演示条目固定 ID 段：900001~900014 */
export function isDemoSubjectId(id: number): boolean {
  return id >= 900001 && id <= 900014
}

/** 判断 ID 是否为内置演示角色：搜索/收藏列表固定段 800001~800006，条目角色为演示条目 ID×10+序号 */
export function isDemoCharacterId(id: number): boolean {
  return (id >= 800001 && id <= 800006) || (id >= 9000010 && id <= 9000149)
}

/** 判断 ID 是否为内置演示人物：搜索/收藏列表段 900001~900005，条目人物为演示条目 ID×1000+序号 */
export function isDemoPersonId(id: number): boolean {
  return (id >= 900001 && id <= 900005) || (id >= 900001000 && id <= 900014999)
}
