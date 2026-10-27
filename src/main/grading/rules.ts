// 形式检查与硬规则：确定性的事情全部由代码完成。
import type {
  EssayHardIssue,
  FormatDeduction,
  GradingConstraints,
  Question
} from '../../shared/types'
import { FORM_RULES } from './config'

// 申论计字：去掉空白与换行，其余（含标点）都算
export function countChars(text: string): number {
  return (text || '').replace(/\s/g, '').length
}

// 分条检测：不能只扫行首（很多答案把序号写在句末标点后）
const CN2NUM: Record<string, string> = {
  一: '1',
  二: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  八: '8',
  九: '9',
  十: '10'
}
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫'
const ITEM_RE = new RegExp(
  `(?:^|(?<=[。！？；：:\\n]))\\s*` +
    `([一二三四五六七八九十]{1,3}是|首先|其次|再次|最后|第[一二三四五六七八九十]{1,3}[，,、.．]?|` +
    `[一二三四五六七八九十]{1,3}、|\\d{1,2}[.、]|[（(]\\d{1,2}[)）]|[（(][一二三四五六七八九十]{1,3}[)）]|[${CIRCLED}])`,
  'm'
)

// 把各种序号写法归一成数字，便于检测重复
function normalizeItem(raw: string): string {
  if (CIRCLED.includes(raw[0])) return String(CIRCLED.indexOf(raw[0]) + 1)
  if (raw === '首先') return '1'
  if (raw === '其次') return '2'
  if (raw === '再次') return '3'
  if (raw === '最后') return '4'
  if (/^第/.test(raw)) {
    const inner = raw.replace(/^第/, '').replace(/[，,、.．]/g, '')
    return CN2NUM[inner] ?? inner
  }
  if (/^[一二三四五六七八九十]{1,3}是$/.test(raw)) {
    const inner = raw.slice(0, -1)
    return CN2NUM[inner] ?? inner
  }
  if (raw[0].startsWith('（') || raw[0].startsWith('(')) {
    const inner = raw.replace(/[（）()]/g, '').trim()
    return CN2NUM[inner] ?? inner
  }
  if (/^\d/.test(raw)) return raw.replace(/[.、]/g, '')
  return CN2NUM[raw.replace('、', '')] ?? raw.replace('、', '')
}

export interface ItemizationInfo {
  has: boolean
  count: number
  duplicates: string[]
}

export function detectItemization(text: string): ItemizationInfo {
  const re = new RegExp(ITEM_RE.source, 'gm')
  const found: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text || '')) !== null) {
    found.push(normalizeItem(m[1]))
    if (re.lastIndex === m.index) re.lastIndex++
  }
  const seen = new Map<string, number>()
  for (const v of found) seen.set(v, (seen.get(v) ?? 0) + 1)
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([v, n]) => `序号 ${v} 出现 ${n} 次`)
  return { has: found.length > 0, count: found.length, duplicates }
}

// 照抄材料检测：连续 ≥ shingle 字的片段
export function findCopiedSegments(answer: string, material: string, shingle = 20): string[] {
  const a = (answer || '').replace(/\s/g, '')
  const m = (material || '').replace(/\s/g, '')
  if (a.length < shingle || m.length < shingle) return []
  const set = new Set<string>()
  for (let i = 0; i + shingle <= m.length; i++) set.add(m.slice(i, i + shingle))
  const hits: string[] = []
  let i = 0
  while (i + shingle <= a.length) {
    const seg = a.slice(i, i + shingle)
    if (set.has(seg)) {
      hits.push(seg)
      i += shingle
    } else {
      i += 1
    }
  }
  return hits
}

export function checkFormDeductions(
  question: Question,
  answer: string,
  constraints: GradingConstraints
): FormatDeduction[] {
  const out: FormatDeduction[] = []
  const n = countChars(answer)

  if (constraints.minChars && n < constraints.minChars) {
    const under = (constraints.minChars - n) / constraints.minChars
    const tiers = Math.max(1, Math.ceil(under / FORM_RULES.underChar.perRatio))
    const penalty = Math.min(tiers * FORM_RULES.underChar.perPenalty, FORM_RULES.underChar.cap)
    out.push({
      type: '少字',
      reason: `共 ${n} 字，少于要求 ${constraints.minChars} 字（${(under * 100).toFixed(0)}%）`,
      value: penalty
    })
  }
  if (constraints.maxChars && n > constraints.maxChars) {
    const over = (n - constraints.maxChars) / constraints.maxChars
    const tiers = Math.max(1, Math.ceil(over / FORM_RULES.overChar.perRatio))
    const penalty = Math.min(tiers * FORM_RULES.overChar.perPenalty, FORM_RULES.overChar.cap)
    out.push({
      type: '超字',
      reason: `共 ${n} 字，超出上限 ${constraints.maxChars} 字（${(over * 100).toFixed(0)}%）`,
      value: penalty
    })
  }

  const items = detectItemization(answer)
  if (constraints.requireItems && !items.has && question.type !== '文章论述') {
    out.push({ type: '未分条', reason: '题干要求分条/条理，答卷未见序号', value: FORM_RULES.missingItems })
  }
  if (items.duplicates.length > 0) {
    const penalty = Math.min(
      items.duplicates.length * FORM_RULES.duplicateNumber.perPenalty,
      FORM_RULES.duplicateNumber.cap
    )
    out.push({ type: '编号重复', reason: items.duplicates.join('；'), value: penalty })
  }

  return out
}

function firstNonEmptyLines(answer: string, limit: number): string[] {
  return (answer || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, limit)
}

function lastNonEmptyLines(answer: string, limit: number): string[] {
  return (answer || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-limit)
}

const DATE_RE = /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|20\d{2}[./-]\d{1,2}[./-]\d{1,2}/
const SIGN_RE =
  /(?:委|局|部|办|中心|政府|公司|学校|学院|协会|研究会|院|会|处|站|科|室|队|集团|银行|社|厅|署|办公室)$/

// 应用文格式要素检测（确定性；用于判断必需要素是否缺失）
export function detectApplicationFormat(answer: string): Record<string, boolean> {
  const lines = (answer || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const first = lines[0] ?? ''
  const head = lines.slice(0, 6)
  const tail = lines.slice(-6)
  // 标题：首行长度适中、不是称谓/问候语；允许标题末尾带冒号（如“XXX汇报提纲：”）
  const firstClean = first.replace(/[：:。；，,]+$/, '')
  const hasTitle =
    !!firstClean &&
    firstClean.length >= 2 &&
    firstClean.length <= 40 &&
    !/^(?:广大|尊敬的|各位|亲爱的|同志们|朋友们)/.test(firstClean)
  const hasSalutation = head.some((l) => /[：:]$/.test(l) && l.length <= 30)
  const hasBody = lines.length >= 3
  const hasSignature = tail.some((l) => SIGN_RE.test(l.replace(/[。；，,]$/, '')) && l.length <= 40)
  const hasDate = tail.some((l) => DATE_RE.test(l))
  return { 标题: hasTitle, 称谓: hasSalutation, 正文结构: hasBody, 落款: hasSignature, 日期: hasDate }
}

export function checkApplicationFormat(
  answer: string,
  constraints: GradingConstraints,
  fullScore: number
): FormatDeduction[] {
  if (constraints.requiredFormat.length === 0) return []
  const detected = detectApplicationFormat(answer)
  const penaltyPer = FORM_RULES.appFormatElement(fullScore)
  const out: FormatDeduction[] = []
  for (const element of constraints.requiredFormat) {
    const found = detected[element]
    if (found === false) {
      out.push({ type: '格式要素缺失', reason: `缺少「${element}」`, value: penaltyPer })
    }
  }
  return out
}

export interface EssayHardCheck {
  wordCount: number
  copied: string[]
  issues: EssayHardIssue[]
  severeWordShort: boolean
}

export function checkEssayHardRules(
  question: Question,
  answer: string,
  constraints: GradingConstraints
): EssayHardCheck {
  const wordCount = countChars(answer)
  const issues: EssayHardIssue[] = []
  const copied = findCopiedSegments(answer, question.material, FORM_RULES.essayCopy.shingle)

  if (constraints.minChars && wordCount < constraints.minChars) {
    const under = (constraints.minChars - wordCount) / constraints.minChars
    // 大作文按每少 15% 扣 1 分、最多扣 2 分（训练规则；比小题更温和，避免单一字数压低整档）
    const penalty = Math.min(Math.ceil(under / 0.15), 2)
    issues.push({
      type: '字数',
      detail: `共 ${wordCount} 字，少于要求下限 ${constraints.minChars} 字（${(under * 100).toFixed(0)}%）`,
      penalty
    })
  }
  if (constraints.maxChars && wordCount > constraints.maxChars) {
    const over = (wordCount - constraints.maxChars) / constraints.maxChars
    const penalty = Math.min(Math.ceil(over / 0.15), 2)
    issues.push({
      type: '字数',
      detail: `共 ${wordCount} 字，超出上限 ${constraints.maxChars} 字（${(over * 100).toFixed(0)}%）`,
      penalty
    })
  }
  if (copied.length > 0) {
    const penalty = Math.min(copied.length * FORM_RULES.essayCopy.perPenalty, FORM_RULES.essayCopy.cap)
    issues.push({
      type: '抄材料',
      detail: `与材料连续重合 ≥${FORM_RULES.essayCopy.shingle} 字共 ${copied.length} 处，如「${copied[0].slice(0, 30)}…」`,
      penalty
    })
  }
  const firstLine = firstNonEmptyLines(answer, 1)[0] ?? ''
  if (!firstLine || firstLine.length > 40) {
    issues.push({ type: '标题', detail: '未识别到独立标题行（或标题过长）', penalty: 0 })
  }
  // 未替换的占位符（如【主题词】、XXX）属明显硬伤
  const placeholder = /【[^】]{0,12}主题词[^】]{0,12}】|\[主题词\]|（主题词）|XXX|×××|xxx/.exec(answer)
  if (placeholder) {
    issues.push({
      type: '其他',
      detail: `存在未替换的占位符「${placeholder[0]}」`,
      penalty: 1
    })
  }

  const severeWordShort = !!constraints.minChars && wordCount < constraints.minChars * 0.5
  return { wordCount, copied, issues, severeWordShort }
}
