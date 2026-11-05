// 伪装模式：调用本机 WPS，把整张试卷写进一个临时 Word 文档。
// 主窗口隐藏；WPS 中只有一份中性标题的文档；托盘/快捷键完成或取消。
import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain } from 'electron'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { DisguiseStartInput } from '../shared/api'
import { getSettings } from './store'

interface DisguiseState {
  active: boolean
  docPath: string
  questions: DisguiseStartInput['questions']
  timer: NodeJS.Timeout | null
  tray: Tray | null
  busy: boolean
  proc: ChildProcessWithoutNullStreams | null
  send: ((command: Record<string, unknown>) => Promise<HelperResult>) | null
}

let mainWindow: BrowserWindow | null = null
let state: DisguiseState = {
  active: false,
  docPath: '',
  questions: [],
  timer: null,
  tray: null,
  busy: false,
  proc: null,
  send: null
}

const DEFAULT_START_HOTKEY = 'Alt+W'
const DEFAULT_FINISH_HOTKEY = 'Alt+F'

function countChars(text: string): number {
  return (text || '').replace(/\s/g, '').length
}

/** 从 WPS 文档纯文本中按标记提取答案。 */
function parseAnswers(text: string, questions: DisguiseStartInput['questions']): Record<string, string> {
  const answers: Record<string, string> = {}
  questions.forEach((q, index) => {
    const n = index + 1
    const start = `【第${n}题作答区｜开始】`
    const end = `【第${n}题作答区｜结束】`
    const i = text.indexOf(start)
    const j = text.indexOf(end, i + start.length)
    if (i < 0 || j < 0) {
      answers[q.id] = ''
      return
    }
    let body = text.slice(i + start.length, j)
    body = body.replace(/（请在此处作答[^）]*）/g, '')
    answers[q.id] = body.trim()
  })
  return answers
}

function buildDocumentText(input: DisguiseStartInput): string {
  const lines: string[] = []
  lines.push('工作参考材料', '')
  lines.push('目录', '  参考材料')
  input.questions.forEach((_, i) => lines.push(`  第${i + 1}题作答区`))
  lines.push('', '一、参考材料', '')
  lines.push(input.material || '（暂无材料）', '')
  lines.push('二、作答题目', '')
  input.questions.forEach((q, i) => {
    const n = i + 1
    const answer = input.answers[q.id] ?? ''
    lines.push(`【第${n}题】`)
    lines.push(q.title, '')
    lines.push(q.requirement, '')
    lines.push(`【第${n}题作答区｜开始】`)
    lines.push(answer || '（请在此处作答，交卷时请勿删除上下标记）')
    lines.push(`【第${n}题作答区｜结束】`, '')
  })
  return lines.join('\r\n')
}

const HELPER_PS1 = String.raw`param(
  [Parameter(Mandatory=$true)][string]$Action,
  [string]$Payload = '',
  [string]$DocPath = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class WpsWin {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd,int x,int y,int w,int ht,bool repaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd,int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
function Show-WpsDocumentWindow($doc) {
  try {
    # WPS 的文档窗口是 MDI 子窗口，必须最大化子窗口，否则会缩在左上角。
    if ($doc.Windows.Count -gt 0) {
      $doc.Windows.Item(1).WindowState = 1
      $doc.Windows.Item(1).Activate()
    }
  } catch {}
  try {
    $proc = Get-Process wps -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*$($doc.Name)*" } | Select-Object -First 1
    if ($proc -and $proc.MainWindowHandle -ne 0) {
      [void][WpsWin]::ShowWindow($proc.MainWindowHandle, 9)
      [void][WpsWin]::MoveWindow($proc.MainWindowHandle, 80, 60, 1200, 760, $true)
      [void][WpsWin]::SetForegroundWindow($proc.MainWindowHandle)
    }
  } catch {}
}

function Write-Result($obj) {
  Write-Output ($obj | ConvertTo-Json -Compress -Depth 5)
}

function Get-WpsApp {
  $app = New-Object -ComObject KWPS.Application
  $app.Visible = $true
  try { $app.DisplayAlerts = 0 } catch {}
  return $app
}

function Find-Doc($app, $path) {
  for ($i = 1; $i -le $app.Documents.Count; $i++) {
    try {
      $d = $app.Documents.Item($i)
      if ($d.FullName -and ([IO.Path]::GetFullPath($d.FullName) -eq [IO.Path]::GetFullPath($path))) { return $d }
    } catch {}
  }
  return $app.Documents.Open($path)
}

try {
  $app = Get-WpsApp
  if ($Action -eq 'serve') {
    $data = Get-Content -LiteralPath $Payload -Raw -Encoding UTF8 | ConvertFrom-Json
    $doc = $app.Documents.Add()
    $doc.Content.Text = [string]$data.text
    try { $doc.Content.Font.Name = '宋体'; $doc.Content.Font.Size = 11 } catch {}
    $doc.SaveAs([ref]$DocPath)
    $doc.Activate()
    try { $app.ActiveWindow.WindowState = 0; $app.ActiveWindow.Activate() } catch {}
    Show-WpsDocumentWindow $doc
    $app.StatusBar = '伪装模式已就绪'
    Write-Result @{ ok = $true; ready = $true; docPath = $DocPath }
    [Console]::InputEncoding = [System.Text.Encoding]::UTF8
    while ($true) {
      $line = [Console]::In.ReadLine()
      if ($null -eq $line) { break }
      if ([string]::IsNullOrWhiteSpace($line)) { continue }
      $cmd = $line | ConvertFrom-Json
      if ($cmd.action -eq 'read') {
        Write-Result @{ ok = $true; text = [string]$doc.Content.Text }
      } elseif ($cmd.action -eq 'status') {
        try { $app.StatusBar = [string]$cmd.status } catch {}
        Write-Result @{ ok = $true }
      } elseif ($cmd.action -eq 'close') {
        try { $doc.Close(0) } catch {}
        Write-Result @{ ok = $true }
        break
      } else {
        Write-Result @{ ok = $false; error = 'unknown command' }
      }
    }
    exit
  } elseif ($Action -eq 'create') {
    $data = Get-Content -LiteralPath $Payload -Raw -Encoding UTF8 | ConvertFrom-Json
    $doc = $app.Documents.Add()
    $doc.Content.Text = [string]$data.text
    try { $doc.Content.Font.Name = '宋体'; $doc.Content.Font.Size = 11 } catch {}
    $doc.SaveAs([ref]$DocPath)
    $doc.Activate()
    try { $app.ActiveWindow.WindowState = 0; $app.ActiveWindow.Activate() } catch {}
    Show-WpsDocumentWindow $doc
    Write-Result @{ ok = $true; docPath = $DocPath }
  } elseif ($Action -eq 'read') {
    $doc = Find-Doc $app $DocPath
    Write-Result @{ ok = $true; text = [string]$doc.Content.Text }
  } elseif ($Action -eq 'status') {
    $data = Get-Content -LiteralPath $Payload -Raw -Encoding UTF8 | ConvertFrom-Json
    try { $app.StatusBar = [string]$data.status } catch {}
    Write-Result @{ ok = $true }
  } elseif ($Action -eq 'close') {
    $doc = Find-Doc $app $DocPath
    try { $doc.Close(0) } catch {}
    Write-Result @{ ok = $true }
  } else {
    Write-Result @{ ok = $false; error = 'unknown action' }
  }
} catch {
  Write-Result @{ ok = $false; error = $_.Exception.Message }
}
`

function helperPath(): string {
  const dir = join(app.getPath('userData'), 'disguise')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'wps-helper.ps1')
  // 每次覆盖，保证升级后的主进程不会继续使用旧 helper
  writeFileSync(file, '\ufeff' + HELPER_PS1, 'utf-8')
  return file
}

interface HelperResult {
  ok: boolean
  error?: string
  text?: string
  docPath?: string
}

function runHelper(action: string, payload?: unknown, docPath = ''): Promise<HelperResult> {
  return new Promise((resolve) => {
    try {
      const dir = join(app.getPath('userData'), 'disguise')
      mkdirSync(dir, { recursive: true })
      const payloadPath = join(dir, `payload-${Date.now()}.json`)
      if (payload !== undefined) writeFileSync(payloadPath, JSON.stringify(payload), 'utf-8')
      const args = [
        '-NoProfile',
        '-STA',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        helperPath(),
        '-Action',
        action,
        '-DocPath',
        docPath
      ]
      if (payload !== undefined) args.push('-Payload', payloadPath)
      execFile(
        'powershell.exe',
        args,
        { windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024 },
        (_err, stdout) => {
          const out = String(stdout || '').trim()
          const start = out.lastIndexOf('{')
          if (start < 0) {
            resolve({ ok: false, error: 'WPS 没有返回结果' })
            return
          }
          try {
            resolve(JSON.parse(out.slice(start)) as HelperResult)
          } catch {
            resolve({ ok: false, error: '解析 WPS 返回结果失败' })
          }
        }
      )
    } catch (err) {
      resolve({ ok: false, error: (err as Error).message })
    }
  })
}

interface WpsServer {
  proc: ChildProcessWithoutNullStreams
  send: (command: Record<string, unknown>) => Promise<HelperResult>
}

function startWpsServer(text: string, docPath: string): Promise<WpsServer> {
  return new Promise((resolve, reject) => {
    const dir = join(app.getPath('userData'), 'disguise')
    mkdirSync(dir, { recursive: true })
    const payloadPath = join(dir, `payload-${Date.now()}.json`)
    writeFileSync(payloadPath, JSON.stringify({ text }), 'utf-8')
    const proc = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-STA',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        helperPath(),
        '-Action',
        'serve',
        '-Payload',
        payloadPath,
        '-DocPath',
        docPath
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    let buffer = ''
    let lastError = ''
    const pending: {
      resolve: (r: HelperResult) => void
      reject: (e: Error) => void
      timer: NodeJS.Timeout
    }[] = []
    const push = (r: HelperResult): void => {
      const item = pending.shift()
      if (!item) return
      clearTimeout(item.timer)
      item.resolve(r)
    }
    const onLine = (line: string): void => {
      const start = line.lastIndexOf('{')
      if (start < 0) return
      try {
        const parsed = JSON.parse(line.slice(start)) as HelperResult
        push(parsed)
      } catch {
        // 忽略 WPS 的其他 stdout
      }
    }
    proc.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let idx = buffer.indexOf('\n')
      while (idx >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '')
        buffer = buffer.slice(idx + 1)
        onLine(line)
        idx = buffer.indexOf('\n')
      }
    })
    proc.stderr.on('data', (chunk: string) => {
      lastError = String(chunk).slice(-1000)
    })
    proc.on('error', (err) => {
      while (pending.length) {
        const item = pending.shift()!
        clearTimeout(item.timer)
        item.reject(err)
      }
      reject(err)
    })
    proc.on('exit', () => {
      while (pending.length) {
        const item = pending.shift()!
        clearTimeout(item.timer)
        item.reject(new Error(lastError || 'WPS helper 已退出'))
      }
    })
    const timeout = setTimeout(() => {
      proc.kill()
      reject(new Error('启动 WPS 超时'))
    }, 25000)
    pending.push({
      resolve: (r) => {
        clearTimeout(timeout)
        if (!r.ok) {
          proc.kill()
          reject(new Error(r.error || 'WPS 文档创建失败'))
          return
        }
        resolve({
          proc,
          send: (command: Record<string, unknown>) =>
            new Promise<HelperResult>((res, rej) => {
              if (proc.killed) {
                rej(new Error('WPS helper 已退出'))
                return
              }
              const timer = setTimeout(() => {
                const i = pending.findIndex((p) => p.timer === timer)
                if (i >= 0) pending.splice(i, 1)
                rej(new Error('WPS 响应超时'))
              }, 30000)
              pending.push({ resolve: res, reject: rej, timer })
              proc.stdin.write(JSON.stringify(command) + '\n')
            })
        })
      },
      reject,
      timer: timeout
    })
    // 先写入启动负载（serve 直接从 -Payload 读取，不需要 stdin）
    void proc.stdin
  })
}

function killWpsServer(silent = true): void {
  const proc = state.proc
  if (!proc) return
  try {
    if (!proc.killed) proc.kill()
  } catch {
    // ignore
  }
  if (!silent) state.proc = null
  else state.proc = null
  state.send = null
}

function makeTray(): void {
  if (state.tray) return
  const icon = [join(process.resourcesPath, 'icon.png'), join(__dirname, '../../build/icon.png')].find(
    (p) => existsSync(p)
  )
  if (!icon) return
  const tray = new Tray(icon)
  tray.setToolTip('工作参考材料')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '完成伪装作答',
        click: () => {
          void finishDisguise()
        }
      },
      {
        label: '取消伪装',
        click: () => {
          void abortDisguise()
        }
      },
      {
        label: '显示主界面',
        click: () => {
          showMainWindow()
        }
      }
    ])
  )
  tray.on('click', () => showMainWindow())
  state.tray = tray
}

function destroyTray(): void {
  if (state.tray) {
    state.tray.destroy()
    state.tray = null
  }
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.setSkipTaskbar(false)
  mainWindow.show()
  mainWindow.focus()
}

function stopTimer(): void {
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
}

async function syncFromWps(sendAutosave: boolean): Promise<Record<string, string> | null> {
  if (!state.active || state.busy || !state.send) return null
  state.busy = true
  try {
    const read = await state.send({ action: 'read' })
    if (!read.ok || read.text === undefined) return null
    if (
      state.questions.length > 0 &&
      !state.questions.every((_, i) =>
        read.text!.includes(`【第${i + 1}题作答区｜开始】`) &&
        read.text!.includes(`【第${i + 1}题作答区｜结束】`)
      )
    ) {
      return null
    }
    const answers = parseAnswers(read.text, state.questions)
    const counts = state.questions.map((q) => countChars(answers[q.id] ?? ''))
    const status = state.questions
      .map((q, i) => `第${i + 1}题 ${counts[i]}/${q.wordLimit || '—'} 字`)
      .join(' ｜ ')
    await state.send({ action: 'status', status })
    if (sendAutosave && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('disguise:autosave', answers)
    }
    return answers
  } finally {
    state.busy = false
  }
}

export function initDisguise(win: BrowserWindow): void {
  mainWindow = win
  helperPath()
  registerDisguiseShortcuts()

  ipcMain.handle('disguise:start', async (_e, input: DisguiseStartInput) => {
    if (state.active) return { ok: true }
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: '主窗口不可用' }
    if (!input || !Array.isArray(input.questions) || input.questions.length === 0) {
      return { ok: false, error: '没有可作答的题目' }
    }
    const dir = join(app.getPath('userData'), 'disguise')
    mkdirSync(dir, { recursive: true })
    const docPath = join(dir, `工作参考材料-${Date.now()}.docx`)
    const text = buildDocumentText(input)
    let server: WpsServer
    try {
      server = await startWpsServer(text, docPath)
    } catch (err) {
      return { ok: false, error: (err as Error).message || 'WPS 文档创建失败' }
    }
    state = {
      active: true,
      docPath,
      questions: input.questions,
      timer: null,
      tray: null,
      busy: false,
      proc: server.proc,
      send: server.send
    }
    const initialStatus = input.questions
      .map((q, i) => `第${i + 1}题 ${countChars(input.answers[q.id] ?? '')}/${q.wordLimit || '—'} 字`)
      .join(' ｜ ')
    try {
      await server.send({ action: 'status', status: initialStatus })
    } catch {
      // 状态栏失败不影响作答
    }
    startDisguiseUi()
    return { ok: true }
  })

  ipcMain.handle('disguise:finish', () => finishDisguise())
  ipcMain.handle('disguise:abort', () => abortDisguise())
  ipcMain.handle('disguise:refreshShortcuts', () => {
    registerDisguiseShortcuts()
  })
}

function startDisguiseUi(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  makeTray()
  mainWindow.setSkipTaskbar(true)
  mainWindow.hide()
  stopTimer()
  state.timer = setInterval(() => {
    void syncFromWps(true)
  }, 10000)
}

async function finishDisguise(): Promise<{ ok: boolean; answers?: Record<string, string>; error?: string }> {
  if (!state.active) return { ok: false, error: '当前没有伪装作答' }
  stopTimer()
  let answers: Record<string, string> | null = null
  for (let attempt = 0; attempt < 5 && !answers; attempt++) {
    answers = await syncFromWps(false)
    if (!answers) await new Promise((resolve) => setTimeout(resolve, 300))
  }
  if (!answers) {
    showMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('disguise:error', '读取 WPS 作答内容失败，文档仍保留，可在 WPS 中检查')
    }
    return { ok: false, error: '读取 WPS 作答内容失败，文档仍保留，可在 WPS 中检查' }
  }
  try {
    await state.send?.({ action: 'close' })
  } catch {
    // 文档可能已关闭
  }
  killWpsServer()
  const result = { ...answers }
  destroyTray()
  state = {
    active: false,
    docPath: '',
    questions: [],
    timer: null,
    tray: null,
    busy: false,
    proc: null,
    send: null
  }
  showMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('disguise:finished', result)
  }
  return { ok: true, answers: result }
}

async function abortDisguise(): Promise<{ ok: boolean; error?: string }> {
  if (!state.active) {
    showMainWindow()
    return { ok: true }
  }
  stopTimer()
  try {
    await state.send?.({ action: 'close' })
  } catch {
    // 文档可能已关闭
  }
  killWpsServer()
  destroyTray()
  state = {
    active: false,
    docPath: '',
    questions: [],
    timer: null,
    tray: null,
    busy: false,
    proc: null,
    send: null
  }
  showMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('disguise:aborted')
  }
  return { ok: true }
}

export function refreshDisguiseShortcuts(): void {
  registerDisguiseShortcuts()
}

function registerDisguiseShortcuts(): void {
  try {
    globalShortcut.unregister('Alt+W')
    globalShortcut.unregister('Alt+F')
  } catch {}
  const settings = getSettings()
  const startKey = settings.disguiseStartHotkey?.trim() || DEFAULT_START_HOTKEY
  const finishKey = settings.disguiseFinishHotkey?.trim() || DEFAULT_FINISH_HOTKEY
  try {
    globalShortcut.register(startKey, () => {
      if (state.active) return
      if (!mainWindow || mainWindow.isDestroyed()) return
      showMainWindow()
      mainWindow.webContents.send('disguise:request-start')
    })
  } catch {}
  try {
    globalShortcut.register(finishKey, () => {
      if (state.active) void finishDisguise()
    })
  } catch {}
}

export async function stopDisguiseOnQuit(): Promise<void> {
  if (state.active) {
    stopTimer()
    try {
      await state.send?.({ action: 'close' })
    } catch {
      // ignore
    }
    killWpsServer()
    destroyTray()
    state.active = false
  }
}
