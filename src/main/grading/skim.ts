// 快速阅卷模拟：模拟阅卷老师 10–15 秒扫读，只评估“采分点是否容易被看到”。
// 结果只作为实战预估，不参与主评分；主评分仍按完整判点计算。
import type {
  GradeResultV2,
  PointPool,
  Question,
  SkimMissedItem,
  SkimPointResult,
  SkimResult,
  SkimVisibility
} from '../../shared/types'
import type { DeepSeekConfig } from '../llm'
import type { PointScoreResult } from './calc'
import { callJson } from './llmJson'
import { buildSkimEssayMessages, buildSkimPointMessages } from './prompts'
import { asString, clamp, roundHalfUp } from './validators'

const FACTOR: Record<SkimVisibility, number> = {
  clear: 1,
  partial: 0.5,
  missed: 0
}

export interface SkimPointJudgment {
  points: SkimPointResult[]
  summary: string
  warnings: string[]
}

export interface SkimEssayJudgment {
  ratio: number
  tier: string
  summary: string
  missed: SkimMissedItem[]
  warnings: string[]
}

function normalizeVisibility(value: unknown): SkimVisibility {
  const v = asString(value).toLowerCase()
  if (v === 'clear' || v === 'partial' || v === 'missed') return v
  return 'missed'
}

function normalizeMissed(raw: unknown): SkimMissedItem[] {
  const arr = Array.isArray(raw) ? raw : []
  return arr
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const o = item as Record<string, unknown>
      const label = asString(o.label)
      const reason = asString(o.reason)
      return label ? { label, reason } : null
    })
    .filter((x): x is SkimMissedItem => !!x)
    .slice(0, 8)
}

export async function judgeSkimPoints(
  question: Question,
  pool: PointPool,
  answer: string,
  llm: DeepSeekConfig,
  application = false
): Promise<SkimPointJudgment> {
  const parsed = await callJson(llm, buildSkimPointMessages(question, pool, answer, application), {
    maxTokens: 3000
  })
  const rawPoints = Array.isArray(parsed.points) ? parsed.points : []
  const byId = new Map<string, Record<string, unknown>>()
  for (const item of rawPoints) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = asString(o.id)
    if (id) byId.set(id, o)
  }
  const warnings: string[] = []
  const points: SkimPointResult[] = pool.points.map((point) => {
    const o = byId.get(point.id)
    if (!o) {
      warnings.push(`快速阅卷模拟未返回要点 ${point.id}，按“易漏”处理`)
      return {
        pointId: point.id,
        visibility: 'missed',
        factor: 0,
        reason: '模拟结果未覆盖该要点，按快速阅卷易漏处理'
      }
    }
    const visibility = normalizeVisibility(o.visibility)
    const reason = asString(o.reason) || '模型未说明原因'
    const userQuote = asString(o.userQuote)
    return {
      pointId: point.id,
      visibility,
      factor: FACTOR[visibility],
      reason,
      ...(userQuote ? { userQuote } : {})
    }
  })
  return {
    points,
    summary: asString(parsed.summary) || '已模拟快速阅卷扫描各要点',
    warnings
  }
}

export async function judgeSkimEssay(
  question: Question,
  answer: string,
  llm: DeepSeekConfig
): Promise<SkimEssayJudgment> {
  const parsed = await callJson(llm, buildSkimEssayMessages(question, answer), { maxTokens: 2200 })
  const rawRatio = Number(parsed.skimRatio)
  const warnings: string[] = []
  // 模型偶尔会输出 72 而不是 0.72；大于 1 且不超过 100 时按百分数处理
  const normalizedRatio =
    Number.isFinite(rawRatio) && rawRatio > 1 && rawRatio <= 100 ? rawRatio / 100 : rawRatio
  const ratio = Number.isFinite(normalizedRatio) ? clamp(normalizedRatio, 0, 1) : 0.7
  if (!Number.isFinite(rawRatio)) warnings.push('快速阅卷模拟未返回有效得分率，按中性估计处理')
  const tier = asString(parsed.skimTier) || '三类文'
  return {
    ratio,
    tier,
    summary: asString(parsed.summary) || '已模拟快速阅卷第一印象',
    missed: normalizeMissed(parsed.missed),
    warnings
  }
}

function riskOf(lossRatio: number): SkimResult['risk'] {
  if (lossRatio >= 0.12) return '高'
  if (lossRatio >= 0.05) return '中'
  return '低'
}

function rangeOf(center: number, totalScore: number): [number, number] {
  const margin = Math.max(0.5, totalScore * 0.04)
  const lo = roundHalfUp(clamp(center - margin, 0, totalScore), 0.5)
  const hi = roundHalfUp(clamp(center + margin, 0, totalScore), 0.5)
  return [lo, hi]
}

export function buildPointSkimResult(input: {
  question: Question
  pointScores: PointScoreResult
  formatPenalty: number
  mainCenter: number
  judgment: SkimPointJudgment
  model: string
}): SkimResult {
  const { question, pointScores, formatPenalty, mainCenter, judgment, model } = input
  const totalScore = question.score
  const byId = new Map(judgment.points.map((p) => [p.pointId, p]))
  let raw = 0
  const missed: SkimMissedItem[] = []
  for (const detail of pointScores.details) {
    if (detail.got <= 0) continue
    const p = byId.get(detail.pointId)
    const factor = p?.factor ?? 0
    raw += detail.got * factor
    if (factor < 1) {
      missed.push({
        label: detail.label,
        reason: p?.reason ?? '快速阅卷时没有看到该要点'
      })
    }
  }
  raw = clamp(raw - formatPenalty, 0, totalScore)
  const score = roundHalfUp(clamp(Math.min(raw, mainCenter), 0, totalScore), 0.5)
  const lossRatio = totalScore > 0 ? Math.max(0, mainCenter - score) / totalScore : 0
  return {
    version: 'skim-v1',
    mode: 'points',
    score,
    range: rangeOf(score, totalScore),
    totalScore,
    risk: riskOf(lossRatio),
    summary:
      judgment.summary ||
      `完整阅读能看到的得分点，在快速阅卷下预估为 ${score}/${totalScore} 分`,
    points: judgment.points,
    missed: missed.slice(0, 8),
    warnings: judgment.warnings,
    model
  }
}

export function buildEssaySkimResult(input: {
  question: Question
  main: GradeResultV2
  judgment: SkimEssayJudgment
  model: string
}): SkimResult {
  const { question, main, judgment, model } = input
  const totalScore = question.score
  const raw = roundHalfUp(clamp(totalScore * judgment.ratio, 0, totalScore), 0.5)
  const score = roundHalfUp(clamp(Math.min(raw, main.center), 0, totalScore), 0.5)
  const lossRatio = totalScore > 0 ? Math.max(0, main.center - score) / totalScore : 0
  return {
    version: 'skim-v1',
    mode: 'essay',
    score,
    range: rangeOf(score, totalScore),
    totalScore,
    risk: riskOf(lossRatio),
    summary: judgment.summary,
    essayTier: judgment.tier,
    missed: judgment.missed,
    warnings: judgment.warnings,
    model
  }
}
