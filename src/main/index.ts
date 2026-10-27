import { app, BrowserWindow, globalShortcut, shell } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { initStore } from './store'
import { registerIpc } from './ipc'
import { autoStartLanSync, stopLanSync } from './lanSync'
import { autoStartProgressSync, stopProgressSync } from './progressSync'

// 启动日志：用于排查“双击 exe 没有窗口”这类问题（只记录启动阶段，不涉及作答内容）
function startupLog(message: string): void {
  try {
    const dir = join(process.env.APPDATA ?? '', 'wokao')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'startup.log'), `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    // 日志失败不影响启动
  }
}

startupLog(`main module loaded, pid=${process.pid}, electron=${process.versions.electron}`)
process.on('uncaughtException', (err) => startupLog(`uncaughtException: ${err?.stack ?? err}`))
process.on('unhandledRejection', (err) => startupLog(`unhandledRejection: ${String(err)}`))

let mainWindow: BrowserWindow | null = null

// 老板键：隐藏/显示窗口，连同任务栏图标一起隐藏
function toggleBossKey(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  if (win.isVisible()) {
    win.setSkipTaskbar(true)
    win.hide()
  } else {
    win.setSkipTaskbar(false)
    win.show()
    win.focus()
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'wokao',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      plugins: true
    }
  })

  mainWindow = win

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.on('ready-to-show', () => {
    startupLog('main window ready-to-show')
    win.show()
  })
  win.webContents.on('did-finish-load', () => startupLog('renderer did-finish-load'))
  win.webContents.on('render-process-gone', (_e, details) =>
    startupLog(`render-process-gone: ${details.reason} exitCode=${details.exitCode}`)
  )

  // 最小化/还原时通知渲染进程，用于冻结作答计时
  win.on('minimize', () => win.webContents.send('window:minimized'))
  win.on('restore', () => win.webContents.send('window:restored'))
  win.on('focus', () => win.webContents.send('window:focused'))
  win.on('blur', () => win.webContents.send('window:blurred'))

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initStore()
  registerIpc()
  createWindow()

  // 局域网同步服务：上次若为开启状态则自动恢复
  autoStartLanSync()

  // 跨设备进度同步（云盘）：已配置同步目录时自动同步一次并开启定时同步
  autoStartProgressSync()

  app.on('before-quit', () => {
    stopProgressSync()
    void stopLanSync()
  })

  // 老板键 Alt+C：隐藏/显示窗口
  globalShortcut.register('Alt+C', toggleBossKey)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
