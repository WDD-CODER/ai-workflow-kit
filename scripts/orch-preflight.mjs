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
 *   dev server   commands.dev set → the dev server answers on the base port (kit config slots.fePorts), else
 *                scripts/slot-serve.mjs starts it; a failed start is a FAIL (an environment failure before any builder)
 *   git identity user.name and user.email are set
 *   remote       origin/<main branch> is known (a fetch has run)
 *   main folder  on the main branch with no uncommitted tracked file (a run never writes it; plans are committed first)
 *   settings     the workflow, the /orchestrate command, the role agents and the state script are installed
 *   run          --run <name>: no run of that name is live (status.json phase running, updated in the last 2 hours)
 * --env-only runs disk, database and packages only (the retry check after an environment failure).
 *
 *   node scripts/orch-preflight.mjs --ui [--pages <url,url>] [--login <url>] [--api <url>]
 *
 * --ui is the check before any browser step of a [ui] card (docs/agent/orchestrator.md), and runs only these:
 *   ui server    each page's origin answers below 500 (--pages: the cards' page URLs; SKIP when none is given)
 *   ui login     the QA login answers 2xx/3xx (--login or ORCH_UI_LOGIN_URL; a POST of {username,password} from
 *                ORCH_QA_USER / ORCH_QA_PASSWORD when both are set, else a GET; never printed; SKIP when no URL)
 *   ui backend   the backend (--api or ORCH_UI_API_URL) answers a request sent with the first page's Origin, and allows
 *                that origin when it is another origin (Access-Control-Allow-Origin); SKIP when no URL
 * A FAIL adds `uiBlocked: true`: the orchestrator stops before the browser agent, with no fix round spent.
 * The last line is `ORCH_JSON {"ok":…,"problems":[…]}`. Exit 0 when nothing FAILed, else 1.
 */
import { existsSync, readFileSync, statfsSync } from 'fs'
import { spawnSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import net from 'net'
import { freeGb, runNameProblem, serverProblem, loginProblem, crossOriginProblem } from './lib/orch-run.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const MAIN = 'main'
const MIN_FREE_GB = 5
const DEV = ''
const LIVE_MS = 2 * 60 * 60 * 1000
const SERVE_TIMEOUT_MS = 4 * 60 * 1000

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

// The main folder's dev server port: kit config slots.fePorts (the base port; main = base), as preflight.mjs reads it.
function devPort() {
  for (const f of ['kit.config.json', join('.kit', 'config.json')]) {
    try {
      const port = Number(JSON.parse(readFileSync(join(root, f), 'utf8')).slots?.fePorts)
      if (Number.isInteger(port) && port > 0) return port
    } catch { /* no such config */ }
  }
  return null
}

// commands.dev set: the dev server must answer, or start. A server that already answers on the base port passes;
// otherwise scripts/slot-serve.mjs runs once and its failure (in the main folder it starts nothing: the main folder's
// servers are the Human's) is an environment failure before any builder runs.
async function devServer() {
  if (!DEV) return skip('dev server', 'commands.dev is not set (no frontend)')
  const serve = join(root, 'scripts', 'slot-serve.mjs')
  if (!existsSync(serve)) return bad('dev server', 'scripts/slot-serve.mjs is missing — run the kit sync')
  const port = devPort()
  const url = port ? `http://localhost:${port}/` : null
  if (url && !serverProblem(url, await ask(url))) return ok('dev server')
  const r = spawnSync(process.execPath, [serve], { cwd: root, encoding: 'utf8', timeout: SERVE_TIMEOUT_MS })
  if (r.status === 0) return ok('dev server')
  const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split(/\r?\n/).slice(-2).join(' | ')
  bad('dev server', `${url ? `nothing answers on ${url} and ` : ''}scripts/slot-serve.mjs did not start it (exit ${r.status ?? 'timeout'}: ${tail || 'no output'}) — start the dev server, then relaunch`)
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

// ---- --ui: the environment of a browser step ---------------------------------------------------------------------
const UI_TIMEOUT_MS = 5 * 1000
async function ask(url, init = {}) {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(UI_TIMEOUT_MS), ...init })
    return { status: res.status, allowOrigin: res.headers.get('access-control-allow-origin') ?? '' }
  } catch (e) {
    return { error: e?.cause?.code ?? e?.name ?? 'no answer' }
  }
}

const originOf = (url) => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

async function uiChecks() {
  const pages = String(flag('--pages') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!pages.length) skip('ui server', 'no page URL given (--pages)')
  else {
    const byOrigin = new Map(pages.map((p) => [originOf(p) ?? p, p]))
    const found = []
    for (const p of byOrigin.values()) {
      const why = serverProblem(p, originOf(p) ? await ask(p) : null)
      if (why) found.push(why)
    }
    if (found.length) bad('ui server', found.join('; '))
    else ok('ui server')
  }
  const login = flag('--login') ?? process.env.ORCH_UI_LOGIN_URL ?? ''
  if (!login) skip('ui login', 'no login URL (--login or ORCH_UI_LOGIN_URL)')
  else {
    // The QA user comes from the environment (.env, loaded by the project); it is sent, never printed.
    const user = process.env.ORCH_QA_USER
    const pass = process.env.ORCH_QA_PASSWORD
    const res = !originOf(login) ? { error: 'not a URL' } : user && pass
      ? await ask(login, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) })
      : await ask(login)
    const why = loginProblem(login, res)
    if (why) bad('ui login', why)
    else ok('ui login')
  }
  const api = flag('--api') ?? process.env.ORCH_UI_API_URL ?? ''
  if (!api) skip('ui backend', 'no backend URL (--api or ORCH_UI_API_URL)')
  else {
    const origin = originOf(pages[0] ?? '')
    const res = originOf(api) ? await ask(api, origin ? { headers: { origin } } : {}) : null
    const why = crossOriginProblem(pages[0] ?? '', api, res)
    if (why) bad('ui backend', why)
    else ok('ui backend')
  }
}

const uiOnly = argv.includes('--ui')
if (uiOnly) await uiChecks()
else {
  disk()
  await database()
  packages()
}
if (!envOnly && !uiOnly) {
  await devServer()
  identity()
  remote()
  mainFolder()
  settings()
  live()
}
for (const r of results) console.log(`${r.status.padEnd(4)} ${r.name}${r.why ? `: ${r.why}` : ''}`)
const problems = results.filter((r) => r.status === 'FAIL').map((r) => `${r.name}: ${r.why}`)
console.log(`ORCH_JSON ${JSON.stringify({ ok: problems.length === 0, problems, ...(problems.length ? { envFailure: true } : {}), ...(problems.length && uiOnly ? { uiBlocked: true } : {}) })}`)
process.exit(problems.length ? 1 : 0)
