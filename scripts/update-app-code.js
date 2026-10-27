/**
 * 本地更新模式：只更新 resources/app.asar，不替换 wokao.exe。
 *
 * 根目录的 wokao.exe 已经用本机证书签名并信任；以后只替换 app.asar，
 * 避免重新打包 exe 再次触发 Windows 安全提示。
 *
 * 用法：npm run update
 * 注意：更新前请先退出正在运行的 wokao。
 */
const fs = require('fs')
const path = require('path')
const asar = require('@electron/asar')

const root = path.join(__dirname, '..')
const src = path.join(root, 'out')
const resources = path.join(root, 'resources')
const target = path.join(resources, 'app.asar')
const stage = path.join(resources, '.app-stage')
const tmpAsar = path.join(resources, 'app.asar.new')

if (!fs.existsSync(src)) {
  console.error('[update-app-code] 未找到 out，请先执行 electron-vite build。')
  process.exit(1)
}

fs.rmSync(stage, { recursive: true, force: true })
fs.mkdirSync(stage, { recursive: true })

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name)
    const d = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else if (entry.isFile()) fs.copyFileSync(s, d)
  }
}

copyDir(src, path.join(stage, 'out'))
fs.writeFileSync(
  path.join(stage, 'package.json'),
  JSON.stringify(
    {
      name: 'wokao',
      version: '0.1.0',
      description: 'wokao · 国考与省考申论学习练习桌面应用',
      main: 'out/main/index.js',
      author: 'wokao',
      license: 'MIT'
    },
    null,
    2
  ),
  'utf-8'
)

async function main() {
  fs.rmSync(tmpAsar, { force: true })
  await asar.createPackage(stage, tmpAsar)
  fs.rmSync(stage, { recursive: true, force: true })

  // 不删除/重命名 app.asar：某些编辑器（如 Trae）会保持它打开，导致 rename EBUSY。
  // 直接在原文件上覆盖内容；Node 的 r+ 打开方式允许共享读写。
  const data = fs.readFileSync(tmpAsar)
  const fd = fs.openSync(target, 'r+')
  try {
    fs.writeSync(fd, data, 0, data.length, 0)
    fs.ftruncateSync(fd, data.length)
  } finally {
    fs.closeSync(fd)
  }
  fs.rmSync(tmpAsar, { force: true })
  fs.rmSync(path.join(resources, 'app'), { recursive: true, force: true })
  console.log('[update-app-code] 已更新 resources/app.asar；wokao.exe 未改动，双击即可启动。')
}

main().catch((err) => {
  console.error('[update-app-code] 更新失败：', err)
  process.exit(1)
})
