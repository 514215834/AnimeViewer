/** Tauri 桌面端检测（v1.0-S1 T2/T3 共用）：Web 浏览器环境恒 false，行为与既往版本一致 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** T2 桌面端 User-Agent：Bangumi 要求可识别的 UA（浏览器 Forbidden header 限制，桌面端经 Rust 侧请求解除） */
export function desktopUserAgent(): string {
  return `AnimeViewer/${__APP_VERSION__} (https://github.com/514215834/AnimeViewer)`
}
