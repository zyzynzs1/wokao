// 评分 v2 总编排：材料建点 -> 参考答案校准 -> 逐点判定 -> 代码算分 -> 档位/区间/置信度。
// 对外只暴露 gradeQuestion，主进程与移动端共用。
import type {
  AppSettings,
  GradeResultV2,
  LossItem,
  PointPool,
  Question,
  ScoreResult
} from '../../shared/types'
import { AI_GENERATED_SOURCE } from '../../shared/types'
import type { DeepSeekConfig } from '../llm'
import { analyzeConstraints } from './analyze'
import { buildEssayGrade, buildPointGrade, type BuiltGrade } from './calc'
import { GRADING_VERSION } from './config'
import { judgeEssay } from './essay'
import { judgeCoverage } from './judge'
import { buildPointPool, estimateReferenceQuality } from './points'
import { checkApplicationFormat, checkEssayHardRules, checkFormDeductions, countChars } from './rules'
import { roundHalfUp } from './validators'

export class GradingUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GradingUnavailableError'
  }
}

export interface GradeQuestionInput {
  question: Question
  answer: string
  settings: AppSettings
  llm?: DeepSeekConfig
  pool?: PointPool | null
  // 已有点池不重复建点；调用方持久化新点池
}

export interface GradeQuestionResult {
  grade: GradeResultV2
  scoreResult: ScoreResult
  feedback: string
  suggestions: string[]
  modelAnswer: string
  losses: LossItem[]
  pool: PointPool | null
  poolIsNew: boolean
}

function isAiQuestion(question: Question): boolean {
  return question.source === AI_GENERATED_SOURCE || question.referenceSource === 'ai'
}

function buildLossesAndSuggestions(
  question: Question,
  built: BuiltGrade,
  pool: PointPool | null
): { losses: LossItem[]; suggestions: string[] } {
  const losses: LossItem[] = []
  const suggestions: string[] = []
  const grade = built.grade

  if (grade.mode === 'essay' && grade.essay) {
    const e = grade.essay
    losses.push({ title: `${e.tier}：${e.offTopic ? '跑题' : '档位判定'}`, reason: e.tierReason })
    for (const h of e.hardIssues.slice(0, 3)) {
      losses.push({ title: `硬伤（${h.type}）`, reason: h.detail })
    }
    if (e.offTopic) suggestions.push('先重新审题：把题干的核心命题与核心关系写进总论点，解决跑题问题')
    if (!e.titleHasThemeWord) suggestions.push('标题必须包含题干主题词（可在题干引文中找）')
    if (!e.structureCorrect) suggestions.push('先补足“标题—开头—总论点—分论点”的基础框架')
    if (!e.openingEndingGood) suggestions.push('开头点题、结尾回扣并升华，是升入二类文的关键')
    if (!e.subArgumentEvidenceGood) suggestions.push('每个分论点按“观点—阐释—材料/事例—回扣”展开，避免只喊口号')
    for (const h of e.hardIssues.filter((x) => x.type === '字数').slice(0, 1)) {
      suggestions.push(h.detail.includes('少于') ? '严格按字数下限写满（本题建议写到下限以上）' : '压缩冗余表述，控制在字数上限内')
    }
    return { losses: losses.slice(0, 6), suggestions: [...new Set(suggestions)].slice(0, 5) }
  }

  const byId = new Map((grade.pointCoverage ?? []).map((c) => [c.pointId, c]))
  if (pool) {
    for (const point of pool.points) {
      const c = byId.get(point.id)
      if (!c || c.status === 'full' || c.status === 'equivalent') continue
      const label = c.status === 'partial' ? '部分覆盖' : c.status === 'out_of_material' ? '材料外' : '未覆盖'
      losses.push({
        title: `${label}：${point.text}`,
        reason: `材料依据：${point.evidence}${c.userQuote ? `；你的表述：${c.userQuote}` : '；你的作答未提及'}`
      })
      if (suggestions.length < 3) suggestions.push(`补充要点：${point.text}`)
    }
    losses.splice(5)
  }
  if (grade.formatDeductions?.length) {
    for (const d of grade.formatDeductions) suggestions.push(`格式/字数：${d.reason}`)
  }
  if (grade.aiQuestion) {
    suggestions.push('本题为 AI 自命题：评分只作训练参考，建议多练真题')
  }
  return { losses: losses.slice(0, 6), suggestions: [...new Set(suggestions)].slice(0, 5) }
}

function buildFeedback(question: Question, built: BuiltGrade): string {
  const g = built.grade
  const range = `${g.range[0]}–${g.range[1]}`
  const head = `【${g.tier}】建议分 ${g.center}/${question.score} 分，区间 ${range} 分，置信度 ${g.confidence}（${g.confidenceReason}）。`
  if (g.mode === 'essay' && g.essay) {
    return `${head}\n${g.essay.tierReason}${g.aiQuestion ? '\n（本题为 AI 自命题，评分仅作训练参考。）' : ''}`
  }
  const hits = (g.pointCoverage ?? []).filter((c) => c.status === 'full' || c.status === 'equivalent').length
  const partial = (g.pointCoverage ?? []).filter((c) => c.status === 'partial').length
  const total = g.pointCoverage?.length ?? 0
  const penalty = (g.formatDeductions ?? []).reduce((s, d) => s + d.value, 0)
  const lines = [
    head,
    `命中要点 ${hits}/${total}${partial > 0 ? `，部分覆盖 ${partial} 个` : ''}；形式扣分 ${roundHalfUp(penalty, 0.1)} 分。`
  ]
  const miss = (g.pointCoverage ?? []).filter((c) => c.status === 'none' || c.status === 'partial').length
  if (miss > 0) lines.push(`主要失分：${miss} 个要点未完整覆盖，见下方逐点核对。`)
  if (g.aiQuestion) lines.push('（本题为 AI 自命题，评分仅作训练参考。）')
  return lines.join('\n')
}

export async function gradeQuestion(input: GradeQuestionInput): Promise<GradeQuestionResult> {
  const { question, answer, settings } = input
  const llm = input.llm ?? settings.deepseek
  if (!llm.apiKey || !llm.apiKey.trim()) {
    throw new GradingUnavailableError('未配置 AI 模型，无法进行 v2 评分')
  }
  const aiQuestion = isAiQuestion(question)

  if (question.type === '文章论述') {
    const constraints = analyzeConstraints(question)
    const judged = await judgeEssay(question, answer, llm)
    const hard = checkEssayHardRules(question, answer, constraints)
    const built = buildEssayGrade({
      question,
      review: judged.review,
      hard,
      reviewAgreement: null,
      warnings: judged.warnings,
      model: llm.model,
      aiQuestion,
      referenceQuality: estimateReferenceQuality(question)
    })
    const { losses, suggestions } = buildLossesAndSuggestions(question, built, null)
    return {
      grade: built.grade,
      scoreResult: built.scoreResult,
      feedback: buildFeedback(question, built),
      suggestions,
      modelAnswer: question.referenceAnswer || '',
      losses,
      pool: null,
      poolIsNew: false
    }
  }

  let pool = input.pool ?? null
  let poolIsNew = false
  const poolWarnings: string[] = []
  if (!pool) {
    const built = await buildPointPool(question, llm)
    pool = built.pool
    poolIsNew = true
    poolWarnings.push(...built.warnings)
  }

  const judged = await judgeCoverage(question, answer, pool, settings, llm)
  const formDeductions = checkFormDeductions(question, answer, pool.constraints)
  const isApplication = question.type === '应用文写作'
  if (isApplication) {
    formDeductions.push(...checkApplicationFormat(answer, pool.constraints, question.score))
  }

  const built = buildPointGrade({
    question,
    answer,
    pool,
    coverage: judged.coverage,
    formatDeductions: formDeductions,
    reviewAgreement: judged.agreement,
    warnings: [...poolWarnings, ...judged.warnings],
    model: llm.model,
    aiQuestion,
    mode: isApplication ? 'application' : 'points'
  })

  const { losses, suggestions } = buildLossesAndSuggestions(question, built, pool)
  if (countChars(answer) === 0) {
    built.grade.warnings.push('答案为空白，评分无意义')
  }
  return {
    grade: built.grade,
    scoreResult: built.scoreResult,
    feedback: buildFeedback(question, built),
    suggestions,
    modelAnswer: question.referenceAnswer || '',
    losses,
    pool,
    poolIsNew
  }
}

export { GRADING_VERSION, analyzeConstraints }
