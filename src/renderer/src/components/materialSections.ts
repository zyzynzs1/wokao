import type { Question } from '../../../shared/types'

export interface MaterialSection {
  title: string
  text: string
  offset: number
}

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const cn = (n: number): string => CN_NUM[n - 1] ?? String(n)

function trimSection(full: string, start: number, end: number): MaterialSection | null {
  const raw = full.slice(start, end)
  const text = raw.trim()
  if (!text) return null
  const leading = raw.length - raw.trimStart().length
  return { title: '', text, offset: start + leading }
}

/**
 * 大作文/全卷材料：优先按同卷前面几题的材料边界，把当前材料拆成多则。
 * 拆分不上时退回单段材料，不显示 tab，保证不会因为推断失败而少显示内容。
 */
export function splitMaterialSections(
  question: Question,
  allQuestions: Question[]
): MaterialSection[] {
  const full = question.material ?? ''
  if (!full) return []
  const fallback = (): MaterialSection[] => {
    const one = trimSection(full, 0, full.length)
    return one ? [one] : []
  }
  const others = allQuestions.filter(
    (q) => q.id !== question.id && q.material && q.material.trim()
  )
  if (question.type !== '文章论述' || others.length === 0) return fallback()

  const ranges: { start: number; end: number }[] = []
  let cursor = 0
  for (const other of others) {
    const idx = full.indexOf(other.material, cursor)
    if (idx < 0) continue
    if (idx > cursor) ranges.push({ start: cursor, end: idx })
    ranges.push({ start: idx, end: idx + other.material.length })
    cursor = idx + other.material.length
  }
  if (cursor < full.length) ranges.push({ start: cursor, end: full.length })

  const sections = ranges
    .map((r) => trimSection(full, r.start, r.end))
    .filter((s): s is MaterialSection => !!s)
  if (sections.length < 2) return fallback()
  return sections.map((s, i) => ({ ...s, title: `材料${cn(i + 1)}` }))
}
