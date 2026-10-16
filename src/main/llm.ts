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
  // 细分维度实得分；大作文由模型自定维度并给出各自满分（full）
  dimensions?: { name: string; got: number; full?: number }[]
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

// 细分维度定义：小题维度固定；大作文仅作为「建议维度」提供给模型参考，模型可自行调整
const DIMENSION_CONFIG: Record<'small' | 'essay', { name: string; weight: number }[]> = {
  small: [
    { name: '结构', weight: 0.2 },
    { name: '要点', weight: 0.6 },
    { name: '语言', weight: 0.2 }
  ],
  essay: [
    { name: '立意', weight: 0.2 },
    { name: '结构', weight: 0.2 },
    { name: '论证', weight: 0.3 },
    { name: '语言', weight: 0.2 },
    { name: '字数与卷面', weight: 0.1 }
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

// 整理模型给出的细分维度：大作文完全采用模型的维度与分值，小题对齐到固定维度
export function buildDimensions(
  question: Question,
  scoreResult: ScoreResult,
  aiDims?: { name: string; got: number; full?: number }[]
): ScoreDimension[] {
  if (!aiDims || aiDims.length === 0) return []

  // 大作文：维度名与各维度满分都由模型按官方阅卷标准给出，软件不再套用权重、不平摊残差
  if (question.type === '文章论述') {
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

  // 小题：维度固定（结构/要点/语言），并保证各维度实得分之和 = 总分
  const bars = dimensionBars(false, scoreResult.totalScore)
  const byName = new Map(aiDims.map((d) => [d.name.trim(), d.got]))
  // 模型未按给定维度名返回时，放弃细分而不是错配
  if (bars.some((b) => !byName.has(b.name))) return []
  const list = bars.map((b) => ({
    ...b,
    got: Math.max(0, Math.min(b.full, Math.round(byName.get(b.name) ?? 0)))
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
    `【阅卷要点参考（${examType}·${subType}·${type}）】\n` +
    '（以下要点由软件整理，仅供你判断时参考；最终打分请你按自己掌握的该题型官方阅卷标准独立判定，不要机械套用本文本）\n' +
    `${examLine}\n` +
    `${byType[type]}\n` +
    '共性扣分项（出现下列问题必须扣分，不得因此给满分）：' +
    '①忠于材料，不得拔高、不得添加材料中没有的效果或因果；' +
    '②照抄材料：与【给定资料】连续重合达 20 字以上的句子，一律判为照抄材料并扣分；' +
    '③术语与固定表述必须准确（如“双随机、一公开”不得写成“双随机，一公开”，“跨部门联合检查”不得写成“联合调查”）；' +
    '④条理清晰、分条作答，语言规范、不啰嗦；' +
    '⑤错别字、标点及固定表述错误每处扣 0.5-1 分；' +
    '⑥字数量化扣分：少于规定字数下限的，每少 50 字扣 1 分（不足 50 字按 50 字计），最多扣 3 分；明显超出上限的同样每 50 字扣 1 分、最多扣 3 分。'
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
    '你是国家公务员录用考试《申论》科目的资深阅卷专家，精通国考与省考申论的官方阅卷标准。' +
    '请依据该题型的官方阅卷标准，对考生作答进行独立、客观、准确、有建设性的评判，' +
    '不得编造采分点，不得脱离材料与作答随意打分。' +
    '你是本题唯一评分方：最终得分、档位、细分维度与失分点全部由你独立判定；' +
    '题目中给出的评分材料仅作参考，不得机械套用，也不得照搬其中的表述当作结论。' +
    '打分必须从严把握、宁严勿松：要点不完整、表述不准确、扣题不紧、逻辑混乱或格式不规范都应如实扣分，' +
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

  // 大作文：细分维度由模型按官方阅卷维度自行确定，软件不再预设权重
  const dimensionsInfo = isEssay
    ? `\n\n【细分维度（本卷满分 ${question.score} 分）】\n细分维度由你按该题型的官方阅卷维度自行确定（3-5 个；可参考：${dimensionBars(true, question.score)
        .map((d) => d.name)
        .join('、')}，也可按你的判断调整），并为每个维度给出满分。\n约束：各维度满分之和必须等于 ${question.score} 分；各维度实得分之和必须等于你给出的 score。`
    : `\n\n【细分维度（本卷满分 ${question.score} 分）】\n${dimensionBars(false, question.score)
        .map((d) => `${d.name}：满分 ${d.full} 分`)
        .join('\n')}\n（各维度实得分之和必须等于总分，即各采分点实得分之和）`

  const commonSchema = `
  "losses": [{"title": "主要失分点（必须是实际扣了分的点，一句话，按扣分多少排序，1-5 条；无失分则为空数组 []）", "reason": "为什么失分：规范要求是什么 + 你实际写成了什么 + 应该怎么写"}],
  "skeleton": [{"part": "层级标题，如 一、基本情况", "how": "这一层该写什么（只写要素与写法，如“改革背景 + 总体成效，一句话概括”）"}]`

  const dimensionsSchema = isEssay
    ? `,
  "dimensions": [{"name": "维度名（由你按官方阅卷维度确定）", "full": 数字（该维度满分）, "got": 数字（该维度实得分，0 到该维度满分之间）}]${commonSchema}`
    : `,
  "dimensions": [{"name": "维度名（必须与上面给定的维度名完全一致）", "got": 数字（该维度实得分，0 到该维度满分之间）}]${commonSchema}`

  const outputSchema = isEssay
    ? `{
  "feedback": "综合点评：先肯定优点，再指出主要不足，结合划档标准说明失分原因，100-200字",
  "suggestions": ["改进建议1", "改进建议2", "改进建议3"],
  "modelAnswer": "给出该题的高分范文：必须完整成篇，正文字数符合【作答要求】中的字数规定（如要求 1000—1200 字，则正文不得少于 1000 字、不超过 1200 字），贴近参考答案的立意与结构，规范、充实，严禁只写提纲、要点罗列或缩写",
  "score": 数字（你按官方阅卷标准独立判定的得分，0-${question.score} 之间、可为 0.5 倍数，且必须落在你判定的档位区间内）,
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
【题目评分要求（软件整理，仅作参考，最终以官方阅卷标准为准）】${question.scoringRules}${bandInfo}${pointsInfo}${dimensionsInfo}

${gradingStandard(question, province)}
${
  isEssay
    ? `\n【范文硬性要求】modelAnswer 必须是完整成篇的高分范文，正文字数须达到【作答要求】规定的字数下限、且不超过上限（例如要求“1000—1200 字”，则正文控制在 1000—1200 字）；不得用提纲、要点罗列、缩写或“（略）”代替；参考上方的立意与结构，用自己的语言充分展开论证。`
    : ''
}

【本题答题骨架范式（供参考，可结合题目微调）】
${SKELETON_PATTERN[question.type]}
（skeleton 只写“层级标题 + 该层写什么”，如 {"part":"一、基本情况","how":"改革背景 + 总体成效，一句话概括"}。
严禁照抄范文，严禁出现材料中的具体事项、数据、专有名词，只保留可复用的结构与写法。）

【参考信息（仅供你参考，不作为给分依据，最终得分由你按官方阅卷标准独立确定）】
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
- 围绕一个真实、具体的社会 / 治理 / 发展话题，编写给定资料（合计 300-1000 字，随难度调整）。
- 资料中要包含可提炼的事实、做法、数据或案例，不要直接给出结论性要点，要点须能由材料概括或分析得出。
- 材料须自洽、可信，不得出现“略”“……”等占位。

【题干与作答要求】
- 题干应明确作答任务，与所选题型一致。
- 作答要求写明分值与字数上限，如“要求：全面、准确、有条理，不超过 300 字。（15 分）”。

【参考答案】
- 给出规范、完整、可直接对照阅卷的参考答案（小题贴近采分点，大作文给出范文）。

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
    { temperature: 0.8, json: true, maxTokens: 4000 }
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
  return { ...core, difficulty: calcDifficulty(core) }
}

