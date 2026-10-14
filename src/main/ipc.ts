import { ipcMain, shell } from 'electron'
import { randomUUID } from 'crypto'
import { readdirSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import type {
  ExamType,
  HighlightMark,
  LossItem,
  Paper,
  PracticeRecord,
  PracticeSession,
  PracticeType,
  PredictionItem,
  Question,
  QuestionType,
  ScoreDimension,
  SkeletonPart,
  SubType
} from '../shared/types'
import { NO_KEY_FEEDBACK } from '../shared/types'
import { applyFeedbackScore, buildDimensions, generateFeedback, testConnection } from './llm'
import { getLanSyncInfo, regenerateSyncToken, startLanSync, stopLanSync } from './lanSync'
import { scoreAnswer } from './scoring'
import {
  addPaper,
  addRecord,
  deleteRecordById,
  deleteSessionById,
  ensureDefaultUser,
  getPaperById,
  getPapers,
  getQuestionById,
  getQuestions,
  getRealPaperById,
  getRealPapers,
  getRecordById,
  getRecordsByUser,
  getSessionsByUser,
  getSettings,
  getStudyMaterialById,
  getStudyMaterials,
  updateRecord,
  updateSettings,
  upsertSession
} from './store'

// ---- 整卷组卷结构：各考试类型的题型顺序 ----
const PAPER_STRUCTURES: { examType: ExamType; subType: SubType; types: QuestionType[] }[] = [
  { examType: '国考', subType: '副省级', types: ['归纳概括', '综合分析', '应用文写作', '应用文写作', '文章论述'] },
  { examType: '国考', subType: '地市级', types: ['归纳概括', '归纳概括', '提出对策', '应用文写作', '文章论述'] },
  { examType: '国考', subType: '行政执法类', types: ['归纳概括', '综合分析', '应用文写作', '应用文写作', '文章论述'] },
  { examType: '省考', subType: '省市级', types: ['归纳概括', '综合分析', '应用文写作', '文章论述'] },
  { examType: '省考', subType: '县乡级', types: ['归纳概括', '提出对策', '应用文写作', '文章论述'] }
]

function pickByType(types: QuestionType[], subType: SubType, examType: ExamType, province?: string): Question[] {
  let pool = getQuestions().filter((q) => q.subType === subType && q.examType === examType)
  if (examType === '省考') {
    // 优先匹配所选省份的题目，其次用通用题，最后兜底使用全部省考题
    const byProvince = pool.filter((q) => q.province === province)
    const generic = pool.filter((q) => !q.province || q.province === '通用')
    if (byProvince.length > 0 || generic.length > 0) {
      pool = [...byProvince, ...generic]
    }
  }
  const picked: Question[] = []
  const used = new Set<string>()
  for (const t of types) {
    const candidates = pool.filter((q) => q.type === t && !used.has(q.id))
    const chosen = candidates[Math.floor(Math.random() * candidates.length)]
    if (chosen) {
      used.add(chosen.id)
      picked.push(chosen)
    }
  }
  return picked
}

function buildPaper(examType: ExamType, subType: SubType, province?: string): Paper {
  const structure = PAPER_STRUCTURES.find((s) => s.examType === examType && s.subType === subType)
  const types = structure?.types ?? ['归纳概括', '综合分析', '提出对策', '应用文写作', '文章论述']
  const questions = pickByType(types, subType, examType, province)
  const totalScore = questions.reduce((s, q) => s + q.score, 0)
  const suggestMinutes = questions.reduce((s, q) => s + q.suggestMinutes, 0)
  const title =
    examType === '省考'
      ? `${province ?? ''}省考申论·${subType} 模拟卷`
      : `${examType}申论·${subType} 模拟卷`
  return {
    id: randomUUID(),
    title,
    examType,
    subType,
    province: examType === '省考' ? province : undefined,
    questionIds: questions.map((q) => q.id),
    totalScore,
    suggestMinutes,
    createdAt: Date.now()
  }
}

function computePredictions(userId: string): PredictionItem[] {
  const types: QuestionType[] = ['归纳概括', '综合分析', '提出对策', '应用文写作', '文章论述']
  const examTypes: ExamType[] = ['国考', '省考']
  const records = getRecordsByUser(userId)
  const result: PredictionItem[] = []
  for (const examType of examTypes) {
    for (const type of types) {
      const related = records.filter((r) => {
        const q = getQuestionById(r.questionId)
        return q?.type === type && q?.examType === examType
      })
      if (related.length === 0) {
        result.push({ type, examType, avgRatio: null, predictedScore: null, count: 0 })
        continue
      }
      const avgRatio = related.reduce((s, r) => s + (r.scoreResult.ratio || 0), 0) / related.length
      result.push({
        type,
        examType,
        avgRatio,
        predictedScore: Math.round(avgRatio * 100),
        count: related.length
      })
    }
  }
  return result
}

export function registerIpc(): void {
  ipcMain.handle('auth:ensureDefaultUser', () => {
    const user = ensureDefaultUser()
    return { id: user.id, username: user.username, nickname: user.nickname, createdAt: user.createdAt }
  })

  ipcMain.handle('questions:all', () => getQuestions())
  ipcMain.handle('questions:get', (_e, id: string) => getQuestionById(id))
  ipcMain.handle('questions:random', (_e, type?: QuestionType, examType?: ExamType, province?: string) => {
    let pool = getQuestions()
    if (type) pool = pool.filter((q) => q.type === type)
    if (examType) pool = pool.filter((q) => q.examType === examType)
    if (examType === '省考' && province) {
      const byProvince = pool.filter((q) => q.province === province)
      const generic = pool.filter((q) => !q.province || q.province === '通用')
      if (byProvince.length > 0 || generic.length > 0) pool = [...byProvince, ...generic]
    }
    if (pool.length === 0) return null
    return pool[Math.floor(Math.random() * pool.length)]
  })
  ipcMain.handle('questions:types', () => {
    const types: QuestionType[] = ['归纳概括', '综合分析', '提出对策', '应用文写作', '文章论述']
    return types
  })

  ipcMain.handle('papers:all', () => getPapers())
  ipcMain.handle('papers:generate', (_e, examType: ExamType, subType: SubType, province?: string) => {
    const paper = buildPaper(examType, subType, province)
    addPaper(paper)
    return paper
  })
  ipcMain.handle('papers:get', (_e, id: string) => getPaperById(id))

  ipcMain.handle('realPapers:all', () => getRealPapers())
  ipcMain.handle('realPapers:get', (_e, id: string) => getRealPaperById(id))

  ipcMain.handle('records:list', (_e, userId: string) => getRecordsByUser(userId))
  ipcMain.handle('records:get', (_e, id: string) => getRecordById(id))

  ipcMain.handle('records:delete', (_e, id: string) => {
    deleteRecordById(id)
  })

  ipcMain.handle(
    'records:submit',
    async (
      _e,
      payload: {
        userId: string
        questionId: string
        answer: string
        practiceType: PracticeType
        paperId?: string
        durationSeconds: number
        province?: string
        highlights?: HighlightMark[]
      }
    ) => {
      const question = getQuestionById(payload.questionId)
      if (!question) return { ok: false, error: '题目不存在' }

      const scoreResult = scoreAnswer(question, payload.answer)

      let feedback = ''
      let suggestions: string[] = []
      let modelAnswer = question.referenceAnswer
      let dimensions: ScoreDimension[] | undefined
      let losses: LossItem[] | undefined
      let skeleton: SkeletonPart[] | undefined

      const llm = getSettings().deepseek
      if (!llm.apiKey.trim()) {
        // 未配置 API Key：退化为本地规则评分，并引导免费领取 Key
        scoreResult.scoredBy = 'rule'
        feedback = NO_KEY_FEEDBACK
      } else {
        try {
          const fb = await generateFeedback(llm, question, payload.answer, scoreResult, payload.province)
          feedback = fb.feedback
          suggestions = fb.suggestions
          modelAnswer = fb.modelAnswer || question.referenceAnswer
          // 用模型结果覆盖评分明细与总分，保证总分与「得分点/扣分点」明细一致
          applyFeedbackScore(question, scoreResult, fb)
          dimensions = buildDimensions(question, scoreResult, fb.dimensions)
          losses = fb.losses
          skeleton = fb.skeleton
        } catch (err) {
          scoreResult.scoredBy = 'rule'
          feedback = `（AI 评分暂不可用：${(err as Error).message}）以下为本地规则评分，可稍后在设置中检查接口配置后重新练习。`
        }
      }

      const record: PracticeRecord = {
        id: randomUUID(),
        userId: payload.userId,
        questionId: payload.questionId,
        practiceType: payload.practiceType,
        paperId: payload.paperId,
        answer: payload.answer,
        scoreResult,
        feedback,
        suggestions,
        modelAnswer,
        durationSeconds: payload.durationSeconds,
        createdAt: Date.now(),
        highlights: payload.highlights,
        dimensions,
        losses,
        skeleton
      }
      addRecord(record)
      return { ok: true, record }
    }
  )

  // 按最新评价标准重新评审一条历史作答记录
  ipcMain.handle('records:reevaluate', async (_e, id: string) => {
    const record = getRecordById(id)
    if (!record) return { ok: false, error: '记录不存在' }
    const question = getQuestionById(record.questionId)
    if (!question) return { ok: false, error: '题目不存在' }

    const scoreResult = scoreAnswer(question, record.answer)
    const llm = getSettings().deepseek
    // 未配置接口时不做重评，避免每次启动都空跑网络请求
    if (!llm.apiKey.trim()) return { ok: false, error: '未配置 AI 模型' }
    try {
      const fb = await generateFeedback(llm, question, record.answer, scoreResult)
      applyFeedbackScore(question, scoreResult, fb)
      const next: PracticeRecord = {
        ...record,
        scoreResult,
        feedback: fb.feedback,
        suggestions: fb.suggestions,
        modelAnswer: fb.modelAnswer || question.referenceAnswer,
        dimensions: buildDimensions(question, scoreResult, fb.dimensions),
        losses: fb.losses,
        skeleton: fb.skeleton
      }
      updateRecord(next)
      return { ok: true, record: next }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('predictions:get', (_e, userId: string) => computePredictions(userId))

  ipcMain.handle('sessions:list', (_e, userId: string) => getSessionsByUser(userId))
  ipcMain.handle('sessions:save', (_e, session: PracticeSession) => {
    upsertSession({ ...session, updatedAt: Date.now() })
  })
  ipcMain.handle('sessions:delete', (_e, id: string) => deleteSessionById(id))

  ipcMain.handle('study:all', () => getStudyMaterials())
  ipcMain.handle('study:get', (_e, id: string) => getStudyMaterialById(id))

  ipcMain.handle('localStudy:list', () => {
    const dir = getSettings().localStudyDir
    return listLocalStudy(dir)
  })
  ipcMain.handle('localStudy:open', (_e, path: string) => {
    return shell.openPath(path).then((err) => (err ? { ok: false, error: err } : { ok: true }))
  })

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:update', (_e, next) => {
    updateSettings(next)
    return getSettings()
  })
  ipcMain.handle('settings:test', () => testConnection(getSettings().deepseek))

  // ---- 局域网同步（桌面端为服务端）----
  ipcMain.handle('lanSync:info', () => getLanSyncInfo())
  ipcMain.handle('lanSync:start', () => startLanSync())
  ipcMain.handle('lanSync:stop', () => stopLanSync())
  ipcMain.handle('lanSync:regenerateToken', () => regenerateSyncToken())
  ipcMain.handle('lanSync:run', () => ({
    ok: false,
    error: '桌面端是同步服务端，请在手机端发起同步'
  }))
}

// 扫描本地学习资料目录，按子文件夹分组返回可打开的文件
const LOCAL_EXT = new Set(['.pdf', '.doc', '.docx', '.txt', '.md'])
function listLocalStudy(dir: string): { name: string; files: { name: string; path: string; ext: string }[] }[] {
  if (!dir || !existsSync(dir)) return []
  const result: { name: string; files: { name: string; path: string; ext: string }[] }[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      const files: { name: string; path: string; ext: string }[] = []
      let children: string[] = []
      try {
        children = readdirSync(full)
      } catch {
        children = []
      }
      for (const c of children) {
        const cf = join(full, c)
        const dot = c.lastIndexOf('.')
        const ext = dot >= 0 ? c.slice(dot).toLowerCase() : ''
        if (LOCAL_EXT.has(ext)) files.push({ name: c, path: cf, ext })
      }
      if (files.length > 0) result.push({ name: entry, files })
    } else {
      const dot = entry.lastIndexOf('.')
      const ext = dot >= 0 ? entry.slice(dot).toLowerCase() : ''
      if (LOCAL_EXT.has(ext)) {
        const root = result.find((r) => r.name === '(根目录)')
        if (root) root.files.push({ name: entry, path: full, ext })
        else result.push({ name: '(根目录)', files: [{ name: entry, path: full, ext }] })
      }
    }
  }
  return result
}
