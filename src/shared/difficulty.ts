import type { Question, QuestionType } from './types'

// 题目难度（0-10，数字越大越难）
// 难度不单独手写，而是由题型基准分 + 分值/字数/材料长度/作答时长/采分点数量共同推导，
// 保证同类型、同规模的题目难度一致，也避免新增题目忘记标注。

// 各题型的思维门槛基准分
const TYPE_BASE: Record<QuestionType, number> = {
  归纳概括: 1.5,
  提出对策: 4,
  综合分析: 4,
  应用文写作: 5,
  文章论述: 6
}

// 未计算难度的题目（种子数据里的原始形态）
export type QuestionCore = Omit<Question, 'difficulty'>

// 各修正项的系数按题库实际取值范围标定（分值 10~40、字数 200~1200、材料 0~600 字、
// 时长 15~60 分钟、采分点 0~7 个），每项都设了上限，避免单一因素直接把难度顶到 10
export function calcDifficulty(q: QuestionCore): number {
  let d = TYPE_BASE[q.type] ?? 3
  d += Math.min(1, Math.max(0, (q.score - 10) / 30)) // 分值越高，要覆盖的内容越多
  d += Math.min(1.2, Math.max(0, (q.wordLimit - 200) / 1000)) // 字数要求越高，语言组织越吃力
  d += Math.min(1.2, Math.max(0, q.material.length / 500)) // 材料越长，阅读提炼越费时
  d += Math.min(0.8, Math.max(0, (q.suggestMinutes - 15) / 60)) // 建议作答时长越长，题量越大
  d += Math.min(0.5, q.scoringPoints.length / 14) // 采分点越多，答案结构越复杂
  return Math.max(0, Math.min(10, Math.round(d)))
}

// 难度对应的口头描述，便于用户理解数值含义
export function difficultyLabel(d: number): string {
  if (d <= 2) return '入门'
  if (d <= 4) return '基础'
  if (d <= 6) return '进阶'
  if (d <= 8) return '较难'
  return '高难'
}

// 给一批题目统一补上难度
export function withDifficulty<T extends QuestionCore>(list: T[]): (T & { difficulty: number })[] {
  return list.map((q) => ({ ...q, difficulty: calcDifficulty(q) }))
}
