import { loadJson, saveJson } from './storage'

/** H4 全局错误环形日志：仅写入本地 localStorage，不做任何上报（local-first） */

export interface ErrLogEntry {
  at: number
  source: 'app' | 'router' | 'promise'
  message: string
  stack?: string
}

const ERRLOG_KEY = 'animeviewer:errlog'
const ERRLOG_CAP = 50

export function readErrLog(): ErrLogEntry[] {
  const list = loadJson<ErrLogEntry[]>(ERRLOG_KEY, [])
  return Array.isArray(list) ? list : []
}

/** 追加一条错误并裁剪到容量上限；记录本身失败时静默（诊断工具不能成为新的错误源） */
export function recordError(source: ErrLogEntry['source'], e: unknown): void {
  try {
    const entry: ErrLogEntry = {
      at: Date.now(),
      source,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error && e.stack ? e.stack.slice(0, 2000) : undefined,
    }
    const list = [entry, ...readErrLog().filter((x) => x.message !== entry.message)]
    list.length = Math.min(list.length, ERRLOG_CAP)
    saveJson(ERRLOG_KEY, list)
  } catch {
    /* ignore */
  }
}

export function clearErrLog(): void {
  try {
    localStorage.removeItem(ERRLOG_KEY)
  } catch {
    /* ignore */
  }
}

/** 诊断信息汇总文本（设置页一键复制用；不含 Token 等敏感字段） */
export function formatDiagnostics(lines: string[], errors: ErrLogEntry[]): string {
  const errText = errors.length
    ? errors
        .map(
          (x) =>
            `- [${new Date(x.at).toLocaleString('zh-CN')}] ${x.source}: ${x.message}${x.stack ? `\n  ${x.stack.split('\n')[1]?.trim() ?? ''}` : ''}`,
        )
        .join('\n')
    : '（无记录）'
  return [...lines, '', '最近错误：', errText].join('\n')
}
