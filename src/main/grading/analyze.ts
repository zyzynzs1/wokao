// 题干解析：从题干与作答要求中提取可执行约束（不调用模型，保证稳定）。
import type { GradingConstraints, Question } from '../../shared/types'

function normalizeDigits(text: string): string {
  const map: Record<string, string> = {
    零: '0',
    一: '1',
    二: '2',
    两: '2',
    三: '3',
    四: '4',
    五: '5',
    六: '6',
    七: '7',
    八: '8',
    九: '9'
  }
  // 只处理“不超过三百字”这类简单中文数字；复杂数字交给阿拉伯数字正则
  return text
    .replace(/[零一二两三四五六七八九]{1,4}(?=\s*字)/g, (m) => {
      const digits = m
        .split('')
        .map((c) => map[c] ?? '')
        .join('')
      return digits || m
    })
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
}

function parseCharLimit(requirement: string, wordLimit: number): {
  minChars: number | null
  maxChars: number | null
} {
  const text = normalizeDigits(requirement || '')
  let minChars: number | null = null
  let maxChars: number | null = null

  // 区间：800～1000 字 / 800-1000字 / 800—1000字
  const range = /(\d{2,4})\s*(?:[—\-~～至到])\s*(\d{2,4})\s*字/.exec(text)
  if (range) {
    const a = Number(range[1])
    const b = Number(range[2])
    if (Number.isFinite(a) && Number.isFinite(b)) {
      minChars = Math.min(a, b)
      maxChars = Math.max(a, b)
    }
  }

  if (maxChars === null) {
    const over = /(?:不超过|不多于|不得超过|限|字数不超过)\s*(\d{2,4})\s*字/.exec(text)
    if (over) maxChars = Number(over[1])
  }
  if (minChars === null) {
    const under = /(?:不少于|不低于|至少)\s*(\d{2,4})\s*字/.exec(text)
    if (under) minChars = Number(under[1])
  }
  if (maxChars === null && minChars === null) {
    const around = /(\d{2,4})\s*字(?:左右|上下)/.exec(text)
    if (around) {
      const n = Number(around[1])
      minChars = Math.round(n * 0.9)
      maxChars = Math.round(n * 1.1)
    }
  }
  if (maxChars === null) {
    const single = /(\d{2,4})\s*字/.exec(text)
    if (single) maxChars = Number(single[1])
  }
  // 兜底：题目 wordLimit 是软件内记录的字数上限
  if (maxChars === null && minChars === null && wordLimit > 0) {
    maxChars = wordLimit
  }

  return { minChars, maxChars }
}

// 应用文格式要素：按文种推断“题干通常要求的格式”，最终以题干明确要求为准。
// 只有被列入 requiredFormat 的要素，评分时才会因缺失扣分。
function inferRequiredFormat(question: Question): string[] {
  const text = `${question.title}\n${question.requirement}`
  const isApp = question.type === '应用文写作'
  if (!isApp) return []
  if (/(?:明确要求)?(?:不需要|无需|不要求)格式/.test(text)) return []

  const withSalutation = [
    '倡议书',
    '公开信',
    '宣传稿',
    '发言稿',
    '讲话稿',
    '致辞',
    '讲解稿',
    '招募公告',
    '通知',
    '启事'
  ]
  const withSignature = [
    '倡议书',
    '公开信',
    '宣传稿',
    '发言稿',
    '讲话稿',
    '致辞',
    '通知',
    '启事',
    '工作方案',
    '建议书',
    '短评'
  ]
  const hasSalutation = withSalutation.some((k) => text.includes(k))
  const hasSignature = withSignature.some((k) => text.includes(k))
  const isOutline = /提纲|要点|导言|编者按/.test(text)

  if (isOutline) return ['标题', '正文结构']
  const list = ['标题', '正文结构']
  if (hasSalutation) list.push('称谓')
  if (hasSignature) list.push('落款')
  if (hasSignature || hasSalutation) list.push('日期')
  return list
}

export function analyzeConstraints(question: Question): GradingConstraints {
  const requirement = `${question.requirement || ''}`
  const { minChars, maxChars } = parseCharLimit(requirement, question.wordLimit)
  const requireItems = /分条|条理|层次|分类|分项|分点/.test(requirement)
  const requiredFormat = inferRequiredFormat(question)
  const notes: string[] = []
  if (minChars === null && maxChars === null) notes.push('未识别到明确字数要求')
  if (question.type === '应用文写作' && requiredFormat.length === 0) {
    notes.push('未要求格式，评分不因缺少标题/称谓/落款扣分')
  }
  return {
    minChars,
    maxChars,
    requireItems,
    requiredFormat,
    notes: notes.join('；')
  }
}

// 从题干中提取主题词（用于大作文标题/分论点的辅助校验，最终仍以模型判断为主）
export function extractThemeKeywords(question: Question): string[] {
  const text = `${question.title}\n${question.requirement}`
  const out = new Set<string>()
  const quoted = /[“"]([^”"]{2,40})[”"]/g
  let m: RegExpExecArray | null
  while ((m = quoted.exec(text)) !== null) {
    const t = m[1].trim()
    if (t) out.add(t)
  }
  // 常见主题词兜底
  const pools = [
    '高质量发展',
    '新发展理念',
    '中国式现代化',
    '乡村振兴',
    '基层治理',
    '科技创新',
    '文化自信',
    '生态文明',
    '民生',
    '安全',
    '方向',
    '速度',
    '创新',
    '改革'
  ]
  for (const k of pools) if (text.includes(k)) out.add(k)
  return [...out]
}
