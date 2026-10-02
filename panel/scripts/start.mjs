import { spawn } from 'child_process'
import { mkdirSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const panelRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(panelRoot, 'package.json'))
const esbuild = require('esbuild')
const outfile = join(panelRoot, 'dist/server.mjs')

mkdirSync(dirname(outfile), { recursive: true })
await esbuild.build({
  entryPoints: [join(panelRoot, 'server.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  sourcemap: true,
  absWorkingDir: panelRoot
})

const child = spawn(process.execPath, [outfile], {
  cwd: panelRoot,
  stdio: 'inherit',
  env: process.env
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
