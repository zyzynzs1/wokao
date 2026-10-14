import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type {
  AppSettings,
  ExamType,
  Paper,
  PracticeSession,
  Question,
  QuestionType,
  SubType
} from '../../../shared/types'
import { PROVINCES } from '../../../shared/types'
import './practice.css'

const QUESTION_TYPES: { type: QuestionType; desc: string }[] = [
  { type: '归纳概括', desc: '概括问题/做法/经验' },
  { type: '综合分析', desc: '词句理解/原因分析' },
  { type: '提出对策', desc: '提出解决措施' },
  { type: '应用文写作', desc: '倡议书/汇报/发言稿' },
  { type: '文章论述', desc: '大作文' }
]

const EXAM_CONFIGS: { examType: ExamType; subTypes: SubType[] }[] = [
  { examType: '国考', subTypes: ['副省级', '地市级', '行政执法类'] },
  { examType: '省考', subTypes: ['省市级', '县乡级'] }
]

export default function PracticePage(): JSX.Element {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [examType, setExamType] = useState<ExamType>('国考')
  const [subType, setSubType] = useState<SubType>('副省级')
  const [randomExamType, setRandomExamType] = useState<ExamType>('国考')
  const [generating, setGenerating] = useState(false)
  const [province, setProvince] = useState('辽宁')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [sessions, setSessions] = useState<PracticeSession[]>([])
  const [realPapers, setRealPapers] = useState<Paper[]>([])
  const [questionMap, setQuestionMap] = useState<Record<string, Question>>({})

  useEffect(() => {
    void window.api.getSettings().then((s) => {
      setSettings(s)
      setProvince(s.province ?? '辽宁')
    })
    void window.api.getRealPapers().then(setRealPapers)
    void window.api.getQuestions().then((qs) => {
      const map: Record<string, Question> = {}
      for (const q of qs) map[q.id] = q
      setQuestionMap(map)
    })
  }, [])

  useEffect(() => {
    if (!user) return
    void window.api.getSessions(user.id).then(setSessions)
  }, [user])

  const changeProvince = async (p: string): Promise<void> => {
    setProvince(p)
    if (settings) {
      const next = { ...settings, province: p }
      setSettings(next)
      await window.api.updateSettings(next)
    }
  }

  const startRandom = async (): Promise<void> => {
    const q = await window.api.randomQuestion(
      undefined,
      randomExamType,
      randomExamType === '省考' ? province : undefined
    )
    if (q) {
      navigate('/practice/answer', {
        state: { mode: '随机练习', questionIds: [q.id], suggestMinutes: q.suggestMinutes }
      })
    }
  }

  const startKnowledge = async (type: QuestionType): Promise<void> => {
    const q = await window.api.randomQuestion(type)
    if (q) {
      navigate('/practice/answer', {
        state: { mode: '知识点练习', questionIds: [q.id], suggestMinutes: q.suggestMinutes }
      })
    }
  }

  const startPaper = async (): Promise<void> => {
    setGenerating(true)
    const paper = await window.api.generatePaper(
      examType,
      subType,
      examType === '省考' ? province : undefined
    )
    setGenerating(false)
    if (paper.questionIds.length === 0) {
      alert('该分类下题库暂未覆盖足够题目，请稍后再试或选择其他分类')
      return
    }
    navigate('/practice/answer', {
      state: {
        mode: '整卷练习',
        questionIds: paper.questionIds,
        paperTitle: paper.title,
        paperId: paper.id,
        province: paper.province,
        suggestMinutes: paper.suggestMinutes
      }
    })
  }

  const continueSession = (session: PracticeSession): void => {
    navigate('/practice/answer', {
      state: {
        mode: session.mode,
        questionIds: session.questionIds,
        paperTitle: session.paperTitle,
        paperId: session.paperId,
        province: session.province,
        suggestMinutes: session.suggestMinutes,
        resume: session
      }
    })
  }

  const removeSession = async (id: string): Promise<void> => {
    await window.api.deleteSession(id)
    setSessions((prev) => prev.filter((s) => s.id !== id))
  }

  // 依据会话中的题目，归纳题型 / 考试类型 / 分类等信息用于展示
  const sessionInfo = (s: PracticeSession): { types: QuestionType[]; examTypes: ExamType[]; subTypes: string[] } => {
    const qs = s.questionIds.map((id) => questionMap[id]).filter(Boolean) as Question[]
    return {
      types: [...new Set(qs.map((q) => q.type))],
      examTypes: [...new Set(qs.map((q) => q.examType))],
      subTypes: [...new Set(qs.map((q) => q.subType))].filter(Boolean) as string[]
    }
  }

  const startRealPaper = (paper: Paper): void => {
    if (paper.questionIds.length === 0) {
      alert('该真题卷暂未收录题目，敬请期待')
      return
    }
    navigate('/practice/answer', {
      state: {
        mode: '真题练习',
        questionIds: paper.questionIds,
        paperTitle: paper.title,
        paperId: paper.id,
        province: paper.province,
        suggestMinutes: paper.suggestMinutes
      }
    })
  }

  const config = EXAM_CONFIGS.find((c) => c.examType === examType)

  return (
    <div>
      <h1 className="page-title">练习</h1>

      {sessions.length > 0 && (
        <div className="card continue-card">
          <h2 className="continue-title">继续练习</h2>
          <p className="continue-hint">上次未完成的练习已保存，点击可继续作答。</p>
          <div className="continue-list">
            {sessions.map((s) => {
              const info = sessionInfo(s)
              return (
                <div key={s.id} className="continue-item" onClick={() => continueSession(s)}>
                  <div className="continue-info">
                    <div className="continue-name">
                      {s.mode}
                      {s.paperTitle ? ` · ${s.paperTitle}` : ''}
                    </div>
                    <div className="continue-tags">
                      {info.types.map((t) => (
                        <span key={t} className="tag tag-blue">
                          {t}
                        </span>
                      ))}
                      {info.examTypes.map((e) => (
                        <span key={e} className="tag tag-gray">
                          {e}
                        </span>
                      ))}
                      {info.subTypes.map((st) => (
                        <span key={st} className="tag tag-gray">
                          {st}
                        </span>
                      ))}
                      {s.province && <span className="tag tag-orange">{s.province}</span>}
                    </div>
                    <div className="continue-meta">
                      已作答 {Math.floor(s.elapsedSeconds / 60)} 分 {s.elapsedSeconds % 60} 秒 · 完成{' '}
                      {Object.values(s.answers).filter((a) => a.trim()).length}/{s.questionIds.length} 题
                    </div>
                  </div>
                  <div className="continue-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        continueSession(s)
                      }}
                    >
                      继续 →
                    </button>
                    <button
                      className="continue-close"
                      title="删除这条未完成记录"
                      onClick={(e) => {
                        e.stopPropagation()
                        void removeSession(s.id)
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="practice-grid">
        {/* 随机练习 */}
        <div className="card practice-card">
          <div className="practice-icon">🎲</div>
          <h2>随机练习</h2>
          <p className="practice-desc">从题库随机抽取一道题，覆盖全部题型与国省考考点。</p>
          <div className="practice-controls">
            <div className="seg-group">
              {EXAM_CONFIGS.map((c) => (
                <button
                  key={c.examType}
                  className={`seg${randomExamType === c.examType ? ' active' : ''}`}
                  onClick={() => setRandomExamType(c.examType)}
                >
                  {c.examType}
                </button>
              ))}
            </div>
            {randomExamType === '省考' && (
              <div className="province-row">
                <label className="province-label">省份</label>
                <select
                  className="province-select"
                  value={province}
                  onChange={(e) => void changeProvince(e.target.value)}
                >
                  {PROVINCES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={startRandom}>
            随机出题
          </button>
        </div>

        {/* 整卷练习 */}
        <div className="card practice-card">
          <div className="practice-icon">📝</div>
          <h2>整卷练习</h2>
          <p className="practice-desc">模拟整张申论试卷，按国考/省考真实题型结构组卷。</p>
          <div className="practice-controls">
            <div className="seg-group">
              {EXAM_CONFIGS.map((c) => (
                <button
                  key={c.examType}
                  className={`seg${examType === c.examType ? ' active' : ''}`}
                  onClick={() => {
                    setExamType(c.examType)
                    setSubType(c.subTypes[0])
                  }}
                >
                  {c.examType}
                </button>
              ))}
            </div>
            {examType === '省考' && (
              <div className="province-row">
                <label className="province-label">省份</label>
                <select
                  className="province-select"
                  value={province}
                  onChange={(e) => void changeProvince(e.target.value)}
                >
                  {PROVINCES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="seg-group">
              {config?.subTypes.map((s) => (
                <button
                  key={s}
                  className={`seg${subType === s ? ' active' : ''}`}
                  onClick={() => setSubType(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" onClick={startPaper} disabled={generating}>
            {generating ? '组卷中…' : '生成试卷'}
          </button>
        </div>

        {/* 真题练习 */}
        <div className="card practice-card practice-card-wide">
          <div className="practice-icon">🏆</div>
          <h2>真题练习</h2>
          <p className="practice-desc">历年申论真题，以整卷形式作答，贴近真实考试。</p>
          {realPapers.length === 0 ? (
            <p className="practice-desc">暂无真题卷，敬请期待。</p>
          ) : (
            <div className="real-paper-list">
              {realPapers.map((p) => (
                <button key={p.id} className="real-paper-item" onClick={() => startRealPaper(p)}>
                  <div className="real-paper-info">
                    <div className="real-paper-title">{p.title}</div>
                    <div className="real-paper-meta">
                      {p.examType} · {p.subType}
                      {p.province ? ` · ${p.province}` : ''} · {p.questionIds.length} 题 · 满分{' '}
                      {p.totalScore} 分 · 建议 {p.suggestMinutes} 分钟
                    </div>
                  </div>
                  <span className="real-paper-go">开始作答 →</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 知识点练习 */}
        <div className="card practice-card practice-card-wide">
          <div className="practice-icon">🎯</div>
          <h2>知识点练习</h2>
          <p className="practice-desc">按申论五大题型进行专项练习，补齐短板。</p>
          <div className="type-grid">
            {QUESTION_TYPES.map((t) => (
              <button key={t.type} className="type-item" onClick={() => startKnowledge(t.type)}>
                <span className="type-name">{t.type}</span>
                <span className="type-desc">{t.desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
