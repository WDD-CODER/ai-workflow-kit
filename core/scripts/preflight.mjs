/**
 * Preflight — environment check before dev-server / browser / database work.
 *
 * Checks (one line each, `OK`, `SKIP` or `FAIL: <reason>`):
 *   1. dev server answers on this checkout's port (.worktree-port, else kit.config.json slots.fePorts)
 *   2. the database accepts a TCP connection (DB_PORT env or --db-port; SKIP when neither is set)
 *   3. current branch is not the main branch (kit.config.json git.mainBranch)
 *   4. --visual only: the browser tool's binary exists (BROWSER_BIN env; a Windows `.exe` sibling also counts)
 *
 * Exit 0 when nothing FAILed, 1 otherwise, so a calling workflow can abort.
 * Node built-ins only — no database shell or curl dependency, so it behaves the same on
 * Windows, Git Bash and CI.
 *
 * Usage: node scripts/preflight.mjs [--visual] [--port <n>] [--db-port <n>]
 */
import { existsSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import net from 'net'
import http from 'http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const argv = process.argv.slice(2)
const flagValue = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}

let config = {}
try {
  config = JSON.parse(readFileSync(join(repoRoot, 'kit.config.json'), 'utf8'))
} catch { /* no config: fall back to the defaults below */ }
const MAIN_BRANCH = config.git?.mainBranch || 'main'

// Dev server port: the slot's .worktree-port when inside a slot, else the main checkout's base port.
const portFile = join(repoRoot, '.worktree-port')
const basePort = config.slots?.fePorts
const devPort = Number(flagValue('--port') ?? (existsSync(portFile) ? readFileSync(portFile, 'utf8').trim() : basePort))
const dbPort = flagValue('--db-port') ?? process.env.DB_PORT ?? null
// 3 s is enough for a local socket; a longer wait only delays the FAIL.
const TIMEOUT_MS = 3 * 1000

const results = []
const report = (name, ok, reason = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : `: ${reason}`}`)
}
const skip = (name, reason) => console.log(`SKIP ${name}: ${reason}`)

function httpStatus(port) {
  return new Promise((done) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: TIMEOUT_MS }, (res) => {
      res.resume()
      done(res.statusCode)
    })
    req.on('timeout', () => { req.destroy(); done(null) })
    req.on('error', () => done(null))
  })
}

function tcpOpen(port) {
  return new Promise((done) => {
    const s = net.connect({ host: '127.0.0.1', port })
    s.setTimeout(TIMEOUT_MS)
    s.on('connect', () => { s.destroy(); done(true) })
    s.on('timeout', () => { s.destroy(); done(false) })
    s.on('error', () => done(false))
  })
}

if (!devPort) {
  report('dev server', false, 'no port — set slots.fePorts in kit.config.json or pass --port')
} else {
  const status = await httpStatus(devPort)
  report(`dev server :${devPort}`, status === 200, status ? `HTTP ${status}` : 'nothing listening — start the dev server first')
}

if (dbPort) report(`database :${dbPort}`, await tcpOpen(Number(dbPort)), 'no TCP listener — start the database first')
else skip('database', 'set DB_PORT or pass --db-port to check it')

let branch = ''
try {
  branch = execFileSync('git', ['branch', '--show-current'], { cwd: repoRoot, encoding: 'utf8' }).trim()
} catch { /* not a git checkout: the check below reports it */ }
report(`branch != ${MAIN_BRANCH}`, branch !== '' && branch !== MAIN_BRANCH,
  branch === '' ? 'detached HEAD — check out a feature/ fix/ chore/ branch' : `on ${MAIN_BRANCH} — all code goes through a feature/ fix/ chore/ branch`)

if (argv.includes('--visual')) {
  const bin = process.env.BROWSER_BIN
  if (!bin) skip('browser binary', 'set BROWSER_BIN to the browser tool binary to check it')
  else report('browser binary', existsSync(bin) || existsSync(bin + '.exe'), `${bin} missing`)
}

process.exit(results.every(Boolean) ? 0 : 1)
