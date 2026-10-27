const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
try { fs.appendFileSync(path.join(process.env.TEMP, 'wokao-mini.log'), 'main loaded ' + new Date().toISOString() + '\n') } catch (e) {}
app.whenReady().then(() => {
  try { fs.appendFileSync(path.join(process.env.TEMP, 'wokao-mini.log'), 'ready ' + new Date().toISOString() + '\n') } catch (e) {}
  const w = new BrowserWindow({ width: 400, height: 300 })
  w.loadURL('data:text/html,<h1>mini</h1>')
})
