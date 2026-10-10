/**
 * Preflight — environment check before dev-server / browser / database work.
 *
 * Checks (one line each, `OK` or `FAIL: <reason>`):
 *   1. dev server answers on this checkout's port (.worktree-port, else the main-folder port)
 *   2. {{stack.backend}} accepts a TCP connection (MONGO_PORT, else 27017)
 *   3. current branch is not the main branch
 *   4. --visual only: {{tools.browser}} browse binary exists
 *
 * Exit 0 when every check passed, 1 otherwise, so a calling workflow can abort.
 * Node built-ins only — no mongosh/curl dependency, so it behaves the same on
 * Windows, Git Bash and CI.
 *
 * Usage: node scripts/preflight.mjs [--visual] [--port <n>]
 */
import { existsSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import net from 'net'
import http from 'http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const argv = process.argv.slice(2)
const flagValue = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}

// Dev server port: the slot's .worktree-port when inside a wt-N slot, else the main folder port.
const portFile = join(repoRoot, '.worktree-port')
const devPort = Number(flagValue('--port') ?? (existsSync(portFile) ? readFileSync(portFile, 'utf8').trim() : {{slots.fePorts}}))
const mongoPort = Number(process.env.MONGO_PORT ?? 27017)
// 2.5 s is enough for a local socket; a longer wait only delays the FAIL.
const TIMEOUT_MS = 2500
const MAIN_BRANCH = '{{git.mainBranch}}'

const results = []
const report = (name, ok, reason = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : `: ${reason}`}`)
}

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

const status = await httpStatus(devPort)
report(`dev server :${devPort}`, status === 200, status ? `HTTP ${status}` : `nothing listening — start it with \`npm start\` (main folder) or take a plan in the slot`)

const mongo = await tcpOpen(mongoPort)
report(`{{stack.backend}} :${mongoPort}`, mongo, 'no TCP listener — start {{stack.backend}} first')

let branch = ''
try {
  branch = execFileSync('git', ['branch', '--show-current'], { cwd: repoRoot, encoding: 'utf8' }).trim()
} catch { /* detached HEAD prints empty, handled below */ }
report(`branch != ${MAIN_BRANCH}`, branch !== MAIN_BRANCH, `on ${MAIN_BRANCH} — all code goes through a feature/ fix/ chore/ branch`)

if (argv.includes('--visual')) {
  const browserBin = join(homedir(), '.claude/skills/{{tools.browser}}/browse/dist/browse')
  report('{{tools.browser}} browse binary', existsSync(browserBin), `${browserBin} missing — install {{tools.browser}}`)
}

process.exit(results.every(Boolean) ? 0 : 1)
