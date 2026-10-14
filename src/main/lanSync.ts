import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { networkInterfaces } from 'os'
import type { LanSyncInfo } from '../shared/types'
import { getAllRecords, getLanSyncState, mergeRecords, regenerateLanSyncToken, updateLanSyncState } from './store'

// 桌面端在局域网内提供同步服务：手机连同一 Wi-Fi 后，把作答记录推过来、再取回合并结果
const MAX_BODY = 32 * 1024 * 1024 // 请求体上限 32MB

let server: Server | null = null
let running = false
let lastError = ''
let mergedCount = 0 // 本次运行累计合并进来的条数

function lanAddresses(port: number): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) out.push(`http://${item.address}:${port}`)
    }
  }
  return out
}

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-sync-token')
}

function reply(res: ServerResponse, code: number, body: unknown): void {
  if (res.writableEnded) return
  setCors(res)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    setCors(res)
    res.writeHead(204)
    res.end()
    return
  }

  const state = getLanSyncState()
  const path = (req.url ?? '/').split('?')[0]

  // 连通性探测，不需要同步码
  if (path === '/api/ping') {
    reply(res, 200, { ok: true, name: 'wokao', port: state.port })
    return
  }

  if (path !== '/api/sync') {
    reply(res, 404, { ok: false, error: '接口不存在' })
    return
  }
  if (req.method !== 'POST') {
    reply(res, 405, { ok: false, error: '仅支持 POST' })
    return
  }
  if (req.headers['x-sync-token'] !== state.token) {
    reply(res, 403, { ok: false, error: '同步码不正确' })
    return
  }

  let payload: { userId?: unknown; records?: unknown }
  try {
    payload = JSON.parse(await readBody(req)) as typeof payload
  } catch {
    reply(res, 400, { ok: false, error: '请求内容无法解析' })
    return
  }

  const userId =
    typeof payload.userId === 'string' && payload.userId ? payload.userId : 'local-default-user'
  const added = mergeRecords(payload.records, userId)
  mergedCount += added
  updateLanSyncState({ lastSyncAt: Date.now() })

  const mine = getAllRecords().filter((r) => r.userId === userId)
  reply(res, 200, { ok: true, added, total: mine.length, records: mine })
}

export function startLanSync(): Promise<LanSyncInfo> {
  return new Promise((resolve) => {
    if (running && server) {
      updateLanSyncState({ enabled: true })
      resolve(getLanSyncInfo())
      return
    }
    lastError = ''
    const port = getLanSyncState().port
    const s = createServer((req, res) => {
      handle(req, res).catch(() => reply(res, 500, { ok: false, error: '服务内部错误' }))
    })
    s.once('error', (err: NodeJS.ErrnoException) => {
      lastError = err.code === 'EADDRINUSE' ? `端口 ${port} 已被占用` : err.message
      server = null
      running = false
      resolve(getLanSyncInfo())
    })
    s.listen(port, '0.0.0.0', () => {
      server = s
      running = true
      updateLanSyncState({ enabled: true })
      resolve(getLanSyncInfo())
    })
  })
}

export function stopLanSync(): Promise<LanSyncInfo> {
  return new Promise((resolve) => {
    updateLanSyncState({ enabled: false })
    const s = server
    server = null
    running = false
    if (!s) {
      resolve(getLanSyncInfo())
      return
    }
    s.close(() => resolve(getLanSyncInfo()))
  })
}

export function getLanSyncInfo(): LanSyncInfo {
  const state = getLanSyncState()
  return {
    role: 'server',
    enabled: state.enabled,
    running,
    port: state.port,
    addresses: lanAddresses(state.port),
    token: state.token,
    serverUrl: '',
    lastSyncAt: state.lastSyncAt,
    mergedCount,
    error: lastError || undefined
  }
}

export function regenerateSyncToken(): LanSyncInfo {
  regenerateLanSyncToken()
  return getLanSyncInfo()
}

// 启动时若上次是开启状态，则自动恢复监听
export function autoStartLanSync(): void {
  if (getLanSyncState().enabled) void startLanSync()
}
