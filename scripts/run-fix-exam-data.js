const path = require('path')
const os = require('os')
const esbuild = require('esbuild')
const root = path.join(__dirname, '..')
const outfile = path.join(os.tmpdir(), 'wokao-fix-exam-data.cjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'scripts/fix-exam-data.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  logLevel: 'silent'
})
require(outfile)
