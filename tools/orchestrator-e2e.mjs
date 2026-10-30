/**
 * Orchestrator end to end — installs the kit into a scratch project and runs the installed orchestrator workflow
 * (.claude/workflows/orchestrate.js) with stub role agents that return scripted JSON. Run from the kit root:
 *
 *   node tools/orchestrator-e2e.mjs [--deps-from <scripts/node_modules folder>] [--keep]
 *
 * The workflow body runs as the Workflow tool runs it: agent(), parallel(), phase(), log() and args are injected, and
 * Date / Math are replaced by guards that throw on a clock or random call. The stub runner executes only
 * `node scripts/orch-state.mjs …` and `node scripts/orch-preflight.mjs …` in the scratch project (anything else fails
 * the run); the stub builder commits and pushes real commits; the stub merger merges with git into the run branch of a
 * local bare origin. Nothing reaches GitHub. Toy plans and scenarios: tools/fixtures/orchestrator/plans.mjs.
 *
 * Asserts: the diamond merges in wave order with the anchored subjects; a gate failure is fixed in round 1; an
 * environment failure costs no round and is retried once after the environment check; a finder's pass: true next to
 * a major problem is a fail; status.json on the run branch lists every plan with state, round, sha and model per
 * agent; origin/main never moves; the merge folder ends clean; a plan reaching maxFixRounds is parked and stops the
 * wave; escalation (judgment start tier, ESCALATE → fresh judgment builder with the hand-off file, second finding →
 * judgment); a relaunch rebuilds the done set from git and redoes no merged plan; the workflow script has no file,
 * git or clock call; every state write is an orch-state.mjs command.
 * The [ui] tier (plan 018), against a local test server this script starts as a child process (killed at the end): a
 * passing card script lands in status.json and the report grid with its screenshot and never reaches the browser
 * agent; a failing one goes to the browser agent with the pre-checked list and comes back as plan drift, reported in
 * its own section with no severity; a page server down, a failing login and a backend the page's origin cannot reach
 * each stop before the browser agent with the reason in status.json and no fix round.
 * Plan 020: a [ui] card test that is not an allowed check is dropped with a run note; a card title covers only the
 * [ui] item it equals; a [ui] bullet outside the Done-when sections is no item; a dev server that does not start
 * (commands.dev set, a stub slot-serve exiting 1) stops the run at the preflight, before any builder.
 * The scripts' package (picomatch) is copied from --deps-from, else from the kit's own scripts/node_modules, else
 * installed with npm (network). Exit 0 = every case passed, 1 = failures (one line per case).
 */
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, realpathSync, cpSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, dirname } from 'path'
import { spawnSync, spawn } from 'child_process'
import net from 'net'
import { fileURLToPath } from 'url'
import { PLANS, fileName } from './fixtures/orchestrator/plans.mjs'

const kit = resolve(fileURLToPath(new URL('..', import.meta.url)))
const argv = process.argv.slice(2)
const keep = argv.includes('--keep')
const depsFrom = argv.includes('--deps-from') ? argv[argv.indexOf('--deps-from') + 1] : null
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'kit-orch-')))
const proj = join(root, 'orch-app')
const origin = join(root, 'origin.git')
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'kit-orch', GIT_AUTHOR_EMAIL: 'kit-orch@example.invalid',
  GIT_COMMITTER_NAME: 'kit-orch', GIT_COMMITTER_EMAIL: 'kit-orch@example.invalid',
  GIT_TERMINAL_PROMPT: '0',
}
delete env.ORCH_FREE_GB
for (const k of ['ORCH_UI_LOGIN_URL', 'ORCH_UI_API_URL', 'ORCH_QA_USER', 'ORCH_QA_PASSWORD']) delete env[k]
const results = []
let failed = 0
const check = (name, ok, evidence) => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${evidence}`}`)
  if (!ok) failed++
  return ok
}
const sh = (cmd, args, cwd, extraEnv = {}) => {
  const r = spawnSync(cmd, args, { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8' })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, stdout: r.stdout ?? '' }
}
const git = (cwd, ...a) => sh('git', a, cwd)
const tail = (s) => String(s).trim().split(/\r?\n/).slice(-3).join(' | ')

// ---------------------------------------------------------------------------------------------- the scratch project
function setup() {
  git(root, 'init', '-q', '--bare', '-b', 'main', origin)
  git(root, 'init', '-q', '-b', 'main', proj)
  git(proj, 'config', 'user.name', 'kit-orch')
  git(proj, 'config', 'user.email', 'kit-orch@example.invalid')
  writeFileSync(join(proj, 'package.json'), `${JSON.stringify({ name: 'orch-app', private: true, scripts: { build: 'node -e ""', lint: 'node -e ""', test: 'node -e ""' } }, null, 2)}\n`)
  writeFileSync(join(proj, 'kit.config.json'), `${JSON.stringify({
    project: { name: 'orch-app', repoName: 'orch-app' }, stack: { packs: [] },
    commands: { build: 'build', lint: 'lint', test: 'test' }, hooks: { shellPath: 'bash' },
    models: { judgment: 'opus' }, orchestrator: { maxFixRounds: 2, minFreeDiskGb: 0, pilotSize: 0 },
  }, null, 2)}\n`)
  const inst = sh(process.execPath, [join(kit, 'tools', 'install.mjs'), '--target', proj, '--source', kit], proj)
  if (!check('install the kit into a scratch project', inst.status === 0 && /KIT_INSTALL: ok/.test(inst.out), tail(inst.out))) return false
  for (const f of ['.claude/workflows/orchestrate.js', '.claude/commands/orchestrate.md', 'docs/agent/orchestrator.md', 'scripts/orch-state.mjs', 'scripts/orch-preflight.mjs']) {
    if (!check(`installed ${f}`, existsSync(join(proj, f)), 'missing')) return false
  }
  const deps = [depsFrom, join(kit, 'scripts', 'node_modules')].find((d) => d && existsSync(join(d, 'picomatch')))
  if (deps) cpSync(deps, join(proj, 'scripts', 'node_modules'), { recursive: true })
  else {
    const n = spawnSync('npm install --no-audit --no-fund', { cwd: join(proj, 'scripts'), env, encoding: 'utf8', shell: true })
    if (!check('npm install inside scripts/ (no local copy of the packages)', n.status === 0, tail(`${n.stdout}${n.stderr}`))) return false
  }
  // A real project ignores node_modules in its .gitignore; the scratch one has none, so the merge folder's packages
  // (init installs them, plan 029) and a provisioned slot would look like uncommitted files.
  writeFileSync(join(proj, '.git', 'info', 'exclude'), `${readFileSync(join(proj, '.git', 'info', 'exclude'), 'utf8')}\nnode_modules\n`)
  mkdirSync(join(proj, 'plans'), { recursive: true })
  // Plan 032: the project script the toy plan 206's [auto:main] item names exists (readiness drops a check whose file is missing).
  writeFileSync(join(proj, 'scripts', 'log-ok.mjs'), 'process.exit(0)\n')
  for (const nnn of Object.keys(PLANS)) writeFileSync(join(proj, fileName(nnn)), PLANS[nnn])
  git(proj, 'add', '-A')
  const c = git(proj, 'commit', '-q', '-m', 'chore: install the kit and the toy plans')
  git(proj, 'remote', 'add', 'origin', origin)
  const p = git(proj, 'push', '-q', '-u', 'origin', 'main')
  return check('first commit pushed to the scratch origin', c.status === 0 && p.status === 0, tail(c.out + p.out))
}

// ------------------------------------------------------------------------------------------------------ stub agents
const calls = []
const runnerCommands = []
let phase2 = false
// Run zeta (the security follow-up): the next gate call leaves out its last result; the builder of 501 reports cards
// with values set must refuse.
let gateDrop = false
// Plan 029: the next call of this agent type returns null (a dead agent) — once.
let dieOnce = null
// Plan 033: the stub runner's next copy of a `worktree` ORCH_JSON line for this run gets a smart quote — once.
let garbleWorktreeOnce = null
const count = {}
const bump = (key) => (count[key] = (count[key] ?? 0) + 1)

function taskOf(prompt) {
  const o = {}
  for (const line of String(prompt).split('\n')) {
    const m = /^([A-Z_]+): (.*)$/.exec(line)
    if (m) o[m[1]] = m[2]
  }
  return o
}
const json = (v) => {
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}
// Split a runner command the way bash would for the quoting the workflow uses (plain words and "double quotes").
function words(cmd) {
  const out = []
  const re = /"([^"]*)"|(\S+)/g
  let m
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2])
  return out
}

function stubRunner(t) {
  const command = t.COMMAND
  runnerCommands.push(command)
  const w = words(command)
  if (w[0] !== 'node' || !['scripts/orch-state.mjs', 'scripts/orch-preflight.mjs'].includes(w[1])) {
    return { exitCode: 127, output: `stub runner refuses: ${command}` }
  }
  const r = sh(process.execPath, w.slice(1), t.FOLDER)
  if (garbleWorktreeOnce && w[2] === 'worktree' && w.includes(`--run=${garbleWorktreeOnce}`)) {
    garbleWorktreeOnce = null
    return { exitCode: r.status ?? 1, output: r.out.replace(/ORCH_JSON \{"/, 'ORCH_JSON {“') }
  }
  return { exitCode: r.status ?? 1, output: r.out }
}

const MODEL_OF = (opts) => opts.model ?? (opts.agentType ? { 'orch-builder': 'sonnet', 'orch-readiness': 'opus', 'orch-gate': 'haiku', 'kit-runner': 'haiku' }[opts.agentType] ?? 'sonnet' : 'session-model')
const base = (role, opts) => ({ role, model: MODEL_OF(opts), effort: opts.effort ?? 'medium' })

// The [ui] cards each 4xx builder reports (pages on the local test server; UI is set once the server is up).
const UI = { base: '', dead: '', api: '' }
// Card tests pass the same allowlist as extra checks (node tools/…); the stub UI gate passes the ui-pass one.
const PASS_TEST = 'node tools/ui-pass.mjs'
const FAIL_TEST = 'node tools/ui-fail.mjs'
const BAD_TEST = 'node -e "process.exit(0)"'
const UI_CARDS = {
  '401': () => [
    { card: 'Save shows Saved', page: `${UI.base}/settings`, test: PASS_TEST, screenshot: 'screens/401-1.png' },
    { card: 'Error shows Error', page: `${UI.base}/settings`, test: FAIL_TEST, screenshot: 'screens/401-2.png' },
    { card: 'The colour looks right', page: `${UI.base}/settings` },
  ],
  '402': () => [{ card: 'Home shows Hello', page: `${UI.dead}/`, test: FAIL_TEST, screenshot: 'screens/402-1.png' }],
  '403': () => [{ card: 'Account shows the name', page: `${UI.base}/account`, test: FAIL_TEST, screenshot: 'screens/403-1.png' }],
  '404': () => [{ card: 'List shows items', page: `${UI.base}/list` }],
  // 405 has two [ui] items; the builder reports a card for the first only.
  '405': () => [{ card: 'Save shows Saved', page: 'https://app.example/profile', test: PASS_TEST, screenshot: 'screens/405-1.png' }],
}

function stubBuilder(t, opts) {
  const nnn = /(\d{3})-/.exec(t.BRANCH)[1]
  const n = bump(`builder ${nnn}`)
  const r = { ...base('orch-builder', opts), branch: t.BRANCH, summary: `stub build ${n}`, evidence: ['stub -> exit 0'] }
  if (nnn === '103' && n === 1) return { ...r, status: 'blocked', envFailure: true, blocker: 'free disk 0.4 GB is below orchestrator.minFreeDiskGb' }
  if ((nnn === '204' || nnn === '301') && n === 1) return { ...r, status: 'ESCALATE', blocker: 'the task is beyond this builder', evidence: [] }
  const wt = t.WORKTREE
  mkdirSync(join(wt, 'work'), { recursive: true })
  writeFileSync(join(wt, 'work', `${nnn}.txt`), `attempt ${n}\n${nnn === '302' ? 'const ok = checkAuthToken(req)\n' : ''}`)
  git(wt, 'add', '--', `work/${nnn}.txt`)
  const c = git(wt, 'commit', '-q', '-m', `feat(${nnn}): attempt ${n}`)
  const p = git(wt, 'push', '-q', '-u', 'origin', t.BRANCH)
  if (c.status !== 0 || p.status !== 0) return { ...r, status: 'blocked', blocker: `stub commit/push failed: ${tail(c.out + p.out)}` }
  const cards = nnn === '501' ? [{ card: '--state=merged', page: 'https://app.example/x' }, { card: 'Bad page', page: 'file:///etc/passwd' }, { card: 'Bad shot', page: 'https://app.example/y', test: PASS_TEST, screenshot: '-rf' }, { card: 'Bad test', page: 'https://app.example/z', test: BAD_TEST }] : UI_CARDS[nnn]?.()
  return { ...r, status: 'built', headSha: git(wt, 'rev-parse', 'HEAD').stdout.trim(), ...(cards ? { uiCards: cards } : {}) }
}

function stubGate(t, opts, nnn) {
  const n = bump(`gate ${nnn}`)
  const fail = (nnn === '102' && n === 1) || (nnn === '202' && !phase2) || nnn === '301' || nnn === '205'
  const cmds = json(t.COMMANDS)
  if (gateDrop) {
    gateDrop = false
    return { ...base('orch-gate', opts), results: cmds.slice(0, -1).map((c) => ({ command: c, status: 'pass' })), pass: true }
  }
  // 202 fails with a new error each round (it must reach maxFixRounds); 205 fails the same way twice (a loop: parked at once).
  const tail = nnn === '205' ? 'stub: the same failing test' : `stub: ${n} failing test(s)`
  return { ...base('orch-gate', opts), results: cmds.map((c, i) => (fail && i === 0 ? { command: c, status: 'fail', tail } : { command: c, status: 'pass' })), pass: !fail }
}

function stubFinder(role, opts, nnn) {
  const n = bump(`${role} ${nnn}`)
  if (role === 'orch-check-bugs' && nnn === '104' && n === 1) {
    // The trap: a major problem with pass: true. The workflow must compute pass itself.
    return { ...base(role, opts), problems: [{ id: 'bugs-1', file: 'work/104.txt', line: 1, rule: 'runtime: wrong value', reasoning: 'the file says attempt 1, the plan wants the fixed value', severity: 'major' }], pass: true }
  }
  return { ...base(role, opts), problems: [], pass: true }
}

function stubVerify(t, opts) {
  const cands = json(t.CANDIDATES)
  return { ...base('orch-verify', opts), verdicts: cands.map((c) => ({ id: c.id, verdict: 'keep', confidence: 90, severity: c.severity, note: 'stub keeps it' })) }
}

function stubMerge(t, opts) {
  // Plan 029 (A14): the first merge of 405 fails on the environment (a real run's merge folder had no packages).
  if (t.PLAN_NUMBER === '405' && bump('merge-env 405') === 1) return { ...base('orch-merge', opts), merged: false, envFailure: true, reason: "stub: 'ng' is not recognized" }
  const mf = t.MERGE_FOLDER
  const steps = [
    ['fetch', '-q', 'origin'],
    ['merge', '-q', '--ff-only', `origin/${t.RUN_BRANCH}`],
    ['merge', '-q', '--no-ff', '--no-commit', `origin/${t.PLAN_BRANCH}`],
    ['commit', '-q', '-m', t.SUBJECT],
    ['push', '-q', 'origin', t.RUN_BRANCH],
  ]
  for (const s of steps) {
    const r = git(mf, ...s)
    if (r.status !== 0) {
      git(mf, 'merge', '--abort')
      return { ...base('orch-merge', opts), merged: false, reason: `git ${s.join(' ')} -> exit ${r.status}: ${tail(r.out)}` }
    }
  }
  return { ...base('orch-merge', opts), merged: true, sha: git(mf, 'rev-parse', 'HEAD').stdout.trim() }
}

async function agent(prompt, opts = {}) {
  const t = taskOf(prompt)
  const type = opts.agentType ?? null
  const nnn = (/plan (\d{3})/.exec(prompt) ?? [])[1] ?? null
  const role = type ?? (/\.claude\/agents\/(orch-[\w-]+)\.md/.exec(prompt) ?? [])[1]
  calls.push({ type, role, nnn, model: opts.model ?? null, label: opts.label, mode: t.MODE ?? null, tier: t.TIER ?? null, handoff: t.HANDOFF ?? null, findings: t.FINDINGS ? json(t.FINDINGS) : null, cards: t.CARDS ? json(t.CARDS) : null, pre: t.PRE_CHECKED ? json(t.PRE_CHECKED) : null, known: t.KNOWN_FINDINGS ? json(t.KNOWN_FINDINGS) : null, commands: t.COMMANDS ? json(t.COMMANDS) : null, checks: t.CHECKS ? json(t.CHECKS) : null, folder: t.FOLDER ?? null, plan: opts.plan ?? null })
  if (dieOnce && type === dieOnce) {
    dieOnce = null
    return null
  }
  if (type === 'kit-runner') return stubRunner(t)
  if (role === 'orch-builder') return stubBuilder(t, opts)
  if (type === 'orch-gate' && /^ui-gate /.test(opts.label ?? '')) {
    // The [ui] cards' own tests: pass or fail by the exit code the test command names.
    return { ...base('orch-gate', opts), results: json(t.COMMANDS).map((c) => (c === PASS_TEST ? { command: c, status: 'pass' } : { command: c, status: 'fail', tail: 'stub: expected "Error", page shows "Problem"' })) }
  }
  if (type === 'orch-gate') return stubGate(t, opts, nnn)
  if (['orch-check-plan', 'orch-check-bugs', 'orch-check-rules', 'orch-security'].includes(type)) return stubFinder(type, opts, nnn)
  if (type === 'orch-verify') return stubVerify(t, opts)
  if (type === 'orch-ui' && t.CARDS) {
    // The browser look: an "Error" card shows other wording (plan drift); the rest pass.
    const cards = json(t.CARDS).map((c, i) => ({ card: c.card, page: c.page, status: /Error/.test(c.card) ? 'plan-drift' : 'pass', screenshots: [`screens/${nnn}-browser-${i + 1}.png`] }))
    return { ...base('orch-ui', opts), cards, pass: cards.every((c) => c.status === 'pass') }
  }
  if (type === 'orch-ui') return { ...base('orch-ui', opts), cards: [{ card: '1 Saved shows', status: 'pass', page: 'https://app.example/settings', screenshots: [`screens/${nnn}-1.png`] }], pass: true }
  if (type === 'orch-merge') return stubMerge(t, opts)
  // Plan 032: plan 206 has a main-folder command and one that may not run there (a package.json script); plan 034:
  // only that plan, so the other runs still have nothing to ask.
  if (type === 'orch-readiness') return { ...base('orch-readiness', opts), plans: [{ plan: t.PLAN, state: 'ready', questions: [], envNeeds: [], commands: ['node --test', 'git reset --hard HEAD'], mainCommands: /\/206-/.test(t.PLAN ?? '') ? ['node scripts/log-ok.mjs --since=15m', 'npm run build'] : [] }] }
  throw new Error(`stub: no agent for ${type ?? role} (${opts.label})`)
}
const parallel = (thunks) => Promise.all(thunks.map((th) => Promise.resolve().then(th).catch((e) => {
  results.push(`NOTE  a parallel task threw: ${e.message}`)
  return null
})))
const pipeline = async (items, ...stages) => Promise.all(items.map(async (item, i) => {
  let v = item
  for (const s of stages) v = await s(v, item, i)
  return v
}))

class GuardDate extends Date {
  constructor(...a) {
    if (!a.length) throw new Error('workflow script called new Date() without arguments')
    super(...a)
  }
  static now() {
    throw new Error('workflow script called Date.now()')
  }
}
const GuardMath = Object.create(Math, { random: { value: () => { throw new Error('workflow script called Math.random()') } } })

const workflowFile = () => join(proj, '.claude', 'workflows', 'orchestrate.js')
async function runWorkflow(args) {
  const src = readFileSync(workflowFile(), 'utf8').replace(/^export const meta\s*=/m, 'const meta =')
  const AsyncFunction = (async () => {}).constructor
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', 'Date', 'Math', 'require', 'process', src)
  const budget = { total: null, spent: () => 0, remaining: () => Infinity }
  return fn(agent, parallel, pipeline, () => {}, () => {}, args, budget, () => { throw new Error('nested workflow') }, GuardDate, GuardMath, undefined, undefined)
}

// The local test server for the [ui] cases: pages answer 200, /login-bad 401, /api-cors allows the caller's origin,
// /api-nocors sends no Access-Control-Allow-Origin. A child process, because the stub runner blocks this one; it exits
// on its own after 10 minutes if it is not killed.
const UI_SERVER = `import http from 'http'
const s = http.createServer((req, res) => {
  if (req.url.startsWith('/login-bad')) { res.writeHead(401); return res.end('no') }
  if (req.url.startsWith('/api-cors')) { res.writeHead(200, { 'access-control-allow-origin': req.headers.origin ?? '*' }); return res.end('{}') }
  if (req.url.startsWith('/api-nocors')) { res.writeHead(200); return res.end('{}') }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h1>ok</h1>')
})
s.listen(0, () => console.log('PORT ' + s.address().port))
setTimeout(() => process.exit(0), 10 * 60 * 1000)
`
function startUiServer() {
  const file = join(root, 'ui-server.mjs')
  writeFileSync(file, UI_SERVER)
  const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'inherit'] })
  return new Promise((done, fail) => {
    let buf = ''
    child.stdout.on('data', (d) => {
      buf += d
      const m = /PORT (\d+)/.exec(buf)
      if (m) done({ child, port: Number(m[1]) })
    })
    child.once('exit', (code) => fail(new Error(`the UI test server exited (${code})`)))
  })
}
// A port nothing listens on: bind, read, close.
function deadPort() {
  return new Promise((done) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => done(port))
    })
  })
}

// ------------------------------------------------------------------------------------------------------- the cases
const subjects = (branch) => git(proj, 'log', '--reverse', '--first-parent', '--format=%s', `origin/${branch}`).stdout.split('\n').filter((s) => /^Merge /.test(s))
const statusOnBranch = (run) => {
  const r = git(proj, 'show', `origin/orch/${run}:docs/orchestrator/runs/${run}/status.json`)
  try {
    return JSON.parse(r.stdout)
  } catch {
    return null
  }
}
const builderCalls = (nnn) => calls.filter((c) => c.role === 'orch-builder' && c.nnn === nnn)
const SUBJECT = (run, nnn) => new RegExp(`^Merge feat/${nnn}-\\S+ into orch/${run} \\(plan ${nnn}\\)$`)

async function main() {
  if (!setup()) return
  const mainBefore = git(origin, 'rev-parse', 'main').stdout.trim()

  // Static: the workflow script has no file, git or clock call.
  // The same pattern as `grep -nE 'Date.now|new Date\(\)|require\(|import .*fs|child_process'` (exit 1 = none), in JS
  // so it runs where no grep is on the PATH.
  const FORBIDDEN = /Date.now|new Date\(\)|require\(|import .*fs|child_process/
  const hits = readFileSync(workflowFile(), 'utf8').split(/\r?\n/).map((l, i) => [i + 1, l]).filter(([, l]) => FORBIDDEN.test(l))
  check('orchestrate.js has no file, git or clock call (no line matches the forbidden pattern)', hits.length === 0, hits.map(([n, l]) => `${n}: ${l.trim()}`).join(' | '))

  // Readiness: one agent per plan, the waves, a deny-listed command dropped and named.
  const ready = await runWorkflow({ mode: 'readiness', run: 'alpha', plans: ['101', '102', '103', '104'], root: proj })
  check('readiness: waves 101 | 102, 103 | 104', JSON.stringify(ready?.waves) === JSON.stringify([['101'], ['102', '103'], ['104']]), JSON.stringify(ready?.waves))
  check('readiness: one readiness agent per plan', calls.filter((c) => c.type === 'orch-readiness').length === 4, String(calls.filter((c) => c.type === 'orch-readiness').length))
  check('readiness: a deny-listed command is dropped and named', ready?.plans?.every((p) => p.denied.length === 1 && p.denied[0] === 'git reset --hard HEAD' && !p.commands.some((c) => /reset --hard/.test(c))), JSON.stringify(ready?.plans?.[0]))
  check('readiness: the preflight result comes back', ready?.preflight?.ok === true, JSON.stringify(ready?.preflight))
  check('readiness: nothing to ask → askHuman false, no main-folder command listed (the command starts the run without go)', ready?.askHuman === false && JSON.stringify(ready?.mainApproval) === '[]', JSON.stringify({ askHuman: ready?.askHuman, mainApproval: ready?.mainApproval }))
  // Plan 034: a plan with an [auto:main] item — its command is kept under mainCommands (a package.json script is not
  // allowed there), listed for the Human under mainApproval, and makes askHuman true although nothing else is open.
  const MAIN_CMD = 'node scripts/log-ok.mjs --since=15m'
  const readyMain = await runWorkflow({ mode: 'readiness', run: 'iota', plans: ['206'], root: proj })
  const rm206 = readyMain?.plans?.[0]
  check('readiness: a main-folder command is kept under mainCommands, a package.json script is not allowed there', JSON.stringify(rm206?.mainCommands) === JSON.stringify([MAIN_CMD]) && rm206?.denied[1] === 'npm run build' && /only node scripts/.test(rm206?.deniedWhy[1] ?? ''), JSON.stringify(rm206))
  check('readiness: a main-folder command is listed for the Human and makes askHuman true', readyMain?.askHuman === true && JSON.stringify(readyMain?.mainApproval) === JSON.stringify([`206: ${MAIN_CMD}`]), JSON.stringify({ askHuman: readyMain?.askHuman, mainApproval: readyMain?.mainApproval }))
  // A5: a check file that exists nowhere (and that the plan does not create) is dropped with the reason and makes askHuman true.
  const gone = sh(process.execPath, ['scripts/orch-state.mjs', 'check-files', '--plan=101', '--files=scripts/log-ok.mjs,tools/leak-check.mjs'], proj)
  check('check-files: a file that exists passes, one that exists nowhere is named as missing', gone.status === 0 && /"missing":\["tools\/leak-check\.mjs"\]/.test(gone.out), tail(gone.out))
  const unsafe = sh(process.execPath, ['scripts/orch-state.mjs', 'check-files', '--plan=101', '--files=../x.mjs'], proj)
  check('check-files: an unsafe path is refused', unsafe.status === 1 && /safe relative paths/.test(unsafe.out), tail(unsafe.out))

  // Run alpha: the diamond.
  const a = await runWorkflow({ mode: 'run', run: 'alpha', plans: ['101', '102', '103', '104'], root: proj })
  const sa = subjects('orch/alpha')
  // Plan 029: the merge folder has its packages (the merge step builds there), the run branch starts with its own empty
  // commit, and the start time is init's clock.
  const mfA = join(root, 'orch-app-orch-merge-alpha')
  check('alpha: init installed the merge folder\'s scripts packages (picomatch) and said so', existsSync(join(mfA, 'scripts', 'node_modules', 'picomatch')) && !existsSync(join(proj, '.git', 'modules')), `picomatch ${existsSync(join(mfA, 'scripts', 'node_modules', 'picomatch'))}`)
  const firstOnRun = git(proj, 'log', '--reverse', '--first-parent', '--format=%s', 'origin/main..origin/orch/alpha').stdout.split('\n')[0]
  check('alpha: the run branch starts with its own empty commit "orch(alpha): run start"', firstOnRun === 'orch(alpha): run start', firstOnRun)
  check('alpha: the preflight was given the run\'s plans', runnerCommands.some((c) => c === 'node scripts/orch-preflight.mjs --run alpha --plans 101,102,103,104'), runnerCommands.filter((c) => /preflight/.test(c)).join(' | '))
  const order = sa.map((s) => (/\(plan (\d+)\)$/.exec(s) ?? [])[1])
  check('alpha: four merges with the anchored subject', sa.length === 4 && sa.every((s, i) => SUBJECT('alpha', order[i]).test(s)), sa.join(' | '))
  check('alpha: merged in wave order (101 first, 104 last)', order[0] === '101' && order[3] === '104' && new Set(order.slice(1, 3)).size === 2 && order.slice(1, 3).every((n) => ['102', '103'].includes(n)), order.join(','))
  const st = statusOnBranch('alpha')
  check('alpha: status.json on the run branch lists every plan merged with round, sha and models', !!st && ['101', '102', '103', '104'].every((n) => st.plans[n]?.state === 'merged' && /^[0-9a-f]{40}$/.test(st.plans[n].sha ?? '') && Number.isInteger(st.plans[n].round) && st.plans[n].models?.['orch-builder']?.model && st.plans[n].models?.['orch-merge']?.model && st.plans[n].models?.['orch-gate']?.model), JSON.stringify(st?.plans?.['101']))
  check('alpha: rounds 101=0, 102=1, 103=0, 104=1', !!st && st.plans['101'].round === 0 && st.plans['102'].round === 1 && st.plans['103'].round === 0 && st.plans['104'].round === 1, st ? ['101', '102', '103', '104'].map((n) => st.plans[n].round).join(',') : 'no status')
  check('alpha: 102 fixed by the same build-tier builder in round 1', builderCalls('102').map((c) => `${c.tier}/${c.mode}`).join(',') === 'build/first,build/fix' && builderCalls('102')[1].findings?.length === 1, JSON.stringify(builderCalls('102')))
  check('alpha: 103 environment failure retried once after the env check (which names the run), no fix round', builderCalls('103').map((c) => `${c.tier}/${c.mode}`).join(',') === 'build/first,build/env-retry' && runnerCommands.some((c) => c === 'node scripts/orch-preflight.mjs --env-only --run alpha'), builderCalls('103').map((c) => c.mode).join(','))
  check('alpha: 104 pass: true next to a major is a fail, sent back with the finding', builderCalls('104').length === 2 && builderCalls('104')[1].mode === 'fix' && builderCalls('104')[1].findings?.[0]?.severity === 'major' && (st?.notes ?? []).some((n) => /pass: true next to a major/.test(n.text)), JSON.stringify(builderCalls('104')[1]))
  check('alpha: origin/main unchanged', git(origin, 'rev-parse', 'main').stdout.trim() === mainBefore, 'main moved')
  check('alpha: the merge folder has no uncommitted files', existsSync(mfA) && git(mfA, 'status', '--porcelain').stdout.trim() === '', git(mfA, 'status', '--porcelain').stdout)
  check('alpha: the report is on the run branch and copied to the main folder', a?.ok === true && a.reportCommitted === true && git(proj, 'cat-file', '-e', 'origin/orch/alpha:docs/orchestrator/runs/alpha/report.md').status === 0 && existsSync(join(proj, '.claude', 'orchestrator-runs', 'alpha.md')) && /What only the Human can do/.test(readFileSync(join(proj, '.claude', 'orchestrator-runs', 'alpha.md'), 'utf8')), JSON.stringify(a))
  check('alpha: startedAt is init\'s own clock (an ISO time, no args value)', !!st && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(st.startedAt ?? '') && Date.now() - Date.parse(st.startedAt) < 60 * 60 * 1000 && a?.startedAt === st.startedAt, `${st?.startedAt} / ${a?.startedAt}`)
  check('alpha: the main folder stays clean (status and report copy are gitignored)', git(proj, 'status', '--porcelain').stdout.trim() === '', git(proj, 'status', '--porcelain').stdout)

  // Run beta, first launch: fix rounds, escalation, the wave gate.
  const b1 = await runWorkflow({ mode: 'run', run: 'beta', plans: ['201', '202', '203', '204'], root: proj })
  const sb = subjects('orch/beta').map((s) => (/\(plan (\d+)\)$/.exec(s) ?? [])[1])
  check('beta 1: 201 and 204 merged, 202 parked, 203 not started', sb.length === 2 && sb.includes('201') && sb.includes('204') && b1?.parked?.includes('202') && builderCalls('203').length === 0, `${sb.join(',')} ${JSON.stringify(b1?.parked)}`)
  const s1 = JSON.parse(readFileSync(join(proj, '.claude', 'orchestrator-runs', 'beta', 'status.json'), 'utf8'))
  check('beta 1: 202 parked at maxFixRounds with its reason', s1.plans['202']?.state === 'parked' && /fix rounds used: 2 of 2/.test(s1.plans['202'].reason ?? ''), JSON.stringify(s1.plans['202']))
  check('beta 1: 203 marked skipped, the run stopped after wave 1', s1.plans['203']?.state === 'skipped' && /wave 1 parked 202/.test(s1.stopReason ?? ''), `${s1.plans['203']?.state} ${s1.stopReason}`)
  check('beta 1: 202 builders build → build (findings) → fresh judgment with the hand-off file', builderCalls('202').map((c) => `${c.tier}/${c.mode}/${c.model ?? '-'}`).join(',') === 'build/first/-,build/fix/-,judgment/handoff/opus' && existsSync(join(proj, '.claude', 'sessions', 'orch-beta', 'handoff-202.md')) && /^Failing check: /m.test(readFileSync(join(proj, '.claude', 'sessions', 'orch-beta', 'handoff-202.md'), 'utf8')), builderCalls('202').map((c) => `${c.tier}/${c.mode}/${c.model}`).join(','))
  check('beta 1: 201 (names INV-1) starts on the judgment tier', builderCalls('201')[0]?.tier === 'judgment' && builderCalls('201')[0]?.model === 'opus' && s1.plans['201'].models?.['orch-builder']?.model === 'opus', JSON.stringify(builderCalls('201')[0]))
  check('beta 1: 204 ESCALATE → fresh judgment builder with the hand-off file, merged in round 1', builderCalls('204').map((c) => `${c.tier}/${c.mode}`).join(',') === 'build/first,judgment/handoff' && s1.plans['204'].round === 1 && s1.plans['204'].state === 'merged', JSON.stringify(builderCalls('204')))

  // Run beta, relaunch: the done set comes from git; merged plans are not redone.
  phase2 = true
  const before = { b201: builderCalls('201').length, b204: builderCalls('204').length }
  // Plan 029: the rules finder of the relaunch dies once (returns null) → retried once on the fallback model.
  dieOnce = 'orch-check-rules'
  const b2 = await runWorkflow({ mode: 'run', run: 'beta', plans: ['201', '202', '203', '204'], root: proj })
  const sb2 = subjects('orch/beta').map((s) => (/\(plan (\d+)\)$/.exec(s) ?? [])[1])
  const dead = calls.filter((c) => c.type === 'orch-check-rules')
  const deadPlan = dead.find((c) => c.model === 'opus')?.nnn
  const deadCalls = dead.filter((c) => c.nnn === deadPlan)
  const s2notes = statusOnBranch('beta')?.notes ?? []
  check('beta 2: a dead finder is retried once on the fallback model (opus), with a run note naming both models, and not a third time', !!deadPlan && deadCalls.length === 2 && deadCalls[0].model === null && deadCalls[1].model === 'opus' && s2notes.some((n) => n.plan === deadPlan && n.text === `model fallback: check-rules ${deadPlan} agent default → opus`), JSON.stringify({ deadPlan, models: deadCalls.map((c) => c.model), notes: s2notes.filter((n) => /fallback/.test(n.text)) }))
  check('beta 2: relaunch merges 202 and 203 after 201 and 204', sb2.length === 4 && new Set(sb2.slice(0, 2)).size === 2 && sb2.slice(2).every((n) => ['202', '203'].includes(n)) && new Set(sb2.slice(2)).size === 2, sb2.join(','))
  check('beta 2: no builder ran again for the merged 201 and 204', builderCalls('201').length === before.b201 && builderCalls('204').length === before.b204, JSON.stringify(before))
  const s2 = statusOnBranch('beta')
  check('beta 2: status.json shows all four merged after two attempts', !!s2 && s2.attempts === 2 && ['201', '202', '203', '204'].every((n) => s2.plans[n].state === 'merged') && !s2.plans['202'].reason && s2.plans['202'].earlier?.[0]?.state === 'parked', JSON.stringify(s2 && Object.values(s2.plans).map((p) => `${p.nnn}:${p.state}`)))
  check('beta 2: the run result counts come from git', JSON.stringify((b2?.merged ?? []).slice().sort()) === JSON.stringify(['201', '202', '203', '204']), JSON.stringify(b2?.merged))
  // Run gamma: the UI step on; an ESCALATE then a judgment-tier failure parks at round 1; auth code in a plain path.
  const g = await runWorkflow({ mode: 'run', run: 'gamma', plans: ['301', '302'], ui: true, root: proj })
  const sg = JSON.parse(readFileSync(join(proj, '.claude', 'orchestrator-runs', 'gamma', 'status.json'), 'utf8'))
  const b301 = builderCalls('301').map((c) => `${c.tier}/${c.mode}`).join(',')
  check('gamma: 301 ESCALATE → judgment builder fails → parked at round 1 of 2 (judgment + escalated)', b301 === 'build/first,judgment/handoff' && sg.plans['301']?.state === 'parked' && sg.plans['301'].round === 1 && /fix rounds used: 1 of 2/.test(sg.plans['301'].reason ?? '') && !!g?.parked?.includes('301'), `${b301} ${JSON.stringify(sg.plans['301'])}`)
  const card = sg.plans['302']?.uiCards?.[0]
  check('gamma: 302 merged with its UI card (page, status, screenshot) in status.json', sg.plans['302']?.state === 'merged' && sg.plans['302'].uiCards.length === 1 && card.page === 'https://app.example/settings' && card.status === 'pass' && card.screenshots[0] === 'screens/302-1.png', JSON.stringify(sg.plans['302']?.uiCards))
  const gReport = join(proj, '.claude', 'orchestrator-runs', 'gamma.md')
  const rg = existsSync(gReport) ? readFileSync(gReport, 'utf8') : ''
  check('gamma: the report groups the validation list by page with the evidence', rg.includes('### https://app.example/settings\n\n| # | Card | Verdict | Screenshot |\n| --- | --- | --- | --- |\n| 1 | 302: 1 Saved shows | pass — browser, round 0 | [![1 Saved shows](screens/302-1.png)](screens/302-1.png) |') && rg.includes('2. 302 UI checked and auth code: Open work/302.txt'), (rg.split('## What only the Human can do')[1] ?? rg).slice(0, 400))
  const sec = calls.filter((c) => c.type === 'orch-security').map((c) => c.nnn)
  check('gamma: orch-security runs for added auth code in a plain path, and only there', sec.length > 0 && sec.every((n) => n === '302'), JSON.stringify(sec))
  check('beta: origin/main unchanged', git(origin, 'rev-parse', 'main').stdout.trim() === mainBefore, 'main moved')

  // Run epsilon (UI step off): a [ui] item the builder reported no card for is still recorded and reaches the Human.
  const e = await runWorkflow({ mode: 'run', run: 'epsilon', plans: ['405'], root: proj })
  const se = JSON.parse(readFileSync(join(proj, '.claude', 'orchestrator-runs', 'epsilon', 'status.json'), 'utf8'))
  const eCard = (title) => (se.plans['405']?.uiCards ?? []).find((c) => c.card === title)
  check('epsilon: 405 merged; its reported card passed by script, the left-out [ui] items are recorded unchecked', e?.ok === true && se.plans['405']?.state === 'merged' && eCard('Save shows Saved')?.status === 'pass' && eCard('Save shows Saved').via === 'script' && eCard('Profile shows the avatar')?.status === 'unchecked' && eCard('Profile shows the avatar').via === 'none', JSON.stringify(se.plans['405']?.uiCards))
  const eMerges = calls.filter((c) => c.type === 'orch-merge' && c.nnn === '405').length
  check('epsilon: an environment failure at the merge retries the merge only — one builder, one gate, two merges, merged in round 0', se.plans['405']?.state === 'merged' && se.plans['405'].round === 0 && builderCalls('405').length === 1 && calls.filter((c) => c.type === 'orch-gate' && c.nnn === '405' && /^gate /.test(c.label ?? '')).length === 1 && eMerges === 2 && runnerCommands.includes('node scripts/orch-preflight.mjs --env-only --run epsilon') && (se.notes ?? []).some((n) => n.plan === '405' && /^environment failure \(merge: stub: 'ng' is not recognized\); the environment check passed, the merge is retried on its own/.test(n.text)), JSON.stringify({ builders: builderCalls('405').length, merges: eMerges, notes: (se.notes ?? []).filter((n) => /environment/.test(n.text)) }))
  check('epsilon: a run note names the [ui] items the builder left out', (se.notes ?? []).some((n) => n.plan === '405' && /builder reported no card for 2 \[ui\] item\(s\).*Profile shows the avatar/.test(n.text)), JSON.stringify(se.notes))
  check('epsilon: a card title covers only the item it equals — "Save shows Saved" does not cover "Save shows Saved in the header"', eCard('Save shows Saved in the header')?.status === 'unchecked', JSON.stringify(se.plans['405']?.uiCards))
  check('epsilon: a [ui] bullet in the Execution Notes is not a [ui] item', !(se.plans['405']?.uiCards ?? []).some((c) => /Not a goal/.test(c.card)) && !(se.notes ?? []).some((n) => /Not a goal/.test(n.text)), JSON.stringify(se.plans['405']?.uiCards))
  const re = readFileSync(join(proj, '.claude', 'orchestrator-runs', 'epsilon.md'), 'utf8')
  check('epsilon: the run report hands the left-out [ui] item to the Human', /\d+\. 405: Profile shows the avatar — a \[ui\] card no script could check and the browser step was off/.test(re), (re.split('## What only the Human can do')[1] ?? re).slice(0, 400))

  // Run zeta (security follow-up): extra check commands are allowlisted, a gate that leaves a check out fails, and
  // [ui] card values that could become flags or reach a shell are not recorded; orch-state takes --key=value only.
  gateDrop = true
  const zBuilders = builderCalls('501').length
  const z = await runWorkflow({ mode: 'run', run: 'zeta', plans: ['501'], root: proj,
    checks: { '501': ['npm run build', 'npm run nosuch', 'node tools/ok-check.mjs --quick', 'node --test tests/a.test.mjs', 'node -e "1"', 'node tools/x.mjs; rm -rf /', 'echo hi > x', 'git reset --hard HEAD', 'node scripts/kit-owned.mjs --write'] } })
  const sz = JSON.parse(readFileSync(join(proj, '.claude', 'orchestrator-runs', 'zeta', 'status.json'), 'utf8'))
  const zGates = calls.filter((c) => c.type === 'orch-gate' && c.nnn === '501' && /^gate /.test(c.label ?? '')).slice(-2)
  check('zeta: only allowlisted extra checks reach the gate (npm run <known script>, node tools/…, node --test)', JSON.stringify(zGates[0]?.commands) === JSON.stringify(['npm run build', 'npm run lint', 'npm run test', 'node tools/ok-check.mjs --quick', 'node --test tests/a.test.mjs']), JSON.stringify(zGates[0]?.commands))
  const zMerge = calls.filter((c) => c.type === 'orch-merge' && c.nnn === '501').at(-1)
  check('zeta: the merge step runs the build only (mergeChecks "build"), not lint, the tests or the plan\'s extra checks', JSON.stringify(zMerge?.checks) === JSON.stringify(['npm run build']), JSON.stringify(zMerge?.checks))
  const dropNote = (sz.notes ?? []).filter((n) => n.plan === '501' && /^check command dropped, not run: /.test(n.text)).map((n) => n.text).join(' | ')
  check('zeta: each dropped check command is named in a run note with its reason (a --write script among them)', ['npm run nosuch', 'node -e', 'rm -rf', 'echo hi', 'reset --hard', 'kit-owned.mjs --write: --write writes files'].every((c) => dropNote.includes(c)) && /no script nosuch in package.json/.test(dropNote), dropNote)
  // Plan 029: a result the gate lost is run again — only that command, once — and costs no fix round.
  check('zeta: a gate result left out is rerun for the missing command only, no fix round (round 0, one builder)', z?.ok === true && sz.plans['501']?.state === 'merged' && sz.plans['501'].round === 0 && builderCalls('501').length === zBuilders + 1 && zGates.length === 2 && JSON.stringify(zGates[1]?.commands) === JSON.stringify(['node --test tests/a.test.mjs']) && zGates[1].label === 'gate 501 rerun' && (sz.notes ?? []).some((n) => n.plan === '501' && n.text === 'gate rerun for 1 missing result(s): node --test tests/a.test.mjs'), JSON.stringify({ round: sz.plans['501']?.round, gates: zGates.map((c) => [c.label, c.commands]), notes: (sz.notes ?? []).filter((n) => /rerun/.test(n.text)) }))
  const zCards = (sz.plans['501']?.uiCards ?? []).map((c) => c.card)
  const cardNotes = (sz.notes ?? []).filter((n) => /\[ui\] card not recorded/.test(n.text)).map((n) => n.text).join(' | ')
  check('zeta: a card title starting with "-", a non-http page and an unsafe screenshot path are not recorded', !zCards.some((c) => c !== 'Bad test') && /starts with - or is empty/.test(cardNotes) && /not an http\(s\) URL/.test(cardNotes) && /not a safe relative path/.test(cardNotes) && sz.plans['501'].state === 'merged', `${JSON.stringify(zCards)} ${cardNotes}`)
  const zUiGates = calls.filter((c) => c.nnn === '501' && /^ui-gate /.test(c.label ?? '')).flatMap((c) => c.commands ?? [])
  const testNote = (sz.notes ?? []).filter((n) => n.plan === '501' && /^\[ui\] card test dropped, not run: /.test(n.text)).map((n) => n.text).join(' | ')
  const badTestCard = (sz.plans['501']?.uiCards ?? []).find((c) => c.card === 'Bad test')
  check('zeta: a [ui] card test that is not an allowed check never reaches the gate; a run note says why; the card is left unchecked', !zUiGates.includes(BAD_TEST) && zUiGates.includes(PASS_TEST) && /Bad test: node -e\W+process\.exit\(0\)\W+not an allowed check/.test(testNote) && badTestCard?.status === 'unchecked', JSON.stringify({ zUiGates, testNote, badTestCard }))
  const zSets = runnerCommands.filter((c) => c.startsWith('node scripts/orch-state.mjs set ') && c.includes('--run=zeta'))
  check('zeta: every orch-state argument is one --key=value token', zSets.length > 0 && runnerCommands.filter((c) => c.startsWith('node scripts/orch-state.mjs ')).every((c) => words(c).slice(3).every((w) => /^--[a-z-]+=/.test(w))), zSets[0] ?? 'none')

  // Run theta (plan 029): the same gate failure twice in a row is a loop — parked at once with the reason, no further
  // fix round, two builders only; the report and the STUCK line still come.
  const th = await runWorkflow({ mode: 'run', run: 'theta', plans: ['205'], root: proj })
  const sth = JSON.parse(readFileSync(join(proj, '.claude', 'orchestrator-runs', 'theta', 'status.json'), 'utf8'))
  check('theta: 205 parked as "same reason twice" after one fix round, two builders, the report written and STUCK returned', sth.plans['205']?.state === 'parked' && sth.plans['205'].round === 1 && /^same reason twice: gate: npm run build/.test(sth.plans['205'].reason ?? '') && builderCalls('205').length === 2 && th?.ok === true && existsSync(join(proj, '.claude', 'orchestrator-runs', 'theta.md')) && /^STUCK: /.test(th?.stuck ?? ''), JSON.stringify({ p: sth.plans['205'], builders: builderCalls('205').length, stuck: th?.stuck, ok: th?.ok }))
  const thWatch = sh(process.execPath, ['scripts/orch-state.mjs', 'watch', '--run=theta'], proj)
  check('theta: watch on the stopped run prints STOPPED with the reason and exits 0', thWatch.status === 0 && /^STOPPED: wave 1 parked 205/m.test(thWatch.out), tail(thWatch.out))

  // Run iota (plan 032): a plan with an [auto:main] item — its command runs in a second gate from the main folder
  // after the worktree gate, a package.json script is dropped from mainChecks with a note, and neither the merge
  // step nor the final gate runs it.
  // Plan 034: without the Human's approval the run does not start — no state file, no init.
  const ioRefused = await runWorkflow({ mode: 'run', run: 'iota', plans: ['206'], root: proj, mainChecks: { '206': [MAIN_CMD, 'npm run build'] } })
  check('iota: mainChecks without mainApproved stop the run before init (no status.json)', ioRefused?.ok === false && ioRefused?.stopped === 'main-approval' && ioRefused?.problems?.length === 1 &&/^plan 206 runs node scripts\/log-ok\.mjs --since=15m from the main folder/.test(ioRefused?.problems?.[0] ?? '') && !existsSync(join(proj, '.claude', 'orchestrator-runs', 'iota', 'status.json')), JSON.stringify(ioRefused))
  const io = await runWorkflow({ mode: 'run', run: 'iota', plans: ['206'], root: proj, mainChecks: { '206': [MAIN_CMD, 'npm run build'] }, mainApproved: true })
  const sio = JSON.parse(readFileSync(join(proj, '.claude', 'orchestrator-runs', 'iota', 'status.json'), 'utf8'))
  const ioGates = calls.filter((c) => c.type === 'orch-gate' && c.nnn === '206')
  const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  check('iota: the main-folder gate runs the [auto:main] command from the main folder, right after the worktree gate', ioGates.length === 2 && ioGates[0].label === 'gate 206' && norm(ioGates[0].folder) !== norm(proj) && ioGates[1].label === 'gate 206 main' && norm(ioGates[1].folder) === norm(proj) && JSON.stringify(ioGates[1].commands) === JSON.stringify([MAIN_CMD]), JSON.stringify(ioGates.map((c) => [c.label, c.folder, c.commands])))
  const ioMerge = calls.filter((c) => c.type === 'orch-merge' && c.nnn === '206').at(-1)
  const ioFinal = calls.filter((c) => c.type === 'orch-gate' && c.label === 'gate final').at(-1)
  check('iota: the merge step and the final gate never run the main-folder command; 206 merged', io?.ok === true && sio.plans['206']?.state === 'merged' && JSON.stringify(ioMerge?.checks) === JSON.stringify(['npm run build']) && !(ioFinal?.commands ?? []).includes(MAIN_CMD), JSON.stringify({ merge: ioMerge?.checks, final: ioFinal?.commands, state: sio.plans['206']?.state }))
  check('iota: a package.json script in mainChecks is dropped with a run note naming the rule', (sio.notes ?? []).some((n) => n.plan === '206' && /^main-folder check dropped, not run: npm run build: only node scripts\/… or node tools\/… run from the main folder/.test(n.text)), JSON.stringify((sio.notes ?? []).filter((n) => /dropped/.test(n.text))))

  // Run kappa (plan 033): the runner's first copy of the `worktree` state line does not parse (a smart quote) — the
  // workflow asks once more, the real second answer is used, the plan is built and merged in one folder, and a run
  // note keeps the first error with the raw line (quotes kept as ' through the state write).
  garbleWorktreeOnce = 'kappa'
  const k = await runWorkflow({ mode: 'run', run: 'kappa', plans: ['601'], root: proj })
  const sk = JSON.parse(readFileSync(join(proj, '.claude', 'orchestrator-runs', 'kappa', 'status.json'), 'utf8'))
  const kWt = runnerCommands.filter((c) => /^node scripts\/orch-state\.mjs worktree --run=kappa --plan=601$/.test(c))
  const kTrees = git(proj, 'worktree', 'list', '--porcelain').stdout.split('\n').filter((l) => /^worktree .*orch-kappa-601/.test(l))
  check('kappa: a bad copy of the worktree line is asked for once more and the plan is merged in one folder', k?.ok === true && sk.plans['601']?.state === 'merged' && kWt.length === 2 && kTrees.length === 1 && garbleWorktreeOnce === null, JSON.stringify({ ok: k?.ok, state: sk.plans['601']?.state, worktreeCalls: kWt.length, trees: kTrees }))
  const kNote = (sk.notes ?? []).find((n) => n.plan === '601' && /^runner retry: worktree 601 — first attempt: unreadable ORCH_JSON from: node scripts\/orch-state\.mjs worktree /.test(n.text))
  check('kappa: the run note keeps the first error with the raw line and the odd character', !!kNote && kNote.text.includes("raw: 'ORCH_JSON {“ok") && /non-ASCII U\+201C at 11/.test(kNote.text), JSON.stringify((sk.notes ?? []).filter((n) => n.plan === '601').map((n) => n.text)))

  // The [ui] tier: a local test server (a child process) for the pages, the login and the backend.
  const server = await startUiServer()
  try {
    UI.base = `http://127.0.0.1:${server.port}`
    UI.api = `http://localhost:${server.port}`
    UI.dead = `http://127.0.0.1:${await deadPort()}`
    const d = await runWorkflow({ mode: 'run', run: 'delta', plans: ['401'], ui: true, uiLogin: `${UI.base}/login-ok`, uiApi: `${UI.api}/api-cors`, root: proj })
    const sd = JSON.parse(readFileSync(join(proj, '.claude', 'orchestrator-runs', 'delta', 'status.json'), 'utf8'))
    const cardOf = (title) => (sd.plans['401']?.uiCards ?? []).find((c) => c.card === title)
    const passCard = cardOf('Save shows Saved')
    check('delta: 401 merged in round 0 with one builder (plan drift costs no fix round)', d?.ok === true && sd.plans['401']?.state === 'merged' && sd.plans['401'].round === 0 && builderCalls('401').length === 1, JSON.stringify(sd.plans['401']))
    check('delta: the passing script card is in status.json with its screenshot, checked by script', passCard?.status === 'pass' && passCard.via === 'script' && passCard.screenshots[0] === 'screens/401-1.png' && passCard.page === `${UI.base}/settings`, JSON.stringify(passCard))
    const uiGate = calls.filter((c) => c.nnn === '401' && /^ui-gate /.test(c.label ?? ''))
    check('delta: the gate runs the two card scripts (the unscripted card has none)', uiGate.length === 1 && uiGate[0].commands?.length === 2, JSON.stringify(uiGate.map((c) => c.commands)))
    const look = calls.filter((c) => c.type === 'orch-ui' && c.nnn === '401')
    check('delta: the browser agent gets only the failed and the unscripted card, never the passing one', look.length === 1 && JSON.stringify(look[0].cards?.map((c) => c.card)) === JSON.stringify(['Error shows Error', 'The colour looks right']) && look[0].cards[0].scriptFailed === true, JSON.stringify(look[0]?.cards))
    check('delta: the browser agent gets the "pre-checked, skip" list and the known finding', JSON.stringify(look[0]?.pre) === JSON.stringify(['Save shows Saved']) && (look[0]?.known ?? []).some((k) => /^Error shows Error: its script failed/.test(k)), JSON.stringify({ pre: look[0]?.pre, known: look[0]?.known }))
    check('delta: the browser verdicts are in status.json (plan drift, pass), checked by browser', cardOf('Error shows Error')?.status === 'plan-drift' && cardOf('Error shows Error').via === 'browser' && cardOf('The colour looks right')?.status === 'pass' && cardOf('The colour looks right').via === 'browser', JSON.stringify(sd.plans['401']?.uiCards))
    check('delta: the UI environment check ran before the browser step', runnerCommands.some((c) => c.startsWith(`node scripts/orch-preflight.mjs --ui --pages ${UI.base}/settings --login `)), runnerCommands.filter((c) => /--ui/.test(c)).join(' | '))
    const dr = readFileSync(join(proj, '.claude', 'orchestrator-runs', 'delta.md'), 'utf8')
    const grid = (dr.split(`### ${UI.base}/settings`)[1] ?? '').split('\n### ')[0]
    const drift = (dr.split('### Plan drift')[1] ?? '').split('\n### ')[0].split('\n## ')[0]
    check('delta: the report grid shows the passing card with its screenshot under its page', grid.includes('| 401: Save shows Saved | pass — script, round 0 | [![Save shows Saved](screens/401-1.png)](screens/401-1.png) |') && grid.includes('| 401: The colour looks right | pass — browser, round 0 |'), grid.slice(0, 400))
    check('delta: plan drift has its own section, no severity, not in the grid', drift.includes('401: Error shows Error') && !/\b(?:blocker|major|minor|nit)\b/.test(drift) && !grid.includes('Error shows Error'), drift.slice(0, 300))
    // Plan 028: an idle permanent slot (detached, no marker, provisioned once like a real slot) is the builder's folder,
    // installs nothing and is given back when the plan ends; with no idle slot the run builds in its own folder.
    const slotDir = join(root, 'orch-app-wt-1')
    git(proj, 'worktree', 'add', '--detach', slotDir, 'main')
    const slotInstall = spawnSync('npm install --no-audit --no-fund --no-package-lock', { cwd: join(slotDir, 'scripts'), env, encoding: 'utf8', shell: true })
    check('slots: the scratch slot is provisioned (npm install inside scripts/)', slotInstall.status === 0, tail(`${slotInstall.stdout}${slotInstall.stderr}`))
    for (const [run, nnn, args, why] of [
      ['ui-down', '402', {}, /ui server: dev server http:\/\/127\.0\.0\.1:\d+ does not answer/],
      ['ui-login', '403', { uiLogin: `${UI.base}/login-bad` }, /ui login: login http:\S+\/login-bad answered 401/],
      ['ui-cors', '404', { uiApi: `${UI.api}/api-nocors` }, /ui backend: backend http:\/\/localhost:\d+ is cross-origin unreachable from http:\/\/127\.0\.0\.1:\d+ \(Access-Control-Allow-Origin: missing\)/],
    ]) {
      const r = await runWorkflow({ mode: 'run', run, plans: [nnn], ui: true, ...args, root: proj })
      const sx = JSON.parse(readFileSync(join(proj, '.claude', 'orchestrator-runs', run, 'status.json'), 'utf8'))
      const p = sx.plans[nnn]
      check(`${run}: ${nnn} stops before the browser agent with the reason in status.json, no fix round`, p?.state === 'parked' && p.round === 0 && /^UI environment blocked before the browser step: /.test(p.reason ?? '') && why.test(p.reason) && !!r?.parked?.includes(nnn) && builderCalls(nnn).length === 1 && calls.filter((c) => c.type === 'orch-ui' && c.nnn === nnn).length === 0, JSON.stringify(p))
    }
    const branchNow = git(slotDir, 'branch', '--show-current').stdout.trim()
    check('slots: plan 402 built in the idle slot (no own folder), no builder installed packages, and the slot was given back',
      !existsSync(join(root, 'orch-app-orch-ui-down-402')) && runnerCommands.some((c) => c.includes('orch-state.mjs worktree --run=ui-down --plan=402')) &&
      runnerCommands.some((c) => c.includes('orch-state.mjs release --run=ui-down --plan=402')) && !existsSync(join(slotDir, '.worktree-plan')) &&
      branchNow === '' && existsSync(join(slotDir, 'scripts', 'node_modules', 'picomatch')),
      `own folder ${existsSync(join(root, 'orch-app-orch-ui-down-402'))}, marker ${existsSync(join(slotDir, '.worktree-plan'))}, branch "${branchNow}"`)
    git(proj, 'worktree', 'remove', '--force', slotDir)
  } finally {
    server.child.kill()
  }

  // Run devfail (plan 020): commands.dev set and the dev server does not start (a stub slot-serve that exits 1) — the
  // preflight reports it as an environment failure and no builder runs. The scratch project has no commands.dev, so
  // the installed preflight gets one (and the stub) in a local commit, restored after; origin is not touched.
  const preFile = join(proj, 'scripts', 'orch-preflight.mjs')
  const serveFile = join(proj, 'scripts', 'slot-serve.mjs')
  const preSrc = readFileSync(preFile, 'utf8')
  const serveSrc = readFileSync(serveFile, 'utf8')
  if (check('devfail: the installed preflight renders commands.dev as an empty string here', /^const DEV = ''$/m.test(preSrc), 'no const DEV line')) {
    writeFileSync(preFile, preSrc.replace(/^const DEV = ''$/m, "const DEV = 'dev'"))
    writeFileSync(serveFile, "console.error('SLOT_SERVE: stub - the dev server did not come up')\nprocess.exit(1)\n")
    git(proj, 'commit', '-q', '-am', 'test: a dev command whose server does not start')
    const buildersBefore = calls.filter((c) => c.role === 'orch-builder').length
    const df = await runWorkflow({ mode: 'run', run: 'devfail', plans: ['101'], root: proj })
    const devProblem = (df?.problems ?? []).find((p) => /^dev server: /.test(p)) ?? ''
    check('devfail: the run stops at the preflight with the dev server start failure, before any builder', df?.ok === false && df.stopped === 'preflight' && /slot-serve\.mjs did not start it \(exit 1: .*did not come up\)/.test(devProblem) && calls.filter((c) => c.role === 'orch-builder').length === buildersBefore && !existsSync(join(proj, '.claude', 'orchestrator-runs', 'devfail', 'status.json')), JSON.stringify(df))
    writeFileSync(preFile, preSrc)
    writeFileSync(serveFile, serveSrc)
    git(proj, 'commit', '-q', '-am', 'test: restore the preflight and slot-serve')
  }

  // Every state write went through orch-state.mjs (the runner ran nothing else).
  const other = runnerCommands.filter((c) => !/^node scripts\/orch-(state|preflight)\.mjs /.test(`${c} `))
  check('every runner command is orch-state.mjs or orch-preflight.mjs', other.length === 0 && runnerCommands.some((c) => c.startsWith('node scripts/orch-state.mjs set ')), other.join(' | '))
}

try {
  await main()
} catch (e) {
  check('the workflow ran without throwing', false, e.stack?.split('\n').slice(0, 3).join(' | ') ?? String(e))
}
for (const line of results) console.log(line)
const total = results.filter((l) => /^(PASS|FAIL)/.test(l)).length
if (keep) console.log(`kept: ${root}`)
else {
  for (const run of ['alpha', 'beta', 'gamma', 'epsilon', 'zeta', 'theta', 'iota', 'delta', 'ui-down', 'ui-login', 'ui-cors']) {
    git(proj, 'worktree', 'remove', '--force', join(root, `orch-app-orch-merge-${run}`))
  }
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 })
  } catch { /* a Windows file lock: the OS temp folder is cleaned later */ }
}
console.log(failed ? `ORCHESTRATOR_E2E: FAIL — ${failed} of ${total} case(s) failed` : `ORCHESTRATOR_E2E: ok — ${total} cases passed`)
process.exit(failed ? 1 : 0)
