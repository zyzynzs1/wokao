/**
 * 本地更新模式：只更新 resources/app，不替换 wokao.exe。
 *
 * 背景：根目录的 wokao.exe 是从旧构建恢复的、本机 SmartScreen 已经允许过的版本；
 * 因为 Electron 的 asar 完整性校验和 OnlyLoadAppFromAsar 都是关闭的，
 * 所以最新代码可以放在 resources/app 目录里，由旧 exe 直接加载。
 *
 * 用法：npm run update
 * 注意：更新前请先退出正在运行的 wokao。
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const src = path.join(root, 'out')
const resources = path.join(root, 'resources')
const appDir = path.join(resources, 'app')
const dest = path.join(appDir, 'out')

if (!fs.existsSync(src)) {
  console.error('[update-app-code] 未找到 out，请先执行 electron-vite build。')
  process.exit(1)
}

const asar = path.join(resources, 'app.asar')
if (fs.existsSync(asar)) {
  // app.asar 的优先级高于 app 目录；本地更新模式下必须移除它
  console.error('[update-app-code] 检测到 resources/app.asar（完整打包产物）。')
  console.error('[update-app-code] 本地更新模式下请删除/重命名它，否则会加载旧的 app.asar。')
  process.exit(1)
}

fs.mkdirSync(appDir, { recursive: true })
fs.rmSync(dest, { recursive: true, force: true })

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name)
    const d = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else if (entry.isFile()) fs.copyFileSync(s, d)
  }
}

copyDir(src, dest)

const pkgPath = path.join(appDir, 'package.json')
const pkg = {
  name: 'wokao',
  version: '0.1.0',
  description: 'wokao · 国考与省考申论学习练习桌面应用',
  main: 'out/main/index.js',
  author: 'wokao',
  license: 'MIT'
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8')

console.log('[update-app-code] 已更新 resources/app/out；wokao.exe 未改动，双击即可启动。')
