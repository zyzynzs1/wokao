import { useRef } from 'react'
import type { HighlightMark } from '../../../shared/types'
import './markable.css'

// 预设标记颜色（顺序即切换顺序，可用 Q/E 左右切换）
export const MARK_COLORS = [
  '#fff3a3', // 黄
  '#b7f0c2', // 绿
  '#b3dcff', // 蓝
  '#ffc9dd', // 粉
  '#e0c9ff', // 紫
  '#ffd9a8', // 橙
  '#a8ecf0', // 青
  '#d6e9a8', // 黄绿
  '#ffb3b3', // 红
  '#c9d6ff', // 蓝紫
  '#e8c9a8', // 棕
  '#d5d8dd' // 灰
]

interface Props {
  text: string
  field: HighlightMark['field']
  marks: HighlightMark[]
  editable?: boolean
  color?: string
  onMark?: (start: number, end: number) => void
}

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(max, n))
}

// 把文本按标记切段渲染；区间重叠时，后添加的标记覆盖先前的
function renderSegments(text: string, marks: HighlightMark[]): JSX.Element[] {
  const valid = marks
    .map((m) => ({ ...m, start: clamp(m.start, text.length), end: clamp(m.end, text.length) }))
    .filter((m) => m.end > m.start)
  if (valid.length === 0) return [<span key="plain">{text}</span>]

  const points = new Set<number>([0, text.length])
  for (const m of valid) {
    points.add(m.start)
    points.add(m.end)
  }
  const sorted = [...points].sort((a, b) => a - b)

  const out: JSX.Element[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i]
    const e = sorted[i + 1]
    const seg = text.slice(s, e)
    if (!seg) continue
    const covering = valid.filter((m) => m.start <= s && m.end >= e)
    const color = covering.length > 0 ? covering[covering.length - 1].color : ''
    out.push(
      color ? (
        <mark key={s} style={{ backgroundColor: color }}>
          {seg}
        </mark>
      ) : (
        <span key={s}>{seg}</span>
      )
    )
  }
  return out
}

// 题干文字：支持左键拖选标记（editable），完成后以只读方式回显
export default function MarkableText({
  text,
  field,
  marks,
  editable,
  color,
  onMark
}: Props): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)

  // 把选区端点换算成容器纯文本中的字符下标
  const offsetOf = (node: Node, offset: number): number => {
    const root = ref.current
    if (!root) return -1
    let total = 0
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let cur = walker.nextNode()
    while (cur) {
      if (cur === node) return total + offset
      total += (cur.textContent ?? '').length
      cur = walker.nextNode()
    }
    return -1
  }

  const handleMouseUp = (): void => {
    if (!editable || !onMark || !color) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const root = ref.current
    if (!root) return
    // 选区必须完整落在本段文字内，跨段落不做处理
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return
    const start = offsetOf(range.startContainer, range.startOffset)
    const end = offsetOf(range.endContainer, range.endOffset)
    if (start < 0 || end < 0 || end <= start) return
    onMark(start, end)
    sel.removeAllRanges()
  }

  const fieldMarks = marks.filter((m) => m.field === field)

  return (
    <span
      ref={ref}
      className={editable ? 'markable markable-editable' : 'markable'}
      onMouseUp={handleMouseUp}
    >
      {renderSegments(text, fieldMarks)}
    </span>
  )
}
