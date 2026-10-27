// 修复真题材料关联：
// 1) 大作文（文章论述）材料不再整卷拼接，而是按题干引用的“给定资料N”取对应材料；
// 2) 明确属于应用文（讲话稿/推荐材料/公开信等）却标成“文章论述”的题，改回应用文写作。
// 用法：node scripts/run-fix-exam-data.js
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Paper, Question } from '../src/shared/types'
import { seedQuestions } from '../src/main/data/questions'
import { seedRealQuestions, seedRealPapers } from '../src/main/data/realPapers'

const root = process.cwd()
const qmap = new Map<string, Question>([...seedQuestions, ...seedRealQuestions].map((q) => [q.id, q]))
const norm = (s: string): string => (s || '').replace(/\s/g, '')
const paragraphs = (s: string): string[] =>
  (s || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
const CN: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

interface Change {
  material?: string
  type?: Question['type']
}

const changes = new Map<string, Change>()
const report: string[] = []

function deriveExtraMaterial(essay: Question, others: Question[]): string {
  const otherText = others.map((q) => norm(q.material)).join('\n')
  const keep = paragraphs(essay.material).filter((p) => !otherText.includes(norm(p)))
  return keep
    .join('\n\n')
    .replace(/^材料[一二三四五六七八九十\d]+\s*/, '')
    .trim()
}

for (const paper of seedRealPapers as Paper[]) {
  const qs = paper.questionIds.map((id) => qmap.get(id)).filter((q): q is Question => !!q)
  const essay = qs.find((q) => q.type === '文章论述')
  if (!essay) continue
  const others = qs.filter((q) => q.id !== essay.id)

  // 明确是应用文的题：标题含常见文种，虽标成文章论述，按应用文处理
  const applicationLike =
    /(讲话稿|推荐材料|公开信|倡议书|发言稿|汇报|短评|宣传稿|新闻稿|致辞|讲解稿|工作方案|活动方案|建议书|通知|启事|提纲)/.test(
      essay.title
    )

  const refs = [
    ...new Set(
      [...`${essay.title}\n${essay.requirement}`.matchAll(/给定(?:资料|材料)\s*([一二三四五六七八九十\d]+)/g)]
        .map((m) => (/^\d+$/.test(m[1]) ? Number(m[1]) : (CN[m[1]] ?? 0)))
        .filter((n) => n > 0)
    )
  ]

  if (refs.length === 0) {
    // 题干没有指定某则材料（“参考给定资料”）：保留全卷材料，属于合理设计
    if (applicationLike) {
      changes.set(essay.id, { ...(changes.get(essay.id) ?? {}), type: '应用文写作' })
      report.push(`${paper.title} | ${essay.id} | 类型改为应用文（题干无明确材料编号，材料保留全卷）`)
    }
    continue
  }

  let material = ''
  if (refs.every((n) => n <= others.length)) {
    material = refs
      .map((n) => others[n - 1]?.material ?? '')
      .filter(Boolean)
      .join('\n\n')
  } else {
    // 引用的是第 5/6 则材料：用同卷其他题目的材料做“段落覆盖”，剩下的即目标材料
    const extra = deriveExtraMaterial(essay, others)
    if (extra.length >= 100) {
      material = extra
    } else {
      // 极端兜底：保留原全卷材料，标记待人工处理
      report.push(`${paper.title} | ${essay.id} | ⚠️ 无法自动提取材料${refs.join('/')}（剩余 ${norm(extra).length} 字），保留全卷材料`)
    }
  }

  if (material && norm(material) !== norm(essay.material)) {
    const change = changes.get(essay.id) ?? {}
    change.material = material
    if (applicationLike) change.type = '应用文写作'
    changes.set(essay.id, change)
    report.push(
      `${paper.title} | ${essay.id} | 材料 ${norm(essay.material).length} → ${norm(material).length} 字（引用 ${refs.map((n) => `资料${n}`).join('、')}）${applicationLike ? '；类型改为应用文' : ''}`
    )
  } else if (applicationLike) {
    const change = changes.get(essay.id) ?? {}
    change.type = '应用文写作'
    changes.set(essay.id, change)
    report.push(`${paper.title} | ${essay.id} | 类型改为应用文`)
  }
}

// 写回 TS 数据文件：在题目对象内替换 material / type 字段
function findObjectStart(text: string, id: string): number {
  const marker = `id: "${id}"`
  const idx = text.indexOf(marker)
  if (idx < 0) return -1
  // 向前找最近的 "{"（题目对象开始）
  for (let i = idx; i >= 0; i--) {
    if (text[i] === '{') return i
  }
  return -1
}

function findObjectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function replaceStringField(objText: string, field: string, value: string): string {
  const marker = `${field}: `
  const idx = objText.indexOf(marker)
  if (idx < 0) return objText
  let p = idx + marker.length
  if (objText[p] !== '"') return objText
  const start = p
  p++
  let escaped = false
  while (p < objText.length) {
    const ch = objText[p]
    if (escaped) escaped = false
    else if (ch === '\\') escaped = true
    else if (ch === '"') break
    p++
  }
  const end = p + 1
  return objText.slice(0, start) + JSON.stringify(value) + objText.slice(end)
}

const files = Array.from({ length: 11 }, (_, i) => `src/main/data/gk/${2016 + i}.ts`)
let patched = 0
for (const file of files) {
  const full = join(root, file)
  let text = readFileSync(full, 'utf-8')
  const original = text
  for (const [id, change] of changes) {
    const start = findObjectStart(text, id)
    if (start < 0) continue
    const end = findObjectEnd(text, start)
    if (end < 0) continue
    let obj = text.slice(start, end + 1)
    if (change.type) obj = replaceStringField(obj, 'type', change.type)
    if (change.material) obj = replaceStringField(obj, 'material', change.material)
    if (obj !== text.slice(start, end + 1)) {
      text = text.slice(0, start) + obj + text.slice(end + 1)
      patched++
    }
  }
  if (text !== original) writeFileSync(full, text, 'utf-8')
}

console.log(`需要修改的题目：${changes.size}，实际写入字段：${patched}\n`)
for (const line of report) console.log('  ' + line)
