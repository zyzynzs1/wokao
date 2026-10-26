// 申论五大题型（知识点模块）
export type QuestionType =
  | '归纳概括'
  | '综合分析'
  | '提出对策'
  | '应用文写作'
  | '文章论述'

// 考试类型
export type ExamType = '国考' | '省考'

// 国考职位类别 / 省考层级
export type SubType = '副省级' | '地市级' | '行政执法类' | '省市级' | '县乡级'

// 练习难度档位（用于随机练习 / 整卷练习 / 知识点练习的难度筛选）
// 档位区间与难度描述保持一致：0-4 入门·基础，5-6 进阶，7-10 较难·高难
export interface DifficultyBand {
  id: string
  label: string
  min: number
  max: number
}

export const DIFFICULTY_BANDS: DifficultyBand[] = [
  { id: 'all', label: '不限难度', min: 0, max: 10 },
  { id: 'easy', label: '入门 · 0-4', min: 0, max: 4 },
  { id: 'medium', label: '进阶 · 5-6', min: 5, max: 6 },
  { id: 'hard', label: '较难 · 7-10', min: 7, max: 10 }
]

// 可选省份（省考），默认辽宁
export const PROVINCES: string[] = [
  '辽宁',
  '北京',
  '天津',
  '上海',
  '重庆',
  '河北',
  '山西',
  '内蒙古',
  '吉林',
  '黑龙江',
  '江苏',
  '浙江',
  '安徽',
  '福建',
  '江西',
  '山东',
  '河南',
  '湖北',
  '湖南',
  '广东',
  '广西',
  '海南',
  '四川',
  '贵州',
  '云南',
  '西藏',
  '陕西',
  '甘肃',
  '青海',
  '宁夏',
  '新疆'
]

// 采分点
export interface ScoringPoint {
  id: string
  label: string // 得分点名称
  keywords: string[] // 用于匹配的关键词（原词或近义词）
  score: number // 该点分值
}

// 大作文划档标准
export interface GradingBand {
  band: string // 一类文 / 二类文 ...
  scoreRange: [number, number]
  description: string
}

// 题目
export interface Question {
  id: string
  type: QuestionType
  examType: ExamType
  subType: SubType
  province?: string // 省考题目标注省份；'通用' 表示适用于各省
  topics?: string[] // 话题标签（三级路径，如 '社会/民生保障/养老服务与一老一小'），见 shared/topics.ts
  title: string // 题干/作答要求
  material: string // 给定资料
  requirement: string // 作答要求（分值/字数等说明）
  score: number // 满分
  difficulty: number // 难度（0-10，数字越大越难），由 calcDifficulty 统一推导
  suggestMinutes: number // 建议作答时长（分钟）
  wordLimit: number // 字数要求（大作文为区间上限，小题为上限）
  referenceAnswer: string // 参考答案 / 范文
  scoringPoints: ScoringPoint[] // 踩分点（小题）
  scoringRules: string // 评分标准说明
  gradingBands?: GradingBand[] // 大作文划档
  modelEssay?: string // 大作文范文
  source: string // 真题来源
}

// 用户
export interface User {
  id: string
  username: string
  nickname: string
  passwordHash: string
  salt: string
  createdAt: number
}

export type SafeUser = Omit<User, 'passwordHash' | 'salt'>

// 练习类型
export type PracticeType = '随机练习' | '整卷练习' | '真题练习' | '知识点练习' | '重新练习'

// 得分点结果
// 约定：各采分点 score 之和 = 卷面满分；总分 = Σ got；
// 得分点展示 got>0 的点，扣分点展示 got<score 的点（扣 score-got）
export interface PointResult {
  pointId: string
  label: string
  score: number // 该采分点满分
  got: number // 实得分（0 ~ score）
  hit: boolean // 是否得分（got > 0）
}

// 评分结果
export interface ScoreResult {
  totalScore: number // 卷面满分
  score: number // 实得分
  ratio: number // 得分率 0-1
  pointResults: PointResult[] // 踩点明细
  formatScore: number // 条理/格式分
  wordCount: number // 实际字数
  overWordLimit: boolean // 是否超字数
  band?: string // 大作文档次
  hitSummary: string[] // 命中要点（得分点）
  missSummary: string[] // 遗漏要点（扣分点）
  scoredBy?: 'ai' | 'rule' // 分数来源：ai=大模型从严评分，rule=本地规则兜底
}

// 题干标记（高亮）：记录在题干某段文字上的字符区间
export interface HighlightMark {
  field: 'title' | 'requirement' | 'material' // 标记落在哪一段文字上
  start: number // 起始字符下标
  end: number // 结束字符下标（不含）
  color: string // 标记颜色
}

// 作答记录
export interface PracticeRecord {
  id: string
  userId: string
  questionId: string
  practiceType: PracticeType
  paperId?: string
  answer: string
  scoreResult: ScoreResult
  feedback: string // AI 综合点评
  suggestions: string[] // 改进建议
  modelAnswer: string // 补充范文/参考答案
  durationSeconds: number
  createdAt: number
  highlights?: HighlightMark[] // 作答时在题干上做的标记
  dimensions?: ScoreDimension[] // 细分维度得分（各维度实得分之和 = 总分）
  losses?: LossItem[] // 主要失分点及原因
  skeleton?: SkeletonPart[] // 答题骨架（只给层级与每层写什么，不含具体内容）
  template?: string // 旧版骨架文本（早期记录遗留，仅在还没有 skeleton 时兜底展示）
}

// 答题骨架的一个层级，如 { part: '一、基本情况', how: '改革背景 + 总体成效，一句话概括' }
export interface SkeletonPart {
  part: string
  how: string
}

// 细分维度得分（结构/要点/语言等）
export interface ScoreDimension {
  name: string
  got: number
  full: number
}

// 主要失分点：失分现象 + 原因说明
export interface LossItem {
  title: string
  reason: string
}

// 整卷
export interface Paper {
  id: string
  title: string
  examType: ExamType
  subType: SubType
  province?: string
  questionIds: string[]
  totalScore: number
  suggestMinutes: number
  createdAt: number
}

// 从本地文件导入的真题：一张卷 + 解析出的题目（持久化保存，与内置真题一并展示）
export interface ImportedPaper {
  paper: Paper
  questions: Question[]
}

// 学习资料
export type StudyCategory = '知识点' | '答题技巧' | '满分范文' | '作答模板'
export interface StudyMaterial {
  id: string
  category: StudyCategory
  title: string
  summary: string
  content: string
  source: string
  createdAt?: number
}

// 知识点预测分数
export interface PredictionItem {
  type: QuestionType
  examType: ExamType
  avgRatio: number | null // 平均得分率，null 表示无记录
  predictedScore: number | null // 预测分数（按满分 100 折算，可空）
  count: number // 做题次数
}

// 进行中的练习会话（用于退出后继续作答）
export interface PracticeSession {
  id: string
  userId: string
  mode: PracticeType
  questionIds: string[]
  paperId?: string
  paperTitle?: string
  province?: string
  suggestMinutes: number // 建议总时长（用于倒计时）
  answers: Record<string, string>
  index: number
  elapsedSeconds: number // 已作答秒数
  startedAt: number
  updatedAt: number
  highlights?: Record<string, HighlightMark[]> // 各题的题干标记，按题目 id 归集
}

// 本地学习资料（文件）
export interface LocalStudyFile {
  name: string
  path: string
  ext: string
}
export interface LocalStudyFolder {
  name: string
  files: LocalStudyFile[]
}

// ---- 大模型服务商预设 ----
// 下列平台均兼容 OpenAI Chat Completions 协议：选中后自动填入接口地址与模型名，
// 用户只需粘贴自己的 API Key。未配置 Key 时应用退化为本地规则评分，练习与打分不受影响。
export interface ModelPreset {
  id: string
  label: string // 下拉中显示的名称
  baseUrl: string
  model: string
  free: boolean // 是否免费（含新用户限免）
  applyUrl: string // 申请 API Key 的地址
  note: string // 说明
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'zhipu',
    label: '智谱 GLM-4-Flash（永久免费）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash-250414',
    free: true,
    applyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    note: '永久免费、不限 Token（仅限并发）。新用户注册另送 2000 万 tokens，推荐没有接口的用户首选。'
  },
  {
    id: 'doubao',
    label: '火山方舟 · 豆包（新用户限免）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-1-pro-260628',
    free: true,
    applyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    note: '首次开通「语言模型」，每个模型赠送 50 万 tokens；额度接近用尽会自动暂停，不会产生费用。'
  },
  {
    id: 'siliconflow',
    label: '硅基流动（部分模型免费）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen3-8B',
    free: true,
    applyUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: '聚合多种开源模型，部分模型免费。具体可用模型与免费范围以其官网标注为准。'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek 官方（按量付费）',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    free: false,
    applyUrl: 'https://platform.deepseek.com/api_keys',
    note: '评分质量最稳定，按量付费。'
  },
  {
    id: 'custom',
    label: '自定义',
    baseUrl: '',
    model: '',
    free: false,
    applyUrl: '',
    note: '手动填写任意兼容 OpenAI 协议的接口地址与模型名。'
  }
]

// AI 自动生成题目的来源标识：内置题库不足以支撑练习时，由大模型即时命题并入库
export const AI_GENERATED_SOURCE = 'AI 自动命题'

// 未配置 API Key 时的点评占位文案（桌面端与手机端共用）
export const NO_KEY_FEEDBACK =
  '本次为本地规则评分。想获得 AI 精批点评、范文与答题骨架？到「设置 → AI 评分模型」选择「智谱 GLM-4-Flash（永久免费）」，按提示免费领取 API Key 后重新作答即可开启。'

// 应用设置
export interface AppSettings {
  province: string // 省考目标省份，默认辽宁
  localStudyDir: string // 本地学习资料目录
  syncDir?: string // 跨设备进度同步目录（云盘共享文件夹），留空表示不启用
  provider?: string // 当前选中的服务商预设 id（用于设置页回显）
  answerLayout?: AnswerLayout // 作答页布局：上下（默认）/ 左右
  deepseek: {
    baseUrl: string
    model: string
    apiKey: string
  }
}

// 作答布局：vertical=资料在上、作答在下；horizontal=资料在左、作答在右并对齐
export type AnswerLayout = 'vertical' | 'horizontal'

// ---- 局域网同步 ----
// 桌面端为服务端（server），手机端为客户端（client）
export interface LanSyncInfo {
  role: 'server' | 'client'
  enabled: boolean // 服务端：服务是否已开启
  running: boolean // 服务端：端口是否正在监听
  port: number
  addresses: string[] // 服务端：可供手机填写的地址
  token: string // 同步码，两端一致
  serverUrl: string // 客户端：电脑端地址
  lastSyncAt: number | null // 最近一次同步时间
  mergedCount: number // 服务端：累计合并进来的记录条数
  error?: string // 服务端启动失败原因
}

export interface LanSyncResult {
  ok: boolean
  error?: string
  added?: number // 本次从对方合并进来的条数
  total?: number // 合并后本机总记录数
}

// ---- 跨设备进度同步（云盘共享文件夹）----
// 每台电脑只写自己命名的那份文件，读取目录内所有对端文件并按 id 合并，避免互相覆盖
export interface ProgressSyncPeer {
  file: string // 对端文件名
  machine: string // 对端机器标识
  records: number // 文件内作答记录条数
  questions: number // 文件内 AI 生成题目条数
  exportedAt: number // 对端最近导出时间
}

export interface ProgressSyncInfo {
  dir: string // 当前配置的同步目录
  enabled: boolean // 是否已配置可用目录
  machine: string // 本机标识（用于命名导出文件）
  myFile: string // 本机导出文件名
  lastImportAt: number | null // 最近一次导入时间
  lastExportAt: number | null // 最近一次导出时间
  lastAddedRecords: number // 最近一次导入新增的作答记录数
  lastAddedQuestions: number // 最近一次导入新增的 AI 题目数
  peers: ProgressSyncPeer[] // 目录内发现的对端文件
  error?: string // 目录不可用等错误信息
}

export interface ProgressSyncResult {
  ok: boolean
  error?: string
  addedRecords?: number
  addedQuestions?: number
  peers?: number // 本次参与合并的对端文件数
  total?: number // 合并后本机作答记录总数
}
