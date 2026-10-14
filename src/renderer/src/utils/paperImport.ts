import type { ExamType, Paper, Question, QuestionType, SubType } from '../../../shared/types'
import { calcDifficulty } from '../../../shared/difficulty'

// 本地真题文件解析（zip / docx / pdf / txt / md）
// 思路：先从文件中抽取纯文本，再按申论题目的常见排版（一、二、… 或 1. 2. …）切分题目，
// 最后统一套用软件内的题目结构（题干 / 分值 / 字数 / 难度等），可直接进入作答与评分流程。

export interface ParsedQuestion {
  title: string
  requirement: string
  type: QuestionType
  score: number
  wordLimit: number
  suggestMinutes: number
  difficulty: number
}

export interface ParsedExam {
  title: string
  material: string
  questions: ParsedQuestion[]
}

// 可解析的文件格式（zip 会递归查找其中的文档）
export const SUPPORTED_EXT = ['.zip', '.docx', '.doc', '.pdf', '.txt', '.md']

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
}

// 解析 Word（.docx 本质是 zip，读取 word/document.xml 并按段落还原文本）
async function readDocx(buf: ArrayBuffer): Promise<string> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buf)
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error('无法读取 Word 内容（缺少 document.xml），请确认文件为 .docx 格式')
  const xml = await entry.async('string')
  const lines = xml.split(/<\/w:p>/).map((p) => {
    const runs = [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1])
    return decodeXmlEntities(runs.join(''))
  })
  return lines.join('\n')
}

// 解析 PDF（基于 pdf.js 抽取文字层，扫描版图片 PDF 无法识别）
async function readPdf(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({ data: new Uint8Array(buf) })
  const doc = await task.promise
  let out = ''
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      let line = ''
      for (const item of content.items) {
        const it = item as { str?: string; hasEOL?: boolean }
        if (typeof it.str !== 'string') continue
        line += it.str
        if (it.hasEOL) {
          out += line + '\n'
          line = ''
        }
      }
      out += line + '\n'
    }
  } finally {
    await task.destroy()
  }
  return out
}

// 解压 zip 并解析其中受支持的文档
async function readZip(buf: ArrayBuffer): Promise<{ name: string; text: string }[]> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buf)
  const inner = Object.values(zip.files).filter((f) => {
    const ext = extOf(f.name)
    return !f.dir && ext !== '.zip' && SUPPORTED_EXT.includes(ext)
  })
  const out: { name: string; text: string }[] = []
  for (const f of inner) {
    const text = await extractText(await f.async('arraybuffer'), f.name)
    if (text.trim()) out.push({ name: f.name, text })
  }
  return out
}

// 抽取文件纯文本
export async function extractText(buf: ArrayBuffer, name: string): Promise<string> {
  const ext = extOf(name)
  if (ext === '.docx') return readDocx(buf)
  if (ext === '.pdf') return readPdf(buf)
  if (ext === '.txt' || ext === '.md') return new TextDecoder('utf-8').decode(buf)
  if (ext === '.doc') throw new Error('暂不支持旧版 .doc，请用 Word 另存为 .docx 后重试')
  if (ext === '.zip') {
    const parts = await readZip(buf)
    if (parts.length === 0) throw new Error('压缩包内没有可解析的文档（支持 docx / pdf / txt）')
    return parts.map((p) => `【${p.name}】\n${p.text}`).join('\n\n')
  }
  throw new Error(`不支持的文件格式：${ext || name}`)
}

// ---- 文本 → 题目结构 ----

const CN_NUM = '一二三四五六七八九十'
const MARKER_RE = new RegExp(`^[\\s]*(?:第?[${CN_NUM}]{1,3}[、.．)）]|\\d{1,2}[、.．)）])\\s*`)
// 判断一段文字是否像「题目」（含作答动词或分值/字数要求）
const QUESTION_HINT = /请|作答|概括|归纳|总结|分析|理解|谈谈|谈谈你的|评析|评价|阐释|提出|对策|措施|建议|拟写|撰写|起草|写一[篇份]|论述|作文|不超过|字数|分[）)]/
// 段落标题行（如「作答要求」「给定资料」），判断题目时先剔除，避免被误判成题目
const HEADER_LINE = /^(?:作答要求|答题要求|要求|注意事项|给定资料|给定材料|背景资料|参考资料|材料)[:：]?$/

function isMarker(line: string): boolean {
  return MARKER_RE.test(line)
}

function looksLikeQuestion(text: string): boolean {
  const cleaned = text
    .split('\n')
    .filter((l) => !HEADER_LINE.test(l.trim()))
    .join('\n')
  return QUESTION_HINT.test(cleaned.slice(0, 200))
}

function lastNumber(re: RegExp, text: string): number | null {
  let last: number | null = null
  let m: RegExpExecArray | null
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  while ((m = r.exec(text)) !== null) {
    last = parseInt(m[1], 10)
    if (r.lastIndex === m.index) r.lastIndex++
  }
  return last
}

function inferType(text: string): QuestionType {
  // 具体文种优先（避免「写一份倡议书」被误判为文章论述）
  if (
    /倡议书|发言稿|讲话稿|宣传稿|公开信|汇报|报告|短评|编者按|工作方案|方案|建议书|提纲|书信|通知|公告|致辞|解说词|导言|简报|解说稿/.test(
      text
    )
  ) {
    return '应用文写作'
  }
  if (/作文|文章|论述|议论文|写一[篇份]|自拟题目|以.{2,24}为题/.test(text)) return '文章论述'
  if (/对策|措施|建议|怎么办|如何解决|解决办法/.test(text)) return '提出对策'
  if (/分析|理解|谈谈|看法|评析|评价|阐释|解释|含义|认识|启示/.test(text)) return '综合分析'
  return '归纳概括'
}

function estimateMinutes(type: QuestionType, score: number, wordLimit: number): number {
  if (type === '文章论述') return 60
  if (wordLimit >= 800) return 45
  if (wordLimit >= 500) return 35
  if (wordLimit >= 300) return 25
  if (wordLimit > 0) return 20
  return score >= 25 ? 30 : 20
}

function buildQuestion(segText: string, material: string): ParsedQuestion {
  const body = segText.replace(MARKER_RE, '').trim()
  const score = lastNumber(/(\d{1,3})\s*分/, body) ?? 20
  const wordLimit =
    lastNumber(/不超过\s*(\d{3,4})\s*字/, body) ??
    lastNumber(/(\d{3,4})\s*字(?:左右|以内|以上|以下)?/, body) ??
    0
  const type = inferType(body)
  // 题干去掉尾部的「（X分）」标注，分值/字数改由规范化的作答要求展示
  const title = body.replace(/[（(]\s*\d{1,3}\s*分\s*[）)]/g, '').trim() || body
  const requirement = `分值 ${score} 分；${wordLimit > 0 ? `字数不超过 ${wordLimit} 字` : '字数不限'}。`
  const suggestMinutes = estimateMinutes(type, score, wordLimit)
  const difficulty = calcDifficulty({
    id: '',
    type,
    examType: '国考',
    subType: '副省级',
    title,
    material,
    requirement,
    score,
    suggestMinutes,
    wordLimit,
    referenceAnswer: '',
    scoringPoints: [],
    scoringRules: '',
    source: ''
  })
  return { title, requirement, type, score, wordLimit, suggestMinutes, difficulty }
}

export function deriveTitle(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  return base.trim() || '本地导入真题'
}

// 把纯文本解析成「材料 + 若干题目」
export function parseExamText(raw: string, fileName: string): ParsedExam {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
  const lines = text.split('\n')

  const candidates: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (isMarker(lines[i])) candidates.push(i)
  }

  // 只保留「像题目」的标记行，材料的「一、二、…」条目会被并入材料
  const starts: number[] = []
  for (let k = 0; k < candidates.length; k++) {
    const s = candidates[k]
    const e = k + 1 < candidates.length ? candidates[k + 1] : lines.length
    if (looksLikeQuestion(lines.slice(s, e).join('\n'))) starts.push(s)
  }

  if (starts.length === 0) {
    throw new Error(
      '未能识别出题目结构。请确认文件中包含申论题目与作答要求；若为扫描版 PDF（图片）则无法识别文字。'
    )
  }

  const material = lines.slice(0, starts[0]).join('\n').trim()
  const questions: ParsedQuestion[] = []
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k]
    const e = k + 1 < starts.length ? starts[k + 1] : lines.length
    questions.push(buildQuestion(lines.slice(s, e).join('\n').trim(), material))
  }

  return { title: deriveTitle(fileName), material, questions }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

// 把解析结果组装成软件内的「试卷 + 题目」，难度由 calcDifficulty 统一推导
export function buildImportedPaper(
  exam: ParsedExam,
  meta: { title: string; examType: ExamType; subType: SubType; province?: string; source: string }
): { paper: Paper; questions: Question[] } {
  const questions: Question[] = exam.questions.map((q) => {
    const core = {
      id: uid(),
      type: q.type,
      examType: meta.examType,
      subType: meta.subType,
      province: meta.examType === '省考' ? meta.province : undefined,
      title: q.title,
      material: exam.material,
      requirement: q.requirement,
      score: q.score,
      suggestMinutes: q.suggestMinutes,
      wordLimit: q.wordLimit,
      referenceAnswer: '',
      scoringPoints: [],
      scoringRules: '本地导入真题，暂无参考答案与采分点；配置 AI 模型后可获得精批点评。',
      source: meta.source
    }
    return { ...core, difficulty: calcDifficulty(core) }
  })

  const paper: Paper = {
    id: uid(),
    title: meta.title,
    examType: meta.examType,
    subType: meta.subType,
    province: meta.examType === '省考' ? meta.province : undefined,
    questionIds: questions.map((q) => q.id),
    totalScore: questions.reduce((s, q) => s + q.score, 0),
    suggestMinutes: questions.reduce((s, q) => s + q.suggestMinutes, 0),
    createdAt: Date.now()
  }

  return { paper, questions }
}
