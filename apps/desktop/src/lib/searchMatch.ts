/** Literal, Unicode-aware matching; offsets always refer to the original text. */
export function searchMatch(text: string, query: string): { start: number; end: number } | null {
  if (!query) return null
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(escaped, 'iu').exec(text)

  return match ? { start: match.index, end: match.index + match[0].length } : null
}
