import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs'
import { hostname } from 'os'
import { join } from 'path'
import type { ProgressSyncInfo, ProgressSyncPeer, ProgressSyncResult, Question } from '../shared/types'
import {
  DEFAULT_USER_ID,
  getAllRecords,
  getGeneratedQuestions,
  getSettings,
  mergeGeneratedQuestions,
  mergeRecords,
  updateSettings
} from './store'

// 跨设备进度同步（云盘共享文件夹）
// 思路：两台电脑都把各自的进度写进同一个云盘目录，但**各写各的文件**（按机器名命名），
// 读取时把目录内所有对端文件按 id 合并进来。这样文件级不会互相覆盖，数据也不会丢。
// 同步内容只有「作答记录 + AI 自动生成的题目」；设置项（含 API Key）不参与同步。

const FILE_PREFIX = 'wokao-'
const FILE_EXT = '.json'
const SCHEMA = 1
const INTERVAL_MS = 60 * 1000

interface Snapshot {
  schema: number
  machine: string
  exportedAt: number
  records: unknown[]
  generatedQuestions: Question[]
}

let timer: NodeJS.Timeout | null = null
let lastImportAt: number | null = null
let lastExportAt: number | null = null
let lastAddedRecords = 0
let lastAddedQuestions = 0
let lastError = ''
// 上次导出内容签名：内容未变化时跳过重写，避免云盘反复上传
let lastSignature = ''

// 机器名做文件名安全化，保证两台电脑写出不同文件名
function machineName(): string {
  const safe = (hostname() || 'pc').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-')
  return safe || 'pc'
}

function myFileName(): string {
  return `${FILE_PREFIX}${machineName()}${FILE_EXT}`
}

export function getProgressSyncDir(): string {
  return (getSettings().syncDir ?? '').trim()
}

function ensureDir(dir: string): string {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return ''
  } catch (err) {
    return `同步目录不可用：${(err as Error).message}`
  }
}

// 读取目录内所有对端快照（跳过本机文件与无法解析的文件）
function readPeerFiles(dir: string): { file: string; snap: Snapshot }[] {
  const mine = myFileName()
  const out: { file: string; snap: Snapshot }[] = []
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(FILE_PREFIX) || !name.endsWith(FILE_EXT) || name === mine) continue
    try {
      const snap = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as Snapshot
      if (snap && typeof snap === 'object') out.push({ file: name, snap })
    } catch {
      // 云盘可能正在写入半截文件，跳过，下一轮再试
    }
  }
  return out
}

function importPeers(dir: string): { addedRecords: number; addedQuestions: number; peers: number } {
  let addedRecords = 0
  let addedQuestions = 0
  let peers = 0
  for (const { snap } of readPeerFiles(dir)) {
    peers++
    addedRecords += mergeRecords(snap.records, DEFAULT_USER_ID)
    addedQuestions += mergeGeneratedQuestions(snap.generatedQuestions)
  }
  return { addedRecords, addedQuestions, peers }
}

// 轻量哈希：用于判断内容是否有变化，避免定时同步时反复重写文件（云盘会因此反复上传）
function simpleHash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return String(h >>> 0)
}

// 导出本机快照：先写临时文件再改名，避免对端读到半截内容
function exportSnapshot(dir: string): string {
  const records = getAllRecords()
  const generatedQuestions = getGeneratedQuestions()
  const target = join(dir, myFileName())

  const body = JSON.stringify({ records, generatedQuestions })
  const signature = `${body.length}:${simpleHash(body)}`
  if (signature === lastSignature && existsSync(target)) return ''

  const snap: Snapshot = {
    schema: SCHEMA,
    machine: machineName(),
    exportedAt: Date.now(),
    records,
    generatedQuestions
  }
  const tmp = `${target}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(snap, null, 2), 'utf-8')
    renameSync(tmp, target)
    lastSignature = signature
    return ''
  } catch (err) {
    return `写入同步文件失败：${(err as Error).message}`
  }
}

// 立即同步：先合并对端文件，再导出本机文件
export function runProgressSync(): ProgressSyncResult {
  const dir = getProgressSyncDir()
  if (!dir) return { ok: false, error: '尚未设置同步目录' }
  const dirErr = ensureDir(dir)
  if (dirErr) {
    lastError = dirErr
    return { ok: false, error: dirErr }
  }

  let imported: { addedRecords: number; addedQuestions: number; peers: number }
  try {
    imported = importPeers(dir)
  } catch (err) {
    lastError = `读取同步目录失败：${(err as Error).message}`
    return { ok: false, error: lastError }
  }

  const exportErr = exportSnapshot(dir)
  if (exportErr) {
    lastError = exportErr
    return { ok: false, error: exportErr }
  }

  const now = Date.now()
  lastImportAt = now
  lastExportAt = now
  lastAddedRecords = imported.addedRecords
  lastAddedQuestions = imported.addedQuestions
  lastError = ''
  return {
    ok: true,
    addedRecords: imported.addedRecords,
    addedQuestions: imported.addedQuestions,
    peers: imported.peers,
    total: getAllRecords().length
  }
}

export function getProgressSyncInfo(): ProgressSyncInfo {
  const dir = getProgressSyncDir()
  const peers: ProgressSyncPeer[] = []
  let error = lastError

  if (dir) {
    if (existsSync(dir)) {
      for (const { file, snap } of readPeerFiles(dir)) {
        peers.push({
          file,
          machine: typeof snap.machine === 'string' ? snap.machine : file,
          records: Array.isArray(snap.records) ? snap.records.length : 0,
          questions: Array.isArray(snap.generatedQuestions) ? snap.generatedQuestions.length : 0,
          exportedAt: typeof snap.exportedAt === 'number' ? snap.exportedAt : 0
        })
      }
    } else {
      error = '同步目录不存在，请确认云盘已把该文件夹同步到本机'
    }
  }

  return {
    dir,
    enabled: !!dir && !error,
    machine: machineName(),
    myFile: myFileName(),
    lastImportAt,
    lastExportAt,
    lastAddedRecords,
    lastAddedQuestions,
    peers,
    error: error || undefined
  }
}

// 保存同步目录并立即同步一次
export function setProgressSyncDir(dir: string): ProgressSyncInfo {
  updateSettings({ ...getSettings(), syncDir: dir.trim() })
  lastError = ''
  // 换目录后必须重新写一份，否则会因签名相同而跳过导出
  lastSignature = ''
  restartAutoSync()
  if (dir.trim()) runProgressSync()
  return getProgressSyncInfo()
}

function restartAutoSync(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (!getProgressSyncDir()) return
  timer = setInterval(() => {
    void runProgressSync()
  }, INTERVAL_MS)
  timer.unref()
}

// 启动时若已配置同步目录，则先同步一次并开启定时同步
export function autoStartProgressSync(): void {
  if (!getProgressSyncDir()) return
  runProgressSync()
  restartAutoSync()
}

export function stopProgressSync(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
