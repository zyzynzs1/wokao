// 评分体系 v2 配置：版本、系数、档位、形式规则。
// 说明：所有常数都是“训练校准值”，不是官方评分标准；调整需同步更新版本并跑基准集。

import type { CoverageStatus, EssayTier, ExpansionLevel } from '../../shared/types'
import { GRADING_VERSION } from '../../shared/types'

export type { EssayTier }

export { GRADING_VERSION }

export const PROMPT_VERSION = 'grading-v2.0.0'
export const POOL_VERSION = GRADING_VERSION

// 覆盖系数
export const COVERAGE_FACTOR: Record<CoverageStatus, number> = {
  full: 1,
  equivalent: 1,
  partial: 0.5,
  none: 0,
  out_of_material: 0
}

// 展开系数（只对“完整/等义覆盖”生效；部分覆盖的 0.5 已包含展开不足，避免重复扣分）
export const EXPANSION_FACTOR: Record<ExpansionLevel, number> = {
  full: 1,
  basic: 0.95,
  brief: 0.8,
  title: 0.55,
  none: 0
}

export interface TierRule {
  label: string
  minRatio: number
  capRatio: number
}

// 小题/应用文档位：按得分率定档，中心分不超过档位上限
export const TIER_RULES: TierRule[] = [
  { label: '一档', minRatio: 0.8, capRatio: 0.9 },
  { label: '二档', minRatio: 0.6, capRatio: 0.75 },
  { label: '三档', minRatio: 0.4, capRatio: 0.55 },
  { label: '四档', minRatio: 0.2, capRatio: 0.35 },
  { label: '五档', minRatio: 0, capRatio: 0.15 }
]

export type ConfidenceLabel = '高' | '中' | '低'

// 区间半宽 = 满分 × 该比例
export const CONFIDENCE_INTERVAL: Record<ConfidenceLabel, number> = {
  高: 0.05,
  中: 0.1,
  低: 0.15
}

// 形式扣分规则（训练规则，非官方）
export const FORM_RULES = {
  underChar: { perRatio: 0.1, perPenalty: 1, cap: 3 },
  overChar: { perRatio: 0.1, perPenalty: 1, cap: 3 },
  missingItems: 1,
  duplicateNumber: { perPenalty: 0.5, cap: 1.5 },
  appFormatElement: (fullScore: number): number => (fullScore >= 25 ? 1.5 : 1),
  essayCopy: { shingle: 20, perPenalty: 1, cap: 3 }
}

// 大作文维度权重（liuyuexi 申发论述默认权重，仅用于诊断与档内定位）
export const ESSAY_WEIGHTS: Record<string, number> = {
  立意扣题: 20,
  材料运用: 15,
  论证深度: 25,
  结构: 15,
  论据例证: 10,
  语言: 15
}

export const ESSAY_DIMENSION_NAMES = [
  '立意扣题',
  '材料运用',
  '论证深度',
  '结构',
  '论据例证',
  '语言'
] as const

// 袁东累进四类文的分数比例区间（35/40 分题统一按满分比例换算）
// 一类：约 71%-80%；二类：约 51%-69%；三类：约 34%-49%；四类：约 14%-31%
// 与 liuyuexi 经验上限（35 分：28/24/17/11；40 分：32/27/19/13）对齐
export const ESSAY_TIER_RATIO: Record<EssayTier, [number, number]> = {
  四类文: [0.14, 0.31],
  三类文: [0.34, 0.49],
  二类文: [0.51, 0.69],
  一类文: [0.71, 0.8]
}

export const ESSAY_TIER_ORDER: EssayTier[] = ['四类文', '三类文', '二类文', '一类文']

// 点池合理范围（超出会提示人工复核）
export const MIN_POINTS = 3
export const MAX_POINTS = 12

// 判定复核后仍分歧超过该比例 → 降为低置信度
export const REVIEW_LOW_AGREEMENT = 0.7

// 同答案两次评分中心分差超过该值 → 提示重试（满分比例）
export const STABILITY_WARN_RATIO = 0.03
