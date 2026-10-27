import type {
  AppSettings,
  ExamType,
  ImportedPaper,
  LanSyncInfo,
  LanSyncResult,
  LocalStudyFolder,
  Paper,
  PointPool,
  PracticeRecord,
  PracticeSession,
  PracticeType,
  PredictionItem,
  ProgressSyncInfo,
  ProgressSyncResult,
  Question,
  QuestionType,
  SafeUser,
  StudyMaterial,
  SubType
} from '../shared/types'
import { AI_GENERATED_SOURCE, GRADING_VERSION, NO_KEY_FEEDBACK } from '../shared/types'
import type {
  Api,
  GradingMigrationInfo,
  GradingMigrationResult,
  ReevaluateResult,
  SubmitPayload,
  SubmitResult
} from '../shared/api'
import { filterByBand, findBand, inBand } from '../shared/difficulty'
import { filterByTopic } from '../shared/topics'
import { seedQuestions } from '../main/data/questions'
import { seedRealPapers, seedRealQuestions } from '../main/data/realPapers'
import { seedStudy } from '../main/data/study'
import { BUILTIN_TOPICS } from '../main/data/topicMap'
import { scoreAnswer } from '../main/scoring'
import { generateQuestion, testConnection } from '../main/llm'
import type { QuestionSpec } from '../main/llm'
import { gradeQuestion } from '../main/grading'

// 移动端数据层：不依赖 Electron IPC，使用 localStorage 持久化，逻辑与桌面端 store/ipc 保持一致

const DEFAULT_USER_ID = 'local-default-user'

const K = {
  user: 'wokao:user',
  records: 'wokao:records',
  papers: 'wokao:papers',
  sessions: 'wokao:sessions',
  settings: 'wokao:settings',
  lanSync: 'wokao:lanSync',
  importedPapers: 'wokao:importedPapers',
  generatedQuestions: 'wokao:generatedQuestions',
  pointPools: 'wokao:pointPools'
}

// 局域网同步：手机端只保存「电脑端地址 + 同步码」
interface LanSyncConfig {
  serverUrl: string
  token: string
  port: number
  lastSyncAt: number | null
}
const DEFAULT_LAN_SYNC: LanSyncConfig = { serverUrl: '', token: '', port: 8848, lastSyncAt: null }

function loadLanSync(): LanSyncConfig {
  return { ...DEFAULT_LAN_SYNC, ...read<Partial<LanSyncConfig>>(K.lanSync, {}) }
}

// 允许只填 IP 或 IP:端口，自动补全协议与端口
function normalizeServerUrl(raw: string): string {
  let url = (raw ?? '').trim().replace(/\/+$/, '')
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`
  if (!/:\d+$/.test(url)) url = `${url}:8848`
  return url
}

const DEFAULT_SETTINGS: AppSettings = {
  province: '辽宁',
  localStudyDir: '',
  provider: 'zhipu',
  answerLayout: 'vertical',
  deepseek: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash-250414',
    apiKey: ''
  },
  grading: {
    secondPass: 'same-model',
    aiQuestionPolicy: 'separate'
  }
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 忽略写入异常（如容量超限） */
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

// ---- 只读种子数据 + 本地导入的真题 ----
function loadImported(): ImportedPaper[] {
  return read<ImportedPaper[]>(K.importedPapers, [])
}

// AI 自动命题生成的题目（题库不足以支撑练习时由大模型即时生成）
function loadGenerated(): Question[] {
  return read<Question[]>(K.generatedQuestions, [])
}
function saveGenerated(list: Question[]): void {
  write(K.generatedQuestions, list)
}

// 给内置题目补上话题标签（AI 生成题自带 topics，导入题暂不打标）
function withTopics(q: Question): Question {
  if (q.topics && q.topics.length > 0) return q
  const topics = BUILTIN_TOPICS[q.id]
  return topics ? { ...q, topics } : q
}

function allQuestions(): Question[] {
  return [
    ...seedQuestions,
    ...seedRealQuestions,
    ...loadGenerated(),
    ...loadImported().flatMap((p) => p.questions)
  ].map(withTopics)
}

function findQuestion(id: string): Question | undefined {
  const q =
    seedQuestions.find((q) => q.id === id) ??
    seedRealQuestions.find((q) => q.id === id) ??
    loadGenerated().find((q) => q.id === id) ??
    loadImported()
      .flatMap((p) => p.questions)
      .find((q) => q.id === id)
  return q ? withTopics(q) : undefined
}

// ---- 设置 ----
function loadSettings(): AppSettings {
  const s = read<AppSettings>(K.settings, DEFAULT_SETTINGS)
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    deepseek: { ...DEFAULT_SETTINGS.deepseek, ...(s?.deepseek ?? {}) },
    grading: { ...DEFAULT_SETTINGS.grading, ...(s?.grading ?? {}) }
  }
}

// ---- 评分 v2 点池（localStorage 持久化）----
function loadPointPools(): Record<string, PointPool> {
  return read<Record<string, PointPool>>(K.pointPools, {})
}
function savePointPoolMobile(pool: PointPool): void {
  const pools = loadPointPools()
  pools[pool.questionId] = pool
  write(K.pointPools, pools)
}

// ---- 记录 ----
function loadRecords(): PracticeRecord[] {
  return read<PracticeRecord[]>(K.records, [])
}
function saveRecords(rs: PracticeRecord[]): void {
  write(K.records, rs)
}
// 该用户已作答过的题目 id 集合：抽题时据此排除，避免重复抽到同一道题
function answeredIds(userId?: string): Set<string> | undefined {
  if (!userId) return undefined
  return new Set(loadRecords().filter((r) => r.userId === userId).map((r) => r.questionId))
}

// ---- 整卷 ----
function loadPapers(): Paper[] {
  return read<Paper[]>(K.papers, [])
}
function savePapers(ps: Paper[]): void {
  write(K.papers, ps)
}

// ---- 会话 ----
function loadSessions(): PracticeSession[] {
  return read<PracticeSession[]>(K.sessions, [])
}
function saveSessions(ss: PracticeSession[]): void {
  write(K.sessions, ss)
}

// ---- 组卷结构（与桌面端一致）----
const PAPER_STRUCTURES: { examType: ExamType; subType: SubType; types: QuestionType[] }[] = [
  { examType: '国考', subType: '副省级', types: ['归纳概括', '综合分析', '应用文写作', '应用文写作', '文章论述'] },
  { examType: '国考', subType: '地市级', types: ['归纳概括', '归纳概括', '提出对策', '应用文写作', '文章论述'] },
  { examType: '国考', subType: '行政执法类', types: ['归纳概括', '综合分析', '应用文写作', '应用文写作', '文章论述'] },
  { examType: '省考', subType: '省市级', types: ['归纳概括', '综合分析', '应用文写作', '文章论述'] },
  { examType: '省考', subType: '县乡级', types: ['归纳概括', '提出对策', '应用文写作', '文章论述'] }
]

const ALL_TYPES: QuestionType[] = ['归纳概括', '综合分析', '提出对策', '应用文写作', '文章论述']

// 各考试类型下的类别，AI 命题未指定类别时随机补全
const SUB_TYPES: Record<ExamType, SubType[]> = {
  国考: ['副省级', '地市级', '行政执法类'],
  省考: ['省市级', '县乡级']
}

function pickRandom<T>(list: T[]): T | undefined {
  if (list.length === 0) return undefined
  return list[Math.floor(Math.random() * list.length)]
}

// 目标难度：按档位取区间中值，不限难度按「进阶」取 5
function bandTarget(difficultyId?: string): number {
  const band = findBand(difficultyId)
  if (!band) return 5
  return Math.round((band.min + band.max) / 2)
}

// 依据抽题条件推断 AI 命题参数（随机 / 知识点练习未指定题型或类别时随机补全）
function inferSpec(
  type?: QuestionType,
  examType?: ExamType,
  province?: string,
  difficultyId?: string,
  topic?: string
): QuestionSpec {
  const et: ExamType = examType ?? pickRandom(['国考', '省考'] as ExamType[]) ?? '国考'
  const st = pickRandom(SUB_TYPES[et]) ?? SUB_TYPES[et][0]
  return {
    examType: et,
    subType: st,
    province: et === '省考' ? (province ?? loadSettings().province) : undefined,
    type: type ?? pickRandom(ALL_TYPES) ?? '归纳概括',
    difficultyId,
    targetDifficulty: bandTarget(difficultyId),
    topic
  }
}

// 调用大模型生成一道题并入库；未配置 Key 或生成失败时返回 null，由调用方兜底
async function generateAndStore(spec: QuestionSpec): Promise<Question | null> {
  const llm = loadSettings().deepseek
  if (!llm.apiKey.trim()) return null
  try {
    const avoid = allQuestions()
      .filter((q) => q.type === spec.type && q.examType === spec.examType)
      .map((q) => q.title)
      .slice(0, 30)
    const q = await generateQuestion(llm, spec, avoid)
    if (!q) return null
    const list = loadGenerated()
    if (!list.some((x) => x.id === q.id)) {
      list.push(q)
      saveGenerated(list)
    }
    return q
  } catch {
    return null
  }
}

// 组卷候选池：先按子类 / 考试类型过滤，省考优先匹配所选省份；话题为可选条件，命中优先
function paperPool(subType: SubType, examType: ExamType, province?: string, topic?: string): Question[] {
  let pool = allQuestions().filter((q) => q.subType === subType && q.examType === examType)
  if (examType === '省考') {
    const byProvince = pool.filter((q) => q.province === province)
    const generic = pool.filter((q) => !q.province || q.province === '通用')
    if (byProvince.length > 0 || generic.length > 0) pool = [...byProvince, ...generic]
  }
  // 话题为可选条件：命中该话题（含下级）的题目优先，未命中则退回全部候选
  const byTopic = filterByTopic(pool, topic)
  if (byTopic.length > 0) pool = byTopic
  return pool
}

// 组卷抽题：优先抽取未作答题目 → 不足则由 AI 自动命题 → 仍不可用才允许重复
async function pickByType(
  types: QuestionType[],
  subType: SubType,
  examType: ExamType,
  province?: string,
  difficultyId?: string,
  answered?: Set<string>,
  topic?: string
): Promise<Question[]> {
  const pool = paperPool(subType, examType, province, topic)
  const band = findBand(difficultyId)
  const target = bandTarget(difficultyId)
  const picked: Question[] = []
  const used = new Set<string>()
  for (const t of types) {
    const candidates = pool.filter((q) => q.type === t && !used.has(q.id))
    // 优先取符合难度档位的题；该题型在档位内没有题目时退回全部候选，保证整卷结构完整
    const inBandCandidates = band ? candidates.filter((q) => inBand(q.difficulty, band)) : candidates
    const finalists = inBandCandidates.length > 0 ? inBandCandidates : candidates
    const fresh = answered ? finalists.filter((q) => !answered.has(q.id)) : finalists
    let chosen = pickRandom(fresh)
    // 未作答的题目不足 → AI 自动命题补足
    if (!chosen) {
      chosen =
        (await generateAndStore({
          examType,
          subType,
          province,
          type: t,
          difficultyId,
          targetDifficulty: target,
          topic
        })) ?? undefined
    }
    // AI 不可用 / 生成失败时退回已作答题目（允许重复），保证整卷结构完整
    if (!chosen) chosen = pickRandom(finalists)
    if (chosen) {
      used.add(chosen.id)
      picked.push(chosen)
    }
  }
  return picked
}

async function buildPaper(
  examType: ExamType,
  subType: SubType,
  province?: string,
  difficultyId?: string,
  answered?: Set<string>,
  topic?: string
): Promise<Paper> {
  const structure = PAPER_STRUCTURES.find((s) => s.examType === examType && s.subType === subType)
  const types = structure?.types ?? ['归纳概括', '综合分析', '提出对策', '应用文写作', '文章论述']
  const questions = await pickByType(types, subType, examType, province, difficultyId, answered, topic)
  const totalScore = questions.reduce((s, q) => s + q.score, 0)
  const suggestMinutes = questions.reduce((s, q) => s + q.suggestMinutes, 0)
  const title =
    examType === '省考'
      ? `${province ?? ''}省考申论·${subType} 模拟卷`
      : `${examType}申论·${subType} 模拟卷`
  return {
    id: uid(),
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
  const records = loadRecords()
    .filter((r) => r.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
  const includeAi = loadSettings().grading?.aiQuestionPolicy === 'include'
  const result: PredictionItem[] = []
  for (const examType of examTypes) {
    for (const type of types) {
      const related = records.filter((r) => {
        const q = findQuestion(r.questionId)
        if (!q || q.type !== type || q.examType !== examType) return false
        if (!includeAi && q.source === AI_GENERATED_SOURCE) return false
        return true
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

export const mobileApi: Api = {
  ensureDefaultUser: async (): Promise<SafeUser> => {
    let user = read<SafeUser | null>(K.user, null)
    if (!user) {
      user = {
        id: DEFAULT_USER_ID,
        username: 'local',
        nickname: '本地用户',
        createdAt: Date.now()
      }
      write(K.user, user)
    }
    return user
  },

  getQuestions: async () => allQuestions(),
  getQuestion: async (id) => findQuestion(id),
  randomQuestion: async (
    type?: QuestionType,
    examType?: ExamType,
    province?: string,
    difficultyId?: string,
    userId?: string,
    topic?: string
  ) => {
    const answered = answeredIds(userId)
    let pool = allQuestions()
    if (type) pool = pool.filter((q) => q.type === type)
    if (examType) pool = pool.filter((q) => q.examType === examType)
    if (examType === '省考' && province) {
      const byProvince = pool.filter((q) => q.province === province)
      const generic = pool.filter((q) => !q.province || q.province === '通用')
      if (byProvince.length > 0 || generic.length > 0) pool = [...byProvince, ...generic]
    }
    // 话题为可选条件：命中该话题（含下级）的题目优先，未命中则退回全部候选
    const byTopic = filterByTopic(pool, topic)
    if (byTopic.length > 0) pool = byTopic
    // 按难度档位筛选；档位内无题时兜底返回，保证仍能出题
    pool = filterByBand(pool, findBand(difficultyId))
    // 优先抽未作答过的题目，避免重复练习
    const fresh = answered ? pool.filter((q) => !answered.has(q.id)) : pool
    const picked = pickRandom(fresh)
    if (picked) return picked
    // 未作答题目已用尽 → 由 AI 按「考试类型 + 知识点 + 话题 + 难度 + 给分点」自动命题
    const generated = await generateAndStore(inferSpec(type, examType, province, difficultyId, topic))
    if (generated) return generated
    // 未配置 Key / 生成失败 → 退回全部候选（允许重复），保证仍能出题
    return pickRandom(pool) ?? null
  },
  getQuestionTypes: async () =>
    ['归纳概括', '综合分析', '提出对策', '应用文写作', '文章论述'] as QuestionType[],

  getPapers: async () => loadPapers().sort((a, b) => b.createdAt - a.createdAt),
  generatePaper: async (examType, subType, province, difficultyId, userId, topic) => {
    const paper = await buildPaper(examType, subType, province, difficultyId, answeredIds(userId), topic)
    const papers = loadPapers()
    papers.push(paper)
    savePapers(papers)
    return paper
  },
  getPaper: async (id) => loadPapers().find((p) => p.id === id),

  getRealPapers: async () => [...loadImported().map((p) => p.paper), ...seedRealPapers],
  getRealPaper: async (id) =>
    loadImported().find((p) => p.paper.id === id)?.paper ?? seedRealPapers.find((p) => p.id === id),
  importRealPaper: async (paper, questions) => {
    if (!paper || questions.length === 0) return { ok: false, error: '导入内容为空' }
    const list = loadImported()
    list.push({ paper, questions })
    write(K.importedPapers, list)
    return { ok: true }
  },

  getRecords: async (userId) =>
    loadRecords()
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt),
  getRecord: async (id) => loadRecords().find((r) => r.id === id),
  deleteRecord: async (id) => {
    saveRecords(loadRecords().filter((r) => r.id !== id))
  },
  submitAnswer: async (payload: SubmitPayload): Promise<SubmitResult> => {
    const question = findQuestion(payload.questionId)
    if (!question) return { ok: false, error: '题目不存在' }

    const settings = loadSettings()
    const llm = settings.deepseek
    let scoreResult = scoreAnswer(question, payload.answer)
    let feedback = ''
    let suggestions: string[] = []
    let modelAnswer = question.referenceAnswer
    let dimensions: PracticeRecord['dimensions']
    let losses: PracticeRecord['losses']
    let grading: PracticeRecord['grading']
    let gradingVersion: string | undefined

    if (!llm.apiKey.trim()) {
      scoreResult.scoredBy = 'rule'
      feedback = NO_KEY_FEEDBACK
    } else {
      try {
        const pools = loadPointPools()
        const graded = await gradeQuestion({
          question,
          answer: payload.answer,
          settings,
          llm,
          pool: pools[question.id] ?? null
        })
        if (graded.poolIsNew && graded.pool) savePointPoolMobile(graded.pool)
        scoreResult = graded.scoreResult
        feedback = graded.feedback
        suggestions = graded.suggestions
        modelAnswer = graded.modelAnswer || question.referenceAnswer
        dimensions = graded.grade.dimensions
        losses = graded.losses
        grading = graded.grade
        gradingVersion = graded.grade.version
      } catch (err) {
        scoreResult = scoreAnswer(question, payload.answer)
        scoreResult.scoredBy = 'rule'
        feedback = `（AI 评分暂不可用：${(err as Error).message}）以下为本地规则评分，可稍后在设置中检查接口配置。`
      }
    }

    const record: PracticeRecord = {
      id: uid(),
      userId: payload.userId,
      questionId: payload.questionId,
      practiceType: payload.practiceType as PracticeType,
      paperId: payload.paperId,
      attemptId: payload.attemptId,
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
      grading,
      gradingVersion
    }
    const records = loadRecords()
    records.push(record)
    saveRecords(records)
    return { ok: true, record }
  },
  // 按最新评价标准重新评审一条历史作答记录
  reevaluateRecord: async (id: string): Promise<ReevaluateResult> => {
    const records = loadRecords()
    const idx = records.findIndex((r) => r.id === id)
    if (idx < 0) return { ok: false, error: '记录不存在' }
    const record = records[idx]
    const question = findQuestion(record.questionId)
    if (!question) return { ok: false, error: '题目不存在' }

    const settings = loadSettings()
    const llm = settings.deepseek
    // 未配置接口时不做重评，避免每次启动都空跑网络请求
    if (!llm.apiKey.trim()) return { ok: false, error: '未配置 AI 模型' }
    try {
      const pools = loadPointPools()
      const graded = await gradeQuestion({
        question,
        answer: record.answer,
        settings,
        llm,
        pool: pools[question.id] ?? null
      })
      if (graded.poolIsNew && graded.pool) savePointPoolMobile(graded.pool)
      const legacy =
        record.legacy ??
        ({
          scoreResult: record.scoreResult,
          feedback: record.feedback,
          suggestions: record.suggestions,
          modelAnswer: record.modelAnswer,
          gradingVersion: record.gradingVersion ?? 'legacy-v1',
          gradedAt: record.createdAt
        } as PracticeRecord['legacy'])
      const next: PracticeRecord = {
        ...record,
        scoreResult: graded.scoreResult,
        feedback: graded.feedback,
        suggestions: graded.suggestions,
        modelAnswer: graded.modelAnswer || question.referenceAnswer,
        dimensions: graded.grade.dimensions,
        losses: graded.losses,
        grading: graded.grade,
        gradingVersion: graded.grade.version,
        legacy
      }
      records[idx] = next
      saveRecords(records)
      return { ok: true, record: next }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  },
  getPredictions: async (userId) => computePredictions(userId),

  getSessions: async (userId) =>
    loadSessions()
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt),
  saveSession: async (session) => {
    const sessions = loadSessions()
    const idx = sessions.findIndex((s) => s.id === session.id)
    if (idx >= 0) sessions[idx] = { ...session, updatedAt: Date.now() }
    else sessions.push({ ...session, updatedAt: Date.now() })
    saveSessions(sessions)
  },
  deleteSession: async (id) => {
    saveSessions(loadSessions().filter((s) => s.id !== id))
  },

  getStudyMaterials: async (): Promise<StudyMaterial[]> => seedStudy,
  getStudyMaterial: async (id) => seedStudy.find((s) => s.id === id),

  // 移动端无本地文件系统访问能力，本地资料为空
  listLocalStudy: async (): Promise<LocalStudyFolder[]> => [],
  openLocalStudy: async () => ({ ok: false, error: '移动端暂不支持打开本地资料' }),

  getSettings: async () => loadSettings(),
  updateSettings: async (next) => {
    const merged: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...next,
      deepseek: { ...DEFAULT_SETTINGS.deepseek, ...(next?.deepseek ?? {}) },
      grading: { ...DEFAULT_SETTINGS.grading, ...(next?.grading ?? {}) }
    }
    write(K.settings, merged)
    return merged
  },
  testConnection: async () => testConnection(loadSettings().deepseek),

  // ---- 评分 v2：历史记录迁移（手机端）----
  getGradingMigrationInfo: async (): Promise<GradingMigrationInfo> => {
    const records = loadRecords()
    const pending = records.filter((r) => r.gradingVersion !== GRADING_VERSION || !r.grading)
    return {
      needed: pending.length > 0,
      total: records.length,
      done: records.length - pending.length,
      failed: 0,
      running: false,
      version: GRADING_VERSION
    }
  },

  runGradingMigration: async (): Promise<GradingMigrationResult> => {
    const settings = loadSettings()
    if (!settings.deepseek.apiKey.trim()) {
      return { ok: false, total: 0, done: 0, failed: 0, error: '未配置 AI 模型，暂不能重评历史记录' }
    }
    const records = loadRecords()
    const pendingIndexes = records
      .map((r, i) => (r.gradingVersion !== GRADING_VERSION || !r.grading ? i : -1))
      .filter((i) => i >= 0)
    let done = 0
    let failed = 0
    const pools = loadPointPools()
    for (const index of pendingIndexes) {
      const record = records[index]
      const question = findQuestion(record.questionId)
      if (!question) {
        failed++
        continue
      }
      try {
        const graded = await gradeQuestion({
          question,
          answer: record.answer,
          settings,
          llm: settings.deepseek,
          pool: pools[question.id] ?? null
        })
        if (graded.poolIsNew && graded.pool) {
          pools[graded.pool.questionId] = graded.pool
          write(K.pointPools, pools)
        }
        const legacy =
          record.legacy ??
          ({
            scoreResult: record.scoreResult,
            feedback: record.feedback,
            suggestions: record.suggestions,
            modelAnswer: record.modelAnswer,
            gradingVersion: record.gradingVersion ?? 'legacy-v1',
            gradedAt: record.createdAt
          } as PracticeRecord['legacy'])
        records[index] = {
          ...record,
          scoreResult: graded.scoreResult,
          feedback: graded.feedback,
          suggestions: graded.suggestions,
          modelAnswer: graded.modelAnswer || question.referenceAnswer,
          dimensions: graded.grade.dimensions,
          losses: graded.losses,
          grading: graded.grade,
          gradingVersion: graded.grade.version,
          legacy
        }
        done++
      } catch (err) {
        console.error('[mobile grading migration] 失败', record.id, (err as Error).message)
        failed++
      }
    }
    saveRecords(records)
    if (failed === 0) {
      const merged: AppSettings = {
        ...settings,
        grading: { ...settings.grading, migrationVersion: GRADING_VERSION }
      }
      write(K.settings, merged)
    }
    return { ok: failed === 0, total: done + failed, done, failed }
  },

  // ---- 局域网同步（手机端为客户端，桌面端为服务端）----
  getLanSyncInfo: async (): Promise<LanSyncInfo> => {
    const cfg = loadLanSync()
    return {
      role: 'client',
      enabled: !!cfg.serverUrl,
      running: false,
      port: cfg.port,
      addresses: [],
      token: cfg.token,
      serverUrl: cfg.serverUrl,
      lastSyncAt: cfg.lastSyncAt,
      mergedCount: 0
    }
  },

  // 手机端没有服务端可开关，保持原样返回
  setLanSyncServer: async (): Promise<LanSyncInfo> => mobileApi.getLanSyncInfo(),

  regenerateSyncToken: async (): Promise<LanSyncInfo> => mobileApi.getLanSyncInfo(),

  saveLanSyncClient: async (serverUrl: string, token: string): Promise<LanSyncInfo> => {
    write(K.lanSync, { ...loadLanSync(), serverUrl: serverUrl.trim(), token: token.trim() })
    return mobileApi.getLanSyncInfo()
  },

  runLanSync: async (): Promise<LanSyncResult> => {
    const cfg = loadLanSync()
    const base = normalizeServerUrl(cfg.serverUrl)
    if (!base) return { ok: false, error: '请先填写电脑端显示的服务器地址' }
    if (!cfg.token) return { ok: false, error: '请先填写电脑端显示的同步码' }

    const mine = loadRecords()
    let data: {
      ok?: boolean
      error?: string
      added?: number
      records?: PracticeRecord[]
    }
    try {
      const res = await fetch(`${base}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sync-token': cfg.token },
        body: JSON.stringify({ userId: DEFAULT_USER_ID, records: mine })
      })
      if (!res.ok) {
        const hint = res.status === 403 ? '同步码不正确' : `服务器返回 ${res.status}`
        return { ok: false, error: hint }
      }
      data = (await res.json()) as typeof data
    } catch {
      return { ok: false, error: '连接不上电脑端，请确认在同一 Wi-Fi 下且桌面端程序已开启' }
    }

    if (!data.ok) return { ok: false, error: data.error ?? '同步失败' }

    // 把电脑端返回的记录按 id 合并进来（只增不删）
    const ids = new Set(mine.map((r) => r.id))
    const merged = [...mine]
    let added = 0
    for (const r of data.records ?? []) {
      if (!r || typeof r.id !== 'string' || ids.has(r.id)) continue
      merged.push(r)
      ids.add(r.id)
      added++
    }
    merged.sort((a, b) => b.createdAt - a.createdAt)
    saveRecords(merged)
    write(K.lanSync, { ...cfg, lastSyncAt: Date.now() })

    return { ok: true, added, total: merged.length }
  },

  // ---- 跨设备进度同步（云盘文件夹）：仅桌面端支持，手机端无文件系统访问能力 ----
  getProgressSyncInfo: async (): Promise<ProgressSyncInfo> => ({
    dir: '',
    enabled: false,
    machine: '',
    myFile: '',
    lastImportAt: null,
    lastExportAt: null,
    lastAddedRecords: 0,
    lastAddedQuestions: 0,
    peers: [],
    error: '手机端不支持云盘文件夹同步，请在电脑端使用'
  }),

  setProgressSyncDir: async (): Promise<ProgressSyncInfo> => mobileApi.getProgressSyncInfo(),

  pickProgressSyncDir: async (): Promise<ProgressSyncInfo> => mobileApi.getProgressSyncInfo(),

  runProgressSync: async (): Promise<ProgressSyncResult> => ({
    ok: false,
    error: '手机端不支持云盘文件夹同步，请在电脑端使用'
  }),

  openProgressSyncDir: async () => ({
    ok: false,
    error: '手机端不支持云盘文件夹同步，请在电脑端使用'
  })
}
