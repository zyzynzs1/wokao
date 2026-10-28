import { useCallback, useEffect, useRef, useState } from 'react'
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
  color?: string // 当前标记颜色（左键拖选后自动使用该颜色）
  onMark?: (start: number, end: number, color: string) => void
  onUnmark?: (start: number, end: number) => void
  onNote?: (start: number, end: number, note: string) => void
  onRemove?: (start: number, end: number) => void
}

interface Anchor {
  left: number
  top: number
  bottom: number
}

interface MenuState {
  x: number
  y: number
  start: number
  end: number
  existing: boolean
}

interface EditorState {
  x: number
  y: number
  start: number
  end: number
  note: string
  existing: boolean
}

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(max, n))
}

// #rrggbb → rgba()，仅用于旧版纯色高亮
function toRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function markKey(m: { start: number; end: number }): string {
  return `${m.start}-${m.end}`
}

// 题干文字：左键拖选即用当前颜色标注；右键可加笔记/改色/清除。
// 笔记以半透明便签悬浮在选区上方，悬停变实心。
export default function MarkableText({
  text,
  field,
  marks,
  editable,
  color,
  onMark,
  onUnmark,
  onNote,
  onRemove
}: Props): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const noteEls = useRef<Map<string, HTMLElement>>(new Map())
  // 右键时浏览器可能清空选区，这里在左键松开时先记一份
  const [pending, setPending] = useState<{ start: number; end: number } | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [anchors, setAnchors] = useState<Record<string, Anchor>>({})
  const [hoverKey, setHoverKey] = useState<string | null>(null)

  const fieldMarks = marks.filter((m) => m.field === field && m.end > m.start)

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
    if (!editable || ev.button !== 0) return
    const sel = readSelection()
    setPending(sel)
    // 左键拖选后立即用当前颜色标注（不切换/不取消，改色和清除走右键菜单）
    if (sel && onMark) {
      onMark(sel.start, sel.end, color || MARK_COLORS[0])
    }
  }

  const handleContextMenu = (ev: React.MouseEvent): void => {
    if (!editable) return
    const sel = readSelection() ?? pending
    if (sel) {
      ev.preventDefault()
      setPending(sel)
      setMenu({ x: ev.clientX, y: ev.clientY, start: sel.start, end: sel.end, existing: false })
      return
    }
    // 右键点在已有笔记上：允许编辑或删除
    const el = (ev.target as HTMLElement).closest('mark[data-mark-start]')
    if (el) {
      const start = Number(el.getAttribute('data-mark-start'))
      const end = Number(el.getAttribute('data-mark-end'))
      if (Number.isFinite(start) && Number.isFinite(end)) {
        ev.preventDefault()
        setPending(null)
        setMenu({ x: ev.clientX, y: ev.clientY, start, end, existing: true })
      }
    }
  }

  // 测量每条笔记首个文字片段的位置，用于放置悬浮便签
  const measure = useCallback((): void => {
    const next: Record<string, Anchor> = {}
    noteEls.current.forEach((el, key) => {
      const r = el.getBoundingClientRect()
      next[key] = { left: r.left, top: r.top, bottom: r.bottom }
    })
    setAnchors(next)
  }, [])

  useEffect(() => {
    measure()
    const id = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(id)
  }, [measure, text, marks])

  useEffect(() => {
    let raf = 0
    const schedule = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        measure()
      })
    }
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [measure])

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

  useEffect(() => {
    if (!editor) return
    const onDown = (e: MouseEvent): void => {
      if (editorRef.current && editorRef.current.contains(e.target as Node)) return
      setEditor(null)
      setPending(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [editor])

  const openEditor = (fromCard?: HighlightMark): void => {
    if (fromCard) {
      const a = anchors[markKey(fromCard)]
      setEditor({
        x: a ? a.left : window.innerWidth / 2 - 140,
        y: a ? a.bottom + 8 : window.innerHeight / 2 - 100,
        start: fromCard.start,
        end: fromCard.end,
        note: fromCard.note ?? '',
        existing: true
      })
      setMenu(null)
      return
    }
    if (!menu) return
    const found = fieldMarks.find((m) => m.start === menu.start && m.end === menu.end)
    setEditor({
      x: menu.x,
      y: menu.y,
      start: menu.start,
      end: menu.end,
      note: found?.note ?? '',
      existing: menu.existing
    })
    setMenu(null)
  }

  const saveNote = (): void => {
    if (!editor) return
    const note = editor.note.trim()
    if (!note) {
      // 内容被清空后保存，视为取消这条笔记
      const target = fieldMarks.find((m) => m.start === editor.start && m.end === editor.end)
      if (target?.note) onRemove?.(editor.start, editor.end)
      setEditor(null)
      setPending(null)
      window.getSelection()?.removeAllRanges()
      return
    }
    onNote?.(editor.start, editor.end, note)
    setEditor(null)
    setPending(null)
    window.getSelection()?.removeAllRanges()
  }

  const menuMark = menu
    ? fieldMarks.find((m) => m.start === menu.start && m.end === menu.end)
    : undefined

  const applyColor = (c: string): void => {
    if (!menu) return
    onMark?.(menu.start, menu.end, c)
    setMenu(null)
    setPending(null)
    window.getSelection()?.removeAllRanges()
  }

  const clearColor = (): void => {
    if (!menu) return
    onUnmark?.(menu.start, menu.end)
    setMenu(null)
    setPending(null)
  }

  const removeNote = (): void => {
    if (!editor) return
    onRemove?.(editor.start, editor.end)
    setEditor(null)
    setPending(null)
  }

  // 按标记端点切段；同一区间重叠时，后添加的笔记覆盖先前标记
  const renderSegments = (): JSX.Element[] => {
    const valid = fieldMarks
      .map((m) => ({ ...m, start: clamp(m.start, text.length), end: clamp(m.end, text.length) }))
      .filter((m) => m.end > m.start)
    if (valid.length === 0) return [<span key="plain">{text}</span>]

    const points = new Set<number>([0, text.length])
    for (const m of valid) {
      points.add(m.start)
      points.add(m.end)
    }
    const sorted = [...points].sort((a, b) => a - b)
    const attached = new Set<string>()

    const out: JSX.Element[] = []
    for (let i = 0; i < sorted.length - 1; i++) {
      const s = sorted[i]
      const e = sorted[i + 1]
      const seg = text.slice(s, e)
      if (!seg) continue
      const covering = valid.filter((m) => m.start <= s && m.end >= e)
      const mark = covering[covering.length - 1]
      if (!mark) {
        out.push(<span key={s}>{seg}</span>)
        continue
      }
      const key = markKey(mark)
      const hasNote = !!mark.note && mark.note.trim() !== ''
      const hasColor = !!mark.color
      const isFirst = hasNote && !attached.has(key)
      if (isFirst) attached.add(key)
      const className = hasNote ? `markable-note${hasColor ? ' has-color' : ''}` : 'markable-hl'
      out.push(
        <mark
          key={s}
          className={className}
          data-mark-start={mark.start}
          data-mark-end={mark.end}
          ref={
            isFirst
              ? (el) => {
                  if (el) noteEls.current.set(key, el)
                  else noteEls.current.delete(key)
                }
              : undefined
          }
          style={
            hasColor
              ? ({
                  '--mark-color': mark.color,
                  '--mark-soft': toRgba(mark.color!, 0.32)
                } as CSSProperties)
              : undefined
          }
          onMouseEnter={hasNote ? () => setHoverKey(key) : undefined}
          onMouseLeave={hasNote ? () => setHoverKey(null) : undefined}
        >
          {seg}
        </mark>
      )
    }
    return out
  }

  const menuStyle: CSSProperties | undefined = menu
    ? {
        left: Math.min(menu.x, window.innerWidth - 240),
        top: Math.min(menu.y, window.innerHeight - 120)
      }
    : undefined

  const editorStyle: CSSProperties | undefined = editor
    ? {
        left: Math.max(8, Math.min(editor.x, window.innerWidth - 308)),
        top: Math.max(8, Math.min(editor.y, window.innerHeight - 260))
      }
    : undefined

  const noteMarks = fieldMarks.filter((m) => (m.note ?? '').trim() !== '')

  return (
    <span
      ref={ref}
      className={editable ? 'markable markable-editable' : 'markable'}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
    >
      {renderSegments()}

      {noteMarks.map((m) => {
        const key = markKey(m)
        const a = anchors[key]
        if (!a) return null
        // 选区滚出视口时不显示便签，避免便签吸附在窗口边缘
        if (a.bottom < 0 || a.top > window.innerHeight) return null
        const below = a.top < 150
        const style: CSSProperties = {
          left: Math.max(8, Math.min(a.left, window.innerWidth - 272)),
          top: below ? a.bottom + 8 : Math.max(8, a.top - 42)
        }
        return createPortal(
          <div
            key={`note-${key}`}
            className={`mark-note-card${hoverKey === key ? ' is-solid' : ''}`}
            style={style}
            onMouseEnter={() => setHoverKey(key)}
            onMouseLeave={() => setHoverKey(null)}
            onClick={() => editable && openEditor(m)}
            title={editable ? '点击编辑笔记' : m.note}
          >
            <span className="mark-note-text">{m.note}</span>
          </div>,
          document.body
        )
      })}

      {menu &&
        createPortal(
          <div ref={menuRef} className="mark-menu" style={menuStyle}>
            <div className="mark-menu-title">
              {menuMark ? '已有标注' : `选中 ${menu.end - menu.start} 个字`}
            </div>
            {onMark && (
              <>
                <div className="mark-menu-subtitle">标记颜色</div>
                <div className="mark-menu-colors">
                  {MARK_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`mark-menu-swatch${
                        (menuMark?.color ?? color ?? '').toLowerCase() === c ? ' active' : ''
                      }`}
                      style={{ backgroundColor: c }}
                      title="用该颜色标注"
                      onClick={() => applyColor(c)}
                    />
                  ))}
                </div>
              </>
            )}
            {onNote && (
              <button type="button" className="mark-menu-item" onClick={() => openEditor()}>
                {menuMark?.note ? '编辑笔记' : '添加笔记'}
              </button>
            )}
            {menuMark && onUnmark && menuMark.color && (
              <button type="button" className="mark-menu-item" onClick={clearColor}>
                清除颜色
              </button>
            )}
            {menuMark && onRemove && menuMark.note && (
              <button
                type="button"
                className="mark-menu-clear"
                onClick={() => {
                  onRemove(menu.start, menu.end)
                  setMenu(null)
                }}
              >
                删除笔记
              </button>
            )}
          </div>,
          document.body
        )}

      {editor &&
        createPortal(
          <div ref={editorRef} className="mark-editor" style={editorStyle}>
            <div className="mark-editor-title">{editor.existing ? '编辑笔记' : '添加笔记'}</div>
            <textarea
              className="mark-editor-input"
              autoFocus
              rows={4}
              value={editor.note}
              placeholder="记录关键词，方便复习时快速回忆…"
              onChange={(e) => setEditor({ ...editor, note: e.target.value })}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  saveNote()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setEditor(null)
                  setPending(null)
                }
              }}
            />
            <div className="mark-editor-actions">
              <span className="mark-editor-tip">
                {editor.existing ? '清空内容后保存即删除笔记 · Ctrl + Enter' : 'Ctrl + Enter 保存'}
              </span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!editor.note.trim() && !editor.existing}
                onClick={saveNote}
              >
                保存
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => {
                  setEditor(null)
                  setPending(null)
                }}
              >
                取消
              </button>
            </div>
          </div>,
          document.body
        )}
    </span>
  )
}
