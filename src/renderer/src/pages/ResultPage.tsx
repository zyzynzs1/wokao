import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import type {
  CoverageStatus,
  ExamType,
  ExpansionLevel,
  PracticeRecord,
  Question,
  QuestionType
} from '../../../shared/types'
import { AI_GENERATED_SOURCE } from '../../../shared/types'
import { difficultyLabel } from '../../../shared/difficulty'
import MarkableText from '../components/MarkableText'
import './result.css'

// 进入本页时可能携带的来源信息（如从主页题型详情弹窗跳转而来）
type ResultNavState = {
  from?: string
  detail?: { type: QuestionType; examType: ExamType }
}

const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  full: '完整覆盖',
  equivalent: '等义表达',
  partial: '部分覆盖',
  none: '未覆盖',
  out_of_material: '材料外'
}

const EXPANSION_LABEL: Record<ExpansionLevel, string> = {
  full: '充分展开',
  basic: '基本展开',
  brief: '简略提及',
  title: '仅列标题',
  none: '—'
}

// 分数展示：最多保留 1 位小数
function fmtScore(n: number): string {
  const v = Math.round((Number.isFinite(n) ? n : 0) * 10) / 10
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

// 参考答案字数
function countWords(text: string): number {
  return (text || '').replace(/\s/g, '').length
}

function coverageClass(status: CoverageStatus): string {
  if (status === 'full' || status === 'equivalent') return 'result-point-status ok'
  if (status === 'partial') return 'result-point-status partial'
  if (status === 'out_of_material') return 'result-point-status out'
  return 'result-point-status none'
}

export default function ResultPage(): JSX.Element {
  const { recordId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [record, setRecord] = useState<PracticeRecord | null>(null)
  const [question, setQuestion] = useState<Question | null>(null)

  const navState = (location.state as ResultNavState | null) ?? {}
  const backTo = navState.from ?? '/history'

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
  const grading = record.grading
  const isEssay = question?.type === '文章论述'
  const isAiQuestion = question?.source === AI_GENERATED_SOURCE
  const module = grading?.mode === 'essay' || isEssay ? '文章论述' : question?.type
  const pointScoreById = new Map(scoreResult.pointResults.map((p) => [p.pointId, p]))
  const coverage = grading?.pointCoverage ?? []

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
            {fmtScore(grading ? grading.center : scoreResult.score)}
            <span className="result-score-total"> / {scoreResult.totalScore} 分</span>
          </div>
          <div className="result-score-ratio">
            得分率 {((grading ? grading.center : scoreResult.score) / Math.max(1, scoreResult.totalScore) * 100).toFixed(0)}%
          </div>
        </div>
        <div className="result-score-info">
          <div>
            {grading ? (
              <>
                <span className="tag">{grading.tier}</span>
                <span className="tag">{grading.confidence}置信度</span>
              </>
            ) : (
              <span className="tag">{scoreResult.band ?? module}</span>
            )}
            {isAiQuestion && <span className="tag">AI 自命题</span>}
            {grading && <span className="tag">训练参考分</span>}
          </div>
          {grading && (
            <div className="result-score-meta">
              建议区间 {grading.range[0]}–{grading.range[1]} 分
            </div>
          )}
          <div className="result-score-meta">
            {question?.examType} · {question?.subType}
            {question && ` · 难度 ${question.difficulty}/10 ${difficultyLabel(question.difficulty)}`}
          </div>
          <div className="result-score-meta">
            实际字数 {grading && grading.mode === 'essay' ? record.scoreResult.wordCount : scoreResult.wordCount} 字
          </div>
          {grading && <div className="result-score-meta">评分标准 {grading.version}</div>}
          {scoreResult.overWordLimit && <div className="result-over">已超出字数限制</div>}
        </div>
      </div>

      {grading && (
        <div className="card">
          <h3 className="result-section-title">🧭 评分说明</h3>
          <p className="result-feedback">
            {grading.confidenceReason}
            {grading.aiQuestion ? '（AI 自命题，评分仅作训练参考。）' : ''}
          </p>
          {grading.reviewAgreement !== null && grading.reviewAgreement !== undefined && (
            <p className="result-score-meta" style={{ color: '#475467', marginTop: 6 }}>
              两次独立判点一致率：{(grading.reviewAgreement * 100).toFixed(0)}%
            </p>
          )}
          {grading.warnings.length > 0 && (
            <ul className="result-suggestions" style={{ marginTop: 8 }}>
              {grading.warnings.map((w, i) => (
                <li key={i}>⚠️ {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {grading?.essay && (
        <div className="card">
          <h3 className="result-section-title">📝 大作文档位判定</h3>
          <p className="result-feedback">
            <b>{grading.essay.tier}</b>
            {grading.essay.relationType ? ` · 双主题 ${grading.essay.relationType} 型` : ''}
            {' · '}
            {grading.essay.topicType === 'single'
              ? '单主题'
              : grading.essay.topicType === 'double'
                ? '双主题'
                : '多主题'}
            {' · '}
            {grading.essay.essayStyle}
          </p>
          <p className="result-feedback" style={{ marginTop: 8 }}>
            {grading.essay.tierReason}
          </p>
          <div className="result-dims" style={{ marginTop: 12 }}>
            {(grading.dimensions ?? []).map((d) => (
              <div key={d.name} className="result-dim">
                <span className="result-dim-name">{d.name}</span>
                <span className="result-dim-bar">
                  <span
                    className="result-dim-fill"
                    style={{ width: `${d.full > 0 ? (d.got / d.full) * 100 : 0}%` }}
                  />
                </span>
                <span className="result-dim-score">
                  {fmtScore(d.got)}/{fmtScore(d.full)}
                </span>
              </div>
            ))}
          </div>
          {grading.essay.hardIssues.length > 0 && (
            <ul className="result-losses" style={{ marginTop: 12 }}>
              {grading.essay.hardIssues.map((h, i) => (
                <li key={i} className="result-loss">
                  <div className="result-loss-title">硬伤（{h.type}）</div>
                  <div className="result-loss-reason">{h.detail}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {coverage.length > 0 && (
        <div className="card">
          <h3 className="result-section-title">🔍 逐点核对</h3>
          <div className="result-points-table">
            <div className="result-points-head">
              <span>标准要点 / 材料依据</span>
              <span>你的表述</span>
              <span>覆盖</span>
              <span>得分</span>
            </div>
            {coverage.map((c) => {
              const p = pointScoreById.get(c.pointId)
              return (
                <div key={c.pointId} className="result-point-row">
                  <div className="result-point-label">
                    <div className="result-point-text">{c.pointText ?? c.pointId}</div>
                    {c.pointEvidence && <div className="result-point-evidence">{c.pointEvidence}</div>}
                  </div>
                  <div className="result-point-quote">
                    {c.userQuote ? c.userQuote : <span className="result-empty-inline">未提及</span>}
                    {(c.status === 'partial' || c.status === 'full' || c.status === 'equivalent') &&
                      c.expansion !== 'none' && (
                        <span className="result-expansion">（{EXPANSION_LABEL[c.expansion]}）</span>
                      )}
                  </div>
                  <div>
                    <span className={coverageClass(c.status)}>{COVERAGE_LABEL[c.status]}</span>
                  </div>
                  <div className="result-point-score">
                    {p ? `${fmtScore(p.got)}/${fmtScore(p.score)}` : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {grading && grading.formatDeductions && grading.formatDeductions.length > 0 && (
        <div className="card">
          <h3 className="result-section-title">📎 形式扣分</h3>
          <ul className="result-losses">
            {grading.formatDeductions.map((d, i) => (
              <li key={i} className="result-loss">
                <div className="result-loss-title">
                  {d.type}：-{fmtScore(d.value)} 分
                </div>
                <div className="result-loss-reason">{d.reason}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

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
          {isEssay ? '📄 参考范例（非唯一答案）' : '📄 参考答案（非唯一答案）'}
          <span style={{ fontSize: 12, fontWeight: 400, color: '#667085', marginLeft: 8 }}>
            共 {countWords(record.modelAnswer)} 字
          </span>
        </h3>
        <p className="result-empty" style={{ marginBottom: 8 }}>
          参考范例用于对照思路，不是官方标准答案；评分以逐点核对与档位判定为准。
        </p>
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
