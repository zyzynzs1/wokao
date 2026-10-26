import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
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
  onMark?: (start: number, end: number, color: string) => void
  onUnmark?: (start: number, end: number) => void
}

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(max, n))
}

// #rrggbb → rgba()，用于标注默认的半透明底色
function toRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
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
    const mark = covering[covering.length - 1]
    out.push(
      mark ? (
        <mark
          key={s}
          className="markable-hl"
          data-mark-start={mark.start}
          data-mark-end={mark.end}
          style={
            {
              '--mark-color': mark.color,
              '--mark-soft': toRgba(mark.color, 0.32)
            } as CSSProperties
          }
        >
          {seg}
        </mark>
      ) : (
        <span key={s}>{seg}</span>
      )
    )
  }
  return out
}

interface MenuState {
  x: number
  y: number
  start: number
  end: number
  existing: boolean
}

// 题干文字：左键拖选后用右键菜单标注；标注以半透明底色悬浮，悬停时实心显示
export default function MarkableText({
  text,
  field,
  marks,
  editable,
  color,
  onMark,
  onUnmark
}: Props): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // 右键时浏览器可能清空选区，这里在左键松开时先记一份
  const [pending, setPending] = useState<{ start: number; end: number } | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)

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

  // 选区必须完整落在本段文字内，跨段落不做处理
  const readSelection = (): { start: number; end: number } | null => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
    const range = sel.getRangeAt(0)
    const root = ref.current
    if (!root) return null
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
    const start = offsetOf(range.startContainer, range.startOffset)
    const end = offsetOf(range.endContainer, range.endOffset)
    if (start < 0 || end < 0 || end <= start) return null
    return { start, end }
  }

  const handleMouseUp = (ev: React.MouseEvent): void => {
    if (!editable || !onMark || ev.button !== 0) return
    setPending(readSelection())
  }

  const handleContextMenu = (ev: React.MouseEvent): void => {
    if (!editable || !onMark) return
    const sel = readSelection() ?? pending
    if (sel) {
      ev.preventDefault()
      setPending(sel)
      setMenu({ x: ev.clientX, y: ev.clientY, start: sel.start, end: sel.end, existing: false })
      return
    }
    // 右键点在已有标注上：允许改色或清除
    const el = (ev.target as HTMLElement).closest('mark[data-mark-start]')
    if (el) {
      ev.preventDefault()
      setPending(null)
      setMenu({
        x: ev.clientX,
        y: ev.clientY,
        start: Number(el.getAttribute('data-mark-start')),
        end: Number(el.getAttribute('data-mark-end')),
        existing: true
      })
    }
  }

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return
      setMenu(null)
    }
    const onScroll = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const applyMark = (c: string): void => {
    if (!menu) return
    onMark?.(menu.start, menu.end, c)
    setMenu(null)
    setPending(null)
    window.getSelection()?.removeAllRanges()
  }

  const clearMark = (): void => {
    if (!menu) return
    onUnmark?.(menu.start, menu.end)
    setMenu(null)
    setPending(null)
  }

  const fieldMarks = marks.filter((m) => m.field === field)
  const menuStyle: CSSProperties | undefined = menu
    ? {
        left: Math.min(menu.x, window.innerWidth - 250),
        top: Math.min(menu.y, window.innerHeight - 150)
      }
    : undefined

  return (
    <span
      ref={ref}
      className={editable ? 'markable markable-editable' : 'markable'}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
    >
      {renderSegments(text, fieldMarks)}
      {menu &&
        createPortal(
          <div ref={menuRef} className="mark-menu" style={menuStyle}>
            <div className="mark-menu-title">{menu.existing ? '已有标注' : '标注选中内容'}</div>
            <div className="mark-menu-colors">
              {MARK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`mark-menu-swatch${color?.toLowerCase() === c ? ' active' : ''}`}
                  style={{ backgroundColor: c }}
                  title="用该颜色标注"
                  onClick={() => applyMark(c)}
                />
              ))}
            </div>
            {menu.existing && onUnmark && (
              <button type="button" className="mark-menu-clear" onClick={clearMark}>
                清除标注
              </button>
            )}
          </div>,
          document.body
        )}
    </span>
  )
}
