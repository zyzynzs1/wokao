// 真题数据体检：重点检查
//  1) 套卷与题目关联、题型是否与题干匹配；
//  2) 大作文材料是否错误地拼接了前面题的材料（题干明确引用某则材料时）；
//  3) 材料过短、跨卷材料重复等异常。
// 用法：node scripts/run-audit-exam-data.js
import type { Paper, Question } from '../src/shared/types'
import { seedQuestions } from '../src/main/data/questions'
import { seedRealQuestions, seedRealPapers } from '../src/main/data/realPapers'

const allQuestions: Question[] = [...seedQuestions, ...seedRealQuestions]
const qmap = new Map(allQuestions.map((q) => [q.id, q]))
const norm = (s: string): string => (s || '').replace(/\s/g, '')
const CN: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const APPLICATION_WORDS = /(讲话稿|推荐材料|公开信|倡议书|发言稿|汇报|短评|宣传稿|新闻稿|致辞|讲解稿|工作方案|活动方案|建议书|通知|启事|提纲)/

type Level = 'error' | 'warn' | 'info'
interface Flag {
  level: Level
  paperTitle: string
  message: string
}
const flags: Flag[] = []
const papers: Paper[] = [...seedRealPapers]

for (const paper of papers) {
  const qs = paper.questionIds.map((id) => qmap.get(id)).filter((q): q is Question => !!q)
  if (qs.length !== paper.questionIds.length) {
    const missing = paper.questionIds.filter((id) => !qmap.has(id))
    flags.push({ level: 'error', paperTitle: paper.title, message: `题目缺失：${missing.join(', ')}` })
  }
  const essay = qs.find((q) => q.type === '文章论述')
  const refs = essay
    ? [
        ...new Set(
          [...`${essay.title}\n${essay.requirement}`.matchAll(/给定(?:资料|材料)\s*([一二三四五六七八九十\d]+)/g)]
            .map((m) => (/^\d+$/.test(m[1]) ? Number(m[1]) : (CN[m[1]] ?? 0)))
            .filter((n) => n > 0)
        )
      ]
    : []
  const nonEssay = qs.filter((q) => q.type !== '文章论述')

  for (const q of qs) {
    if (q.type === '文章论述' && APPLICATION_WORDS.test(q.title)) {
      flags.push({ level: 'error', paperTitle: paper.title, message: `${q.id} 标题是应用文（${q.title.slice(0, 40)}…），但题型仍为文章论述` })
    }
    if ((q.type === '文章论述' || q.type === '应用文写作') && norm(q.material).length < 300) {
      flags.push({ level: 'warn', paperTitle: paper.title, message: `${q.id}（${q.type}）材料只有 ${norm(q.material).length} 字，疑似缺失/截断` })
    }
  }

  // 材料包含关系
  for (const a of qs) {
    const ma = norm(a.material)
    if (ma.length < 400) continue
    const contained = qs.filter((b) => b.id !== a.id && norm(b.material).length >= 400 && ma.includes(norm(b.material)))
    if (contained.length === 0) continue
    if (a.type === '文章论述') {
      const referencedIds = refs.map((n) => nonEssay[n - 1]?.id).filter(Boolean)
      const unreferenced = contained.filter((b) => !referencedIds.includes(b.id))
      if (refs.length > 0 && unreferenced.length > 0) {
        flags.push({ level: 'error', paperTitle: paper.title, message: `${a.id} 材料仍包含未引用题目的材料：${unreferenced.map((b) => b.id).join(', ')}` })
      } else if (refs.length === 0) {
        flags.push({ level: 'info', paperTitle: paper.title, message: `${a.id} 题干未指定具体材料，材料为全卷资料（合理设计）` })
      }
    } else {
      flags.push({ level: 'info', paperTitle: paper.title, message: `${a.id} 材料包含其他题材料（可能是多材料题/子题，属正常）：${contained.map((b) => b.id).join(', ')}` })
    }
  }

  // 同卷同材料
  const byMat = new Map<string, Question[]>()
  for (const q of qs) {
    const k = norm(q.material)
    if (!k) continue
    byMat.set(k, [...(byMat.get(k) ?? []), q])
  }
  for (const [, list] of byMat) {
    if (list.length <= 1) continue
    const isEssayShare = list.some((q) => q.type === '文章论述') && refs.length > 0
    flags.push({
      level: isEssayShare ? 'info' : 'info',
      paperTitle: paper.title,
      message: `同卷题目材料相同：${list.map((q) => q.id).join(', ')}（${isEssayShare ? '大作文引用的那则材料与小题共用' : '子题/多材料题共用'}）`
    })
  }
}

// 跨套卷材料完全重复
const matOwners = new Map<string, { id: string; paperId: string }[]>()
for (const paper of papers) {
  for (const id of paper.questionIds) {
    const q = qmap.get(id)
    if (!q) continue
    const key = norm(q.material)
    if (!key) continue
    matOwners.set(key, [...(matOwners.get(key) ?? []), { id, paperId: paper.id }])
  }
}
for (const [, owners] of matOwners) {
  const paperIds = [...new Set(owners.map((o) => o.paperId))]
  if (paperIds.length > 1) {
    flags.push({ level: 'warn', paperTitle: paperIds.join(','), message: `跨套卷材料完全相同：${owners.map((o) => o.id).join(', ')}（待核实）` })
  }
}

const errs = flags.filter((f) => f.level === 'error')
const warns = flags.filter((f) => f.level === 'warn')
const infos = flags.filter((f) => f.level === 'info')
console.log(`套卷数：${papers.length}，题目数：${allQuestions.length}`)
console.log(`体检结果：error ${errs.length} / warn ${warns.length} / info ${infos.length}`)
for (const level of ['error', 'warn', 'info'] as Level[]) {
  const list = flags.filter((f) => f.level === level)
  if (!list.length) continue
  console.log(`\n=== ${level} ===`)
  for (const f of list) console.log(`[${f.paperTitle}] ${f.message}`)
}
