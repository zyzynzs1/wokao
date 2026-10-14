import { app, BrowserWindow, globalShortcut, shell } from 'electron'
import { join } from 'path'
import { initStore } from './store'
import { registerIpc } from './ipc'
import { autoStartLanSync, stopLanSync } from './lanSync'

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

  win.on('ready-to-show', () => win.show())

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

  app.on('before-quit', () => {
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
