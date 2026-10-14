import { useEffect, useMemo, useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { PracticeRecord, PracticeType, Question } from '../../../shared/types'
import './history.css'

const PRACTICE_TABS: (PracticeType | '全部')[] = [
  '全部',
  '随机练习',
  '整卷练习',
  '真题练习',
  '知识点练习',
  '重新练习'
]

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m <= 0) return `${s} 秒`
  return `${m} 分 ${s} 秒`
}

export default function HistoryPage(): JSX.Element {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [records, setRecords] = useState<PracticeRecord[]>([])
  const [questions, setQuestions] = useState<Record<string, Question>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<PracticeType | '全部'>('全部')
  // 删除菜单：电脑端右键、手机端长按触发
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const pressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)
  const isMobile = document.documentElement.classList.contains('mobile')

  useEffect(() => {
    if (!user) return
    void window.api.getRecords(user.id).then((rs) => {
      setRecords(rs)
      setLoading(false)
    })
    void window.api.getQuestions().then((qs) => {
      const map: Record<string, Question> = {}
      for (const q of qs) map[q.id] = q
      setQuestions(map)
    })
  }, [user])

  const formatDate = (ts: number): string => {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  const filteredRecords = useMemo(
    () => (filter === '全部' ? records : records.filter((r) => r.practiceType === filter)),
    [records, filter]
  )

  const grouped = useMemo(() => {
    const byPaper = new Map<string, PracticeRecord[]>()
    const singles: PracticeRecord[] = []
    for (const r of filteredRecords) {
      if (r.paperId) {
        byPaper.set(r.paperId, [...(byPaper.get(r.paperId) ?? []), r])
      } else {
        singles.push(r)
      }
    }
    return { byPaper, singles }
  }, [filteredRecords])

  const repractice = (record: PracticeRecord): void => {
    navigate('/practice/answer', {
      state: { mode: '重新练习', questionIds: [record.questionId] }
    })
  }

  // 菜单打开后，点击空白处 / 滚动 / 改变窗口大小都关闭它
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  const openMenu = (id: string, x: number, y: number): void => {
    // 收进视口内，避免菜单跑到屏幕外
    setMenu({
      id,
      x: Math.min(x, window.innerWidth - 150),
      y: Math.min(y, window.innerHeight - 56)
    })
  }

  const cancelPress = (): void => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  const onTouchStart = (id: string) => (e: ReactTouchEvent): void => {
    if (!isMobile || e.touches.length > 1) return
    longPressed.current = false
    const { clientX, clientY } = e.touches[0]
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true
      openMenu(id, clientX, clientY)
    }, 550)
  }

  const onTouchEnd = (e: ReactTouchEvent): void => {
    cancelPress()
    // 长按已触发时吞掉后续的 click，避免菜单刚弹出就被关闭
    if (longPressed.current) e.preventDefault()
  }

  const removeRecord = (id: string): void => {
    setMenu(null)
    if (!window.confirm('确定删除这条作答记录吗？删除后不可恢复。')) return
    void window.api.deleteRecord(id).then(() => {
      setRecords((rs) => rs.filter((r) => r.id !== id))
    })
  }

  const renderRecord = (r: PracticeRecord): JSX.Element => {
    const q = questions[r.questionId]
    const isOpen = expanded === r.id
    const hit = r.scoreResult.pointResults.filter((p) => p.got > 0)
    const miss = r.scoreResult.pointResults.filter((p) => p.got < p.score)
    return (
      <div key={r.id} className="history-item">
        <div
          className="history-row"
          onClick={() => {
            // 长按刚触发过则跳过这次展开/收起
            if (longPressed.current) {
              longPressed.current = false
              return
            }
            setExpanded(isOpen ? null : r.id)
          }}
          onContextMenu={(e) => {
            if (isMobile) return
            e.preventDefault()
            openMenu(r.id, e.clientX, e.clientY)
          }}
          onTouchStart={onTouchStart(r.id)}
          onTouchEnd={onTouchEnd}
          onTouchMove={cancelPress}
          onTouchCancel={cancelPress}
        >
          <div className="history-main">
            <div className="history-tags">
              <span className="tag tag-blue">{q?.type ?? '—'}</span>
              <span className="tag tag-gray">{r.practiceType}</span>
              {q && <span className="tag tag-green">{q.examType} · {q.subType}</span>}
            </div>
            <div className="history-title">{q?.title ?? '（题目已删除）'}</div>
            <div className="history-time">
              {formatDate(r.createdAt)} · 用时 {formatDuration(r.durationSeconds)}
            </div>
          </div>
          <div className="history-side">
            <div className="history-score">
              {r.scoreResult.score}
              <span className="history-score-total">/{r.scoreResult.totalScore}</span>
            </div>
            <div className="history-ratio">{(r.scoreResult.ratio * 100).toFixed(0)}%</div>
          </div>
          <span className="history-caret">{isOpen ? '▴' : '▾'}</span>
        </div>

        {isOpen && (
          <div className="history-detail">
            {hit.length > 0 && (
              <div className="history-detail-block">
                <div className="history-detail-label">✅ 得分点</div>
                <div className="history-points">
                  {hit.map((p) => (
                    <span key={p.pointId} className="history-point hit">
                      {p.label}（+{p.got}）
                    </span>
                  ))}
                </div>
              </div>
            )}
            {miss.length > 0 && (
              <div className="history-detail-block">
                <div className="history-detail-label">❌ 扣分点</div>
                <div className="history-points">
                  {miss.map((p) => (
                    <span key={p.pointId} className="history-point miss">
                      {p.label}（-{p.score - p.got}）
                    </span>
                  ))}
                </div>
              </div>
            )}
            {r.dimensions && r.dimensions.length > 0 && (
              <div className="history-detail-block">
                <div className="history-detail-label">📊 细分得分</div>
                <div className="history-dims">
                  {r.dimensions.map((d) => (
                    <span key={d.name} className="history-dim">
                      {d.name} {d.got}/{d.full}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {r.losses && r.losses.length > 0 && (
              <div className="history-detail-block">
                <div className="history-detail-label">🔍 主要失分点</div>
                <ul className="history-losses">
                  {r.losses.map((l, i) => (
                    <li key={i}>
                      <b>{l.title}</b>
                      {l.reason ? `：${l.reason}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.feedback && (
              <div className="history-detail-block">
                <div className="history-detail-label">💬 点评</div>
                <div className="history-feedback">{r.feedback}</div>
              </div>
            )}
            {r.suggestions.length > 0 && (
              <div className="history-detail-block">
                <div className="history-detail-label">📌 建议</div>
                <ul className="history-suggestions">
                  {r.suggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="history-detail-actions">
              <button className="btn btn-outline btn-sm" onClick={() => navigate(`/practice/result/${r.id}`)}>
                查看完整结果
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => repractice(r)}>
                🔁 重新练习
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const flatRecords = useMemo(
    () => [...grouped.singles, ...Array.from(grouped.byPaper.values()).flat()],
    [grouped]
  )

  return (
    <div>
      <h1 className="page-title">历史记录</h1>
      {!loading && records.length > 0 && (
        <p className="history-hint">{isMobile ? '长按记录可删除' : '右键记录可删除'}</p>
      )}
      {loading ? (
        <div className="empty">加载中…</div>
      ) : records.length === 0 ? (
        <div className="card empty">
          还没有作答记录，去「练习」做一道题吧。
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={() => navigate('/practice')}>
              开始练习
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="history-tabs">
            {PRACTICE_TABS.map((t) => (
              <button
                key={t}
                className={`history-tab${filter === t ? ' active' : ''}`}
                onClick={() => setFilter(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {flatRecords.length === 0 ? (
            <div className="card empty">该分类暂无作答记录</div>
          ) : (
            <div className="history-list">{flatRecords.map(renderRecord)}</div>
          )}
        </>
      )}
      {menu && (
        <div
          className="history-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button className="history-menu-item danger" onClick={() => removeRecord(menu.id)}>
            🗑 删除记录
          </button>
        </div>
      )}
    </div>
  )
}
