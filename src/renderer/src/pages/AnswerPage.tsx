import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { AnswerLayout, HighlightMark, PracticeSession, Question } from '../../../shared/types'
import { difficultyLabel } from '../../../shared/difficulty'
import LinedPaper from '../components/LinedPaper'
import MarkableText from '../components/MarkableText'
import './answer.css'

interface AnswerState {
  mode: string
  questionIds: string[]
  paperTitle?: string
  paperId?: string
  province?: string
  suggestMinutes?: number
  resume?: PracticeSession
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function formatClock(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function AnswerPage(): JSX.Element {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as AnswerState | null

  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>(state?.resume?.answers ?? {})
  const [index, setIndex] = useState(state?.resume?.index ?? 0)
  const [submitting, setSubmitting] = useState(false)
  const [elapsed, setElapsed] = useState(state?.resume?.elapsedSeconds ?? 0)
  const [paused, setPaused] = useState(false)
  // 题干标记：按题目 id 归集，退出后可随会话恢复
  const [marks, setMarks] = useState<Record<string, HighlightMark[]>>(
    state?.resume?.highlights ?? {}
  )
  // 作答页布局（来自设置，默认上下布局）
  const [answerLayout, setAnswerLayout] = useState<AnswerLayout>('vertical')

  const sessionIdRef = useRef<string>(state?.resume?.id ?? newId())
  const submittedRef = useRef(false)
  const pausedRef = useRef(false)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  // 载入题目
  useEffect(() => {
    if (!state || !state.questionIds?.length) {
      navigate('/practice', { replace: true })
      return
    }
    void Promise.all(state.questionIds.map((id) => window.api.getQuestion(id))).then((qs) => {
      setQuestions(qs.filter(Boolean) as Question[])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 载入作答布局设置
  useEffect(() => {
    void window.api.getSettings().then((s) => setAnswerLayout(s.answerLayout ?? 'vertical'))
  }, [])

  // 计时：暂停时冻结（倒计时与超时都不增长）
  useEffect(() => {
    const t = setInterval(() => {
      if (!pausedRef.current) setElapsed((e) => e + 1)
    }, 1000)
    return () => clearInterval(t)
  }, [])

  // 窗口最小化/失焦时冻结
  useEffect(() => {
    const offMin = window.windowEvents.onMinimized(() => setPaused(true))
    const offBlur = window.windowEvents.onBlurred(() => setPaused(true))
    return () => {
      offMin()
      offBlur()
    }
  }, [])

  const question = questions[index]
  const isPaper = state?.mode === '整卷练习' || state?.mode === '真题练习'
  const totalCount = questions.length
  const suggestMinutes = state?.suggestMinutes ?? questions[0]?.suggestMinutes ?? 30
  const suggestSeconds = suggestMinutes * 60
  const overtime = elapsed - suggestSeconds

  // 题干标记（仅电脑端提供标注入口，手机端只做只读回显）
  const canMark = !document.documentElement.classList.contains('mobile')
  const questionId = question?.id ?? ''
  const currentMarks = marks[questionId] ?? []

  const addMark = (field: HighlightMark['field'], start: number, end: number, note: string): void => {
    if (!questionId) return
    setMarks((prev) => {
      const list = prev[questionId] ?? []
      const idx = list.findIndex((m) => m.field === field && m.start === start && m.end === end)
      const next =
        idx >= 0
          ? list.map((m, i) => (i === idx ? { ...m, note } : m))
          : [...list, { field, start, end, note }]
      return { ...prev, [questionId]: next }
    })
  }

  const removeMark = (field: HighlightMark['field'], start: number, end: number): void => {
    if (!questionId) return
    setMarks((prev) => ({
      ...prev,
      [questionId]: (prev[questionId] ?? []).filter(
        (m) => !(m.field === field && m.start === start && m.end === end)
      )
    }))
  }

  const undoMark = (): void => {
    if (!questionId) return
    setMarks((prev) => ({ ...prev, [questionId]: (prev[questionId] ?? []).slice(0, -1) }))
  }

  const clearMarks = (): void => {
    if (!questionId) return
    setMarks((prev) => ({ ...prev, [questionId]: [] }))
  }

  // 构建并保存会话
  const persist = useCallback((): void => {
    if (!user || submittedRef.current) return
    if (!state || questions.length === 0) return
    const session: PracticeSession = {
      id: sessionIdRef.current,
      userId: user.id,
      mode: (state.mode as PracticeSession['mode']) ?? '随机练习',
      questionIds: questions.map((q) => q.id),
      paperId: state.paperId,
      paperTitle: state.paperTitle,
      province: state.province,
      suggestMinutes,
      answers,
      index,
      elapsedSeconds: elapsed,
      startedAt: state.resume?.startedAt ?? Date.now(),
      updatedAt: Date.now(),
      highlights: marks
    }
    void window.api.saveSession(session)
  }, [user, state, questions, suggestMinutes, answers, index, elapsed, marks])

  // 答案/切题变化后延迟保存
  useEffect(() => {
    const t = setTimeout(persist, 800)
    return () => clearTimeout(t)
  }, [answers, index, persist])

  // 周期性保存（防止中途退出丢数据）
  useEffect(() => {
    const t = setInterval(persist, 5000)
    return () => clearInterval(t)
  }, [persist])

  const handleBack = (): void => {
    persist()
    navigate('/practice')
  }

  const handleSubmit = async (): Promise<void> => {
    if (!user) return
    submittedRef.current = true
    if (isPaper) {
      const attemptId = `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const payloads = questions
        .filter((q) => (answers[q.id] ?? '').trim())
        .map((q) => ({
          userId: user.id,
          questionId: q.id,
          answer: answers[q.id],
          practiceType: state?.mode ?? '整卷练习',
          paperId: state?.paperId,
          attemptId,
          durationSeconds: elapsed,
          province: state?.province,
          highlights: marks[q.id]
        }))
      if (payloads.length === 0) {
        submittedRef.current = false
        alert('请先作答再交卷')
        return
      }
      setSubmitting(true)
      const results = await Promise.all(payloads.map((p) => window.api.submitAnswer(p)))
      setSubmitting(false)
      void window.api.deleteSession(sessionIdRef.current)
      const records = results.filter((r) => r.ok && r.record).map((r) => r.record!)
      navigate('/practice/paper-result', {
        state: { paperTitle: state?.paperTitle, paperId: state?.paperId, records }
      })
    } else {
      const qid = questions[0]?.id
      const answer = qid ? (answers[qid] ?? '') : ''
      if (!answer.trim()) {
        submittedRef.current = false
        alert('请先作答再提交')
        return
      }
      setSubmitting(true)
      const res = await window.api.submitAnswer({
        userId: user.id,
        questionId: qid,
        answer,
        practiceType: state?.mode ?? '随机练习',
        durationSeconds: elapsed,
        province: state?.province,
        highlights: marks[qid]
      })
      setSubmitting(false)
      void window.api.deleteSession(sessionIdRef.current)
      if (res.ok && res.record) navigate(`/practice/result/${res.record.id}`)
      else alert(res.error ?? '提交失败')
    }
  }

  const switchQuestion = async (): Promise<void> => {
    // 换一题同样排除已作答题目，题量不足时由后端 AI 自动命题补足
    const q = await window.api.randomQuestion(undefined, undefined, undefined, undefined, user?.id)
    if (!q) return
    setQuestions([q])
    setAnswers({})
    setMarks({})
    setIndex(0)
    setElapsed(0)
  }

  if (!question) {
    return <div className="empty">加载中…</div>
  }

  return (
    <div
      className={`answer-page${answerLayout === 'horizontal' ? ' answer-layout-horizontal' : ''}`}
    >
      <div className="answer-topbar">
        <button className="btn btn-outline btn-sm" onClick={handleBack}>
          ← 返回
        </button>
        {isPaper ? (
          <div className="answer-paper-title">{state?.paperTitle}</div>
        ) : (
          <div className="answer-mode-tag">{state?.mode}</div>
        )}
        <div className={`answer-timer${overtime > 0 ? ' overtime' : ''}`}>
          {overtime > 0
            ? `⏱ 超时 ${Math.floor(overtime / 60)}分${overtime % 60}秒`
            : `⏱ 剩余 ${formatClock(-overtime)}`}
        </div>
      </div>

      {isPaper && (
        <div className="answer-progress">
          <div className="answer-progress-bar">
            <div
              className="answer-progress-fill"
              style={{ width: `${((index + 1) / totalCount) * 100}%` }}
            />
          </div>
          <span>
            第 {index + 1} / {totalCount} 题
          </span>
        </div>
      )}

      <div className="card answer-question">
        <div className="answer-meta">
          <span className="tag tag-blue">{question.type}</span>
          <span className="tag tag-green">
            {question.examType} · {question.subType}
          </span>
          <span className="answer-score">分值 {question.score} 分</span>
          <span className="answer-time">建议作答 {question.suggestMinutes} 分钟</span>
          <span className="tag tag-orange">
            难度 {question.difficulty}/10 · {difficultyLabel(question.difficulty)}
          </span>
        </div>

        {canMark && (
          <div className="mark-bar">
            <span className="mark-bar-title">文字笔记</span>
            <span className="mark-bar-tip">
              左键拖选文字后单击右键 →「添加笔记」；笔记会以半透明便签浮在选区上方，鼠标移入变实心，点击便签可编辑。
            </span>
            <div className="mark-bar-actions">
              <button
                className="btn btn-outline btn-sm"
                onClick={undoMark}
                disabled={currentMarks.length === 0}
              >
                撤销
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={clearMarks}
                disabled={currentMarks.length === 0}
              >
                清除全部
              </button>
            </div>
          </div>
        )}

        <h2 className="answer-title">
          <MarkableText
            text={question.title}
            field="title"
            marks={currentMarks}
            editable={canMark}
            onNote={(s, e, n) => addMark('title', s, e, n)}
            onRemove={(s, e) => removeMark('title', s, e)}
          />
        </h2>
        <div className="answer-requirement">
          <MarkableText
            text={question.requirement}
            field="requirement"
            marks={currentMarks}
            editable={canMark}
            onNote={(s, e, n) => addMark('requirement', s, e, n)}
            onRemove={(s, e) => removeMark('requirement', s, e)}
          />
        </div>

        {question.material && (
          <div className="answer-material">
            <div className="answer-material-label">给定资料</div>
            <div className="answer-material-body">
              <MarkableText
                text={question.material}
                field="material"
                marks={currentMarks}
                editable={canMark}
                onNote={(s, e, n) => addMark('material', s, e, n)}
                onRemove={(s, e) => removeMark('material', s, e)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="card answer-write">
        <div className="answer-write-label">作答区域（横格纸）</div>
        <LinedPaper
          value={answers[question.id] ?? ''}
          onChange={(v) => setAnswers((prev) => ({ ...prev, [question.id]: v }))}
          wordLimit={question.wordLimit}
        />
      </div>

      <div className="answer-actions">
        <div>
          {isPaper && (
            <button
              className="btn btn-outline"
              disabled={index === 0}
              onClick={() => setIndex((i) => i - 1)}
            >
              ← 上一题
            </button>
          )}
        </div>
        <div className="answer-actions-right">
          {!isPaper && (
            <button className="btn btn-outline" onClick={switchQuestion}>
              换一题
            </button>
          )}
          {isPaper && index < totalCount - 1 ? (
            <button className="btn btn-primary" onClick={() => setIndex((i) => i + 1)}>
              下一题 →
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? '评分中…' : isPaper ? '交卷并评分' : '提交并评分'}
            </button>
          )}
        </div>
      </div>

      {paused && (
        <div className="answer-overlay">
          <div className="answer-pause-modal">
            <div className="answer-pause-icon">⏸️</div>
            <div className="answer-pause-title">作答已暂停</div>
            <div className="answer-pause-desc">计时已冻结，点击继续作答后恢复计时。</div>
            <button className="btn btn-primary" onClick={() => setPaused(false)}>
              继续作答
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
