import { useEffect, useMemo, useRef } from 'react'
import './lined-paper.css'

interface LinedPaperProps {
  value: string
  onChange: (v: string) => void
  wordLimit: number
  placeholder?: string
}

// 作答区横格纸：随内容自动增高，带字数统计
export default function LinedPaper({
  value,
  onChange,
  wordLimit,
  placeholder
}: LinedPaperProps): JSX.Element {
  const count = useMemo(() => value.replace(/\s/g, '').length, [value])
  const over = wordLimit > 0 && count > wordLimit

  const wrapRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // 随内容自动增高，避免内部滚动导致横线与文字错位
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  const handleFocus = (): void => {
    // 手机上键盘弹出不压缩视口，把作答区滚到顶部，避免光标被输入法遮挡
    if (!document.documentElement.classList.contains('mobile')) return
    requestAnimationFrame(() => wrapRef.current?.scrollIntoView({ block: 'start' }))
  }

  return (
    <div className="lined-wrap" ref={wrapRef}>
      <div className="lined-paper">
        <textarea
          ref={taRef}
          className="lined-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={handleFocus}
          placeholder={placeholder ?? '在此作答……'}
          spellCheck={false}
        />
      </div>
      <div className={`lined-footer${over ? ' over' : ''}`}>
        <span>已写 {count} 字</span>
        {wordLimit > 0 && (
          <span>
            限 {wordLimit} 字{over && ' · 已超字数'}
          </span>
        )}
      </div>
    </div>
  )
}
