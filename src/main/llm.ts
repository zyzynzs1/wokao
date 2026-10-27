import type {
  AppSettings,
  ExamType,
  GradingBand,
  LossItem,
  PointResult,
  Question,
  QuestionType,
  ScoreDimension,
  ScoreResult,
  ScoringPoint,
  SkeletonPart,
  SubType
} from '../shared/types'
import { AI_GENERATED_SOURCE } from '../shared/types'
import { calcDifficulty, difficultyLabel, type QuestionCore } from '../shared/difficulty'
import { isValidTopicPath, leafTopicPaths } from '../shared/topics'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type DeepSeekConfig = AppSettings['deepseek']

// 单次请求（不含重试逻辑）
async function requestChat(
  s: DeepSeekConfig,
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; useJsonMode: boolean }
): Promise<string> {
  const isDeepSeek = /deepseek\.com/i.test(s.baseUrl)
  const res = await fetch(`${s.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${s.apiKey}`
    },
    body: JSON.stringify({
      model: s.model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 4000,
      // DeepSeek V4 系列默认开启思考模式，会消耗 max_tokens 且不支持 temperature；
      // 本应用为评分/命题场景，统一关闭思考，保证稳定出结果。
      ...(isDeepSeek ? { thinking: { type: 'disabled' } } : {}),
      ...(opts.useJsonMode ? { response_format: { type: 'json_object' } } : {})
    })
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`LLM 请求失败 (${res.status}): ${text.slice(0, 300)}`) as Error & {
      status?: number
    }
    err.status = res.status
    throw err
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  return data?.choices?.[0]?.message?.content ?? ''
}

// 是否为「不支持 response_format」类错误：400/422 且报错信息提到 json 相关参数
function isJsonModeUnsupported(err: unknown): boolean {
  const e = err as Error & { status?: number }
  if (e?.status !== 400 && e?.status !== 422) return false
  return /response_format|json_object|json mode|json 模式|结构化/i.test(e?.message ?? '')
}

export async function chat(
  deepseek: DeepSeekConfig,
  messages: ChatMessage[],
  opts?: { temperature?: number; json?: boolean; maxTokens?: number }
): Promise<string> {
  const base = { temperature: opts?.temperature, maxTokens: opts?.maxTokens }
  const wantJson = !!opts?.json
  try {
    return await requestChat(deepseek, messages, { ...base, useJsonMode: wantJson })
  } catch (err) {
    // 部分平台（豆包、部分开源模型）不支持 response_format，强传会直接 400，
    // 此时摘掉该参数重试一次，由提示词约束模型输出 JSON。
    if (!wantJson || !isJsonModeUnsupported(err)) throw err
    return await requestChat(deepseek, messages, { ...base, useJsonMode: false })
  }
}

export interface FeedbackResult {
  feedback: string
  suggestions: string[]
  modelAnswer: string
  score?: number
  band?: string
  // 小题：大模型对每个采分点的实得分（采分点由模型自主确定，label/full 可选）
  points?: { id: string; got: number; label?: string; full?: number }[]
  // 细分维度实得分；大作文由模型自定维度并给出各自满分（full）
  dimensions?: { name: string; got: number; full?: number }[]
  // 主要失分点及原因
  losses?: LossItem[]
  // 答题骨架（只给层级与每层写什么）
  skeleton?: SkeletonPart[]
}

// 整理模型给出的细分维度：维度名与分值全部采用模型判定，软件只做一致性校正
export function buildDimensions(
  _question: Question,
  scoreResult: ScoreResult,
  aiDims?: { name: string; got: number; full?: number }[]
): ScoreDimension[] {
  if (!aiDims || aiDims.length === 0) return []

  const list: ScoreDimension[] = aiDims
    .map((d) => ({
      name: String(d.name ?? '').trim(),
      full: Math.max(0, Math.round(Number(d.full ?? 0))),
      got: Math.max(0, Math.round(Number(d.got ?? 0)))
    }))
    .filter((d) => d.name !== '' && d.full > 0)
  if (list.length === 0) return []

  // 仅做一致性校正：各维度满分之和须等于卷面总分（按比例缩放满分，不改动实得分）
  const sumFull = list.reduce((s, d) => s + d.full, 0)
  if (sumFull !== scoreResult.totalScore) {
    const scale = scoreResult.totalScore / sumFull
    let acc = 0
    list.forEach((d, i) => {
      const next = i === list.length - 1 ? scoreResult.totalScore - acc : Math.round(d.full * scale)
      d.full = Math.max(0, next)
      acc += d.full
    })
  }
  list.forEach((d) => {
    d.got = Math.min(d.got, d.full)
  })
  return list
}

export async function testConnection(
  deepseek: DeepSeekConfig
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await chat(deepseek, [{ role: 'user', content: '请只回复四个字：连接正常' }], {
      temperature: 0,
      maxTokens: 20
    })
    return { ok: true, message: `连接成功，模型回复：${res.slice(0, 60)}` }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // 尝试提取第一个 {...} 块
    const m = trimmed.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        return JSON.parse(m[0])
      } catch {
        /* ignore */
      }
    }
  }
  return null
}

// 生成点评与范文；小题由模型逐点给出实得分，大作文由模型给档位与分数
export async function generateFeedback(
  deepseek: DeepSeekConfig,
  question: Question,
  answer: string,
  scoreResult: ScoreResult,
  province?: string
): Promise<FeedbackResult> {
  const isEssay = question.type === '文章论述'
  const provinceNote = province && question.examType === '省考' ? `（目标省份：${province}）` : ''

  const systemPrompt =
    '你是国家公务员录用考试《申论》科目的资深阅卷专家，熟悉国考、省考申论的官方阅卷标准。' +
    '评分时必须使用与本题考试层级相对应的、你所掌握的现行最新官方阅卷要求' +
    '（国考副省级、地市级、行政执法类，省考省市级、县乡级各不相同），' +
    '不得混用其他层级、其他考试或过时版本的评分标准。' +
    '请只依据【题目】【作答要求】【给定资料】和【考生作答】独立评分，不要依赖任何预置答案、采分点、维度或评分细则。' +
    '评分必须严格、客观、准确：要点是否齐全、表述是否准确、是否紧扣题目、逻辑与格式是否规范，均按你所掌握的官方阅卷标准判断；' +
    '不得因答案“沾边”“字数达标”“格式完整”就给高分，也不得凭空拔高或压低。' +
    '点评要具体、可操作；失分点必须与你实际扣分的原因一一对应，没有失分就不要编造。\n' +
    '输出要求：\n' +
    '1. 先给出细分维度得分，再给结论，不得只有笼统结论；\n' +
    '2. 失分点只列确实扣了分的，逐条说明“规范要求什么、考生写成什么、应该怎么写”；\n' +
    '3. 答题骨架只写“分几层、每层写什么”，不得照抄范文或复述材料原文。'

  const commonSchema = `
  "losses": [{"title": "主要失分点（必须是实际扣了分的点，一句话，按扣分多少排序，1-5 条；无失分则为空数组 []）", "reason": "为什么失分：规范要求是什么 + 考生实际写成了什么 + 应该怎么写"}],
  "skeleton": [{"part": "层级标题，如 一、基本情况", "how": "这一层该写什么（只写要素与写法）"}]`

  const outputSchema = `{
  "feedback": "综合点评：先肯定优点，再指出主要不足，结合你的评分说明失分原因，100-200字",
  "suggestions": ["改进建议1", "改进建议2", "改进建议3"],
  "modelAnswer": "${
    isEssay
      ? '给出该题的高分范文：必须完整成篇，正文字数符合【作答要求】中的字数规定，严禁只写提纲、要点罗列或缩写'
      : '给出该题的高分参考答案：规范、完整，由你独立撰写'
  }",
  "score": 数字（你按官方阅卷标准独立判定的得分，0-${question.score} 之间、可为 0.5 倍数）,
  "points": [{"id": "由你自主确定的编号", "label": "采分点名称", "full": 数字（该点满分）, "got": 数字（该点实得分）}],
  "dimensions": [{"name": "维度名（由你按该题型自行确定 3-5 个）", "full": 数字（该维度满分）, "got": 数字（该维度实得分）}]${
    isEssay ? ',\n  "band": "你判定的档位（如一类文/二类文/三类文/四类文）"' : ''
  },${commonSchema}
}`

  const userPrompt = `【题目类型】${question.type}（${question.examType}·${question.subType}）${provinceNote}
【题目】${question.title}
【作答要求】${question.requirement}
【给定资料】${question.material.slice(0, 12000)}

【本题满分】${scoreResult.totalScore} 分
【字数】实际 ${scoreResult.wordCount} 字（要求 ${question.wordLimit} 字以内）${scoreResult.overWordLimit ? '，已超字数' : ''}

【考生作答】
${answer.slice(0, 6000)}

${
  isEssay
    ? '【范文要求】modelAnswer 必须是完整成篇的高分范文，正文控制在作答要求规定的字数区间内；不得用提纲、要点罗列、缩写或“（略）”代替。\n'
    : ''
}请严格按以下 JSON 格式输出（不要输出多余文字）：
${outputSchema}`

  const raw = await chat(
    deepseek,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    { temperature: 0.2, json: true, maxTokens: 5000 }
  )

  const parsed = extractJson(raw) as Record<string, unknown> | null
  if (parsed && typeof parsed.feedback === 'string') {
    return {
      feedback: parsed.feedback,
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.map((s) => String(s))
        : [],
      modelAnswer: typeof parsed.modelAnswer === 'string' ? parsed.modelAnswer : question.referenceAnswer,
      score: typeof parsed.score === 'number' ? parsed.score : undefined,
      band: typeof parsed.band === 'string' ? parsed.band : undefined,
      points: parsePoints(parsed.points),
      dimensions: parseDimensions(parsed.dimensions),
      losses: parseLosses(parsed.losses),
      skeleton: parseSkeleton(parsed.skeleton)
    }
  }

  // 兜底：返回原文
  return {
    feedback: raw.slice(0, 2000),
    suggestions: [],
    modelAnswer: question.referenceAnswer
  }
}

// 解析模型返回的采分点实得分（采分点由模型自主确定，名称与分值可选）
function parsePoints(
  raw: unknown
): { id: string; got: number; label?: string; full?: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: { id: string; got: number; label?: string; full?: number }[] = []
  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const o = item as Record<string, unknown>
    const id =
      typeof o.id === 'string' ? o.id : typeof o.pointId === 'string' ? o.pointId : `p${index + 1}`
    const label = typeof o.label === 'string' ? o.label : typeof o.name === 'string' ? o.name : ''
    const got = typeof o.got === 'number' ? o.got : typeof o.score === 'number' ? o.score : NaN
    const full =
      typeof o.full === 'number' ? o.full : typeof o.max === 'number' ? o.max : undefined
    if (!Number.isFinite(got)) return
    out.push({
      id: id || `p${index + 1}`,
      got,
      ...(label.trim() ? { label: label.trim() } : {}),
      ...(typeof full === 'number' && Number.isFinite(full) ? { full } : {})
    })
  })
  return out.length > 0 ? out : undefined
}

// 解析模型返回的细分维度得分（大作文含各维度满分 full）
function parseDimensions(raw: unknown): { name: string; got: number; full?: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: { name: string; got: number; full?: number }[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name : ''
    const got = typeof o.got === 'number' ? o.got : typeof o.score === 'number' ? o.score : NaN
    const full = typeof o.full === 'number' ? o.full : typeof o.max === 'number' ? o.max : undefined
    if (name && Number.isFinite(got)) {
      out.push(full === undefined ? { name, got } : { name, got, full })
    }
  }
  return out.length > 0 ? out : undefined
}

// 解析模型返回的主要失分点
function parseLosses(raw: unknown): LossItem[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: LossItem[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item.trim()) out.push({ title: item.trim(), reason: '' })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title : typeof o.point === 'string' ? o.point : ''
    const reason = typeof o.reason === 'string' ? o.reason : typeof o.detail === 'string' ? o.detail : ''
    if (title || reason) out.push({ title: title || '失分点', reason })
  }
  return out.length > 0 ? out : undefined
}

// 解析模型返回的答题骨架（层级 + 该层写什么）
function parseSkeleton(raw: unknown): SkeletonPart[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: SkeletonPart[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item.trim()) out.push({ part: item.trim(), how: '' })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const part = typeof o.part === 'string' ? o.part : typeof o.name === 'string' ? o.name : ''
    const how = typeof o.how === 'string' ? o.how : typeof o.desc === 'string' ? o.desc : ''
    if (part || how) out.push({ part: part || '要点', how })
  }
  return out.length > 0 ? out : undefined
}

// 得分保留到 0.5（申论阅卷的常用最小单位）
function roundHalf(n: number): number {
  return Math.round(n * 2) / 2
}

// 把一组采分点满分校正为指定卷面总分（缺失分值则均分）
function allocateFulls(fulls: number[], total: number): number[] {
  const sum = fulls.reduce((s, n) => s + n, 0)
  if (sum <= 0) {
    const part = Math.floor(total / fulls.length)
    const rest = total - part * fulls.length
    return fulls.map((_, i) => part + (i < rest ? 1 : 0))
  }
  if (sum === total) return fulls
  const scale = total / sum
  const out = fulls.map((n) => Math.round(n * scale))
  let diff = total - out.reduce((s, n) => s + n, 0)
  for (let i = 0; diff !== 0 && i < out.length * 4; i++) {
    const idx = i % out.length
    const step = diff > 0 ? 1 : -1
    if (out[idx] + step >= 0) {
      out[idx] += step
      diff -= step
    }
  }
  return out
}

// 把模型评分合入评分结果。
// AI 是唯一评分方：总分、档位、失分点均由模型独立判定；
// 采分点仅用于展示得分明细（模型可自主增删、重命名或返回空数组）。
export function applyFeedbackScore(
  question: Question,
  scoreResult: ScoreResult,
  fb: FeedbackResult
): void {
  const maxScore = question.score
  const clampScore = (n: number): number => Math.max(0, Math.min(maxScore, roundHalf(n)))

  // 1) 得分明细：模型给出采分点时按其名称与分值展示
  const points = fb.points ?? []
  if (points.length > 0) {
    const fulls = allocateFulls(
      points.map((p) => (typeof p.full === 'number' && p.full > 0 ? roundHalf(p.full) : 0)),
      maxScore
    )
    const pointResults: PointResult[] = points.map((p, i) => {
      const full = fulls[i] ?? 0
      const got = Math.max(0, Math.min(full, roundHalf(p.got)))
      return {
        pointId: p.id,
        label: p.label?.trim() || `采分点 ${i + 1}`,
        score: full,
        got,
        hit: got > 0
      }
    })
    scoreResult.pointResults = pointResults
    scoreResult.hitSummary = pointResults.filter((p) => p.got > 0).map((p) => p.label)
    scoreResult.missSummary = pointResults.filter((p) => p.got < p.score).map((p) => p.label)
  } else {
    // 模型未拆分采分点：不展示明细，避免与 AI 判定不一致
    scoreResult.pointResults = []
    scoreResult.hitSummary = []
    scoreResult.missSummary = []
  }

  // 2) 总分以模型判定为准；模型漏给总分时退回采分点合计
  if (typeof fb.score === 'number') {
    scoreResult.score = clampScore(fb.score)
    scoreResult.scoredBy = 'ai'
  } else if (points.length > 0) {
    scoreResult.score = Math.min(
      maxScore,
      scoreResult.pointResults.reduce((s, p) => s + p.got, 0)
    )
    scoreResult.scoredBy = 'ai'
  }
  scoreResult.ratio = maxScore > 0 ? scoreResult.score / maxScore : 0
  if (fb.band) scoreResult.band = fb.band

  // 满分时不再列「主要失分点」，避免自相矛盾
  if (scoreResult.totalScore > 0 && scoreResult.score >= scoreResult.totalScore) {
    fb.losses = undefined
  }
}

// ---- AI 自动命题 ----
// 命题参数：向大模型明确「国考/省考（含类别）→ 知识点（题型）→ 难度 → 给分点」
export interface QuestionSpec {
  examType: ExamType
  subType: SubType
  province?: string
  type: QuestionType
  difficultyId?: string
  targetDifficulty: number // 目标难度（0-10）
  topic?: string // 指定话题（三级路径）；留空由模型自选
}

// 各难度档位对应的命题尺度说明，用于让模型产出与目标难度相符的题目
const DIFFICULTY_HINT: { min: number; max: number; hint: string }[] = [
  {
    min: 0,
    max: 4,
    hint: '入门/基础：给定资料较短（300-500 字），给分点较少（3-4 个）且较为显豁，字数要求 200-300 字。'
  },
  {
    min: 5,
    max: 6,
    hint: '进阶：给定资料中等（500-700 字），给分点 4-5 个，需要一定的归纳与提炼，字数要求 300-400 字。'
  },
  {
    min: 7,
    max: 10,
    hint: '较难/高难：给定资料较长（700-1000 字），给分点 5-6 个且较为隐蔽，需要深入分析、归纳与提炼，字数要求 400-600 字。'
  }
]

// 知识点（题型）说明，写入提示词，确保命题方向正确
const TYPE_KNOWLEDGE: Record<QuestionType, string> = {
  归纳概括: '归纳概括（提炼要点，考查阅读理解与概括能力）',
  综合分析: '综合分析（词句理解 / 观点分析，考查剖析与思辨能力）',
  提出对策: '提出对策（针对问题提出可行措施，考查解决问题能力）',
  应用文写作: '应用文写作 / 贯彻执行（按文种撰写，考查格式规范与实务能力）',
  文章论述: '文章论述（大作文，考查立意、论证与语言表达）'
}

// 各题型建议的给分点数量（大作文按划档给分，不设采分点）
const TYPE_POINT_RANGE: Record<QuestionType, string> = {
  归纳概括: '4-5 个',
  综合分析: '4-5 个',
  提出对策: '4-5 个',
  应用文写作: '4-5 个',
  文章论述: '0 个（改为给出四类文划档标准）'
}

function genQuestionId(): string {
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function parseScoringPoints(raw: unknown): ScoringPoint[] {
  if (!Array.isArray(raw)) return []
  const out: ScoringPoint[] = []
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object') return
    const o = item as Record<string, unknown>
    const label = typeof o.label === 'string' ? o.label.trim() : ''
    const score = typeof o.score === 'number' ? Math.round(o.score) : NaN
    if (!label || !Number.isFinite(score) || score <= 0) return
    const keywords = Array.isArray(o.keywords)
      ? o.keywords.map((k) => String(k).trim()).filter(Boolean)
      : []
    out.push({ id: `p${i + 1}`, label, keywords, score })
  })
  return out
}

function parseGradingBands(raw: unknown, score: number): GradingBand[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: GradingBand[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const band = typeof o.band === 'string' ? o.band.trim() : ''
    const min = typeof o.min === 'number' ? o.min : NaN
    const max = typeof o.max === 'number' ? o.max : NaN
    if (!band || !Number.isFinite(min) || !Number.isFinite(max)) continue
    const clamp = (n: number): number => Math.max(0, Math.min(score, Math.round(n)))
    out.push({
      band,
      scoreRange: [clamp(min), clamp(max)],
      description: typeof o.description === 'string' ? o.description : ''
    })
  }
  return out.length > 0 ? out : undefined
}

// 调用大模型原创一道申论练习题。未配置 Key 或生成失败时返回 null（由调用方兜底）。
export async function generateQuestion(
  deepseek: DeepSeekConfig,
  spec: QuestionSpec,
  avoidTitles: string[] = []
): Promise<Question | null> {
  if (!deepseek.apiKey.trim()) return null
  const { examType, subType, province, type, targetDifficulty, topic } = spec
  const isEssay = type === '文章论述'
  const difficultyHint =
    DIFFICULTY_HINT.find((h) => targetDifficulty >= h.min && targetDifficulty <= h.max)?.hint ?? ''
  const examLine =
    examType === '国考'
      ? `国考·${subType}`
      : `省考${province ? `（${province}）` : ''}·${subType}`

  const systemPrompt =
    '你是国家公务员录用考试《申论》科目的资深命题人，熟悉国考与省考的命题规律、材料选编与评分标准。' +
    '请严格按照给定的考试类型、知识点（题型）、难度与给分点要求，原创一道高质量的申论练习题，' +
    '并同时给出可直接用于阅卷的参考答案与给分点。不得照抄已有真题，不得与用户列出的已有题目重复。'

  const pointsInfo = isEssay
    ? '本题为大作文，不设采分点，请改为给出「一类文/二类文/三类文/四类文」四档划档标准，每档写明分数区间与特征描述。'
    : `请给出 ${TYPE_POINT_RANGE[type]} 个给分点，每个给分点必须写明：要点名称（label）、判定关键词（keywords，2-4 个近义或原词）、本题分值（score）；各给分点分值之和必须等于本题满分。`

  const userPrompt = `【本次命题参数（必须严格遵守）】
- 考试类型与类别：${examLine}
- 知识点（题型）：${TYPE_KNOWLEDGE[type]}
- 目标难度：${targetDifficulty}/10（${difficultyLabel(targetDifficulty)}）。${difficultyHint}
- 给分点要求：${pointsInfo}

【话题要求】
${
  topic
    ? `本题目的话题已指定为「${topic}」，给定资料与作答任务必须围绕该话题展开，不得跑题。`
    : '请从下面的话题清单中选择最贴切的一个话题（须为清单中的完整路径，一字不差）。'
}
可选话题清单（一级/二级/三级，须原样引用其中一条完整路径）：
${leafTopicPaths().join('\n')}

【材料要求】
- 围绕一个真实、具体的社会 / 治理 / 发展话题，编写给定资料：小题合计 1500—2500 字，大作文 2200—3000 字，分 4—6 段。
- 采用真实申论材料的写法：具体地区、人物、场景、数据、群众与专家观点、政策表述，以叙事为主；避免“一是……二是……”式的要点罗列，也不要直接写出结论性要点，要点须由材料概括或分析得出。
- 材料须自洽、可信，不得出现“略”“……”等占位。

【题干与作答要求】
- 题干应明确作答任务，与所选题型一致。
- 作答要求写明分值与字数上限，如“要求：全面、准确、有条理，不超过 300 字。（15 分）”。

【参考答案】
- 给出规范、完整、可直接对照阅卷的参考答案（小题贴近采分点，大作文给出范文）。
- 参考答案字数必须达到作答要求字数上限的 85%–100%（小题不超过上限），不得只用提纲或要点罗列；大作文范文须完整成篇并落在规定字数区间内。

${
  avoidTitles.length > 0
    ? `【已存在的同类题目（请勿重复，须在话题、材料与作答任务上均有区别）】\n${avoidTitles
        .map((t, i) => `${i + 1}. ${t}`)
        .join('\n')}\n`
    : ''
}请严格按以下 JSON 格式输出（不要输出多余文字）：
${
  isEssay
    ? `{
  "title": "题干（含作答任务）",
  "material": "给定资料",
  "requirement": "作答要求（含分值与字数）",
  "topics": ["话题完整路径"],
  "score": 数字（本题满分）,
  "wordLimit": 数字（字数上限）,
  "suggestMinutes": 数字（建议作答分钟数）,
  "referenceAnswer": "范文",
  "scoringRules": "划档给分说明",
  "gradingBands": [{"band": "一类文", "min": 数字, "max": 数字, "description": "该档特征"}]
}`
    : `{
  "title": "题干（含作答任务）",
  "material": "给定资料",
  "requirement": "作答要求（含分值与字数）",
  "topics": ["话题完整路径"],
  "score": 数字（本题满分，须等于各给分点分值之和）,
  "wordLimit": 数字（字数上限）,
  "suggestMinutes": 数字（建议作答分钟数）,
  "referenceAnswer": "参考答案",
  "scoringRules": "按点给分说明",
  "scoringPoints": [{"label": "要点名称", "keywords": ["关键词1", "关键词2"], "score": 数字（该点分值）}]
}`
}`

  const raw = await chat(
    deepseek,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    { temperature: 0.8, json: true, maxTokens: 8000 }
  )
  const parsed = extractJson(raw) as Record<string, unknown> | null
  if (!parsed) return null

  const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
  const material = typeof parsed.material === 'string' ? parsed.material.trim() : ''
  if (!title || !material) return null

  const scoringPoints: ScoringPoint[] = isEssay ? [] : parseScoringPoints(parsed.scoringPoints)
  let score = typeof parsed.score === 'number' && parsed.score > 0 ? Math.round(parsed.score) : 0
  // 小题以给分点分值之和为准，保证「各点分值合计 = 满分」
  if (!isEssay && scoringPoints.length > 0) score = scoringPoints.reduce((s, p) => s + p.score, 0)
  if (score <= 0) score = isEssay ? 40 : 15

  const wordLimit =
    typeof parsed.wordLimit === 'number' && parsed.wordLimit > 0
      ? Math.round(parsed.wordLimit)
      : isEssay
        ? 1000
        : 300
  const suggestMinutes =
    typeof parsed.suggestMinutes === 'number' && parsed.suggestMinutes > 0
      ? Math.round(parsed.suggestMinutes)
      : isEssay
        ? 60
        : 20

  // 话题标签：仅采纳清单内的合法路径；模型未给出或路径不合法时退回调用方指定的话题
  const rawTopics = Array.isArray(parsed.topics) ? parsed.topics.map((t) => String(t).trim()) : []
  const validTopics = rawTopics.filter((t) => isValidTopicPath(t))
  const topics = validTopics.length > 0 ? validTopics : topic && isValidTopicPath(topic) ? [topic] : []

  const core: QuestionCore = {
    id: genQuestionId(),
    type,
    examType,
    subType,
    province: examType === '省考' ? province : undefined,
    topics: topics.length > 0 ? topics : undefined,
    title,
    material,
    requirement:
      typeof parsed.requirement === 'string' && parsed.requirement.trim()
        ? parsed.requirement.trim()
        : `要求：不超过 ${wordLimit} 字。（${score} 分）`,
    score,
    suggestMinutes,
    wordLimit,
    referenceAnswer: typeof parsed.referenceAnswer === 'string' ? parsed.referenceAnswer : '',
    scoringPoints,
    scoringRules: typeof parsed.scoringRules === 'string' ? parsed.scoringRules : '',
    gradingBands: isEssay ? parseGradingBands(parsed.gradingBands, score) : undefined,
    source: AI_GENERATED_SOURCE
  }

  // ---- AI 自命题质量自检（不合格拒绝入库，避免后续评分失真）----
  const warnings: string[] = []
  const refChars = core.referenceAnswer.replace(/\s/g, '').length
  const minRef = isEssay ? Math.max(600, Math.round(wordLimit * 0.5)) : Math.max(120, Math.round(wordLimit * 0.5))
  if (refChars < minRef) {
    warnings.push(`参考答案偏短（${refChars} 字，期望 ≥${minRef} 字）`)
    return null
  }
  if (isEssay) {
    if (!core.gradingBands || core.gradingBands.length < 3) return null
  } else {
    if (core.scoringPoints.length < 3) return null
    if (core.scoringPoints.some((p) => p.keywords.length === 0)) return null
    const pointsSum = core.scoringPoints.reduce((s, p) => s + p.score, 0)
    if (pointsSum !== core.score) return null
  }
  if (core.material.replace(/\s/g, '').length < 600) return null

  return {
    ...core,
    difficulty: calcDifficulty(core),
    referenceSource: 'ai',
    generationMeta: {
      model: deepseek.model,
      promptVersion: 'question-generation-v2.0',
      createdAt: Date.now(),
      validated: true,
      warnings: warnings.length > 0 ? warnings : undefined
    }
  }
}

