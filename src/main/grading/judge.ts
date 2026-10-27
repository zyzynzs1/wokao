// 逐点判定：默认 3 位独立“阅卷专家”并行判定，按多数票 + 平均覆盖系数合并。
// 单次模型调用不可复现（实测同一答案两次可差 2 分），多次判定取多数可显著降低随机波动。
import type {
  AppSettings,
  CoverageStatus,
  ExpansionLevel,
  GradingSettings,
  PointCoverage,
  PointPool,
  Question
} from '../../shared/types'
import type { DeepSeekConfig } from '../llm'
import { callJson } from './llmJson'
import { buildJudgeMessages, buildReviewMessages, type ChatMsg } from './prompts'
import { normalizeCoverage } from './validators'

function statusFactor(status: CoverageStatus): number {
  if (status === 'full' || status === 'equivalent') return 1
  if (status === 'partial') return 0.5
  return 0
}

const STATUS_SEVERITY: Record<CoverageStatus, number> = {
  full: 0,
  equivalent: 1,
  partial: 2,
  out_of_material: 3,
  none: 4
}

const EXPANSION_LEVEL: Record<ExpansionLevel, number> = {
  full: 3,
  basic: 2,
  brief: 1,
  title: 0,
  none: -1
}

function expansionFromLevel(level: number): ExpansionLevel {
  if (level >= 3) return 'full'
  if (level === 2) return 'basic'
  if (level === 1) return 'brief'
  return 'title'
}

function reviewConfig(settings: AppSettings): DeepSeekConfig {
  const grading: GradingSettings = settings.grading ?? {
    secondPass: 'same-model',
    aiQuestionPolicy: 'separate'
  }
  if (grading.secondPass === 'second-provider' && grading.reviewProvider?.apiKey?.trim()) {
    return {
      baseUrl: grading.reviewProvider.baseUrl,
      model: grading.reviewProvider.model,
      apiKey: grading.reviewProvider.apiKey
    }
  }
  return settings.deepseek
}

function withPassNote(messages: ChatMsg[], passIndex: number, total: number): ChatMsg[] {
  const note = `\n\n## 本次是第 ${passIndex}/${total} 位独立阅卷专家\n请独立完成判定，不要参考其他评卷结果；你的判定会被用于多数票合并。`
  return messages.map((m, i) => (i === 0 ? { ...m, content: m.content + note } : m))
}

interface PassJudgment {
  coverage: PointCoverage[]
  warnings: string[]
}

function mergePasses(pool: PointPool, passes: PassJudgment[]): {
  coverage: PointCoverage[]
  agreement: number
  warnings: string[]
} {
  const warnings: string[] = []
  const coverage: PointCoverage[] = []
  let agreementSum = 0

  for (const point of pool.points) {
    const items = passes.map((p) => p.coverage.find((c) => c.pointId === point.id)).filter(Boolean) as PointCoverage[]
    if (items.length === 0) {
      coverage.push({ pointId: point.id, status: 'none', expansion: 'none' })
      continue
    }
    // 多数票选状态
    const counts = new Map<CoverageStatus, number>()
    for (const it of items) counts.set(it.status, (counts.get(it.status) ?? 0) + 1)
    const maxCount = Math.max(...counts.values())
    let majority: CoverageStatus
    const winners = [...counts.entries()].filter(([, n]) => n === maxCount).map(([s]) => s)
    if (winners.length === 1) {
      majority = winners[0]
    } else {
      // 平票时取中位严重程度，避免极端从严/从宽
      const sorted = [...winners].sort((a, b) => STATUS_SEVERITY[a] - STATUS_SEVERITY[b])
      majority = sorted[Math.floor((sorted.length - 1) / 2)]
      warnings.push(`要点 ${point.id} 多次判定平票（${winners.join('/')}），取中位状态 ${majority}`)
    }
    agreementSum += maxCount / items.length

    // 覆盖系数取所有判定的平均（比取单次更稳）
    const factor = items.reduce((s, it) => s + statusFactor(it.status), 0) / items.length

    // 展开度：取支持多数状态的判定中的中位数
    let expansion: ExpansionLevel = 'none'
    if (majority === 'full' || majority === 'equivalent') {
      const levels = items
        .filter((it) => it.status === majority)
        .map((it) => EXPANSION_LEVEL[it.expansion])
        .sort((a, b) => a - b)
      expansion = levels.length > 0 ? expansionFromLevel(levels[Math.floor(levels.length / 2)]) : 'basic'
    } else if (majority === 'partial') {
      expansion = 'basic'
    }

    const quoteSource = items.find((it) => it.status === majority && it.userQuote)
    const allSame = items.every((it) => it.status === items[0].status)
    coverage.push({
      pointId: point.id,
      status: majority,
      expansion,
      factor,
      ...(quoteSource?.userQuote ? { userQuote: quoteSource.userQuote } : {}),
      ...(!allSame
        ? { note: `多次判定：${items.map((it) => it.status).join(' / ')}，按多数与平均覆盖计分` }
        : {})
    })
  }

  const agreement = pool.points.length > 0 ? agreementSum / pool.points.length : 0
  return { coverage, agreement, warnings }
}

export interface JudgeResult {
  coverage: PointCoverage[]
  agreement: number | null
  warnings: string[]
}

export async function judgeCoverage(
  question: Question,
  answer: string,
  pool: PointPool,
  settings: AppSettings,
  llm: DeepSeekConfig
): Promise<JudgeResult> {
  const grading = settings.grading
  const secondPass = grading?.secondPass ?? 'same-model'
  if (secondPass === 'off' || pool.points.length === 0) {
    const primary = await callJson(llm, buildJudgeMessages(question, pool, answer, question.type === '应用文写作'), {
      maxTokens: 4000
    })
    const first = normalizeCoverage(primary, pool)
    return { coverage: first.coverage, agreement: null, warnings: first.warnings }
  }

  const messages: ChatMsg[][] = [
    withPassNote(buildJudgeMessages(question, pool, answer, question.type === '应用文写作'), 1, 3),
    withPassNote(buildReviewMessages(question, pool, answer, question.type === '应用文写作'), 2, 3),
    withPassNote(buildJudgeMessages(question, pool, answer, question.type === '应用文写作'), 3, 3)
  ]
  const llms: DeepSeekConfig[] = [llm, llm, secondPass === 'second-provider' ? reviewConfig(settings) : llm]
  const rawResults = await Promise.all(
    messages.map(async (msgs, index) => {
      try {
        const raw = await callJson(llms[index], msgs, { maxTokens: 4000 })
        return normalizeCoverage(raw, pool)
      } catch (err) {
        return { coverage: [] as PointCoverage[], warnings: [`第 ${index + 1} 次判定失败：${(err as Error).message}`] }
      }
    })
  )

  const warnings: string[] = []
  const valid = rawResults.filter((r) => r.coverage.length > 0)
  for (const r of rawResults) warnings.push(...r.warnings)
  if (valid.length === 0) throw new Error('多次判点均失败')

  const used = valid
  const merged = mergePasses(pool, used)
  warnings.push(...merged.warnings)
  if (used.length < 3) warnings.push(`仅有 ${used.length}/3 次判定成功，分歧处理置信度降低`)
  return { coverage: merged.coverage, agreement: merged.agreement, warnings }
}
