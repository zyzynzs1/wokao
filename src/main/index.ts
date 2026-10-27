import { app, BrowserWindow, globalShortcut, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync } from 'fs'
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

// 固定数据目录：即使宿主 Electron 运行时来自其他应用，也始终读写原来的 wokao 数据
try {
  app.setPath('userData', join(process.env.APPDATA ?? app.getPath('appData'), 'wokao'))
} catch {
  // 保持 Electron 默认路径
}

let mainWindow: BrowserWindow | null = null
// 老板键/手动隐藏后，禁止任何“自动修复显示”把窗口重新弹出来
let manuallyHidden = false

// 窗口/任务栏图标使用项目自己的图标（宿主运行时可能是别的签名 exe）
const windowIcon = [
  join(process.resourcesPath, 'icon.png'),
  join(__dirname, '../../build/icon.png')
].find((p) => existsSync(p))

// 老板键：隐藏/显示窗口，连同任务栏图标一起隐藏
function toggleBossKey(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  if (win.isVisible()) {
    manuallyHidden = true
    win.setSkipTaskbar(true)
    win.hide()
  } else {
    manuallyHidden = false
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
    icon: windowIcon,
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

  let hasShownOnce = false
  win.on('show', () => {
    startupLog('window show event')
    if (manuallyHidden) {
      // 有任何来源试图把老板键隐藏的窗口重新显示时，立即重新隐藏
      startupLog('window show blocked by manuallyHidden')
      win.hide()
      return
    }
    hasShownOnce = true
  })

  win.on('ready-to-show', () => {
    startupLog('main window ready-to-show')
    win.show()
  })
  win.webContents.on('did-finish-load', () => startupLog('renderer did-finish-load'))
  win.webContents.on('did-fail-load', (_e, code, desc, url) =>
    startupLog(`renderer did-fail-load: ${code} ${desc} ${url}`)
  )
  win.webContents.on('render-process-gone', (_e, details) =>
    startupLog(`render-process-gone: ${details.reason} exitCode=${details.exitCode}`)
  )

  // 注意：不要再加“几秒后自动 show”的兜底逻辑。
  // 之前启动排查时加过这种兜底，会在用户刚最小化/老板键隐藏后把窗口强行弹回来。

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
  startupLog('app ready')
  initStore()
  registerIpc()
  createWindow()
  startupLog('createWindow called')

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
}).catch((err) => {
  startupLog(`whenReady failed: ${err?.stack ?? err}`)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
