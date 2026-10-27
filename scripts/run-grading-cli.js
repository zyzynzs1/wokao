// 用 esbuild 现场打包并运行 scripts/grading-cli.ts（不新增构建依赖）
const path = require('path')
const os = require('os')
const esbuild = require('esbuild')

const root = path.join(__dirname, '..')
const outfile = path.join(os.tmpdir(), 'wokao-grading-cli.cjs')

esbuild.buildSync({
  entryPoints: [path.join(root, 'scripts/grading-cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  logLevel: 'silent'
})

require(outfile)
