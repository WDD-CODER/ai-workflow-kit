/**
 * Orchestrator preflight — finds the environment problems before a run starts, so no builder spends a fix round on
 * them (docs/agent/orchestrator.md). One line per check: `OK`, `SKIP <why>` or `FAIL <what to do>`.
 *
 *   node scripts/orch-preflight.mjs [--run <name>] [--env-only] [--db-port <n>]
 *
 * Checks:
 *   disk         free disk >= orchestrator.minFreeDiskGb (ORCH_FREE_GB replaces the measured value, for tests)
 *   database     a TCP connection to DB_PORT / --db-port (SKIP when neither is set)
 *   packages     scripts/node_modules has the workflow scripts' packages; a project with a frontend has node_modules
 *   dev server   commands.dev set → scripts/slot-serve.mjs is installed (it starts the server in each builder's folder)
 *   git identity user.name and user.email are set
 *   remote       origin/<main branch> is known (a fetch has run)
 *   main folder  on the main branch with no uncommitted tracked file (a run never writes it; plans are committed first)
 *   settings     the workflow, the /orchestrate command, the role agents and the state script are installed
 *   run          --run <name>: no run of that name is live (status.json phase running, updated in the last 2 hours)
 * --env-only runs disk, database and packages only (the retry check after an environment failure).
 * The last line is `ORCH_JSON {"ok":…,"problems":[…]}`. Exit 0 when nothing FAILed, else 1.
 */
import { existsSync, readFileSync, statfsSync } from 'fs'
import { spawnSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import net from 'net'
import { freeGb, runNameProblem } from './lib/orch-run.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const MAIN = '{{git.mainBranch}}'
const MIN_FREE_GB = {{orchestrator.minFreeDiskGb|json}}
const DEV = '{{commands.dev}}'
const LIVE_MS = 2 * 60 * 60 * 1000

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}
const envOnly = argv.includes('--env-only')
const run = flag('--run')
const results = []
const ok = (name) => results.push({ name, status: 'OK' })
const skip = (name, why) => results.push({ name, status: 'SKIP', why })
const bad = (name, why) => results.push({ name, status: 'FAIL', why })
const git = (...a) => {
  const r = spawnSync('git', a, { cwd: root, encoding: 'utf8' })
  return { status: r.status ?? 1, out: (r.stdout ?? '').trim() }
}

function disk() {
  let free = null
  if (process.env.ORCH_FREE_GB !== undefined && process.env.ORCH_FREE_GB !== '') free = Number(process.env.ORCH_FREE_GB)
  else {
    try {
      free = freeGb(statfsSync(root))
    } catch { /* unknown */ }
  }
  if (free === null) return skip('disk', 'free space cannot be read on this system')
  if (free < MIN_FREE_GB) return bad('disk', `${free} GB free, orchestrator.minFreeDiskGb asks for ${MIN_FREE_GB} GB — free some space`)
  ok('disk')
}

function database() {
  const port = Number(flag('--db-port') ?? process.env.DB_PORT ?? 0)
  if (!port) return Promise.resolve(skip('database', 'set DB_PORT or pass --db-port to check it'))
  return new Promise((done) => {
    const s = net.connect({ port, host: '127.0.0.1' })
    const end = (fn) => {
      s.destroy()
      done(fn())
    }
    s.setTimeout(3 * 1000, () => end(() => bad('database', `no answer on port ${port} in 3 s — start the database`)))
    s.once('connect', () => end(() => ok('database')))
    s.once('error', (e) => end(() => bad('database', `port ${port}: ${e.code ?? e.message} — start the database`)))
  })
}

function packages() {
  if (!existsSync(join(root, 'scripts', 'node_modules', 'picomatch'))) return bad('packages', 'scripts/node_modules is missing the workflow scripts\' packages — run npm install inside scripts/')
  if (DEV && existsSync(join(root, 'package.json')) && !existsSync(join(root, 'node_modules'))) return bad('packages', 'the project has no node_modules — run the project install first')
  ok('packages')
}

function devServer() {
  if (!DEV) return skip('dev server', 'commands.dev is not set (no frontend)')
  if (!existsSync(join(root, 'scripts', 'slot-serve.mjs'))) return bad('dev server', 'scripts/slot-serve.mjs is missing — run the kit sync')
  ok('dev server')
}

function identity() {
  const name = git('config', 'user.name').out
  const email = git('config', 'user.email').out
  if (!name || !email) return bad('git identity', 'set git config user.name and user.email (every agent commit needs them)')
  ok('git identity')
}

function remote() {
  if (git('rev-parse', '--verify', '--quiet', `origin/${MAIN}`).status !== 0) return bad('remote', `origin/${MAIN} is not known — run git fetch origin`)
  ok('remote')
}

function mainFolder() {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').out
  if (branch !== MAIN) return bad('main folder', `the main folder is on ${branch}, not ${MAIN} — start a run from the main folder`)
  const dirty = git('status', '--porcelain', '--untracked-files=no').out
  if (dirty) return bad('main folder', `uncommitted files: ${dirty.split('\n').map((l) => l.slice(3)).join(', ')} — commit or set them aside first`)
  ok('main folder')
}

function settings() {
  const need = ['.claude/workflows/orchestrate.js', '.claude/commands/orchestrate.md', 'scripts/orch-state.mjs', 'scripts/plan-order.mjs',
    ...['readiness', 'builder', 'gate', 'check-plan', 'check-bugs', 'check-rules', 'verify', 'security', 'merge'].map((r) => `.claude/agents/orch-${r}.md`),
    '.claude/agents/kit-runner.md']
  const missing = need.filter((f) => !existsSync(join(root, f)))
  if (missing.length) return bad('settings', `not installed: ${missing.join(', ')} — run the kit sync`)
  ok('settings')
}

function live() {
  if (!run) return
  const why = runNameProblem(run)
  if (why) return bad('run', why)
  const p = join(root, '.claude', 'orchestrator-runs', run, 'status.json')
  if (!existsSync(p)) return ok('run')
  try {
    const s = JSON.parse(readFileSync(p, 'utf8'))
    const age = Date.now() - Date.parse(s.updatedAt ?? 0)
    if (s.phase === 'running' && age < LIVE_MS) return bad('run', `run "${run}" is live (last update ${s.updatedAt}) — wait for it, or pick another name`)
  } catch { /* unreadable: treated as not live */ }
  ok('run')
}

disk()
await database()
packages()
if (!envOnly) {
  devServer()
  identity()
  remote()
  mainFolder()
  settings()
  live()
}
for (const r of results) console.log(`${r.status.padEnd(4)} ${r.name}${r.why ? `: ${r.why}` : ''}`)
const problems = results.filter((r) => r.status === 'FAIL').map((r) => `${r.name}: ${r.why}`)
console.log(`ORCH_JSON ${JSON.stringify({ ok: problems.length === 0, problems, ...(problems.length ? { envFailure: true } : {}) })}`)
process.exit(problems.length ? 1 : 0)
