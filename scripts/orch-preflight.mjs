/**
 * Orchestrator preflight — finds the environment problems before a run starts, so no builder spends a fix round on
 * them (docs/agent/orchestrator.md). One line per check: `OK`, `SKIP <why>` or `FAIL <what to do>`.
 *
 *   node scripts/orch-preflight.mjs [--run <name>] [--plans <NNN,NNN>] [--env-only] [--db-port <n>] [--db local|remote]
 *
 * Checks:
 *   disk         free disk >= orchestrator.minFreeDiskGb (ORCH_FREE_GB replaces the measured value, for tests)
 *   database     a TCP connection to DB_PORT / --db-port (SKIP when neither is set)
 *   packages     scripts/node_modules has the workflow scripts' packages; a project with a frontend has node_modules;
 *                with --run, the run's merge folder (when it exists) has its scripts/ packages too
 *   gate         WARN when the gate's test script (commands.testCi, else commands.test) is a watch mode that never exits
 *   dev server   commands.dev set → the dev server answers on the base port (kit config slots.fePorts), else
 *                `scripts/slot-serve.mjs --main --servers fe` starts it; a failed start is a FAIL carrying the server's
 *                log tail (an environment failure before any builder) — never a request to start it by hand
 *   backend      a --plans plan with an open [auto:main] item → the main folder's backend answers on slots.bePorts, else
 *                `slot-serve.mjs --main --servers be --db <local|remote>` starts it (commands.devLocal / devRemote);
 *                SKIP when no plan needs it
 *   git identity user.name and user.email are set
 *   git longpaths on Windows, core.longpaths is true in the main folder's repository config (set to true when it is not:
 *                `OK git longpaths (set to true)`; a failed set is `FAIL git longpaths: run git config core.longpaths true in
 *                <main folder>`); `SKIP git longpaths: not Windows` elsewhere (ORCH_PLATFORM replaces the platform, tests only)
 *   remote       origin/<main branch> is known (a fetch has run)
 *   main folder  on the main branch with no uncommitted tracked file (a run never writes it; plans are committed first)
 *   settings     the /orchestrate command, run-plans.mjs, the builder and reviewer agents and the state script are installed
 *   run          --run <name>: no run of that name is live (status.json phase running, updated in the last 2 hours);
 *                with --plans, no live run holds one of these plans or a plan whose scope overlaps one of them
 *   plan guards  each --plans plan's prescribed code (fenced blocks and inline code) run through the project's commit
 *                guards (scripts/pre-commit-*.mjs exporting scanGuardText): a hit is a `PARK plan NNN` line naming the
 *                guard, its rule line and the plan line — that plan is parked before any builder, the others go on
 *   ui login recipes  each --plans plan's [ui] cards: a role a card names ("as the admin user", "role: admin") with no
 *                recipe in ui.logins is a WARN `ui login: no recipe for role <r> (plan NNN card n)`; with recipes set, a
 *                card naming no role is a WARN too
 *   leftovers    a --plans plan's feat/NNN-* branch the run branch (else main) does not contain, any park/* branch, and
 *                an occupied slot or builder folder of an earlier run: a WARN `leftover: …` line each
 * --plan-checks runs only the plan checks (with --plans). The JSON line carries parkPlans { NNN: reason } and warnings.
 * --env-only runs disk, database, packages, the gate warning, the probes and git longpaths only (the retry check after an environment failure; pass --run too so
 * the merge folder's packages are checked).
 *   probe        --probe "<command>" (repeatable): the precondition of a gate command that ended env-fail, derived from
 *                the command text and never by running it — `node <file>` → the file exists in the root folder
 *                (--probe-dir <folder>: in that folder instead, the one the gate ran in);
 *                `npm|pnpm run <name>` → <name> is in package.json scripts and node_modules exists; anything else →
 *                `SKIP probe: no precondition`. A FAIL is an environment failure; the JSON line lists every probe.
 *
 *   node scripts/orch-preflight.mjs --ui [--pages <url,url>] [--login <url>] [--api <url>]
 *
 * --ui is the check before any browser step of a [ui] card (docs/agent/orchestrator.md), and runs only these:
 *   ui server    each page's origin answers below 500 (--pages: the cards' page URLs; SKIP when none is given)
 *   ui login     the QA login answers 2xx/3xx (--login or ORCH_UI_LOGIN_URL; a POST of {username,password} from
 *                ORCH_QA_USER / ORCH_QA_PASSWORD when both are set, else a GET; never printed; SKIP when no URL);
 *                --role <r> uses that role's recipe from ui.logins (its url, and the variables userEnv / passEnv)
 *   ui backend   the backend (--api or ORCH_UI_API_URL) answers a request sent with the first page's Origin, and allows
 *                that origin when it is another origin (Access-Control-Allow-Origin); SKIP when no URL
 * A FAIL adds `uiBlocked: true`: the orchestrator stops before the browser agent, with no fix round spent.
 * The last line is `ORCH_JSON {"ok":…,"problems":[…]}`. Exit 0 when nothing FAILed, else 1.
 */
import { existsSync, readFileSync, readdirSync, statfsSync } from 'fs'
import { spawnSync } from 'child_process'
import { resolve, dirname, join, isAbsolute } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { planGuardHits, guardParkReason } from './lib/plan-guard-scan.mjs'
import net from 'net'
import { freeGb, runNameProblem, serverProblem, loginProblem, crossOriginProblem, watchModeProblem } from './lib/orch-run.mjs'
import { findOpenPlan } from './lib/plan-paths.mjs'
import { mainAutoItems, uiItems } from './lib/done-when.mjs'
import { extractScopeGlobs } from './lib/plan-scope.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const MAIN = 'main'
const MIN_FREE_GB = 5
const DEV = ''
const PM = 'npm' === 'pnpm' ? 'pnpm' : 'npm'
const REPO = 'ai-workflow-kit'
// The script the gate runs: commands.testCi when the project set it, else commands.test.
const TEST_SCRIPT = '' || 'test'
// A project's own regular expression for its framework's watch-mode test command (orchestrator.watchTestPattern).
const WATCH_PATTERN = ""
const LIVE_MS = 2 * 60 * 60 * 1000
const SERVE_TIMEOUT_MS = 4 * 60 * 1000

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}
const envOnly = argv.includes('--env-only')
const run = flag('--run')
// --db remote: the run asked for the remote database (/orchestrate … remote); never stored, the default is local.
const DB = flag('--db') === 'remote' ? 'remote' : 'local'
const results = []
const ok = (name) => results.push({ name, status: 'OK' })
const skip = (name, why) => results.push({ name, status: 'SKIP', why })
const bad = (name, why) => results.push({ name, status: 'FAIL', why })
// A WARN is printed and never stops the run.
const warn = (name, why) => results.push({ name, status: 'WARN', why })
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
  if (!existsSync(join(root, 'scripts', 'node_modules', 'picomatch'))) return bad('packages', `scripts/node_modules is missing the workflow scripts' packages — run ${PM} install inside scripts/`)
  if (DEV && existsSync(join(root, 'package.json')) && !existsSync(join(root, 'node_modules'))) return bad('packages', 'the project has no node_modules — run the project install first')
  // The run's merge folder (once init made it) runs the project checks too: it needs the same packages.
  if (run && !runNameProblem(run)) {
    const mf = join(dirname(root), `${REPO || root.split(/[\\/]/).pop()}-orch-merge-${run}`)
    if (existsSync(mf) && existsSync(join(mf, 'scripts', 'package.json')) && !existsSync(join(mf, 'scripts', 'node_modules', 'picomatch'))) {
      return bad('packages', `the merge folder ${mf} has no scripts/node_modules — run ${PM} install inside its scripts/ (init installs it on the next start)`)
    }
    // The merge step runs the project's build there: a project with packages in the main folder needs them in the merge folder.
    if (existsSync(mf) && existsSync(join(mf, 'package.json')) && existsSync(join(root, 'node_modules')) && !existsSync(join(mf, 'node_modules'))) {
      return bad('packages', `the merge folder ${mf} has no node_modules — run ${PM} install there (a merge's build fails without it)`)
    }
  }
  ok('packages')
}

// --probe "<command>": the failed gate command's own precondition. The command is split into words and
// matched against two fixed shapes; it is never run and never handed to a shell.
const probeCmds = argv.flatMap((a, i) => (a === '--probe' && i + 1 < argv.length ? [argv[i + 1]] : []))
// --probe-dir <folder>: where the gate ran (the plan's worktree), so a file only the plan's branch adds is found. Only
// an absolute folder that exists is taken; anything else falls back to the root folder.
const probeDirArg = flag('--probe-dir')
const probeDir = probeDirArg && isAbsolute(probeDirArg) && existsSync(probeDirArg) ? resolve(probeDirArg) : root
const probeWhere = probeDir === root ? 'the root folder' : 'the folder the gate ran in'
const probeOut = []
const cmdWords = (cmd) => [...String(cmd).matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3])
function probeOf(cmd, dir) {
  const w = cmdWords(cmd)
  if (w[0] === 'node' && w[1] && !w[1].startsWith('-')) {
    const file = w[1].replace(/\\/g, '/')
    if (/^\/|^[A-Za-z]:|(^|\/)\.\.(\/|$)/.test(file)) return { status: 'SKIP', why: 'no precondition (a path outside the root folder)' }
    return existsSync(join(dir, file)) ? { status: 'OK' } : { status: 'FAIL', why: `${file} not found in ${probeWhere}` }
  }
  if ((w[0] === 'npm' || w[0] === 'pnpm') && w[1] === 'run' && w[2]) {
    let scripts = null
    try {
      scripts = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts ?? {}
    } catch {
      return { status: 'FAIL', why: `package.json cannot be read in ${probeWhere}` }
    }
    if (!Object.prototype.hasOwnProperty.call(scripts, w[2])) return { status: 'FAIL', why: `package.json has no script ${w[2]}` }
    if (!existsSync(join(dir, 'node_modules'))) return { status: 'FAIL', why: `node_modules is missing — run ${w[0]} install` }
    return { status: 'OK' }
  }
  return { status: 'SKIP', why: 'no precondition' }
}
function probes() {
  for (const cmd of probeCmds) {
    const p = probeOf(cmd, probeDir)
    probeOut.push({ command: cmd, ...p })
    if (p.status === 'OK') ok(`probe ${cmd}`)
    else if (p.status === 'FAIL') bad('probe', `${cmd} — ${p.why}`)
    else skip('probe', `${p.why} — ${cmd}`)
  }
}

// The gate waits for the test command to exit: a watch-mode script prints its totals and hangs (a run lost an hour to it).
function gate() {
  if (!TEST_SCRIPT) return skip('gate', 'no test script is set')
  let script
  try {
    script = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts?.[TEST_SCRIPT]
  } catch { /* no package.json */ }
  if (script === undefined) return skip('gate', `no "${TEST_SCRIPT}" script in package.json`)
  const why = watchModeProblem(script, WATCH_PATTERN)
  if (why) return warn('gate', `"${TEST_SCRIPT}" runs "${script}" (${why}), which never exits: the gate stops it after the timeout and fails. Set commands.testCi in the kit config to a script that runs the tests once and exits`)
  ok('gate')
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

// The main folder's servers start through `scripts/slot-serve.mjs --main` (one call per server, at most SERVE_TIMEOUT_MS
// each). Its failure — a held port, a build error, the database down — is an environment failure before any builder
// runs, and the message carries the server's own last log lines. Never "please start the server".
function serveMain(servers) {
  const serve = join(root, 'scripts', 'slot-serve.mjs')
  if (!existsSync(serve)) return { ok: false, why: 'scripts/slot-serve.mjs is missing — run the kit sync' }
  const r = spawnSync(process.execPath, [serve, '--main', '--servers', servers, '--db', DB], { cwd: root, encoding: 'utf8', timeout: SERVE_TIMEOUT_MS })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\r\n/g, '\n').trim()
  if (r.status === 0) return { ok: true, line: out.split('\n').filter((l) => l.startsWith('SLOT_SERVE: main')).pop() ?? '' }
  const tail = out.split('\n').slice(-12).join(' | ')
  return { ok: false, why: `scripts/slot-serve.mjs did not start it (exit ${r.status ?? 'timeout'}: ${tail || 'no output'}) — run by node scripts/slot-serve.mjs --main --servers ${servers}${servers === 'be' ? ` --db ${DB}` : ''}` }
}

// commands.dev set: the dev server must answer, or it is started. A server that already answers on the base port
// passes untouched.
async function devServer() {
  if (!DEV) return skip('dev server', 'commands.dev is not set (no frontend)')
  const port = devPort()
  const url = port ? `http://localhost:${port}/` : null
  if (url && !serverProblem(url, await ask(url))) return ok('dev server')
  const s = serveMain('fe')
  if (s.ok) return ok('dev server')
  bad('dev server', `${url ? `nothing answered on ${url}; ` : ''}${s.why}`)
}

// The run's plans with an open [auto:main] Done-when item read the live environment from the main folder: they need its
// backend. Started (local database, or remote with --db remote) only for such a plan; a backend that answers passes.
function bePort() {
  for (const f of ['kit.config.json', join('.kit', 'config.json')]) {
    try {
      const port = Number(JSON.parse(readFileSync(join(root, f), 'utf8')).slots?.bePorts)
      if (Number.isInteger(port) && port > 0) return port
    } catch { /* no such config */ }
  }
  return null
}
const listening = (port) => new Promise((done) => {
  const s = net.connect({ port, host: '127.0.0.1' })
  const end = (v) => {
    s.destroy()
    done(v)
  }
  s.setTimeout(2 * 1000, () => end(false))
  s.once('connect', () => end(true))
  s.once('error', () => end(false))
})
async function backend() {
  const plans = String(flag('--plans') ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d{1,4}$/.test(s))
  const needing = plans.filter((nnn) => {
    const path = findOpenPlan(root, nnn)
    if (!path) return false
    try {
      return mainAutoItems(readFileSync(join(root, path), 'utf8')).length > 0
    } catch {
      return false
    }
  })
  if (!needing.length) return skip('backend', 'no plan needs it')
  // No backend to start for a plan that needs one: its [auto:main] check would fail after builders spent rounds.
  if (!existsSync(join(root, 'server', 'package.json'))) return bad('backend', `plan ${needing.join(', ')} has an open [auto:main] item, but this folder has no server/package.json to start a backend from — add the backend, or take the [auto:main] item out of that plan`)
  const port = bePort()
  // A backend that answers is kept as it is; with --db remote nothing tells which database it runs on, so say so.
  if (port && await listening(port)) {
    if (DB === 'remote') return warn('backend', `a backend already answers on port ${port} and was kept as it is: the run uses the database it was started on, which may be the local one. For the remote database, stop it and relaunch`)
    return ok('backend')
  }
  const s = serveMain('be')
  if (s.ok) return ok('backend')
  bad('backend', `plan ${needing.join(', ')} has an [auto:main] item and needs the main folder's backend (${DB} database); ${s.why}`)
}

function identity() {
  const name = git('config', 'user.name').out
  const email = git('config', 'user.email').out
  if (!name || !email) return bad('git identity', 'set git config user.name and user.email (every agent commit needs them)')
  ok('git identity')
}

// Windows stops git at 260 characters: a run folder or a review folder with a deep path fails with "Could not reset
// index file". core.longpaths in the repository config (shared by every run folder of the repository) is the fix; it is
// set here when it is not true. ORCH_PLATFORM replaces process.platform, for tests only.
function longpaths() {
  if ((process.env.ORCH_PLATFORM || process.platform) !== 'win32') return skip('git longpaths', 'not Windows')
  if (git('config', '--get', 'core.longpaths').out === 'true') return ok('git longpaths')
  const set = git('config', 'core.longpaths', 'true')
  if (set.status !== 0) return bad('git longpaths', `run git config core.longpaths true in ${root.replace(/\\/g, '/')}`)
  ok('git longpaths (set to true)')
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
  const need = ['.claude/commands/orchestrate.md', 'scripts/run-plans.mjs', 'scripts/orch-state.mjs', 'scripts/plan-order.mjs',
    '.claude/agents/orch-builder.md', '.claude/agents/plan-reviewer.md']
  const missing = need.filter((f) => !existsSync(join(root, f)))
  if (missing.length) return bad('settings', `not installed: ${missing.join(', ')} — run the kit sync`)
  ok('settings')
}

// ---- plan checks: a plan that will fail is named before any builder starts --------------------------------------------
const planNumbers = () => String(flag('--plans') ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d{1,4}$/.test(s))
const planText = (nnn) => {
  const path = findOpenPlan(root, nnn)
  if (!path) return null
  try {
    return readFileSync(join(root, path), 'utf8')
  } catch {
    return null
  }
}
// The plans to park before any builder, with the reason: { NNN: reason } (a PARK line each; not a FAIL — the other
// plans of the run go on).
const parkPlans = {}
const park = (nnn, why) => {
  parkPlans[nnn] = parkPlans[nnn] ? `${parkPlans[nnn]}; ${why}` : why
  results.push({ name: `plan ${nnn}`, status: 'PARK', why })
}

// The project's commit guards (scripts/pre-commit-*.mjs that export scanGuardText), run over the code each plan
// prescribes: a plan that asks for a line a guard refuses is parked with the guard's rule and line.
async function commitGuards() {
  const dir = join(root, 'scripts')
  const names = existsSync(dir) ? readdirSync(dir).filter((f) => /^pre-commit-[\w-]+\.mjs$/.test(f)).sort() : []
  const guards = []
  for (const name of names) {
    try {
      const mod = await import(pathToFileURL(join(dir, name)).href)
      if (typeof mod.scanGuardText === 'function') guards.push({ name, scan: mod.scanGuardText })
    } catch { /* a guard that cannot be loaded is the commit hook's business */ }
  }
  return guards
}
async function planGuards() {
  const plans = planNumbers()
  if (!plans.length) return
  const guards = await commitGuards()
  if (!guards.length) return skip('plan guards', 'no commit guard exports scanGuardText')
  let parked = 0
  for (const nnn of plans) {
    const text = planText(nnn)
    if (text === null) continue
    const hits = planGuardHits(text, guards)
    if (hits.length) {
      parked++
      park(nnn, hits.slice(0, 3).map(guardParkReason).join('; '))
    }
  }
  if (!parked) ok('plan guards')
}

// ui.logins in the project config: one login recipe per role — { role, url, userEnv, passEnv }; the variables are named,
// never their values. Read when the check runs (like bePort), so a config change needs no re-render.
function loginRecipes() {
  for (const f of [join('.kit', 'config.json'), 'kit.config.json']) {
    try {
      const list = JSON.parse(readFileSync(join(root, f), 'utf8')).ui?.logins
      if (Array.isArray(list)) return list.filter((r) => r && typeof r.role === 'string' && typeof r.url === 'string')
    } catch { /* no such config */ }
  }
  return []
}
// The role a [ui] card names: "role: <name>", "as <the|a|an> <name> user|role", or "as <name>" for a role ui.logins has.
const CARD_ROLE_WORDS = /\brole:\s*([a-z][\w-]*)|\bas\s+(?:an?\s+|the\s+)?([a-z][\w-]*)\s+(?:user|role)\b|\bas\s+(?:an?\s+|the\s+)?([a-z][\w-]*)\b/gi
function cardRole(card, known) {
  for (const m of String(card).matchAll(CARD_ROLE_WORDS)) {
    if (m[1] || m[2]) return (m[1] || m[2]).toLowerCase()
    if (m[3] && known.includes(m[3].toLowerCase())) return m[3].toLowerCase()
  }
  return null
}
// Each --plans plan's [ui] cards: a role with no recipe is flagged before any builder (the card would fail at its login
// late in the run). With recipes configured, a card that names no role is flagged too: which login it needs is unknown.
function uiLogins() {
  const recipes = loginRecipes()
  const known = recipes.map((r) => r.role.toLowerCase())
  let flagged = 0
  let cards = 0
  for (const nnn of planNumbers()) {
    const text = planText(nnn)
    if (text === null) continue
    uiItems(text).forEach((card, i) => {
      cards++
      const role = cardRole(card, known)
      if (role && !known.includes(role)) {
        flagged++
        warn('ui login', `no recipe for role ${role} (plan ${nnn} card ${i + 1})`)
      } else if (!role && recipes.length) {
        flagged++
        warn('ui login', `no role named (plan ${nnn} card ${i + 1}) — write "as the <role> user" in the card`)
      }
    })
  }
  if (!cards) return
  if (!flagged) ok('ui login recipes')
}

// Leftovers of earlier runs, one WARN line each, so the Human sees them before a builder trips over one: a plan's own
// feat/NNN-* branch (local or origin) that the run branch (else main) does not contain, any park/* branch (parked work
// saved by an earlier run), and a slot or builder folder that is still occupied (a .worktree-plan marker or a branch).
const RUN_PREFIX = 'orch/'
function leftovers() {
  const plans = planNumbers()
  if (!plans.length) return
  const target = run && git('rev-parse', '--verify', '--quiet', `origin/${RUN_PREFIX}${run}`).status === 0 ? `origin/${RUN_PREFIX}${run}` : `origin/${MAIN}`
  const haveTarget = git('rev-parse', '--verify', '--quiet', target).status === 0
  const refs = git('for-each-ref', '--format=%(refname)', 'refs/heads/feat', 'refs/heads/park', 'refs/remotes/origin/feat', 'refs/remotes/origin/park').out.split('\n').filter(Boolean)
  const found = []
  const seen = new Set()
  for (const ref of refs) {
    const name = ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/origin\//, '')
    const where = ref.startsWith('refs/remotes/') ? 'origin' : 'local'
    if (seen.has(`${name} ${where}`)) continue
    seen.add(`${name} ${where}`)
    if (name.startsWith('park/')) found.push(`park branch ${name} (${where}) holds work saved when an earlier run parked a plan`)
    else {
      const nnn = /^feat\/(\d{3,4})-/.exec(name)?.[1]
      if (!nnn || !plans.includes(nnn)) continue
      const merged = haveTarget && git('merge-base', '--is-ancestor', ref, target).status === 0
      if (!merged) found.push(`branch ${name} (${where}) of plan ${nnn} is not in ${target} — an earlier run's work; the run reuses it`)
    }
  }
  // Slots (…-wt-N) and builder folders (…-orch-<run>-NNN) beside the main folder that are still occupied.
  const lines = git('worktree', 'list', '--porcelain').out.split('\n')
  let wt = null
  const trees = []
  for (const l of [...lines, '']) {
    if (l.startsWith('worktree ')) wt = { path: l.slice(9).trim(), branch: null }
    else if (l.startsWith('branch ') && wt) wt.branch = l.slice(7).replace(/^refs\/heads\//, '')
    else if (!l.trim() && wt) {
      trees.push(wt)
      wt = null
    }
  }
  for (const t of trees) {
    const base = t.path.replace(/\\/g, '/').split('/').pop()
    const slot = /-wt-\d+$/.test(base)
    const builder = /-orch-(?!merge-)[a-z0-9-]+-\d{3,4}$/.test(base)
    if (!slot && !builder) continue
    const marker = existsSync(join(t.path, '.worktree-plan')) ? readFileSync(join(t.path, '.worktree-plan'), 'utf8').trim() : ''
    if (builder) found.push(`builder folder ${t.path} of an earlier run is still there${t.branch ? ` (on ${t.branch})` : ''}`)
    else if (marker || t.branch) found.push(`slot ${t.path} is occupied (${[marker && `plan ${marker}`, t.branch && `on ${t.branch}`].filter(Boolean).join(', ')})`)
  }
  for (const f of found) warn('leftover', f)
  if (!found.length) ok('leftovers')
}

async function planChecks() {
  await planGuards()
  uiLogins()
  leftovers()
}

// A live run: status.json running, updated in the last two hours.
function liveRuns() {
  const dir = join(root, '.claude', 'orchestrator-runs')
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    try {
      const s = JSON.parse(readFileSync(join(dir, name, 'status.json'), 'utf8'))
      if (s.phase === 'running' && Date.now() - Date.parse(s.updatedAt ?? 0) < LIVE_MS) out.push({ name, status: s })
    } catch { /* no status.json, or unreadable: not live */ }
  }
  return out
}

// One run at a time per plan and per file: a second run that names a plan of a live run, or a plan whose Read-Write
// Scope overlaps one of its plans, is refused (lock groups are computed inside one run only; two runs would build
// the same file in parallel). --plans lists the new run's plan numbers.
async function live() {
  if (!run) return
  const why = runNameProblem(run)
  if (why) return bad('run', why)
  const live = liveRuns()
  const same = live.find((r) => r.name === run)
  if (same) return bad('run', `run "${run}" is live (last update ${same.status.updatedAt}) — wait for it, or pick another name`)
  const mine = String(flag('--plans') ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d{1,4}$/.test(s))
  const others = live.filter((r) => r.name !== run)
  if (!mine.length || !others.length) return ok('run')
  const problems = []
  for (const r of others) {
    const theirs = Object.keys(r.status.plans ?? {})
    const shared = mine.filter((p) => theirs.includes(p))
    if (shared.length) problems.push(`plan${shared.length > 1 ? 's' : ''} ${shared.join(', ')} already in live run "${r.name}"`)
    let overlap
    try {
      overlap = (await import('./lib/plan-graph.mjs')).globsOverlap
    } catch {
      continue // no picomatch: the packages check names it
    }
    const scopeOf = (nnn) => {
      const path = findOpenPlan(root, nnn)
      if (!path) return []
      try {
        return extractScopeGlobs(readFileSync(join(root, path), 'utf8')) ?? []
      } catch {
        return []
      }
    }
    const files = git('ls-files').out.split('\n').filter(Boolean)
    for (const p of mine.filter((x) => !shared.includes(x))) {
      for (const t of theirs) {
        const hit = scopeOf(p).flatMap((a) => scopeOf(t).map((b) => overlap(a, b, files))).find(Boolean)
        if (hit) problems.push(`scope overlap with live run "${r.name}": plan ${p} and its plan ${t} both write ${hit}`)
      }
    }
  }
  if (problems.length) return bad('run', `${problems.join('; ')} — wait for that run to end (node scripts/orch-state.mjs watch --run <run>), or leave those plans out`)
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
  // --role <role>: the login recipe of that role (ui.logins) — its URL and the names of the variables holding its user.
  const role = flag('--role')
  const recipe = role ? loginRecipes().find((r) => r.role === role) : null
  if (role && !recipe) bad('ui login', `no login recipe for role ${role} in ui.logins — add { "role": "${role}", "url": …, "userEnv": …, "passEnv": … }`)
  const login = recipe ? recipe.url : role ? '' : flag('--login') ?? process.env.ORCH_UI_LOGIN_URL ?? ''
  if (role && !recipe) { /* reported above */ } else if (!login) skip('ui login', 'no login URL (--login or ORCH_UI_LOGIN_URL)')
  else {
    // The QA user comes from the environment (.env, loaded by the project); it is sent, never printed.
    const user = recipe ? process.env[recipe.userEnv] : process.env.ORCH_QA_USER
    const pass = recipe ? process.env[recipe.passEnv] : process.env.ORCH_QA_PASSWORD
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
// --plan-checks: only the checks of the --plans plans themselves (commit guards, login recipes, leftovers of earlier runs).
const planOnly = argv.includes('--plan-checks')
if (uiOnly) await uiChecks()
else if (planOnly) await planChecks()
else {
  disk()
  await database()
  packages()
  gate()
  probes()
  longpaths()
}
if (!envOnly && !uiOnly && !planOnly) {
  await devServer()
  await backend()
  identity()
  remote()
  mainFolder()
  settings()
  await live()
  await planChecks()
}
for (const r of results) console.log(`${r.status.padEnd(4)} ${r.name}${r.why ? `: ${r.why}` : ''}`)
const problems = results.filter((r) => r.status === 'FAIL').map((r) => `${r.name}: ${r.why}`)
const warnings = results.filter((r) => r.status === 'WARN').map((r) => `${r.name}: ${r.why}`)
console.log(`ORCH_JSON ${JSON.stringify({ ok: problems.length === 0, problems, ...(probeOut.length ? { probes: probeOut } : {}), ...(Object.keys(parkPlans).length ? { parkPlans } : {}), ...(warnings.length ? { warnings } : {}), ...(problems.length ? { envFailure: true } : {}), ...(problems.length && uiOnly ? { uiBlocked: true } : {}) })}`)
process.exit(problems.length ? 1 : 0)
