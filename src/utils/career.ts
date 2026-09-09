/** 人物 career 中文标签（兼容 API 返回的中文值与 OpenAPI 规范声明的英文值） */
const CAREER_LABELS: Record<string, string> = {
  声优: '🎙 声优',
  seiyu: '🎙 声优',
  艺术家: '🎵 艺术家',
  artist: '🎵 艺术家',
  演员: '🎭 演员',
  actor: '🎭 演员',
  导演: '🎬 导演',
  制片人: '💼 制片人',
  producer: '💼 制片人',
  写手: '✍️ 写手',
  writer: '✍️ 写手',
  漫画家: '📝 漫画家',
  mangaka: '📝 漫画家',
  插画家: '🎨 插画家',
  illustrator: '🎨 插画家',
}

export function careerLabel(c: string): string {
  return CAREER_LABELS[c] ?? c
}
