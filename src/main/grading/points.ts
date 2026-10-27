// 点池：材料优先建点 -> 参考答案校准 -> 冻结缓存（由调用方持久化）。
import type { GradingPoint, GradingConstraints, PointPool, Question } from '../../shared/types'
import { AI_GENERATED_SOURCE } from '../../shared/types'
import type { DeepSeekConfig } from '../llm'
import { analyzeConstraints } from './analyze'
import { MIN_POINTS, POOL_VERSION, PROMPT_VERSION } from './config'
import { callJson } from './llmJson'
import { buildApplicationPoolMessages, buildCalibrateMessages, buildPoolMessages } from './prompts'
import { asString, normalizePoints } from './validators'

export function estimateReferenceQuality(question: Question): 'strong' | 'weak' | 'none' {
  const ref = (question.referenceAnswer || '').trim()
  if (!ref) return 'none'
  // AI 自动命题的参考答案不作为强锚点
  if (question.source === AI_GENERATED_SOURCE || question.referenceSource === 'ai') return 'weak'
  const need =
    question.type === '文章论述'
      ? 700
      : Math.max(120, Math.min(400, (question.wordLimit || 300) * 0.6))
  return ref.replace(/\s/g, '').length >= need ? 'strong' : 'weak'
}

function withWeights(points: GradingPoint[], score: number): GradingPoint[] {
  if (points.length === 0) return []
  const weight = score / points.length
  return points.map((p, i) => ({ ...p, id: `p${i + 1}`, weight }))
}

async function askPool(question: Question, constraints: GradingConstraints, llm: DeepSeekConfig): Promise<GradingPoint[]> {
  const messages =
    question.type === '应用文写作'
      ? buildApplicationPoolMessages(question, constraints)
      : buildPoolMessages(question, constraints)
  const parsed = await callJson(llm, messages, { maxTokens: 4000 })
  return normalizePoints(parsed.points, question.score)
}

async function calibrate(
  question: Question,
  points: GradingPoint[],
  llm: DeepSeekConfig
): Promise<{
  points: GradingPoint[]
  addedFromMaterial: string[]
  merged: string[]
  conflicts: string[]
}> {
  const parsed = await callJson(llm, buildCalibrateMessages(question, points, question.referenceAnswer), {
    maxTokens: 4000
  })
  const next = normalizePoints(parsed.points, question.score)
  const added = Array.isArray(parsed.addedFromMaterial)
    ? parsed.addedFromMaterial.map((v) => asString(v)).filter(Boolean)
    : []
  const merged = Array.isArray(parsed.merged) ? parsed.merged.map((v) => asString(v)).filter(Boolean) : []
  const conflicts = Array.isArray(parsed.conflicts) ? parsed.conflicts.map((v) => asString(v)).filter(Boolean) : []
  if (next.length === 0) return { points, addedFromMaterial: [], merged: [], conflicts }
  // 标记来源：被校准新增的点按材料来源，其余按参考答案来源
  const normalized = next.map((p) => ({
    ...p,
    source: added.some((a) => a.includes(p.text) || p.text.includes(a)) ? ('material' as const) : ('reference' as const)
  }))
  return { points: normalized, addedFromMaterial: added, merged, conflicts }
}

export interface PointPoolBuildResult {
  pool: PointPool
  warnings: string[]
}

export async function buildPointPool(
  question: Question,
  llm: DeepSeekConfig,
  constraints?: GradingConstraints
): Promise<PointPoolBuildResult> {
  const c = constraints ?? analyzeConstraints(question)
  const quality = estimateReferenceQuality(question)
  const warnings: string[] = []

  if (question.type === '文章论述') {
    return {
      pool: {
        questionId: question.id,
        version: POOL_VERSION,
        type: question.type,
        points: [],
        constraints: c,
        calibration: { referenceUsed: quality !== 'none', addedFromMaterial: [], merged: [], conflicts: [] },
        referenceQuality: quality,
        createdAt: Date.now(),
        model: llm.model
      },
      warnings
    }
  }

  let points = await askPool(question, c, llm)
  if (points.length < MIN_POINTS) {
    warnings.push(`首次建点只有 ${points.length} 个要点，重试一次`)
    try {
      points = await askPool(question, c, llm)
    } catch {
      /* 保留首次结果 */
    }
  }
  if (points.length === 0) throw new Error('无法从材料中提取评分要点')

  let calibration = { referenceUsed: false, addedFromMaterial: [] as string[], merged: [] as string[], conflicts: [] as string[] }
  // 应用文的内容板块点已按文种收敛，不再用参考答案补材料事实（否则会重新变回逐条罗列）
  if (question.type !== '应用文写作' && quality !== 'none' && (question.referenceAnswer || '').trim()) {
    try {
      const calibrated = await calibrate(question, points, llm)
      points = calibrated.points
      calibration = {
        referenceUsed: true,
        addedFromMaterial: calibrated.addedFromMaterial,
        merged: calibrated.merged,
        conflicts: calibrated.conflicts
      }
    } catch (err) {
      warnings.push(`参考答案校准失败，使用材料点池：${(err as Error).message}`)
    }
  }

  const pool: PointPool = {
    questionId: question.id,
    version: POOL_VERSION,
    type: question.type,
    points: withWeights(points, question.score),
    constraints: c,
    calibration,
    referenceQuality: quality,
    createdAt: Date.now(),
    model: llm.model
  }
  // AI 自命题标注提示（评分时会再降置信度）
  if (question.source === AI_GENERATED_SOURCE) warnings.push('本题为 AI 自命题，点池与参考答案均无真题锚点')
  if (pool.points.length < MIN_POINTS) warnings.push(`点池只有 ${pool.points.length} 个要点，分数可能偏高`)
  if (pool.points.length > 12) warnings.push(`点池有 ${pool.points.length} 个要点，分数可能偏低`)
  void PROMPT_VERSION
  return { pool, warnings }
}
