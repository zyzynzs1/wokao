import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
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
import { DIFFICULTY_BANDS, PROVINCES } from '../../../shared/types'
import { difficultyLabel } from '../../../shared/difficulty'
import {
  buildImportedPaper,
  deriveTitle,
  extractText,
  parseExamText,
  SUPPORTED_EXT,
  type ParsedExam
} from '../utils/paperImport'
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

interface ImportDraft {
  exam: ParsedExam
  fileName: string
  title: string
  examType: ExamType
  subType: SubType
  province: string
}

// 难度选择器：不限 / 入门 / 进阶 / 较难
function DifficultyPicker({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <div className="control-line">
      <span className="control-label">难度</span>
      <div className="seg-group">
        {DIFFICULTY_BANDS.map((b) => (
          <button
            key={b.id}
            className={`seg${value === b.id ? ' active' : ''}`}
            onClick={() => onChange(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function PracticePage(): JSX.Element {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [examType, setExamType] = useState<ExamType>('国考')
  const [subType, setSubType] = useState<SubType>('副省级')
  const [randomExamType, setRandomExamType] = useState<ExamType>('国考')
  const [randomDifficulty, setRandomDifficulty] = useState('all')
  const [paperDifficulty, setPaperDifficulty] = useState('all')
  // 知识点练习：支持选择国考 / 省考与难度
  const [knowExamType, setKnowExamType] = useState<ExamType>('国考')
  const [knowDifficulty, setKnowDifficulty] = useState('all')
  const [generating, setGenerating] = useState(false)
  // 抽取单题时，题库不足会由 AI 自动命题，耗时较长，用该状态给出反馈
  const [picking, setPicking] = useState(false)
  const [province, setProvince] = useState('辽宁')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [sessions, setSessions] = useState<PracticeSession[]>([])
  const [realPapers, setRealPapers] = useState<Paper[]>([])
  const [questionMap, setQuestionMap] = useState<Record<string, Question>>({})
  // 真题导入
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [draft, setDraft] = useState<ImportDraft | null>(null)

  const reloadQuestions = async (): Promise<void> => {
    const qs = await window.api.getQuestions()
    const map: Record<string, Question> = {}
    for (const q of qs) map[q.id] = q
    setQuestionMap(map)
  }

  useEffect(() => {
    void window.api.getSettings().then((s) => {
      setSettings(s)
      setProvince(s.province ?? '辽宁')
    })
    void window.api.getRealPapers().then(setRealPapers)
    void reloadQuestions()
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
    setPicking(true)
    const q = await window.api.randomQuestion(
      undefined,
      randomExamType,
      randomExamType === '省考' ? province : undefined,
      randomDifficulty,
      user?.id
    )
    setPicking(false)
    if (q) {
      navigate('/practice/answer', {
        state: { mode: '随机练习', questionIds: [q.id], suggestMinutes: q.suggestMinutes }
      })
    }
  }

  const startKnowledge = async (type: QuestionType): Promise<void> => {
    setPicking(true)
    const q = await window.api.randomQuestion(
      type,
      knowExamType,
      knowExamType === '省考' ? province : undefined,
      knowDifficulty,
      user?.id
    )
    setPicking(false)
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
      examType === '省考' ? province : undefined,
      paperDifficulty,
      user?.id
    )
    setGenerating(false)
    if (paper.questionIds.length === 0) {
      alert('暂无可用于组卷的题目。请到「设置 → AI 评分模型」配置可用的 API Key，配置后系统会自动命制新题。')
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

  // 选择本地文件 → 抽取文本 → 解析成题目结构 → 弹出预览确认
  const onPickFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    setImportError('')
    try {
      const text = await extractText(await file.arrayBuffer(), file.name)
      const exam = parseExamText(text, file.name)
      setDraft({
        exam,
        fileName: file.name,
        title: deriveTitle(file.name),
        examType: '国考',
        subType: '副省级',
        province
      })
    } catch (err) {
      setImportError((err as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const confirmImport = async (): Promise<void> => {
    if (!draft) return
    setImporting(true)
    setImportError('')
    try {
      const { paper, questions } = buildImportedPaper(draft.exam, {
        title: draft.title.trim() || deriveTitle(draft.fileName),
        examType: draft.examType,
        subType: draft.subType,
        province: draft.examType === '省考' ? draft.province : undefined,
        source: `本地导入 · ${draft.fileName}`
      })
      const res = await window.api.importRealPaper(paper, questions)
      if (!res.ok) {
        setImportError(res.error ?? '导入失败')
        return
      }
      setRealPapers(await window.api.getRealPapers())
      await reloadQuestions()
      setDraft(null)
    } finally {
      setImporting(false)
    }
  }

  const config = EXAM_CONFIGS.find((c) => c.examType === examType)
  const draftConfig = draft ? EXAM_CONFIGS.find((c) => c.examType === draft.examType) : undefined

  const isImported = (p: Paper): boolean =>
    p.questionIds.some((id) => questionMap[id]?.source?.startsWith('本地导入'))

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
            <DifficultyPicker value={randomDifficulty} onChange={setRandomDifficulty} />
          </div>
          <button className="btn btn-primary" onClick={startRandom} disabled={picking}>
            {picking ? '出题中…' : '随机出题'}
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
            <DifficultyPicker value={paperDifficulty} onChange={setPaperDifficulty} />
          </div>
          <button className="btn btn-primary" onClick={startPaper} disabled={generating}>
            {generating ? '组卷中…' : '生成试卷'}
          </button>
        </div>

        {/* 真题练习 */}
        <div className="card practice-card practice-card-wide">
          <div className="real-paper-head">
            <div>
              <div className="practice-icon">🏆</div>
              <h2>真题练习</h2>
            </div>
            <div className="real-paper-import">
              <input
                ref={fileRef}
                type="file"
                accept={SUPPORTED_EXT.join(',')}
                style={{ display: 'none' }}
                onChange={(e) => void onPickFile(e)}
              />
              <button
                className="btn btn-outline btn-sm"
                onClick={() => fileRef.current?.click()}
                disabled={importing}
              >
                {importing ? '解析中…' : '导入本地真题'}
              </button>
            </div>
          </div>
          <p className="practice-desc">
            历年申论真题，以整卷形式作答，贴近真实考试。支持导入本地 zip / word（docx）/ pdf 文件。
          </p>
          {importError && <p className="import-error">{importError}</p>}
          {realPapers.length === 0 ? (
            <p className="practice-desc">暂无真题卷，可点击「导入本地真题」添加。</p>
          ) : (
            <div className="real-paper-list">
              {realPapers.map((p) => (
                <button key={p.id} className="real-paper-item" onClick={() => startRealPaper(p)}>
                  <div className="real-paper-info">
                    <div className="real-paper-title">
                      {p.title}
                      {isImported(p) && <span className="tag tag-orange real-paper-tag">导入</span>}
                    </div>
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
          <p className="practice-desc">按申论五大题型进行专项练习，可指定国考 / 省考与难度。</p>
          <div className="practice-controls">
            <div className="seg-group">
              {EXAM_CONFIGS.map((c) => (
                <button
                  key={c.examType}
                  className={`seg${knowExamType === c.examType ? ' active' : ''}`}
                  onClick={() => setKnowExamType(c.examType)}
                >
                  {c.examType}
                </button>
              ))}
            </div>
            {knowExamType === '省考' && (
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
            <DifficultyPicker value={knowDifficulty} onChange={setKnowDifficulty} />
          </div>
          <div className="type-grid">
            {QUESTION_TYPES.map((t) => (
              <button
                key={t.type}
                className="type-item"
                onClick={() => void startKnowledge(t.type)}
                disabled={picking}
              >
                <span className="type-name">{picking ? `${t.type} · 出题中…` : t.type}</span>
                <span className="type-desc">{t.desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 导入预览确认 */}
      {draft && (
        <div className="import-mask" onClick={() => !importing && setDraft(null)}>
          <div className="import-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="import-title">导入真题预览</h3>
            <p className="import-sub">
              已从《{draft.fileName}》识别出 {draft.exam.questions.length} 道题
              {draft.exam.material ? `、给定资料约 ${draft.exam.material.replace(/\s/g, '').length} 字` : ''}
              ，确认下列信息后导入。
            </p>

            <div className="import-fields">
              <div className="import-field">
                <span className="control-label">卷名</span>
                <input
                  className="input"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>
              <div className="import-field">
                <span className="control-label">考试类型</span>
                <div className="seg-group">
                  {EXAM_CONFIGS.map((c) => (
                    <button
                      key={c.examType}
                      className={`seg${draft.examType === c.examType ? ' active' : ''}`}
                      onClick={() =>
                        setDraft({ ...draft, examType: c.examType, subType: c.subTypes[0] })
                      }
                    >
                      {c.examType}
                    </button>
                  ))}
                </div>
              </div>
              {draft.examType === '省考' && (
                <div className="import-field">
                  <span className="control-label">省份</span>
                  <select
                    className="province-select"
                    value={draft.province}
                    onChange={(e) => setDraft({ ...draft, province: e.target.value })}
                  >
                    {PROVINCES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="import-field">
                <span className="control-label">分类</span>
                <div className="seg-group">
                  {draftConfig?.subTypes.map((s) => (
                    <button
                      key={s}
                      className={`seg${draft.subType === s ? ' active' : ''}`}
                      onClick={() => setDraft({ ...draft, subType: s })}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="import-list">
              {draft.exam.questions.map((q, i) => (
                <div key={i} className="import-item">
                  <div className="import-item-head">
                    <span className="tag tag-blue">第 {i + 1} 题</span>
                    <span className="tag tag-green">{q.type}</span>
                    <span className="tag tag-gray">{q.score} 分</span>
                    {q.wordLimit > 0 && <span className="tag tag-gray">{q.wordLimit} 字</span>}
                    <span className="tag tag-orange">
                      难度 {q.difficulty}/10 · {difficultyLabel(q.difficulty)}
                    </span>
                  </div>
                  <div className="import-item-text">{q.title}</div>
                </div>
              ))}
            </div>

            {importError && <p className="import-error">{importError}</p>}

            <div className="import-actions">
              <button className="btn btn-outline" onClick={() => setDraft(null)} disabled={importing}>
                取消
              </button>
              <button className="btn btn-primary" onClick={() => void confirmImport()} disabled={importing}>
                {importing ? '导入中…' : `导入 ${draft.exam.questions.length} 道题`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
