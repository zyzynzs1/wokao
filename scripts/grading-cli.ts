// 评分 v2 本地命令行工具（开发/迁移用，不参与应用打包）。
// 用法：
//   node scripts/run-grading-cli.js one <recordIndex>   // 试评一条，打印完整结果
//   node scripts/run-grading-cli.js dry                // 全部记录试评，不写数据
//   node scripts/run-grading-cli.js migrate            // 全部记录重评并写回数据（先备份）
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'fs'
import { join } from 'path'
import type { AppSettings, PointPool, PracticeRecord, Question } from '../src/shared/types'
import { GRADING_VERSION } from '../src/shared/types'
import { seedQuestions } from '../src/main/data/questions'
import { seedRealQuestions } from '../src/main/data/realPapers'
import { gradeQuestion } from '../src/main/grading/index'

const APPDATA = process.env.APPDATA ?? ''
const DATA_DIR = join(APPDATA, 'wokao', 'data')

function readJson<T>(file: string, fallback: T): T {
  const p = join(DATA_DIR, file)
  if (!existsSync(p)) return fallback
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(join(DATA_DIR, file), JSON.stringify(value, null, 2), 'utf-8')
}

function backup(file: string, tag: string): void {
  const src = join(DATA_DIR, file)
  if (!existsSync(src)) return
  copyFileSync(src, join(DATA_DIR, `${file}.bak-${tag}`))
}

const DEFAULT_GRADING = { secondPass: 'same-model' as const, aiQuestionPolicy: 'separate' as const }

const questions: Question[] = [...seedQuestions, ...seedRealQuestions]
const questionMap = new Map(questions.map((q) => [q.id, q]))
const records = readJson<PracticeRecord[]>('records.json', [])
const rawSettings = readJson<AppSettings>('settings.json', {} as AppSettings)
const settings: AppSettings = {
  ...rawSettings,
  grading: { ...DEFAULT_GRADING, ...(rawSettings.grading ?? {}) }
}
const pools = readJson<Record<string, PointPool>>('pointPools.json', {})

const mode = process.argv[2] ?? 'dry'

function summarize(record: PracticeRecord, graded: Awaited<ReturnType<typeof gradeQuestion>>): string {
  const g = graded.grade
  const coverage = g.pointCoverage ?? []
  const hits = coverage.filter((c) => c.status === 'full' || c.status === 'equivalent').length
  const partial = coverage.filter((c) => c.status === 'partial').length
  const warn = g.warnings.length ? ` ⚠️${g.warnings.length}` : ''
  return [
    `${record.questionId}`,
    `旧 ${record.scoreResult.score}/${record.scoreResult.totalScore}`,
    `新 ${g.tier} ${g.center}/${record.scoreResult.totalScore}`,
    `区间 ${g.range[0]}–${g.range[1]}`,
    `置信度 ${g.confidence}`,
    g.mode === 'essay' ? '作文' : `点 ${hits}全/${partial}半/${coverage.length}`,
    `一致率 ${g.reviewAgreement === null ? '—' : (g.reviewAgreement * 100).toFixed(0) + '%'}`,
    `模型 ${g.model}${warn}`
  ].join(' | ')
}

async function gradeOne(record: PracticeRecord): Promise<ReturnType<typeof gradeQuestion>> {
  const question = questionMap.get(record.questionId)
  if (!question) throw new Error(`题目不存在：${record.questionId}`)
  const pool = pools[question.id] ?? null
  const graded = await gradeQuestion({ question, answer: record.answer, settings, pool })
  if (graded.poolIsNew && graded.pool) pools[graded.pool.questionId] = graded.pool
  return graded
}

async function main(): Promise<void> {
  if (!settings.deepseek?.apiKey?.trim()) {
    console.error('settings.json 中没有 API Key，无法评分')
    process.exit(1)
  }
  if (!records.length) {
    console.error('records.json 为空')
    process.exit(1)
  }

  if (mode === 'one') {
    const index = Number(process.argv[3] ?? 0)
    const record = records[index]
    if (!record) {
      console.error('record 索引不存在')
      process.exit(1)
    }
    console.log('试评记录：', record.id, record.questionId)
    const graded = await gradeOne(record)
    if (process.argv.includes('--save')) {
      writeJson('pointPools.json', pools)
      console.log('（已保存点池，供后续复评复用）')
    }
    console.log(JSON.stringify({ grade: graded.grade, feedback: graded.feedback, losses: graded.losses }, null, 2))
    return
  }

  const results: {
    recordId: string
    questionId: string
    oldScore: number
    newCenter: number
    totalScore: number
    tier: string
    range: [number, number]
    confidence: string
    warnings: string[]
    pointCount: number
    reviewAgreement: number | null
  }[] = []

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    console.log(`[${i + 1}/${records.length}] ${record.questionId} …`)
    try {
      const graded = await gradeOne(record)
      results.push({
        recordId: record.id,
        questionId: record.questionId,
        oldScore: record.scoreResult.score,
        newCenter: graded.grade.center,
        totalScore: record.scoreResult.totalScore,
        tier: graded.grade.tier,
        range: graded.grade.range,
        confidence: graded.grade.confidence,
        warnings: graded.grade.warnings,
        pointCount: graded.grade.pointCoverage?.length ?? 0,
        reviewAgreement: graded.grade.reviewAgreement ?? null
      })
      console.log('   ', summarize(record, graded))
      if (mode === 'migrate') {
        if (graded.poolIsNew && graded.pool) pools[graded.pool.questionId] = graded.pool
        const legacy =
          record.legacy ??
          ({
            scoreResult: record.scoreResult,
            feedback: record.feedback,
            suggestions: record.suggestions,
            modelAnswer: record.modelAnswer,
            gradingVersion: record.gradingVersion ?? 'legacy-v1',
            gradedAt: record.createdAt
          } as PracticeRecord['legacy'])
        records[i] = {
          ...record,
          scoreResult: graded.scoreResult,
          feedback: graded.feedback,
          suggestions: graded.suggestions,
          modelAnswer: graded.modelAnswer || record.modelAnswer,
          dimensions: graded.grade.dimensions,
          losses: graded.losses,
          grading: graded.grade,
          gradingVersion: GRADING_VERSION,
          legacy
        }
      }
    } catch (err) {
      console.error('    ✗ 失败：', (err as Error).message)
    }
  }

  if (mode === 'migrate') {
    const tag = `grading-v2-${new Date().toISOString().replace(/[:.]/g, '-')}`
    backup('records.json', tag)
    backup('settings.json', tag)
    backup('pointPools.json', tag)
    writeJson('records.json', records)
    writeJson('pointPools.json', pools)
    writeJson('settings.json', {
      ...settings,
      grading: { ...settings.grading, migrationVersion: GRADING_VERSION }
    })
    console.log(`已写回 ${records.length} 条记录与 ${Object.keys(pools).length} 个点池（备份标记 ${tag}）`)
  }

  const outFile = join(process.env.TEMP ?? '.', 'wokao-grading-dry-run.json')
  writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf-8')
  console.log(`\n结果已写入 ${outFile}`)
  const avgOld = results.reduce((s, r) => s + (r.oldScore / r.totalScore) * 100, 0) / Math.max(1, results.length)
  const avgNew = results.reduce((s, r) => s + (r.newCenter / r.totalScore) * 100, 0) / Math.max(1, results.length)
  console.log(`平均得分率：旧 ${avgOld.toFixed(1)}% → 新 ${avgNew.toFixed(1)}%（${results.length} 条）`)
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
