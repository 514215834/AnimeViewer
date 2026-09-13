/** v0.16 剪贴板小工具：navigator.clipboard 失败（非安全上下文 / 权限拒绝）时退回 textarea 方案 */
export const clipboard = {
  async write(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      /* 落入隐藏 textarea 兜底 */
    }
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } finally {
      document.body.removeChild(ta)
    }
  },
}
