// Bundle and run scripts/audit-exam-data.ts.
// Output goes to the project's .tmp directory because the system TEMP directory
// can be protected by security software on some machines.
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

const root = path.join(__dirname, '..')
const outDir = path.join(root, '.tmp')
fs.mkdirSync(outDir, { recursive: true })
const outfile = path.join(outDir, 'wokao-audit-exam-data.cjs')

esbuild.buildSync({
  entryPoints: [path.join(root, 'scripts/audit-exam-data.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  logLevel: 'silent'
})

require(outfile)
