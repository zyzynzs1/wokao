import type { Question } from '../../../shared/types'

export interface MaterialSection {
  title: string
  text: string
  offset: number
}

function trimSection(full: string, start: number, end: number): MaterialSection | null {
  const raw = full.slice(start, end)
  const text = raw.trim()
  if (!text) return null
  const leading = raw.length - raw.trimStart().length
  return { title: '', text, offset: start + leading }
}

// 兼容「材料一 / 材料1 / 给定资料一 / 给定资料1」等真题和整理稿写法。
// 只识别位于行首的标题，避免把正文中的“根据给定资料1”误判为分则。
const HEADING_RE = /(^|\r?\n)[ \t]*(?:给定资料|材料)[ \t]*([一二三四五六七八九十百\d]+)[ \t]*(?:[：:、.．])?[ \t]*(?=\r?\n|$)/g

interface HeadingMatch {
  index: number
  end: number
}

function findHeadings(full: string): HeadingMatch[] {
  const matches: HeadingMatch[] = []
  let m: RegExpExecArray | null
  HEADING_RE.lastIndex = 0
  while ((m = HEADING_RE.exec(full)) !== null) {
    matches.push({ index: m.index, end: m.index + m[0].length })
  }
  return matches
}

/**
 * 给定资料拆分：
 * 1. 优先按材料正文里的「材料一 / 给定资料1」标题分则；
 * 2. 若整卷材料没有标题，但存在同卷其他题目材料，则按同卷材料边界兜底；
 * 3. 仍无法拆分时退回单段，保证内容不丢失。
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

  // 1) 标题式分则（小题、整卷材料都适用）
  const headings = findHeadings(full)
  if (headings.length >= 2) {
    const sections: MaterialSection[] = []
    headings.forEach((heading, i) => {
      const end = headings[i + 1]?.index ?? full.length
      const section = trimSection(full, heading.end, end)
      if (section) {
        sections.push({ ...section, title: `给定资料${i + 1}` })
      }
    })
    if (sections.length >= 2) return sections
  }

  // 2) 旧数据兜底：整卷大作文材料由同卷各题材料拼接，按边界拆分
  if (question.type !== '文章论述') return fallback()
  const others = allQuestions.filter(
    (q) => q.id !== question.id && q.material && q.material.trim()
  )
  if (others.length === 0) return fallback()

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
  return sections.map((s, i) => ({ ...s, title: `给定资料${i + 1}` }))
}
