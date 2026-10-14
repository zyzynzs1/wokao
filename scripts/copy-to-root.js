/**
 * 把 electron-builder 的打包产物复制到项目根目录，
 * 使根目录的 wokao.exe 始终是最新构建版本。
 *
 * 用法：node scripts/copy-to-root.js [源目录]
 * 默认源目录：dist-app/win-unpacked
 *
 * 说明：
 * 1. 用「逐文件 copyFileSync」而非 fs.cpSync，因为本机环境下 fs.cpSync 会导致 Node 原生崩溃；
 * 2. wokao 正在运行时其 exe 与部分资源文件被占用，脚本会跳过这些文件并给出提示。
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
const skipped = []

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name)
    const d = path.join(to, entry.name)
    if (entry.isDirectory()) {
      copyDir(s, d)
    } else if (entry.isFile()) {
      try {
        fs.copyFileSync(s, d)
        copied += 1
      } catch (err) {
        if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') {
          skipped.push(entry.name)
        } else {
          throw err
        }
      }
    }
  }
}

try {
  copyDir(src, root)
} catch (err) {
  console.error(`[copy-to-root] 复制失败：${err.message}`)
  process.exit(1)
}

if (skipped.length > 0) {
  const sample = skipped.slice(0, 5).join('、') + (skipped.length > 5 ? ' 等' : '')
  console.error(`[copy-to-root] 有 ${skipped.length} 个文件被占用而未能更新（${sample}）。`)
  console.error('[copy-to-root] 通常是 wokao 正在运行。请先关闭 wokao，再重新执行 npm run dist。')
  process.exit(1)
}

console.log(`[copy-to-root] 已将最新版本复制到根目录（${copied} 个文件）：${root}`)
