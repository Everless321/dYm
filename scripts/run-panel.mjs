import { spawn } from 'child_process'
import { mkdirSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const outfile = join(root, 'out/panel/cli.mjs')

mkdirSync(dirname(outfile), { recursive: true })
await esbuild.build({
  entryPoints: [join(root, 'src/panel/cli.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  sourcemap: true
})

const child = spawn(process.execPath, [outfile, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit'
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
