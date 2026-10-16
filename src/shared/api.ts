import type {
  AppSettings,
  ExamType,
  HighlightMark,
  LanSyncInfo,
  LanSyncResult,
  LocalStudyFolder,
  Paper,
  PracticeRecord,
  PracticeSession,
  PredictionItem,
  ProgressSyncInfo,
  ProgressSyncResult,
  Question,
  QuestionType,
  SafeUser,
  StudyMaterial,
  SubType
} from './types'

export interface SubmitPayload {
  userId: string
  questionId: string
  answer: string
  practiceType: string
  paperId?: string
  durationSeconds: number
  province?: string
  highlights?: HighlightMark[]
}

export interface SubmitResult {
  ok: boolean
  record?: PracticeRecord
  error?: string
}

// 重新评审结果
export type ReevaluateResult = SubmitResult

export interface Api {
  ensureDefaultUser: () => Promise<SafeUser>

  getQuestions: () => Promise<Question[]>
  getQuestion: (id: string) => Promise<Question | undefined>
  // userId 用于排除该用户已作答过的题目（避免重复抽题）；题目不足时由 AI 自动命题补足
  // topic 为可选话题筛选（三级路径，如 '社会/民生保障'，含下级话题）
  randomQuestion: (
    type?: QuestionType,
    examType?: ExamType,
    province?: string,
    difficultyId?: string,
    userId?: string,
    topic?: string
  ) => Promise<Question | null>
  getQuestionTypes: () => Promise<QuestionType[]>

  getPapers: () => Promise<Paper[]>
  generatePaper: (
    examType: ExamType,
    subType: SubType,
    province?: string,
    difficultyId?: string,
    userId?: string,
    topic?: string
  ) => Promise<Paper>
  getPaper: (id: string) => Promise<Paper | undefined>

  getRealPapers: () => Promise<Paper[]>
  getRealPaper: (id: string) => Promise<Paper | undefined>
  // 导入本地文件解析出的真题卷（zip / word / pdf），存入真题库
  importRealPaper: (paper: Paper, questions: Question[]) => Promise<{ ok: boolean; error?: string }>

  getRecords: (userId: string) => Promise<PracticeRecord[]>
  getRecord: (id: string) => Promise<PracticeRecord | undefined>
  deleteRecord: (id: string) => Promise<void>
  submitAnswer: (payload: SubmitPayload) => Promise<SubmitResult>
  // 按最新评价标准重新评审一条历史作答记录
  reevaluateRecord: (id: string) => Promise<ReevaluateResult>
  getPredictions: (userId: string) => Promise<PredictionItem[]>

  getSessions: (userId: string) => Promise<PracticeSession[]>
  saveSession: (session: PracticeSession) => Promise<void>
  deleteSession: (id: string) => Promise<void>

  getStudyMaterials: () => Promise<StudyMaterial[]>
  getStudyMaterial: (id: string) => Promise<StudyMaterial | undefined>

  listLocalStudy: () => Promise<LocalStudyFolder[]>
  openLocalStudy: (path: string) => Promise<{ ok: boolean; error?: string }>

  getSettings: () => Promise<AppSettings>
  updateSettings: (next: AppSettings) => Promise<AppSettings>
  testConnection: () => Promise<{ ok: boolean; message: string }>

  // 局域网同步：桌面端为服务端，手机端为客户端
  getLanSyncInfo: () => Promise<LanSyncInfo>
  setLanSyncServer: (enabled: boolean) => Promise<LanSyncInfo>
  regenerateSyncToken: () => Promise<LanSyncInfo>
  saveLanSyncClient: (serverUrl: string, token: string) => Promise<LanSyncInfo>
  runLanSync: () => Promise<LanSyncResult>

  // 跨设备进度同步（云盘共享文件夹）：每台电脑只写自己那份文件，按 id 合并
  getProgressSyncInfo: () => Promise<ProgressSyncInfo>
  setProgressSyncDir: (dir: string) => Promise<ProgressSyncInfo>
  pickProgressSyncDir: () => Promise<ProgressSyncInfo>
  runProgressSync: () => Promise<ProgressSyncResult>
  openProgressSyncDir: () => Promise<{ ok: boolean; error?: string }>
}
