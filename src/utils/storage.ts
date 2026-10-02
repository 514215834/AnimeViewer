export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !Array.isArray(fallback)) {
      return { ...(fallback as object), ...parsed } as T
    }
    return parsed as T
  } catch {
    return fallback
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 存储被禁用或超限时静默失败
  }
}

/** v0.31 G2 收编迁移用：静默删除指定键 */
export function removeItem(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // 存储被禁用时静默失败
  }
}
