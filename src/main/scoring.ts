import type { PointResult, Question, ScoreResult } from '../shared/types'

// 统计字数（申论按“一格一字”，含标点，不含空白）
export function countWords(text: string): number {
  return text.replace(/\s/g, '').length
}

// 检测是否分条作答（用于条理/格式辅助判断）
function hasNumbering(text: string): boolean {
  return /(①②③④⑤⑥|1[\.、]|2[\.、]|3[\.、]|4[\.、]|一是|二是|三是|四是|首先|其次|再次|第一[，,、]|第二|第三)/.test(text)
}

// 关键词命中（子串匹配，中文忽略大小写无意义，统一转小写）
function matchKeyword(answer: string, keyword: string): boolean {
  const a = answer.toLowerCase()
  const k = keyword.trim().toLowerCase()
  if (!k) return false
  return a.includes(k)
}

// 规则踩点打分（小题：归纳概括/综合分析/提出对策/应用文写作）
export function ruleScore(question: Question, answer: string): ScoreResult {
  const wordCount = countWords(answer)
  const overWordLimit = question.wordLimit > 0 && wordCount > question.wordLimit

  const pointResults: PointResult[] = question.scoringPoints.map((p) => {
    const hit = p.keywords.some((k) => matchKeyword(answer, k))
    return {
      pointId: p.id,
      label: p.label,
      score: p.score,
      got: hit ? p.score : 0,
      hit
    }
  })

  let score = pointResults.reduce((s, p) => s + p.got, 0)
  const maxScore = question.score
  if (score > maxScore) score = maxScore

  // 超字数轻微扣分（不超过总分 5%），用于提醒规范作答
  let formatScore = 0
  if (!overWordLimit && hasNumbering(answer) && question.type !== '文章论述') {
    formatScore = Math.round(maxScore * 0.05)
  }

  const hitSummary = pointResults.filter((p) => p.hit).map((p) => p.label)
  const missSummary = pointResults.filter((p) => !p.hit).map((p) => p.label)

  return {
    totalScore: maxScore,
    score,
    ratio: maxScore > 0 ? score / maxScore : 0,
    pointResults,
    formatScore,
    wordCount,
    overWordLimit,
    hitSummary,
    missSummary
  }
}

// 大作文：规则估算档次（由 LLM 进一步精修）
export function estimateBand(question: Question, answer: string): string {
  const wordCount = countWords(answer)
  const hasTitle = /\S/.test(answer.split('\n')[0] ?? '') && (answer.split('\n')[0] ?? '').trim().length <= 30
  const hasStructure = hasNumbering(answer) || (answer.match(/\n/g)?.length ?? 0) >= 3
  const wordOk = question.wordLimit > 0 && wordCount >= question.wordLimit - 100

  if (hasTitle && hasStructure && wordOk) return '二类文'
  if (hasTitle && wordOk) return '三类文'
  if (wordCount < 400) return '四类文'
  return '三类文'
}

// 综合评分：小题以规则打分为准；大作文由 LLM 精修，规则仅作兜底
export function scoreAnswer(question: Question, answer: string): ScoreResult {
  if (question.type === '文章论述') {
    const band = estimateBand(question, answer)
    const bands = question.gradingBands ?? []
    const found = bands.find((b) => b.band === band)
    const midScore = found
      ? Math.round((found.scoreRange[0] + found.scoreRange[1]) / 2)
      : Math.round(question.score * 0.7)
    return {
      totalScore: question.score,
      score: midScore,
      ratio: question.score > 0 ? midScore / question.score : 0,
      pointResults: [],
      formatScore: 0,
      wordCount: countWords(answer),
      overWordLimit: question.wordLimit > 0 && countWords(answer) > question.wordLimit,
      band,
      hitSummary: [],
      missSummary: []
    }
  }
  return ruleScore(question, answer)
}
