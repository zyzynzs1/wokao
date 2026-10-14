import type {
  AppSettings,
  LossItem,
  PointResult,
  Question,
  QuestionType,
  ScoreDimension,
  ScoreResult,
  SkeletonPart
} from '../shared/types'

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
  // 小题：大模型对每个采分点的实得分
  points?: { id: string; got: number }[]
  // 细分维度（结构/要点/语言等）实得分
  dimensions?: { name: string; got: number }[]
  // 主要失分点及原因
  losses?: LossItem[]
  // 答题骨架（只给层级与每层写什么）
  skeleton?: SkeletonPart[]
}

// 各题型答题骨架范式：只描述"分几层、每层写什么"，不含具体内容
const SKELETON_PATTERN: Record<QuestionType, string> = {
  归纳概括: '总括句（一句话点明总体情况）；分条罗列要点，每条“概括词 + 具体表现”',
  综合分析: '一、解释含义或亮明观点；二、展开分析（原因 / 影响 / 本质）；三、得出结论或给出对策',
  提出对策: '一、问题梳理；二、对策分条罗列，每条“主体 + 措施 + 目的”',
  应用文写作:
    '标题；称谓（按文种）；一、背景与总体情况；二、具体做法及成效；三、存在问题；四、下一步安排；落款（单位、日期按文种决定）',
  文章论述: '标题（点明总论点）；开头（引出话题 + 亮明总论点）；分论点一 / 二 / 三（分论点 + 论据 + 回扣）；结尾（总结升华）'
}

// 细分维度定义：各维度满分按满分权重折算，折算结果保证求和等于卷面满分
const DIMENSION_CONFIG: Record<'small' | 'essay', { name: string; weight: number }[]> = {
  small: [
    { name: '结构', weight: 0.2 },
    { name: '要点', weight: 0.6 },
    { name: '语言', weight: 0.2 }
  ],
  essay: [
    { name: '立意', weight: 0.3 },
    { name: '结构', weight: 0.25 },
    { name: '语言', weight: 0.25 },
    { name: '字数与卷面', weight: 0.2 }
  ]
}

function dimensionBars(isEssay: boolean, totalScore: number): ScoreDimension[] {
  const config = DIMENSION_CONFIG[isEssay ? 'essay' : 'small']
  const bars: ScoreDimension[] = config.map((c) => ({
    name: c.name,
    got: 0,
    full: Math.floor(totalScore * c.weight)
  }))
  let rest = totalScore - bars.reduce((s, b) => s + b.full, 0)
  for (let i = 0; rest > 0; i = (i + 1) % bars.length, rest--) bars[i].full += 1
  return bars
}

// 把模型给的维度得分对齐到固定维度上，并使各维度实得分之和 = 总分
export function buildDimensions(
  question: Question,
  scoreResult: ScoreResult,
  aiDims?: { name: string; got: number }[]
): ScoreDimension[] {
  if (!aiDims || aiDims.length === 0) return []
  const bars = dimensionBars(question.type === '文章论述', scoreResult.totalScore)
  const byName = new Map(aiDims.map((d) => [d.name.trim(), d.got]))
  // 模型未按给定维度名返回时，放弃细分而不是错配
  if (bars.some((b) => !byName.has(b.name))) return []
  const list = bars.map((b) => ({
    ...b,
    got: Math.max(0, Math.min(b.full, Math.round(byName.get(b.name) as number)))
  }))
  let diff = scoreResult.score - list.reduce((s, d) => s + d.got, 0)
  for (const d of list) {
    if (diff === 0) break
    const room = diff > 0 ? d.full - d.got : d.got
    const move = diff > 0 ? Math.min(diff, room) : -Math.min(-diff, room)
    d.got += move
    diff -= move
  }
  return diff === 0 ? list : []
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
    '你是国家公务员录用考试《申论》科目的资深阅卷专家，熟悉国考与省考申论的评分标准。' +
    '请基于给定的参考答案、采分点和评分标准，对考生作答进行客观、准确、有建设性的点评，' +
    '不得编造采分点，不得脱离材料与评分标准随意打分。' +
    '打分必须从严把握、宁严勿松：要点不完整、表述不准确、逻辑混乱或格式不规范都应如实扣分，' +
    '不得因考生答案“沾边”就给出高分。所有建议必须合理、可操作。\n' +
    '点评要求（务必逐条落实）：\n' +
    '1. 先给出细分维度得分，再给结论，不得只有笼统结论；\n' +
    '2. 主要失分点必须与实际扣分一一对应：只针对你确实扣了分的采分点（或维度）逐条列出，' +
    '每条都要说清“为什么失分”——规范要求是什么、考生实际写成了什么、应该怎么写；' +
    '若本题考生作答没有失分（各采分点均满分），则不要编造失分点，losses 必须返回空数组 []；\n' +
    '3. 若存在下列硬伤并已据此扣分，需在失分点中说明其扣分原因：漏写关键数据、错别字或用词错误、文体/格式不符（如汇报提纲缺“总体成效—具体做法及成效—存在问题—下一步安排”层次）、' +
    '把不同层次内容混写、语言啰嗦或作文腔；未据此扣分的不要列为失分点；\n' +
    '4. 最后给出该题型的答题骨架：只写“分几层、每层写什么”，必须弱化具体内容，不得照抄范文、不得复述材料原文。'

  const bandInfo = isEssay
    ? `\n\n【划档评分标准】\n${(question.gradingBands ?? [])
        .map((b) => `${b.band}：${b.scoreRange[0]}-${b.scoreRange[1]}分，${b.description}`)
        .join('\n')}`
    : ''

  const pointsInfo =
    !isEssay && question.scoringPoints.length > 0
      ? `\n\n【采分点清单（必须逐点给分，不得增删或改名）】\n${question.scoringPoints
          .map((p) => `${p.id}｜${p.label}｜本点满分 ${p.score} 分`)
          .join('\n')}`
      : ''

  const dimBars = dimensionBars(isEssay, question.score)
  const dimensionsInfo = `\n\n【细分维度（本卷满分 ${question.score} 分）】\n${dimBars
    .map((d) => `${d.name}：满分 ${d.full} 分`)
    .join('\n')}\n（各维度实得分之和必须等于总分${
    isEssay ? '，即你给出的 score' : '，即各采分点实得分之和'
  }）`

  const dimensionsSchema = `,
  "dimensions": [{"name": "维度名（必须与上面给定的维度名完全一致）", "got": 数字（该维度实得分，0 到该维度满分之间）}],
  "losses": [{"title": "主要失分点（必须是实际扣了分的点，一句话，按扣分多少排序，1-5 条；无失分则为空数组 []）", "reason": "为什么失分：规范要求是什么 + 你实际写成了什么 + 应该怎么写"}],
  "skeleton": [{"part": "层级标题，如 一、基本情况", "how": "这一层该写什么（只写要素与写法，如“改革背景 + 总体成效，一句话概括”）"}]`

  const outputSchema = isEssay
    ? `{
  "feedback": "综合点评：先肯定优点，再指出主要不足，结合划档标准说明失分原因，100-200字",
  "suggestions": ["改进建议1", "改进建议2", "改进建议3"],
  "modelAnswer": "给出该题的高分范文（贴近参考答案，规范、完整）",
  "score": 数字（0-${question.score} 之间的整数，从严按评分标准给分）,
  "band": "${question.gradingBands?.map((b) => b.band).join('/') ?? '一类文/二类文/三类文/四类文'}"${dimensionsSchema}
}`
    : `{
  "feedback": "综合点评：先肯定优点，再指出主要不足，结合采分点说明失分原因，100-200字",
  "suggestions": ["改进建议1", "改进建议2", "改进建议3"],
  "modelAnswer": "给出该题的高分参考答案（贴近参考答案，规范、完整）",
  "points": [{"id": "采分点编号", "got": 数字（0 到该点满分之间的整数，该点实得分）}]${dimensionsSchema}
}`

  const userPrompt = `【题目类型】${question.type}（${question.examType}·${question.subType}）${provinceNote}
【题目】${question.title}
【作答要求】${question.requirement}
【给定资料摘要】${question.material.slice(0, 3000)}
【参考答案/范文】${question.referenceAnswer.slice(0, 3000)}
【评分标准】${question.scoringRules}${bandInfo}${pointsInfo}${dimensionsInfo}

【本题答题骨架范式（供参考，可结合题目微调）】
${SKELETON_PATTERN[question.type]}
（skeleton 只写“层级标题 + 该层写什么”，如 {"part":"一、基本情况","how":"改革背景 + 总体成效，一句话概括"}。
严禁照抄范文，严禁出现材料中的具体事项、数据、专有名词，只保留可复用的结构与写法。）

【规则评分结果】
- 满分：${scoreResult.totalScore} 分
- 规则得分：${scoreResult.score} 分
- 命中要点（得分点）：${scoreResult.hitSummary.join('、') || '无'}
- 遗漏要点（扣分点）：${scoreResult.missSummary.join('、') || '无'}
- 实际字数：${scoreResult.wordCount} 字（要求 ${question.wordLimit} 字以内）${scoreResult.overWordLimit ? '，已超字数' : ''}

【考生作答】
${answer.slice(0, 6000)}

${
  isEssay
    ? ''
    : '逐点给分尺度：要点完整且表述准确给该点满分；要点不全、表述不准或只是“沾边”给部分分；未涉及该要点给 0 分。总分将按各采分点实得分合计得出，无需你另外给出总分。\n'
}
请严格按以下 JSON 格式输出（不要输出多余文字）：
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

// 解析模型返回的采分点实得分
function parsePoints(raw: unknown): { id: string; got: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: { id: string; got: number }[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : typeof o.pointId === 'string' ? o.pointId : ''
    const got = typeof o.got === 'number' ? o.got : typeof o.score === 'number' ? o.score : NaN
    if (id && Number.isFinite(got)) out.push({ id, got })
  }
  return out.length > 0 ? out : undefined
}

// 解析模型返回的细分维度得分
function parseDimensions(raw: unknown): { name: string; got: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: { name: string; got: number }[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name : ''
    const got = typeof o.got === 'number' ? o.got : typeof o.score === 'number' ? o.score : NaN
    if (name && Number.isFinite(got)) out.push({ name, got })
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

// 把模型评分合并进规则评分结果。
// 小题：以模型逐点给分为准重建采分点明细，总分取各点实得分之和，
//       从而保证「得分点合计 + 扣分点合计 = 满分」且总分与明细一致；
//       模型未返回可用明细时保留本地规则评分（同样自洽）。
// 大作文：沿用模型给出的档位与分数。
export function applyFeedbackScore(
  question: Question,
  scoreResult: ScoreResult,
  fb: FeedbackResult
): void {
  if (question.type === '文章论述' || question.scoringPoints.length === 0) {
    if (fb.band) scoreResult.band = fb.band
    if (typeof fb.score === 'number') {
      const clamped = Math.max(0, Math.min(question.score, Math.round(fb.score)))
      scoreResult.score = clamped
      scoreResult.ratio = question.score > 0 ? clamped / question.score : 0
      scoreResult.scoredBy = 'ai'
    }
    // 没有实际失分就不要保留「主要失分点」，避免与「无扣分」自相矛盾
    if (scoreResult.totalScore > 0 && scoreResult.score >= scoreResult.totalScore) {
      fb.losses = undefined
    }
    return
  }

  const gotById = new Map<string, number>()
  for (const p of fb.points ?? []) gotById.set(p.id.trim(), p.got)
  const matched = question.scoringPoints.filter((p) => gotById.has(p.id.trim()))
  if (matched.length === 0) return

  const pointResults: PointResult[] = question.scoringPoints.map((p) => {
    const raw = gotById.get(p.id.trim())
    const got = typeof raw === 'number' ? Math.max(0, Math.min(p.score, Math.round(raw))) : 0
    return { pointId: p.id, label: p.label, score: p.score, got, hit: got > 0 }
  })
  const total = Math.min(question.score, pointResults.reduce((s, p) => s + p.got, 0))
  scoreResult.pointResults = pointResults
  scoreResult.score = total
  scoreResult.ratio = question.score > 0 ? total / question.score : 0
  scoreResult.hitSummary = pointResults.filter((p) => p.got > 0).map((p) => p.label)
  scoreResult.missSummary = pointResults.filter((p) => p.got < p.score).map((p) => p.label)
  scoreResult.scoredBy = 'ai'
  // 采分点全部满分时不应再列「主要失分点」，保证与「无扣分」一致
  if (scoreResult.totalScore > 0 && total >= scoreResult.totalScore) {
    fb.losses = undefined
  }
}

