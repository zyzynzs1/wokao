import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { ExamType, PracticeRecord, PredictionItem, Question, QuestionType } from '../../../shared/types'
import './home.css'

type TabKey = '国考' | '省考'

const FIVE_TYPES: QuestionType[] = ['归纳概括', '综合分析', '提出对策', '应用文写作', '文章论述']

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m <= 0) return `${s} 秒`
  return `${m} 分 ${s} 秒`
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function levelInfo(ratio: number | null): { label: string; cls: string; color: string } {
  if (ratio === null) return { label: '未练', cls: 'lv-0', color: '#9ca3af' }
  if (ratio >= 0.8) return { label: '优秀', cls: 'lv-4', color: '#16a34a' }
  if (ratio >= 0.6) return { label: '良好', cls: 'lv-3', color: '#2563eb' }
  if (ratio >= 0.4) return { label: '一般', cls: 'lv-2', color: '#f59e0b' }
  return { label: '薄弱', cls: 'lv-1', color: '#dc2626' }
}

// 五边形雷达图：给定 5 个得分率（0-1），返回顶点坐标串
function radarPoints(ratios: number[], cx: number, cy: number, r: number): string {
  return ratios
    .map((ratio, i) => {
      const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2
      const rr = ratio * r
      return `${(cx + rr * Math.cos(angle)).toFixed(1)},${(cy + rr * Math.sin(angle)).toFixed(1)}`
    })
    .join(' ')
}

function labelPos(
  i: number,
  cx: number,
  cy: number,
  r: number
): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } {
  const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2
  const lr = r + 26
  const x = cx + lr * Math.cos(angle)
  const y = cy + lr * Math.sin(angle)
  const anchor: 'start' | 'middle' | 'end' =
    Math.abs(Math.cos(angle)) < 0.3 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end'
  return { x, y, anchor }
}

export default function HomePage(): JSX.Element {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [predictions, setPredictions] = useState<PredictionItem[]>([])
  const [records, setRecords] = useState<PracticeRecord[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('国考')
  // 从结果页返回时带回 detail，直接恢复到原来的题型详情弹窗
  const [detail, setDetail] = useState<{ type: QuestionType; examType: ExamType } | null>(
    () =>
      (location.state as { detail?: { type: QuestionType; examType: ExamType } } | null)?.detail ??
      null
  )

  useEffect(() => {
    if (!user) return
    void window.api.getPredictions(user.id).then((p) => {
      setPredictions(p)
      setLoading(false)
    })
    void window.api.getRecords(user.id).then(setRecords)
    void window.api.getQuestions().then(setQuestions)
  }, [user])

  const items = predictions.filter((p) => p.examType === tab)
  const totalCount = predictions.reduce((s, p) => s + p.count, 0)
  const trainedCount = items.filter((p) => p.count > 0).length

  const itemMap = useMemo(() => {
    const map = new Map<QuestionType, PredictionItem>()
    for (const p of items) map.set(p.type, p)
    return map
  }, [items])

  const avgRatio = useMemo(() => {
    const trained = items.filter((p) => p.count > 0)
    if (trained.length === 0) return null
    return trained.reduce((s, p) => s + (p.avgRatio ?? 0), 0) / trained.length
  }, [items])

  const weakItems = useMemo(
    () => items.filter((p) => p.count > 0 && (p.avgRatio ?? 0) < 0.6).sort((a, b) => (a.avgRatio ?? 0) - (b.avgRatio ?? 0)),
    [items]
  )

  const detailRecords = useMemo(() => {
    if (!detail) return []
    const qMap = new Map(questions.map((q) => [q.id, q]))
    return records
      .filter((r) => {
        const q = qMap.get(r.questionId)
        return q && q.type === detail.type && q.examType === detail.examType
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [detail, records, questions])

  const detailMiss = useMemo(() => {
    const count = new Map<string, number>()
    for (const r of detailRecords) {
      for (const m of r.scoreResult.missSummary) count.set(m, (count.get(m) ?? 0) + 1)
    }
    return Array.from(count.entries()).sort((a, b) => b[1] - a[1])
  }, [detailRecords])

  const detailSuggestions = useMemo(() => {
    const set = new Set<string>()
    for (const r of detailRecords) for (const s of r.suggestions) if (s) set.add(s)
    return Array.from(set)
  }, [detailRecords])

  const detailStats = useMemo(() => {
    if (detailRecords.length === 0) return null
    const ratios = detailRecords.map((r) => r.scoreResult.ratio)
    return {
      count: detailRecords.length,
      avg: ratios.reduce((s, r) => s + r, 0) / ratios.length,
      max: Math.max(...ratios),
      min: Math.min(...ratios)
    }
  }, [detailRecords])

  const radarRatios = FIVE_TYPES.map((t) => itemMap.get(t)?.avgRatio ?? 0)
  const radarDataPoints = radarPoints(radarRatios, 180, 170, 118)

  return (
    <div>
      <div className="home-hero">
        <div>
          <h1 className="page-title" style={{ marginBottom: 6 }}>
            你好，{user?.nickname}
          </h1>
          <p className="home-sub">
            已累计作答 <b>{totalCount}</b> 次，掌握情况见下方能力图谱
          </p>
        </div>
        <div className="home-actions">
          <button className="btn btn-primary" onClick={() => navigate('/practice')}>
            ✍️ 开始练习
          </button>
          <button className="btn btn-outline" onClick={() => navigate('/history')}>
            查看历史
          </button>
        </div>
      </div>

      <div className="home-stats">
        <div className="stat-card">
          <div className="stat-num">{totalCount}</div>
          <div className="stat-label">累计作答</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{trainedCount}</div>
          <div className="stat-label">{tab}已练题型</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">
            {avgRatio !== null ? `${Math.round(avgRatio * 100)}%` : '—'}
          </div>
          <div className="stat-label">{tab}平均得分率</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{weakItems.length}</div>
          <div className="stat-label">待加强题型</div>
        </div>
      </div>

      <div className="card">
        <div className="home-section-title">
          <span>知识掌握程度</span>
          <span className="home-section-hint">基于历史作答的得分率生成，颜色越接近中心越薄弱</span>
        </div>

        <div className="home-tabs">
          {(['国考', '省考'] as ExamType[]).map((t) => (
            <button
              key={t}
              className={`home-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="empty">加载中…</div>
        ) : (
          <div className="mastery-grid">
            <div className="mastery-radar">
              <svg viewBox="-20 0 400 340" className="radar-svg" role="img" aria-label="五大题型掌握程度雷达图">
                {[0.2, 0.4, 0.6, 0.8, 1].map((lv) => (
                  <polygon
                    key={lv}
                    points={radarPoints([lv, lv, lv, lv, lv], 180, 170, 118)}
                    className="radar-grid"
                  />
                ))}
                {FIVE_TYPES.map((_, i) => {
                  const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2
                  const x = 180 + 118 * Math.cos(angle)
                  const y = 170 + 118 * Math.sin(angle)
                  return <line key={i} x1={180} y1={170} x2={x} y2={y} className="radar-axis" />
                })}
                <polygon points={radarDataPoints} className="radar-data" />
                {FIVE_TYPES.map((t, i) => {
                  const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2
                  const x = 180 + (radarRatios[i] ?? 0) * 118 * Math.cos(angle)
                  const y = 170 + (radarRatios[i] ?? 0) * 118 * Math.sin(angle)
                  return <circle key={t} cx={x} cy={y} r={3.5} className="radar-dot" />
                })}
                {FIVE_TYPES.map((t, i) => {
                  const p = labelPos(i, 180, 170, 118)
                  return (
                    <text key={t} x={p.x} y={p.y} textAnchor={p.anchor} className="radar-label">
                      {t}
                    </text>
                  )
                })}
              </svg>
            </div>

            <div className="mastery-list">
              {FIVE_TYPES.map((t) => {
                const p = itemMap.get(t)
                const ratio = p?.avgRatio ?? null
                const lv = levelInfo(ratio)
                return (
                  <div key={t} className="mastery-row">
                    <div className="mastery-row-head">
                      <span className="mastery-type">{t}</span>
                      <span className={`mastery-level ${lv.cls}`}>{lv.label}</span>
                    </div>
                    <div className="mastery-bar">
                      <div
                        className="mastery-bar-fill"
                        style={{ width: `${((ratio ?? 0) * 100).toFixed(0)}%`, background: lv.color }}
                      />
                    </div>
                    <div className="mastery-meta">
                      <span>{ratio === null ? '暂无记录' : `得分率 ${(ratio * 100).toFixed(0)}%`}</span>
                      <span>练习 {p?.count ?? 0} 次</span>
                      {(p?.count ?? 0) > 0 && (
                        <button
                          className="mastery-detail-btn"
                          onClick={() => setDetail({ type: t, examType: tab })}
                        >
                          查看详情 →
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {!loading && weakItems.length > 0 && (
        <div className="card home-suggest">
          <div className="home-section-title">
            <span>💪 建议优先加强</span>
          </div>
          <p className="home-suggest-text">
            {weakItems.map((w) => `${w.type}（${(w.avgRatio! * 100).toFixed(0)}%）`).join('、')}
            ，建议针对性练习薄弱题型。
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/practice')}>
            去练习 →
          </button>
        </div>
      )}

      {detail && (
        <div className="detail-overlay" onClick={() => setDetail(null)}>
          <div className="detail-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="detail-head">
              <span className="detail-title">
                {detail.type} · {detail.examType} 掌握详情
              </span>
              <button className="detail-close" onClick={() => setDetail(null)}>
                ×
              </button>
            </div>
            <div className="detail-body">
              {!detailStats ? (
                <div className="empty">暂无该题型的作答记录</div>
              ) : (
                <>
                  <div className="detail-stats">
                    <div className="detail-stat">
                      <div className="detail-stat-num">{detailStats.count}</div>
                      <div className="detail-stat-label">作答次数</div>
                    </div>
                    <div className="detail-stat">
                      <div className="detail-stat-num">{(detailStats.avg * 100).toFixed(0)}%</div>
                      <div className="detail-stat-label">平均得分率</div>
                    </div>
                    <div className="detail-stat">
                      <div className="detail-stat-num">{(detailStats.max * 100).toFixed(0)}%</div>
                      <div className="detail-stat-label">最高得分率</div>
                    </div>
                    <div className="detail-stat">
                      <div className="detail-stat-num">{(detailStats.min * 100).toFixed(0)}%</div>
                      <div className="detail-stat-label">最低得分率</div>
                    </div>
                  </div>

                  {detailMiss.length > 0 && (
                    <div className="detail-section">
                      <h4 className="detail-section-title">⚠️ 常见失分点（按出现次数排序）</h4>
                      <ul className="detail-list">
                        {detailMiss.slice(0, 8).map(([text, n], i) => (
                          <li key={i}>
                            <span className="detail-list-text">{text}</span>
                            <span className="detail-list-count">{n} 次</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {detailSuggestions.length > 0 && (
                    <div className="detail-section">
                      <h4 className="detail-section-title">📈 增长提高建议</h4>
                      <ul className="detail-list">
                        {detailSuggestions.slice(0, 8).map((s, i) => (
                          <li key={i}>
                            <span className="detail-list-text">{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="detail-section">
                    <h4 className="detail-section-title">📋 过往作答记录</h4>
                    <div className="detail-records">
                      {detailRecords.slice(0, 20).map((r) => (
                        <div
                          key={r.id}
                          className="detail-record"
                          onClick={() =>
                            navigate(`/practice/result/${r.id}`, {
                              state: {
                                from: '/',
                                detail: { type: detail.type, examType: detail.examType }
                              }
                            })
                          }
                          title="查看这次作答的完整详情"
                        >
                          <span className="detail-record-date">{formatDate(r.createdAt)}</span>
                          <span className="detail-record-score">
                            {r.scoreResult.score}/{r.scoreResult.totalScore} 分
                          </span>
                          <span className="detail-record-ratio">
                            {(r.scoreResult.ratio * 100).toFixed(0)}%
                          </span>
                          <span className="detail-record-time">
                            {formatDuration(r.durationSeconds)}
                          </span>
                          <span className="detail-record-go">查看详情 →</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
