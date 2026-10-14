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

// 依据「考试类型 + 题型」给出评分标准说明，作为模型打分的唯一依据
function gradingStandard(question: Question, province?: string): string {
  const { examType, subType, type } = question
  const byType: Record<QuestionType, string> = {
    归纳概括:
      '按点给分，要点齐全、准确是第一位的（约占 70%-80%）；条理清晰、分条作答；表述应与材料原词一致。',
    综合分析:
      '解释（观点）准确 + 分析透彻 + 逻辑清晰 + 结论/要求到位；只罗列不理解、只分析不结论的按比例扣分。',
    提出对策:
      '先概括问题、再给对策；对策须具体、可行、有针对性、有主体，空泛或与问题不对应的要扣分。',
    应用文写作:
      '格式与要素（标题、称谓、正文、落款等，按文种）齐全 + 内容全面 + 语言得体；缺要素、文种不符、格式错误的单独扣分。',
    文章论述:
      '按划档给分：立意是否紧扣题意且深刻、结构是否完整、分论点是否清晰、语言是否规范流畅、字数与卷面是否符合要求。'
  }
  const examLine =
    examType === '国考'
      ? `本题属于【国考·${subType}】，按国考标准从严把握：${
          subType === '副省级'
            ? '更看重分析深度与思想性'
            : subType === '地市级'
              ? '更看重切合实际、措施可行'
              : '更看重依法执法、规范用语与程序意识'
        }。`
      : `本题属于【省考${province ? `（${province}）` : ''}】，按省考标准：相对注重基层实务与可操作性，但格式、字数与表达规范同样从严。`
  return (
    `【评分标准：${examType}·${subType}·${type}】\n` +
    `${examLine}\n` +
    `${byType[type]}\n` +
    '共性扣分项（即使要点已命中，出现下列问题也必须在该要点内扣分，不得因此给满分）：' +
    '①忠于材料，不得拔高、不得添加材料中没有的效果或因果；' +
    '②术语与固定表述必须准确（如“双随机、一公开”不得写成“双随机，一公开”，“跨部门联合检查”不得写成“联合调查”）；' +
    '③条理清晰、分条作答，语言规范、不啰嗦；' +
    '④错别字、标点及固定表述错误每处扣 0.5-1 分；' +
    '⑤字数不足或明显超出按比例扣分。'
  )
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
    '你是本题唯一评分方：最终得分完全由你依据「考试类型 + 题型」对应的官方评分标准确定，' +
    '必须严格按照该标准打分，软件内置的规则评分仅供参考、不得直接照搬。' +
    '打分必须从严把握、宁严勿松：要点不完整、表述不准确、逻辑混乱或格式不规范都应如实扣分，' +
    '不得因考生答案“沾边”就给出高分。所有建议必须合理、可操作。\n' +
    '点评要求（务必逐条落实）：\n' +
    '0. 你是本题唯一评分方，最终得分完全由你依据「考试类型 + 题型」的评分标准确定；软件内置规则评分仅供参考，不得直接照搬；\n' +
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
  "score": 数字（0-${question.score} 之间、可为 0.5 倍数的得分，从严按评分标准给分）,
  "band": "${question.gradingBands?.map((b) => b.band).join('/') ?? '一类文/二类文/三类文/四类文'}"${dimensionsSchema}
}`
    : `{
  "feedback": "综合点评：先肯定优点，再指出主要不足，结合采分点说明失分原因，100-200字",
  "suggestions": ["改进建议1", "改进建议2", "改进建议3"],
  "modelAnswer": "给出该题的高分参考答案（贴近参考答案，规范、完整）",
  "points": [{"id": "采分点编号", "got": 数字（0 到该点满分之间、可为 0.5 倍数的实得分）}]${dimensionsSchema}
}`

  const userPrompt = `【题目类型】${question.type}（${question.examType}·${question.subType}）${provinceNote}
【题目】${question.title}
【作答要求】${question.requirement}
【给定资料摘要】${question.material.slice(0, 3000)}
【参考答案/范文】${question.referenceAnswer.slice(0, 3000)}
【评分标准】${question.scoringRules}${bandInfo}${pointsInfo}${dimensionsInfo}

${gradingStandard(question, province)}

【本题答题骨架范式（供参考，可结合题目微调）】
${SKELETON_PATTERN[question.type]}
（skeleton 只写“层级标题 + 该层写什么”，如 {"part":"一、基本情况","how":"改革背景 + 总体成效，一句话概括"}。
严禁照抄范文，严禁出现材料中的具体事项、数据、专有名词，只保留可复用的结构与写法。）

【参考信息（仅供你参考，不作为给分依据，最终得分由你按上面的评分标准确定）】
- 本卷满分：${scoreResult.totalScore} 分
- 实际字数：${scoreResult.wordCount} 字（要求 ${question.wordLimit} 字以内）${scoreResult.overWordLimit ? '，已超字数' : ''}

【考生作答】
${answer.slice(0, 6000)}

${
  isEssay
    ? ''
    : '逐点给分尺度：要点完整且表述准确给该点满分；要点不全、表述不准或只是“沾边”给部分分；未涉及该要点给 0 分。' +
      '尤其注意：即使要点已命中，只要存在术语/固定表述错误、拔高或添加材料以外的内容、层次归类混乱、错别字，' +
      '也必须在该要点内扣分，不得给满分。总分将按各采分点实得分合计得出，无需你另外给出总分。\n'
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

// 得分保留到 0.5（申论阅卷的常用最小单位）
function roundHalf(n: number): number {
  return Math.round(n * 2) / 2
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
      const clamped = Math.max(0, Math.min(question.score, roundHalf(fb.score)))
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
    const got = typeof raw === 'number' ? Math.max(0, Math.min(p.score, roundHalf(raw))) : 0
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

