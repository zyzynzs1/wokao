// 导出“新评分 vs Lead 独立复评”差异 ≥4 分的样本，供第三方 AI 复评使用。
// 用法：node scripts/run-export-disputed-samples.js
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { PracticeRecord, Question } from '../src/shared/types'
import { seedQuestions } from '../src/main/data/questions'
import { seedRealQuestions } from '../src/main/data/realPapers'

const APPDATA = process.env.APPDATA ?? ''
const DATA_DIR = join(APPDATA, 'wokao', 'data')
const OUT = join(process.cwd(), 'docs', '评分争议样本-2026-10-27.md')

interface CaseConfig {
  recordId: string
  leadScore: number
  leadReason: string[]
}

const CASES: CaseConfig[] = [
  {
    recordId: 'e00b2005-6d03-4a1a-b0a6-ada27cc473a1', // gk-fs-zh-01
    leadScore: 10.5,
    leadReason: [
      '全文 238 字（要求不超过 350 字），篇幅偏短，分析展开不足。',
      '没有分别界定“塑形”（基础设施/人居环境等物质层面）与“铸魂”（乡土文化/文明乡风等精神层面）的内涵，只笼统带过。',
      '写出了重硬件轻精神的问题与“并重”结论，但未点明“物质文明与精神文明协调发展”的实质，深度不足。',
      '语言基本通顺，有个别错别字（“页在消失”）。综合给三档下（10.5/20）。'
    ]
  },
  {
    recordId: 'a29403e9-e5d7-4eea-8422-14e941994001', // gk-fs-dzw-01 第一次
    leadScore: 17,
    leadReason: [
      '全文字数 658 字，远低于 1000–1200 字要求，按字数规则应扣分。',
      '标题“激扬创新之力 奔赴复兴征程”与题干“方向与速度”的核心关系偏离；开头把引文理解为“创新的意义”，立意偏移。',
      '分论点“筑牢思想根基/守正创新/统筹兼顾”较泛，与“跑对方向”的辩证关系不紧。',
      '结尾仍留有“【主题词】”占位符，属明显硬伤。综合按三类下/四类上，给 17/35（相对宽松的口径）。'
    ]
  },
  {
    recordId: 'a201fa2a-7810-4b32-9016-60f7d9e9ddb6', // gk-fs-dzw-01 第二次
    leadScore: 19,
    leadReason: [
      '全文字数 922 字，仍低于 1000 字下限。',
      '开头大段复述材料（“近年来，各地在推动经济社会发展中……”），有照抄材料之嫌。',
      '分论点仍偏通用（思想根基/内生动力/统筹兼顾），与“方向与速度”的关系论证不够集中。',
      '结构完整、扣题意识比第一篇好，按三类中/上，给 19/35（相对宽松的口径）。'
    ]
  },
  {
    recordId: '13baa6e2-fd40-4501-83dc-4f6240ddaf0c', // zt-gk-2026-ds-03
    leadScore: 5,
    leadReason: [
      '发布词必须有标题、称呼（广大市民朋友）、正文、署名（S市科委）与日期；答案无标题、无称呼、无署名，只有日期，格式严重缺失。',
      '题干要求“宗旨明确、介绍全面、有号召力”，答案未写 8 个项目、未写生态学/天文学/心理学领域、未写线上平台报名方式与培训方式，核心要点缺失。',
      '内容大量照抄材料、语言口语化，且存在错别字（“缩进”应为“拉近”）。',
      '综合给四类上（5/20）。'
    ]
  },
  {
    recordId: 'e86da2ea-7945-46e2-b458-e8e60ff91317', // zt-gk-2026-ds-04
    leadScore: 13,
    leadReason: [
      '原因部分覆盖了村民/承租人顾虑、基础设施配套不足、“新村民计划”合同漏洞三类原因，较好。',
      '“配套政策不到位、多部门协调难、噪音管控缺失”只写了天然气入户一句，噪音问题完全未提，原因不完整。',
      '建议部分“明确政策、专人统筹、明确法律条款”偏空泛，缺少具体责任主体、措施与落地条件；对策与原因的对应不够清晰。',
      '语言有口语化（“打水漂”）与用词不当（“有法可依”），综合给 13/20（二档下）。'
    ]
  }
]

function readJson<T>(file: string, fallback: T): T {
  const p = join(DATA_DIR, file)
  if (!existsSync(p)) return fallback
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function countChars(text: string): number {
  return (text ?? '').replace(/\s/g, '').length
}

const questions = new Map<string, Question>(
  [...seedQuestions, ...seedRealQuestions].map((q) => [q.id, q])
)
const records = readJson<PracticeRecord[]>('records.json', [])

const lines: string[] = []
lines.push('# 评分争议样本（App 新标准 vs Lead 独立复评，差异 ≥ 4 分）')
lines.push('')
lines.push('> 用途：提交给第三方 AI 独立复评。建议先只看题干、材料、作答，自行评分后再看末尾两版分数。')
lines.push('> 数据来源：`%APPDATA%\\wokao\\data\\records.json`（2026-10-27 新标准重评后）。')
lines.push('> 说明：App 新标准 = `grading-v2.0`（材料建点 + 三次独立判点 + 代码算分）；Lead 独立复评 = 另一位阅卷者按申论阅卷逻辑给出的分数。')
lines.push('')
lines.push('---')
lines.push('')

let index = 0
for (const cfg of CASES) {
  const record = records.find((r) => r.id === cfg.recordId)
  if (!record) continue
  const q = questions.get(record.questionId)
  if (!q) continue
  index++
  const appScore = record.grading?.center ?? record.scoreResult.score
  const total = record.scoreResult.totalScore
  const range = record.grading?.range
  const tier = record.grading?.tier ?? '—'
  const confidence = record.grading?.confidence ?? '—'
  const diff = Number((appScore - cfg.leadScore).toFixed(1))

  lines.push(`## 样本 ${index}：${q.id} · ${q.type} · ${q.examType}/${q.subType}`)
  lines.push('')
  lines.push(`- 记录 ID：${record.id}`)
  lines.push(`- 练习类型：${record.practiceType}；时间：${new Date(record.createdAt).toLocaleString('zh-CN')}`)
  lines.push(`- 满分：${total} 分；作答字数：${countChars(record.answer)} 字${q.wordLimit ? `；字数要求上限 ${q.wordLimit} 字` : ''}`)
  lines.push('')
  lines.push('### 题干')
  lines.push('')
  lines.push(q.title)
  lines.push('')
  lines.push('### 作答要求')
  lines.push('')
  lines.push(q.requirement)
  lines.push('')
  lines.push('### 给定资料')
  lines.push('')
  lines.push(q.material)
  lines.push('')
  lines.push(`### 考生作答（${countChars(record.answer)} 字）`)
  lines.push('')
  lines.push('```text')
  lines.push(record.answer || '（未作答）')
  lines.push('```')
  lines.push('')
  lines.push('### 评分 A（App 新标准）')
  lines.push('')
  lines.push(
    `- **${appScore}/${total} 分** · ${tier} · 建议区间 ${range ? `${range[0]}–${range[1]}` : '—'} · 置信度 ${confidence}`
  )
  lines.push('')
  lines.push('### 评分 B（Lead 独立复评）')
  lines.push('')
  lines.push(`- **${cfg.leadScore}/${total} 分**`)
  for (const reason of cfg.leadReason) lines.push(`  - ${reason}`)
  lines.push('')
  lines.push(`### 两版差异`)
  lines.push('')
  lines.push(`- App 新标准 − Lead 独立复评 = **${diff > 0 ? '+' : ''}${diff} 分**（差异 ≥4，纳入本清单）`)
  lines.push('')
  lines.push('---')
  lines.push('')
}

const header = lines.join('\n')
writeFileSync(OUT, header, 'utf-8')
console.log(`已导出 ${index} 个样本到 ${OUT}`)
