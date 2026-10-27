// 历史记录迁移：旧评分快照保留在 legacy，随后按 grading-v2 重新评分。
// 由渲染进程首次启动时自动触发；失败条目保留旧分，下次启动可再次尝试。
import type { PracticeRecord } from '../shared/types'
import { GRADING_VERSION } from '../shared/types'
import { gradeQuestion } from './grading'
import {
  getAllRecords,
  getPointPool,
  getQuestionById,
  getSettings,
  savePointPool,
  updateRecord,
  updateSettings
} from './store'

let running = false

export interface GradingMigrationInfo {
  needed: boolean
  total: number
  done: number
  failed: number
  running: boolean
  version: string
}

function pendingRecords(): PracticeRecord[] {
  return getAllRecords().filter((r) => r.gradingVersion !== GRADING_VERSION || !r.grading)
}

export function getGradingMigrationInfo(): GradingMigrationInfo {
  const all = getAllRecords()
  const pending = pendingRecords()
  return {
    needed: pending.length > 0,
    total: all.length,
    done: all.length - pending.length,
    failed: 0,
    running,
    version: GRADING_VERSION
  }
}

async function regradeOne(record: PracticeRecord): Promise<void> {
  const question = getQuestionById(record.questionId)
  if (!question) throw new Error('题目不存在')
  const settings = getSettings()
  const pool = getPointPool(question.id) ?? null
  const result = await gradeQuestion({
    question,
    answer: record.answer,
    settings,
    pool
  })
  if (result.poolIsNew && result.pool) savePointPool(result.pool)
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
  const next: PracticeRecord = {
    ...record,
    scoreResult: result.scoreResult,
    feedback: result.feedback,
    suggestions: result.suggestions,
    modelAnswer: result.modelAnswer,
    losses: result.losses,
    dimensions: result.grade.dimensions,
    grading: result.grade,
    gradingVersion: GRADING_VERSION,
    legacy
  }
  updateRecord(next)
}

export async function runGradingMigration(): Promise<{
  ok: boolean
  total: number
  done: number
  failed: number
  error?: string
}> {
  if (running) {
    return { ok: false, total: 0, done: 0, failed: 0, error: '迁移正在进行中' }
  }
  const settings = getSettings()
  if (!settings.deepseek.apiKey.trim()) {
    return { ok: false, total: 0, done: 0, failed: 0, error: '未配置 AI 模型，暂不能重评历史记录' }
  }
  const queue = pendingRecords()
  if (queue.length === 0) {
    return { ok: true, total: 0, done: 0, failed: 0 }
  }
  running = true
  let done = 0
  let failed = 0

  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      const record = queue.shift()
      if (!record) break
      try {
        await regradeOne(record)
        done++
      } catch (err) {
        failed++
        console.error('[grading-migration] 重评失败', record.id, (err as Error).message)
      }
    }
  }

  try {
    await Promise.all([worker(), worker()])
    if (failed === 0) {
      const latest = getSettings()
      updateSettings({
        ...latest,
        grading: { ...latest.grading, migrationVersion: GRADING_VERSION } as typeof latest.grading
      })
    }
  } finally {
    running = false
  }

  return { ok: failed === 0, total: done + failed, done, failed }
}
