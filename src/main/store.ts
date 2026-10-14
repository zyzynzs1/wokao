import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { join } from 'path'
import type {
  AppSettings,
  ImportedPaper,
  Paper,
  PracticeRecord,
  PracticeSession,
  Question,
  StudyMaterial,
  User
} from '../shared/types'
import { seedQuestions } from './data/questions'
import { seedRealPapers, seedRealQuestions } from './data/realPapers'
import { seedStudy } from './data/study'

// 数据目录：userData/data
let dataDir = ''

function ensureDataDir(): string {
  if (!dataDir) {
    dataDir = join(app.getPath('userData'), 'data')
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }
  }
  return dataDir
}

function readJson<T>(file: string, fallback: T): T {
  const p = join(ensureDataDir(), file)
  if (!existsSync(p)) return fallback
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: unknown): void {
  const p = join(ensureDataDir(), file)
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8')
}

// ---- 默认设置（默认使用智谱 GLM-4-Flash 免费模型，可在设置页切换服务商）----
const DEFAULT_SETTINGS: AppSettings = {
  province: '辽宁',
  localStudyDir: 'D:\\BaiduNetdiskDownload\\shenlun',
  provider: 'zhipu',
  deepseek: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash-250414',
    apiKey: ''
  }
}

// ---- 内存缓存 ----
let users: User[] = []
let records: PracticeRecord[] = []
let papers: Paper[] = []
let settings: AppSettings = DEFAULT_SETTINGS
let sessions: PracticeSession[] = []
// 从本地文件导入的真题卷（含解析出的题目），持久化保存
let importedPapers: ImportedPaper[] = []
// AI 自动命题生成的题目（题库不足以支撑练习时由大模型即时生成），持久化保存
let generatedQuestions: Question[] = []

// ---- 局域网同步状态（桌面端作为服务端）----
export interface LanSyncState {
  enabled: boolean
  port: number
  token: string
  serverUrl: string
  lastSyncAt: number | null
}
const DEFAULT_LAN_SYNC: LanSyncState = {
  enabled: true,
  port: 8848,
  token: '',
  serverUrl: '',
  lastSyncAt: null
}
let lanSync: LanSyncState = { ...DEFAULT_LAN_SYNC }

export function initStore(): void {
  users = readJson<User[]>('users.json', [])
  records = readJson<PracticeRecord[]>('records.json', [])
  papers = readJson<Paper[]>('papers.json', [])
  settings = readJson<AppSettings>('settings.json', DEFAULT_SETTINGS)
  sessions = readJson<PracticeSession[]>('sessions.json', [])
  importedPapers = readJson<ImportedPaper[]>('importedPapers.json', [])
  generatedQuestions = readJson<Question[]>('generatedQuestions.json', [])
  lanSync = { ...DEFAULT_LAN_SYNC, ...readJson<Partial<LanSyncState>>('lanSync.json', {}) }
  if (!lanSync.token) lanSync.token = randomToken()
  writeJson('lanSync.json', lanSync)
  // 若设置缺失字段则补齐
  settings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    deepseek: { ...DEFAULT_SETTINGS.deepseek, ...(settings?.deepseek ?? {}) }
  }
  writeJson('settings.json', settings)
}

function persistUsers(): void {
  writeJson('users.json', users)
}
function persistRecords(): void {
  writeJson('records.json', records)
}
function persistPapers(): void {
  writeJson('papers.json', papers)
}
function persistSettings(): void {
  writeJson('settings.json', settings)
}
function persistSessions(): void {
  writeJson('sessions.json', sessions)
}

// ---- 题库 / 学习资料（只读种子数据 + 本地导入的题目）----
function importedQuestions(): Question[] {
  return importedPapers.flatMap((p) => p.questions)
}

export function getQuestions(): Question[] {
  return [...seedQuestions, ...seedRealQuestions, ...generatedQuestions, ...importedQuestions()]
}

export function getQuestionById(id: string): Question | undefined {
  return (
    seedQuestions.find((q) => q.id === id) ??
    seedRealQuestions.find((q) => q.id === id) ??
    generatedQuestions.find((q) => q.id === id) ??
    importedQuestions().find((q) => q.id === id)
  )
}

// 保存一道 AI 自动生成的题目（按 id 去重）
export function addGeneratedQuestion(question: Question): void {
  if (generatedQuestions.some((q) => q.id === question.id)) return
  generatedQuestions.push(question)
  writeJson('generatedQuestions.json', generatedQuestions)
}

export function getStudyMaterials(): StudyMaterial[] {
  return seedStudy
}

export function getStudyMaterialById(id: string): StudyMaterial | undefined {
  return seedStudy.find((s) => s.id === id)
}

// ---- 用户 ----
export function getUsers(): User[] {
  return users
}
export function addUser(user: User): void {
  users.push(user)
  persistUsers()
}
export function findUserByUsername(username: string): User | undefined {
  return users.find((u) => u.username === username)
}
export function findUserById(id: string): User | undefined {
  return users.find((u) => u.id === id)
}

const DEFAULT_USER_ID = 'local-default-user'

// 无登录流程，使用固定的本地默认用户，保证历史记录可持久化
export function ensureDefaultUser(): User {
  let user = users.find((u) => u.id === DEFAULT_USER_ID)
  if (!user) {
    user = {
      id: DEFAULT_USER_ID,
      username: 'local',
      nickname: '本地用户',
      passwordHash: '',
      salt: '',
      createdAt: Date.now()
    }
    users.push(user)
    persistUsers()
  }
  return user
}

// ---- 记录 ----
export function getRecordsByUser(userId: string): PracticeRecord[] {
  return records
    .filter((r) => r.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
}
// 该用户已作答过的题目 id 集合：抽题时据此排除，避免重复抽到同一道题
export function getAnsweredQuestionIds(userId: string): Set<string> {
  return new Set(records.filter((r) => r.userId === userId).map((r) => r.questionId))
}
export function addRecord(record: PracticeRecord): void {
  records.push(record)
  persistRecords()
}
export function getRecordById(id: string): PracticeRecord | undefined {
  return records.find((r) => r.id === id)
}
// 覆盖更新一条作答记录（用于按新标准重新评审）
export function updateRecord(record: PracticeRecord): void {
  const idx = records.findIndex((r) => r.id === record.id)
  if (idx >= 0) {
    records[idx] = record
    persistRecords()
  }
}
// 删除一条作答记录
export function deleteRecordById(id: string): void {
  records = records.filter((r) => r.id !== id)
  persistRecords()
}

// ---- 局域网同步：记录合并 ----
function randomToken(): string {
  return randomBytes(4).toString('hex').toUpperCase()
}

export function getAllRecords(): PracticeRecord[] {
  return records.slice().sort((a, b) => b.createdAt - a.createdAt)
}

function isValidRecord(r: unknown): r is PracticeRecord {
  const v = r as PracticeRecord
  return (
    !!v &&
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.questionId === 'string' &&
    typeof v.createdAt === 'number' &&
    !!v.scoreResult &&
    typeof v.scoreResult.score === 'number'
  )
}

// 按 id 合并外部传入的记录：只新增、不覆盖、不删除，返回新增条数
export function mergeRecords(incoming: unknown, userId: string): number {
  if (!Array.isArray(incoming)) return 0
  const ids = new Set(records.map((r) => r.id))
  let added = 0
  for (const raw of incoming) {
    if (!isValidRecord(raw) || ids.has(raw.id)) continue
    records.push({ ...raw, userId })
    ids.add(raw.id)
    added++
  }
  if (added > 0) persistRecords()
  return added
}

export function getLanSyncState(): LanSyncState {
  return lanSync
}

export function updateLanSyncState(patch: Partial<LanSyncState>): LanSyncState {
  lanSync = { ...lanSync, ...patch }
  writeJson('lanSync.json', lanSync)
  return lanSync
}

export function regenerateLanSyncToken(): string {
  return updateLanSyncState({ token: randomToken() }).token
}

// ---- 整卷 ----
export function getPapers(): Paper[] {
  return papers.sort((a, b) => b.createdAt - a.createdAt)
}
export function addPaper(paper: Paper): void {
  papers.push(paper)
  persistPapers()
}
export function getPaperById(id: string): Paper | undefined {
  return papers.find((p) => p.id === id)
}

// ---- 真题卷（内置种子数据 + 本地导入）----
export function getRealPapers(): Paper[] {
  return [...importedPapers.map((p) => p.paper), ...seedRealPapers]
}

export function getRealPaperById(id: string): Paper | undefined {
  return (
    importedPapers.find((p) => p.paper.id === id)?.paper ??
    seedRealPapers.find((p) => p.id === id)
  )
}

// 保存一张导入的真题卷（含解析出的题目）
export function addImportedPaper(item: ImportedPaper): void {
  importedPapers.push(item)
  writeJson('importedPapers.json', importedPapers)
}

// ---- 设置 ----
export function getSettings(): AppSettings {
  return settings
}
export function updateSettings(next: AppSettings): void {
  settings = {
    ...DEFAULT_SETTINGS,
    ...next,
    deepseek: { ...DEFAULT_SETTINGS.deepseek, ...(next?.deepseek ?? {}) }
  }
  persistSettings()
}

// ---- 练习会话（退出后继续作答）----
export function getSessionsByUser(userId: string): PracticeSession[] {
  return sessions
    .filter((s) => s.userId === userId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
export function upsertSession(session: PracticeSession): void {
  const idx = sessions.findIndex((s) => s.id === session.id)
  if (idx >= 0) sessions[idx] = session
  else sessions.push(session)
  persistSessions()
}
export function deleteSessionById(id: string): void {
  sessions = sessions.filter((s) => s.id !== id)
  persistSessions()
}
