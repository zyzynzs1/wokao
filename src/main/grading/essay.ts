// 大作文评阅：袁东累进四类文 + liuyuexi 维度/上限锚定 + 代码硬规则。
import type { EssayHardIssue, EssayReview, EssayTier, GradingDimension, Question } from '../../shared/types'
import type { DeepSeekConfig } from '../llm'
import { ESSAY_DIMENSION_NAMES } from './config'
import { callJson } from './llmJson'
import { buildEssayMessages } from './prompts'
import { asString, clamp, normalizeEssayTier } from './validators'

function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return /^(true|是|对|yes|1)$/i.test(v.trim())
  return fallback
}

function normalizeDimensions(raw: unknown): GradingDimension[] {
  const arr = Array.isArray(raw) ? raw : []
  const byName = new Map<string, GradingDimension>()
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = asString(o.name)
    if (!name) continue
    const level = clamp(Math.round(Number(o.level) || 0), 0, 4)
    byName.set(name, { name, level, note: asString(o.note) })
  }
  return ESSAY_DIMENSION_NAMES.map(
    (name) => byName.get(name) ?? { name, level: 2, note: '模型未单独给出，按中性档处理' }
  )
}

function normalizeHardIssues(raw: unknown): EssayHardIssue[] {
  const arr = Array.isArray(raw) ? raw : []
  const out: EssayHardIssue[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const type = asString(o.type)
    const detail = asString(o.detail)
    if (!detail) continue
    const allowed: EssayHardIssue['type'][] = ['字数', '抄材料', '标题', '分论点', '跑题', '其他']
    const t = (allowed as string[]).includes(type) ? (type as EssayHardIssue['type']) : '其他'
    const penalty = Number(o.penalty)
    out.push({ type: t, detail, penalty: Number.isFinite(penalty) ? penalty : 0 })
  }
  return out
}

export interface EssayJudgeResult {
  review: EssayReview
  warnings: string[]
}

export async function judgeEssay(
  question: Question,
  answer: string,
  llm: DeepSeekConfig
): Promise<EssayJudgeResult> {
  const parsed = await callJson(llm, buildEssayMessages(question, answer), { maxTokens: 4000 })
  const topicTypeRaw = asString(parsed.topicType)
  const topicType: EssayReview['topicType'] =
    topicTypeRaw === 'double' ? 'double' : topicTypeRaw === 'multi' ? 'multi' : 'single'
  const relationRaw = asString(parsed.relationType).toUpperCase()
  const relationType: EssayReview['relationType'] | undefined =
    relationRaw === 'AB' ? 'AB' : relationRaw === 'ABC' ? 'ABC' : undefined
  const styleRaw = asString(parsed.essayStyle)
  const essayStyle: EssayReview['essayStyle'] =
    styleRaw === '政论' ? '政论' : styleRaw === '策论' ? '策论' : '议论'
  const tier = normalizeEssayTier(parsed.tier) as EssayTier
  const review: EssayReview = {
    topicType,
    ...(relationType ? { relationType } : {}),
    essayStyle,
    offTopic: asBool(parsed.offTopic),
    offTopicReason: asString(parsed.offTopicReason),
    titleHasThemeWord: asBool(parsed.titleHasThemeWord, true),
    structureCorrect: asBool(parsed.structureCorrect, true),
    openingEndingGood: asBool(parsed.openingEndingGood),
    subArgumentEvidenceGood: asBool(parsed.subArgumentEvidenceGood),
    tier,
    tierReason: asString(parsed.tierReason) || '模型未给出逐条理由',
    dimensions: normalizeDimensions(parsed.dimensions),
    hardIssues: normalizeHardIssues(parsed.hardIssues)
  }
  const warnings: string[] = []
  if (!review.tierReason) warnings.push('大作文评阅未给出档位理由')
  return { review, warnings }
}
