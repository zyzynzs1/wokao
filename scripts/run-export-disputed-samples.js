// 用 esbuild 打包并运行 scripts/export-disputed-samples.ts（不新增构建依赖）
const path = require('path')
const os = require('os')
const esbuild = require('esbuild')

const root = path.join(__dirname, '..')
const outfile = path.join(os.tmpdir(), 'wokao-export-disputed-samples.cjs')

esbuild.buildSync({
  entryPoints: [path.join(root, 'scripts/export-disputed-samples.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  logLevel: 'silent'
})

require(outfile)
