/**
 * 把 electron-builder 的打包产物复制到项目根目录，
 * 使根目录的 wokao.exe 始终是最新构建版本。
 *
 * 用法：node scripts/copy-to-root.js [源目录]
 * 默认源目录：dist-app/win-unpacked
 *
 * 注意：这里用「逐文件 copyFileSync」而非 fs.cpSync，
 * 因为本机环境下 fs.cpSync 会导致 Node 原生崩溃。
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const src = path.resolve(root, process.argv[2] || path.join('dist-app', 'win-unpacked'))

if (!fs.existsSync(src)) {
  console.error(`[copy-to-root] 未找到打包输出目录：${src}`)
  console.error('[copy-to-root] 请先执行打包（npm run dist）。')
  process.exit(1)
}

let copied = 0

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name)
    const d = path.join(to, entry.name)
    if (entry.isDirectory()) {
      copyDir(s, d)
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d)
      copied += 1
    }
  }
}

try {
  copyDir(src, root)
  console.log(`[copy-to-root] 已将最新版本复制到根目录（${copied} 个文件）：${root}`)
} catch (err) {
  console.error(`[copy-to-root] 复制失败：${err.message}`)
  console.error('[copy-to-root] 请确认根目录下的 wokao.exe 未在运行后重试。')
  process.exit(1)
}
