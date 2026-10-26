import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import type { ExamType, PracticeRecord, Question, QuestionType } from '../../../shared/types'
import { difficultyLabel } from '../../../shared/difficulty'
import MarkableText from '../components/MarkableText'
import './result.css'

// 进入本页时可能携带的来源信息（如从主页题型详情弹窗跳转而来）
type ResultNavState = {
  from?: string
  detail?: { type: QuestionType; examType: ExamType }
}

export default function ResultPage(): JSX.Element {
  const { recordId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [record, setRecord] = useState<PracticeRecord | null>(null)
  const [question, setQuestion] = useState<Question | null>(null)

  const navState = (location.state as ResultNavState | null) ?? {}
  const backTo = navState.from ?? '/history'

  // 从哪来回哪去；若来源是主页详情弹窗，把 detail 一并带回，返回后弹窗自动恢复
  const handleBack = (): void => {
    if (navState.detail) navigate(backTo, { state: { detail: navState.detail } })
    else navigate(backTo)
  }

  useEffect(() => {
    if (!recordId) return
    void window.api.getRecord(recordId).then((r) => {
      setRecord(r ?? null)
      if (r) void window.api.getQuestion(r.questionId).then((q) => setQuestion(q ?? null))
    })
  }, [recordId])

  if (!record) {
    return <div className="empty">加载中…</div>
  }

  const { scoreResult } = record
  const isEssay = question?.type === '文章论述'
  const hasPoints = scoreResult.pointResults.length > 0
  const hitPoints = scoreResult.pointResults.filter((p) => p.got > 0)
  // 扣分点 = 实得分低于该点满分的采分点（含完全遗漏与部分得分）
  const missPoints = scoreResult.pointResults.filter((p) => p.got < p.score)
  const sumHit = hitPoints.reduce((s, p) => s + p.got, 0)
  const sumMiss = missPoints.reduce((s, p) => s + (p.score - p.got), 0)

  return (
    <div className="result-page">
      <button className="btn btn-outline btn-sm" onClick={handleBack}>
        {backTo === '/history' ? '← 返回历史' : '← 返回'}
      </button>

      {question && (
        <div className="card">
          <h3 className="result-section-title">📄 题目</h3>
          <div className="result-question-title">
            <MarkableText text={question.title} field="title" marks={record.highlights ?? []} />
          </div>
          <div className="result-question-req">
            <MarkableText
              text={question.requirement}
              field="requirement"
              marks={record.highlights ?? []}
            />
          </div>
          {question.material && (
            <div className="result-question-material">
              <div className="result-question-material-label">给定资料</div>
              <div className="result-question-material-body">
                <MarkableText
                  text={question.material}
                  field="material"
                  marks={record.highlights ?? []}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card result-score-card">
        <div className="result-score-main">
          <div className="result-score-num">
            {scoreResult.score}
            <span className="result-score-total"> / {scoreResult.totalScore} 分</span>
          </div>
          <div className="result-score-ratio">得分率 {(scoreResult.ratio * 100).toFixed(0)}%</div>
          {scoreResult.band && <span className="tag tag-orange">{scoreResult.band}</span>}
          {scoreResult.scoredBy === 'ai' ? (
            <span className="tag tag-blue">AI 评分</span>
          ) : (
            <span className="tag tag-gray">规则评分</span>
          )}
        </div>
        <div className="result-score-info">
          <div>
            <span className="tag tag-blue">{question?.type}</span>{' '}
            <span className="tag tag-green">
              {question?.examType} · {question?.subType}
            </span>
          </div>
          {question && (
            <div className="result-score-meta">
              难度 {question.difficulty}/10 · {difficultyLabel(question.difficulty)}
            </div>
          )}
          <div className="result-score-meta">实际字数 {scoreResult.wordCount} 字</div>
          {hasPoints && (
            <div className="result-score-meta">
              得分点合计 +{sumHit} 分 · 扣分合计 -{sumMiss} 分（满分 {scoreResult.totalScore} 分）
            </div>
          )}
          {scoreResult.overWordLimit && <div className="result-over">已超出字数限制</div>}
        </div>
      </div>

      {record.dimensions && record.dimensions.length > 0 && (
        <div className="card">
          <h3 className="result-section-title">📊 细分得分</h3>
          <div className="result-dims">
            {record.dimensions.map((d) => (
              <div key={d.name} className="result-dim">
                <span className="result-dim-name">{d.name}</span>
                <span className="result-dim-bar">
                  <span
                    className="result-dim-fill"
                    style={{ width: `${d.full > 0 ? (d.got / d.full) * 100 : 0}%` }}
                  />
                </span>
                <span className="result-dim-score">
                  {d.got}/{d.full}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="result-grid">
        <div className="card">
          <h3 className="result-section-title">✅ 得分点</h3>
          {!hasPoints ? (
            <div className="result-empty">本题不设采分点，按整体水平给分</div>
          ) : hitPoints.length === 0 ? (
            <div className="result-empty">未命中采分点</div>
          ) : (
            <ul className="result-points">
              {hitPoints.map((p) => (
                <li
                  key={p.pointId}
                  className="result-point hit"
                  title={`该点满分 ${p.score} 分`}
                >
                  <span className="result-point-label">{p.label}</span>
                  <span className="result-point-score">+{p.got} 分</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h3 className="result-section-title">❌ 扣分点</h3>
          {!hasPoints ? (
            <div className="result-empty">本题不设采分点，按整体水平给分</div>
          ) : missPoints.length === 0 ? (
            <div className="result-empty">采分点已全部命中，无扣分</div>
          ) : (
            <ul className="result-points">
              {missPoints.map((p) => (
                <li
                  key={p.pointId}
                  className="result-point miss"
                  title={`该点满分 ${p.score} 分，实得 ${p.got} 分`}
                >
                  <span className="result-point-label">{p.label}</span>
                  <span className="result-point-score">-{p.score - p.got} 分</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="result-section-title">💬 综合点评</h3>
        <p className="result-feedback">{record.feedback}</p>
      </div>

      {record.losses && record.losses.length > 0 && (
        <div className="card">
          <h3 className="result-section-title">🔍 主要失分点</h3>
          <ul className="result-losses">
            {record.losses.map((l, i) => (
              <li key={i} className="result-loss">
                <div className="result-loss-title">{l.title}</div>
                {l.reason && <div className="result-loss-reason">{l.reason}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {record.suggestions.length > 0 && (
        <div className="card">
          <h3 className="result-section-title">📌 改进建议</h3>
          <ol className="result-suggestions">
            {record.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}

      {(record.skeleton?.length || record.template) && (
        <div className="card">
          <h3 className="result-section-title">🧭 答题骨架</h3>
          {record.skeleton?.length ? (
            <ol className="result-skeleton">
              {record.skeleton.map((s, i) => (
                <li key={i}>
                  <span className="result-skeleton-part">{s.part}</span>
                  {s.how && <span className="result-skeleton-how">{s.how}</span>}
                </li>
              ))}
            </ol>
          ) : (
            <div className="result-skeleton-legacy">{record.template}</div>
          )}
        </div>
      )}

      <div className="card">
        <h3 className="result-section-title">
          {isEssay ? '📄 参考范文（AI 生成，非官方）' : '📄 参考答案（AI 生成，非官方）'}
        </h3>
        <div className="result-model-answer">{record.modelAnswer}</div>
      </div>

      <div className="card">
        <h3 className="result-section-title">📝 我的作答</h3>
        <div className="result-my-answer">{record.answer || '（未作答）'}</div>
      </div>

      <div className="result-actions">
        <button className="btn btn-outline" onClick={() => navigate('/practice')}>
          继续练习
        </button>
        <button
          className="btn btn-primary"
          onClick={() =>
            navigate('/practice/answer', {
              state: { mode: '重新练习', questionIds: [record.questionId] }
            })
          }
        >
          🔁 重新练习本题
        </button>
      </div>
    </div>
  )
}
