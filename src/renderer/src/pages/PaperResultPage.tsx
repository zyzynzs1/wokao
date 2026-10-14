import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { PracticeRecord, Question } from '../../../shared/types'
import './paper-result.css'

interface PaperResultState {
  paperTitle?: string
  records: PracticeRecord[]
}

export default function PaperResultPage(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as PaperResultState | null
  const [questions, setQuestions] = useState<Record<string, Question>>({})

  const records = state?.records ?? []

  useEffect(() => {
    if (!records.length) return
    void Promise.all(
      records.map((r) => window.api.getQuestion(r.questionId).then((q) => q && [r.questionId, q]))
    ).then((pairs) => {
      const map: Record<string, Question> = {}
      for (const pair of pairs) {
        if (pair) map[pair[0] as string] = pair[1] as Question
      }
      setQuestions(map)
    })
  }, [records.length])

  if (records.length === 0) {
    return <div className="empty">暂无结果</div>
  }

  const totalScore = records.reduce((s, r) => s + r.scoreResult.score, 0)
  const totalFull = records.reduce((s, r) => s + r.scoreResult.totalScore, 0)

  return (
    <div className="paper-result">
      <button className="btn btn-outline btn-sm" onClick={() => navigate('/practice')}>
        ← 返回练习
      </button>

      <div className="card paper-result-head">
        <h2 className="paper-result-title">{state?.paperTitle ?? '整卷练习结果'}</h2>
        <div className="paper-result-score">
          {totalScore}
          <span className="paper-result-total"> / {totalFull} 分</span>
        </div>
        <div className="paper-result-ratio">
          总得分率 {totalFull > 0 ? ((totalScore / totalFull) * 100).toFixed(0) : 0}%
        </div>
      </div>

      <div className="card">
        <h3 className="paper-result-section">各题得分</h3>
        <div className="paper-result-list">
          {records.map((r, i) => {
            const q = questions[r.questionId]
            return (
              <div
                key={r.id}
                className="paper-result-row"
                onClick={() => navigate(`/practice/result/${r.id}`)}
              >
                <span className="paper-result-index">{i + 1}</span>
                <span className="tag tag-blue">{q?.type ?? '—'}</span>
                <span className="paper-result-qtitle">{q?.title ?? ''}</span>
                <span className="paper-result-qscore">
                  {r.scoreResult.score} / {r.scoreResult.totalScore}
                </span>
                <span className="paper-result-arrow">→</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="paper-result-tip">
        点击任意一题可查看详细的得分点、扣分点与点评。本次整卷的作答记录已保存至「历史」。
      </div>
    </div>
  )
}
