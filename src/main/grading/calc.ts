// 纯代码算分：覆盖状态与展开度 → 单点得分 → 形式扣分 → 档位/中心分/区间/置信度。
// 模型不参与任何算术。
import type {
  EssayHardIssue,
  EssayReview,
  EssayTier,
  GradeResultV2,
  GradingDimension,
  PointCoverage,
  PointPool,
  PointResult,
  Question,
  ScoreResult
} from '../../shared/types'
import {
  CONFIDENCE_INTERVAL,
  COVERAGE_FACTOR,
  ESSAY_DIMENSION_NAMES,
  ESSAY_TIER_ORDER,
  ESSAY_TIER_RATIO,
  ESSAY_WEIGHTS,
  EXPANSION_FACTOR,
  TIER_RULES
} from './config'
import type { ConfidenceLabel } from './config'
import { checkEssayHardRules, countChars, type EssayHardCheck } from './rules'
import { clamp, roundHalfUp } from './validators'

export interface PointScoreDetail {
  pointId: string
  label: string
  full: number
  got: number
}

export interface PointScoreResult {
  details: PointScoreDetail[]
  raw: number
  pointResults: PointResult[]
}

export function computePointScores(
  pool: PointPool,
  coverage: PointCoverage[],
  application = false
): PointScoreResult {
  const byId = new Map(coverage.map((c) => [c.pointId, c]))
  const details: PointScoreDetail[] = []
  for (const point of pool.points) {
    const c = byId.get(point.id) ?? { pointId: point.id, status: 'none', expansion: 'none' }
    // 应用文按内容板块整体赋分：板块写到给 85%（内容分与格式分分开，不追求内容满分），
    // 部分覆盖 50%，未覆盖 0；展开度不再二次打折。
    const baseCf =
      typeof c.factor === 'number' ? clamp(c.factor, 0, 1) : (COVERAGE_FACTOR[c.status] ?? 0)
    const cf = application ? baseCf * 0.85 : baseCf
    // 小题：展开度只对“完整/等义覆盖”生效；部分覆盖已按 0.5 计，不再乘展开系数（避免重复扣分）。
    const disputed = typeof c.factor === 'number'
    const ef =
      c.status === 'none' || c.status === 'out_of_material'
        ? 0
        : application || c.status === 'partial' || disputed
          ? 1
          : (EXPANSION_FACTOR[c.expansion] ?? 1)
    const got = roundHalfUp(point.weight * cf * ef, 0.1)
    details.push({ pointId: point.id, label: point.text, full: point.weight, got })
  }
  const pointResults: PointResult[] = details.map((d) => ({
    pointId: d.pointId,
    label: d.label,
    score: d.full,
    got: d.got,
    hit: d.got > 0
  }))
  return { details, raw: details.reduce((s, d) => s + d.got, 0), pointResults }
}

function determineTier(ratio: number): (typeof TIER_RULES)[number] {
  return TIER_RULES.find((t) => ratio >= t.minRatio) ?? TIER_RULES[TIER_RULES.length - 1]
}

export function makeRange(center: number, totalScore: number, confidence: ConfidenceLabel): [number, number] {
  const half = totalScore * CONFIDENCE_INTERVAL[confidence]
  const lo = roundHalfUp(clamp(center - half, 0, totalScore), 0.5)
  const hi = roundHalfUp(clamp(center + half, 0, totalScore), 0.5)
  return [lo, hi]
}

export function decideConfidence(opts: {
  aiQuestion: boolean
  referenceQuality: 'strong' | 'weak' | 'none'
  reviewAgreement: number | null
  warnings: string[]
}): { confidence: ConfidenceLabel; reason: string } {
  if (opts.aiQuestion) {
    return { confidence: '低', reason: 'AI 自命题，缺少真题锚点，评分仅作训练参考' }
  }
  if (opts.reviewAgreement !== null && opts.reviewAgreement < 0.7) {
    return {
      confidence: '低',
      reason: `两次独立判点一致率 ${(opts.reviewAgreement * 100).toFixed(0)}%，分歧较大`
    }
  }
  if (
    opts.referenceQuality === 'strong' &&
    opts.reviewAgreement !== null &&
    opts.reviewAgreement >= 0.9 &&
    opts.warnings.length === 0
  ) {
    return { confidence: '高', reason: '参考答案较完整，两次独立判点一致' }
  }
  if (opts.referenceQuality === 'weak') {
    return { confidence: '中', reason: '参考答案偏短或偏简，点池可能不完整' }
  }
  if (opts.referenceQuality === 'none') {
    return { confidence: '中', reason: '无参考答案，点池由材料独立建立' }
  }
  return { confidence: '中', reason: '材料完整，但缺少官方逐点细则/完整参考答案' }
}

export interface BuildPointGradeInput {
  question: Question
  answer: string
  pool: PointPool
  coverage: PointCoverage[]
  formatDeductions: { type: string; reason: string; value: number }[]
  reviewAgreement: number | null
  warnings: string[]
  model: string
  aiQuestion: boolean
  mode: 'points' | 'application'
}

export interface BuiltGrade {
  grade: GradeResultV2
  scoreResult: ScoreResult
  pointScores: PointScoreResult
}

export function buildPointGrade(input: BuildPointGradeInput): BuiltGrade {
  const { question, answer, pool, coverage, formatDeductions, reviewAgreement, warnings, model, aiQuestion, mode } =
    input
  const totalScore = question.score
  const wordCount = countChars(answer)
  const pointScores = computePointScores(pool, coverage, mode === 'application')
  const penalty = formatDeductions.reduce((s, d) => s + (Number.isFinite(d.value) ? d.value : 0), 0)
  const raw = clamp(pointScores.raw - penalty, 0, totalScore)
  const ratio = totalScore > 0 ? raw / totalScore : 0
  const tierRule = determineTier(ratio)
  const center = roundHalfUp(clamp(Math.min(raw, totalScore * tierRule.capRatio), 0, totalScore), 0.5)
  const { confidence, reason } = decideConfidence({
    aiQuestion,
    referenceQuality: pool.referenceQuality,
    reviewAgreement,
    warnings
  })
  const range = makeRange(center, totalScore, confidence)

  const allWarnings = [...warnings]
  if (pointScores.details.some((d) => d.got === 0)) {
    // 无需警告，仅保留信息
  }
  if (confidence === '低' && mode === 'application') allWarnings.push('应用文评分受格式与内容板块判断影响，建议对照逐点表复核')

  const grade: GradeResultV2 = {
    version: pool.version,
    mode,
    tier: tierRule.label,
    center,
    range,
    confidence,
    confidenceReason: reason,
    pointCoverage: coverage.map((c) => {
      const point = pool.points.find((p) => p.id === c.pointId)
      return { ...c, ...(point ? { pointText: point.text, pointEvidence: point.evidence } : {}) }
    }),
    formatDeductions,
    warnings: allWarnings,
    model,
    aiQuestion,
    reviewAgreement
  }

  const scoreResult: ScoreResult = {
    totalScore,
    score: center,
    ratio: totalScore > 0 ? center / totalScore : 0,
    pointResults: pointScores.pointResults,
    formatScore: roundHalfUp(penalty, 0.1),
    wordCount,
    overWordLimit: !!question.wordLimit && wordCount > question.wordLimit,
    hitSummary: pointScores.pointResults.filter((p) => p.got >= p.score && p.score > 0).map((p) => p.label),
    missSummary: pointScores.pointResults.filter((p) => p.got < p.score).map((p) => p.label),
    scoredBy: 'ai'
  }

  return { grade, scoreResult, pointScores }
}

// ---- 大作文 ----

function essayTierRank(tier: EssayTier): number {
  return ESSAY_TIER_ORDER.indexOf(tier)
}

function capEssayTier(tier: EssayTier, cap: EssayTier): EssayTier {
  return essayTierRank(tier) > essayTierRank(cap) ? cap : tier
}

function normalizeDimensions(review: EssayReview): GradingDimension[] {
  const byName = new Map(review.dimensions.map((d) => [d.name, d]))
  return ESSAY_DIMENSION_NAMES.map((name) => {
    const d = byName.get(name)
    const level = d ? clamp(Math.round(Number(d.level) || 0), 0, 4) : 0
    return { name, level, note: d?.note ?? '' }
  })
}

export interface BuildEssayGradeInput {
  question: Question
  review: EssayReview
  hard: EssayHardCheck
  reviewAgreement: number | null
  warnings: string[]
  model: string
  aiQuestion: boolean
  referenceQuality: 'strong' | 'weak' | 'none'
}

export function buildEssayGrade(input: BuildEssayGradeInput): BuiltGrade {
  const { question, review, hard, reviewAgreement, warnings, model, aiQuestion, referenceQuality } = input
  const totalScore = question.score
  const dims = normalizeDimensions(review)

  // 1) 档位：跑题直接四类；再按硬规则限档
  let tier: EssayTier = review.offTopic ? '四类文' : review.tier
  if (!review.offTopic) {
    if (!review.structureCorrect) tier = capEssayTier(tier, '三类文')
    if (!review.titleHasThemeWord) tier = capEssayTier(tier, '二类文')
    if (hard.severeWordShort) tier = capEssayTier(tier, '三类文')
  }

  // 2) 档内定位：维度加权质量 × 档位比例区间
  const quality =
    dims.reduce((s, d) => s + (d.level / 4) * (ESSAY_WEIGHTS[d.name] ?? 0), 0) /
    Math.max(1, Object.values(ESSAY_WEIGHTS).reduce((s, n) => s + n, 0))
  const [loRatio, hiRatio] = ESSAY_TIER_RATIO[tier]
  const lo = totalScore * loRatio
  const hi = totalScore * hiRatio
  const penalty = hard.issues.reduce((s, h) => s + (Number.isFinite(h.penalty) ? h.penalty : 0), 0)
  const raw = lo + quality * (hi - lo) - penalty
  const center = roundHalfUp(clamp(raw, lo * 0.85, hi), 0.5)
  const { confidence, reason } = decideConfidence({
    aiQuestion,
    referenceQuality,
    reviewAgreement,
    warnings
  })
  const range = makeRange(center, totalScore, confidence)

  const essay: EssayReview = {
    ...review,
    tier,
    dimensions: dims,
    hardIssues: [...hard.issues]
  }

  const grade: GradeResultV2 = {
    version: 'grading-v2.0',
    mode: 'essay',
    tier,
    center,
    range,
    confidence,
    confidenceReason: reason,
    essay,
    dimensions: dims.map((d) => {
      const full = roundHalfUp((totalScore * (ESSAY_WEIGHTS[d.name] ?? 0)) / 100, 0.5)
      return { name: d.name, got: roundHalfUp((full * d.level) / 4, 0.5), full, note: d.note }
    }),
    warnings,
    model,
    aiQuestion,
    reviewAgreement
  }

  const scoreResult: ScoreResult = {
    totalScore,
    score: center,
    ratio: totalScore > 0 ? center / totalScore : 0,
    pointResults: [],
    formatScore: roundHalfUp(penalty, 0.1),
    wordCount: hard.wordCount,
    overWordLimit: !!question.wordLimit && hard.wordCount > question.wordLimit,
    band: tier,
    hitSummary: [],
    missSummary: [],
    scoredBy: 'ai'
  }

  return { grade, scoreResult, pointScores: { details: [], raw: center, pointResults: [] } }
}

