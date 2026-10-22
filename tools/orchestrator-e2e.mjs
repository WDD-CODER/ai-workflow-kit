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
    models: { judgment: 'opus' }, orchestrator: { maxFixRounds: 2, minFreeDiskGb: 0 },
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
  mkdirSync(join(proj, 'plans'), { recursive: true })
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
  return { exitCode: r.status ?? 1, output: r.out }
}

const MODEL_OF = (opts) => opts.model ?? (opts.agentType ? { 'orch-builder': 'sonnet', 'orch-readiness': 'opus', 'orch-gate': 'haiku', 'kit-runner': 'haiku' }[opts.agentType] ?? 'sonnet' : 'session-model')
const base = (role, opts) => ({ role, model: MODEL_OF(opts), effort: opts.effort ?? 'medium' })

// The [ui] cards each 4xx builder reports (pages on the local test server; UI is set once the server is up).
const UI = { base: '', dead: '', api: '' }
const PASS_TEST = 'node -e "process.exit(0)"'
const FAIL_TEST = 'node -e "process.exit(1)"'
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
  const cards = nnn === '501' ? [{ card: '--state=merged', page: 'https://app.example/x' }, { card: 'Bad page', page: 'file:///etc/passwd' }, { card: 'Bad shot', page: 'https://app.example/y', test: PASS_TEST, screenshot: '-rf' }] : UI_CARDS[nnn]?.()
  return { ...r, status: 'built', headSha: git(wt, 'rev-parse', 'HEAD').stdout.trim(), ...(cards ? { uiCards: cards } : {}) }
}

function stubGate(t, opts, nnn) {
  const n = bump(`gate ${nnn}`)
  const fail = (nnn === '102' && n === 1) || (nnn === '202' && !phase2) || nnn === '301'
  const cmds = json(t.COMMANDS)
  if (gateDrop) {
    gateDrop = false
    return { ...base('orch-gate', opts), results: cmds.slice(0, -1).map((c) => ({ command: c, status: 'pass' })), pass: true }
  }
  return { ...base('orch-gate', opts), results: cmds.map((c, i) => (fail && i === 0 ? { command: c, status: 'fail', tail: 'stub: 1 failing test' } : { command: c, status: 'pass' })), pass: !fail }
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
  calls.push({ type, role, nnn, model: opts.model ?? null, label: opts.label, mode: t.MODE ?? null, tier: t.TIER ?? null, handoff: t.HANDOFF ?? null, findings: t.FINDINGS ? json(t.FINDINGS) : null, cards: t.CARDS ? json(t.CARDS) : null, pre: t.PRE_CHECKED ? json(t.PRE_CHECKED) : null, known: t.KNOWN_FINDINGS ? json(t.KNOWN_FINDINGS) : null, commands: t.COMMANDS ? json(t.COMMANDS) : null })
  if (type === 'kit-runner') return stubRunner(t)
  if (role === 'orch-builder') return stubBuilder(t, opts)
  if (type === 'orch-gate' && /^ui-gate /.test(opts.label ?? '')) {
    // The [ui] cards' own tests: pass or fail by the exit code the test command names.
    return { ...base('orch-gate', opts), results: json(t.COMMANDS).map((c) => (/exit\(0\)/.test(c) ? { command: c, status: 'pass' } : { command: c, status: 'fail', tail: 'stub: expected "Error", page shows "Problem"' })) }
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
  if (type === 'orch-readiness') return { ...base('orch-readiness', opts), plans: [{ plan: t.PLAN, state: 'ready', questions: [], envNeeds: [], commands: ['node --test', 'git reset --hard HEAD'] }] }
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
  check('readiness: a deny-listed command is dropped and named', ready?.plans?.every((p) => p.denied.length === 1 && !p.commands.some((c) => /reset --hard/.test(c))), JSON.stringify(ready?.plans?.[0]))
  check('readiness: the preflight result comes back', ready?.preflight?.ok === true, JSON.stringify(ready?.preflight))

  // Run alpha: the diamond.
  const a = await runWorkflow({ mode: 'run', run: 'alpha', plans: ['101', '102', '103', '104'], startedAt: '2026-01-01T00:00:00.000Z', root: proj })
  const sa = subjects('orch/alpha')
  const order = sa.map((s) => (/\(plan (\d+)\)$/.exec(s) ?? [])[1])
  check('alpha: four merges with the anchored subject', sa.length === 4 && sa.every((s, i) => SUBJECT('alpha', order[i]).test(s)), sa.join(' | '))
  check('alpha: merged in wave order (101 first, 104 last)', order[0] === '101' && order[3] === '104' && new Set(order.slice(1, 3)).size === 2 && order.slice(1, 3).every((n) => ['102', '103'].includes(n)), order.join(','))
  const st = statusOnBranch('alpha')
  check('alpha: status.json on the run branch lists every plan merged with round, sha and models', !!st && ['101', '102', '103', '104'].every((n) => st.plans[n]?.state === 'merged' && /^[0-9a-f]{40}$/.test(st.plans[n].sha ?? '') && Number.isInteger(st.plans[n].round) && st.plans[n].models?.['orch-builder']?.model && st.plans[n].models?.['orch-merge']?.model && st.plans[n].models?.['orch-gate']?.model), JSON.stringify(st?.plans?.['101']))
  check('alpha: rounds 101=0, 102=1, 103=0, 104=1', !!st && st.plans['101'].round === 0 && st.plans['102'].round === 1 && st.plans['103'].round === 0 && st.plans['104'].round === 1, st ? ['101', '102', '103', '104'].map((n) => st.plans[n].round).join(',') : 'no status')
  check('alpha: 102 fixed by the same build-tier builder in round 1', builderCalls('102').map((c) => `${c.tier}/${c.mode}`).join(',') === 'build/first,build/fix' && builderCalls('102')[1].findings?.length === 1, JSON.stringify(builderCalls('102')))
  check('alpha: 103 environment failure retried once after the env check, no fix round', builderCalls('103').map((c) => `${c.tier}/${c.mode}`).join(',') === 'build/first,build/env-retry' && runnerCommands.some((c) => c === 'node scripts/orch-preflight.mjs --env-only'), builderCalls('103').map((c) => c.mode).join(','))
  check('alpha: 104 pass: true next to a major is a fail, sent back with the finding', builderCalls('104').length === 2 && builderCalls('104')[1].mode === 'fix' && builderCalls('104')[1].findings?.[0]?.severity === 'major' && (st?.notes ?? []).some((n) => /pass: true next to a major/.test(n.text)), JSON.stringify(builderCalls('104')[1]))
  check('alpha: origin/main unchanged', git(origin, 'rev-parse', 'main').stdout.trim() === mainBefore, 'main moved')
  const mfA = join(root, 'orch-app-orch-merge-alpha')
  check('alpha: the merge folder has no uncommitted files', existsSync(mfA) && git(mfA, 'status', '--porcelain').stdout.trim() === '', git(mfA, 'status', '--porcelain').stdout)
  check('alpha: the report is on the run branch and copied to the main folder', a?.ok === true && git(proj, 'cat-file', '-e', 'origin/orch/alpha:docs/orchestrator/runs/alpha/report.md').status === 0 && existsSync(join(proj, '.claude', 'orchestrator-runs', 'alpha.md')) && /What only the Human can do/.test(readFileSync(join(proj, '.claude', 'orchestrator-runs', 'alpha.md'), 'utf8')), JSON.stringify(a))
  check('alpha: the main folder stays clean (status and report copy are gitignored)', git(proj, 'status', '--porcelain').stdout.trim() === '', git(proj, 'status', '--porcelain').stdout)

  // Run beta, first launch: fix rounds, escalation, the wave gate.
  const b1 = await runWorkflow({ mode: 'run', run: 'beta', plans: ['201', '202', '203', '204'], startedAt: '2026-01-02T00:00:00.000Z', root: proj })
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
  const b2 = await runWorkflow({ mode: 'run', run: 'beta', plans: ['201', '202', '203', '204'], startedAt: '2026-01-03T00:00:00.000Z', root: proj })
  const sb2 = subjects('orch/beta').map((s) => (/\(plan (\d+)\)$/.exec(s) ?? [])[1])
  check('beta 2: relaunch merges 202 and 203 after 201 and 204', sb2.length === 4 && new Set(sb2.slice(0, 2)).size === 2 && sb2.slice(2).every((n) => ['202', '203'].includes(n)) && new Set(sb2.slice(2)).size === 2, sb2.join(','))
  check('beta 2: no builder ran again for the merged 201 and 204', builderCalls('201').length === before.b201 && builderCalls('204').length === before.b204, JSON.stringify(before))
  const s2 = statusOnBranch('beta')
  check('beta 2: status.json shows all four merged after two attempts', !!s2 && s2.attempts === 2 && ['201', '202', '203', '204'].every((n) => s2.plans[n].state === 'merged') && !s2.plans['202'].reason && s2.plans['202'].earlier?.[0]?.state === 'parked', JSON.stringify(s2 && Object.values(s2.plans).map((p) => `${p.nnn}:${p.state}`)))
  check('beta 2: the run result counts come from git', JSON.stringify((b2?.merged ?? []).slice().sort()) === JSON.stringify(['201', '202', '203', '204']), JSON.stringify(b2?.merged))
  // Run gamma: the UI step on; an ESCALATE then a judgment-tier failure parks at round 1; auth code in a plain path.
  const g = await runWorkflow({ mode: 'run', run: 'gamma', plans: ['301', '302'], ui: true, startedAt: '2026-01-04T00:00:00.000Z', root: proj })
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
  const e = await runWorkflow({ mode: 'run', run: 'epsilon', plans: ['405'], startedAt: '2026-01-04T12:00:00.000Z', root: proj })
  const se = JSON.parse(readFileSync(join(proj, '.claude', 'orchestrator-runs', 'epsilon', 'status.json'), 'utf8'))
  const eCard = (title) => (se.plans['405']?.uiCards ?? []).find((c) => c.card === title)
  check('epsilon: 405 merged; its reported card passed by script, the left-out [ui] item is recorded unchecked', e?.ok === true && se.plans['405']?.state === 'merged' && eCard('Save shows Saved')?.status === 'pass' && eCard('Save shows Saved').via === 'script' && eCard('Profile shows the avatar')?.status === 'unchecked' && eCard('Profile shows the avatar').via === 'none', JSON.stringify(se.plans['405']?.uiCards))
  check('epsilon: a run note names the [ui] item the builder left out', (se.notes ?? []).some((n) => n.plan === '405' && /builder reported no card for 1 \[ui\] item\(s\).*Profile shows the avatar/.test(n.text)), JSON.stringify(se.notes))
  const re = readFileSync(join(proj, '.claude', 'orchestrator-runs', 'epsilon.md'), 'utf8')
  check('epsilon: the run report hands the left-out [ui] item to the Human', /\d+\. 405: Profile shows the avatar — a \[ui\] card no script could check and the browser step was off/.test(re), (re.split('## What only the Human can do')[1] ?? re).slice(0, 400))

  // Run zeta (security follow-up): extra check commands are allowlisted, a gate that leaves a check out fails, and
  // [ui] card values that could become flags or reach a shell are not recorded; orch-state takes --key=value only.
  gateDrop = true
  const zBuilders = builderCalls('501').length
  const z = await runWorkflow({ mode: 'run', run: 'zeta', plans: ['501'], startedAt: '2026-01-04T18:00:00.000Z', root: proj,
    checks: { '501': ['npm run build', 'npm run nosuch', 'node tools/ok-check.mjs --quick', 'node --test tests/a.test.mjs', 'node -e "1"', 'node tools/x.mjs; rm -rf /', 'echo hi > x', 'git reset --hard HEAD'] } })
  const sz = JSON.parse(readFileSync(join(proj, '.claude', 'orchestrator-runs', 'zeta', 'status.json'), 'utf8'))
  const zGates = calls.filter((c) => c.type === 'orch-gate' && c.nnn === '501' && /^gate /.test(c.label ?? '')).slice(-2)
  check('zeta: only allowlisted extra checks reach the gate (npm run <known script>, node tools/…, node --test)', JSON.stringify(zGates[0]?.commands) === JSON.stringify(['npm run build', 'npm run lint', 'npm run test', 'node tools/ok-check.mjs --quick', 'node --test tests/a.test.mjs']), JSON.stringify(zGates[0]?.commands))
  const dropNote = (sz.notes ?? []).filter((n) => n.plan === '501' && /^check command dropped, not run: /.test(n.text)).map((n) => n.text).join(' | ')
  check('zeta: each dropped check command is named in a run note with its reason', ['npm run nosuch', 'node -e', 'rm -rf', 'echo hi', 'reset --hard'].every((c) => dropNote.includes(c)) && /no script nosuch in package.json/.test(dropNote), dropNote)
  check('zeta: a gate result left out is a fail (fix round 1), not a pass', z?.ok === true && sz.plans['501']?.state === 'merged' && sz.plans['501'].round === 1 && builderCalls('501').length === zBuilders + 2 && /the gate returned no result for this check/.test(JSON.stringify(builderCalls('501').at(-1)?.findings ?? [])), JSON.stringify({ round: sz.plans['501']?.round, f: builderCalls('501').at(-1)?.findings }))
  const zCards = (sz.plans['501']?.uiCards ?? []).map((c) => c.card)
  const cardNotes = (sz.notes ?? []).filter((n) => /\[ui\] card not recorded/.test(n.text)).map((n) => n.text).join(' | ')
  check('zeta: a card title starting with "-", a non-http page and an unsafe screenshot path are not recorded', zCards.length === 0 && /starts with - or is empty/.test(cardNotes) && /not an http\(s\) URL/.test(cardNotes) && /not a safe relative path/.test(cardNotes) && sz.plans['501'].state === 'merged', `${JSON.stringify(zCards)} ${cardNotes}`)
  const zSets = runnerCommands.filter((c) => c.startsWith('node scripts/orch-state.mjs set ') && c.includes('--run=zeta'))
  check('zeta: every orch-state argument is one --key=value token', zSets.length > 0 && runnerCommands.filter((c) => c.startsWith('node scripts/orch-state.mjs ')).every((c) => words(c).slice(3).every((w) => /^--[a-z-]+=/.test(w))), zSets[0] ?? 'none')

  // The [ui] tier: a local test server (a child process) for the pages, the login and the backend.
  const server = await startUiServer()
  try {
    UI.base = `http://127.0.0.1:${server.port}`
    UI.api = `http://localhost:${server.port}`
    UI.dead = `http://127.0.0.1:${await deadPort()}`
    const d = await runWorkflow({ mode: 'run', run: 'delta', plans: ['401'], ui: true, uiLogin: `${UI.base}/login-ok`, uiApi: `${UI.api}/api-cors`, startedAt: '2026-01-05T00:00:00.000Z', root: proj })
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
    for (const [run, nnn, args, why] of [
      ['ui-down', '402', {}, /ui server: dev server http:\/\/127\.0\.0\.1:\d+ does not answer/],
      ['ui-login', '403', { uiLogin: `${UI.base}/login-bad` }, /ui login: login http:\S+\/login-bad answered 401/],
      ['ui-cors', '404', { uiApi: `${UI.api}/api-nocors` }, /ui backend: backend http:\/\/localhost:\d+ is cross-origin unreachable from http:\/\/127\.0\.0\.1:\d+ \(Access-Control-Allow-Origin: missing\)/],
    ]) {
      const r = await runWorkflow({ mode: 'run', run, plans: [nnn], ui: true, ...args, startedAt: '2026-01-06T00:00:00.000Z', root: proj })
      const sx = JSON.parse(readFileSync(join(proj, '.claude', 'orchestrator-runs', run, 'status.json'), 'utf8'))
      const p = sx.plans[nnn]
      check(`${run}: ${nnn} stops before the browser agent with the reason in status.json, no fix round`, p?.state === 'parked' && p.round === 0 && /^UI environment blocked before the browser step: /.test(p.reason ?? '') && why.test(p.reason) && !!r?.parked?.includes(nnn) && builderCalls(nnn).length === 1 && calls.filter((c) => c.type === 'orch-ui' && c.nnn === nnn).length === 0, JSON.stringify(p))
    }
  } finally {
    server.child.kill()
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
  for (const run of ['alpha', 'beta', 'gamma', 'epsilon', 'zeta', 'delta', 'ui-down', 'ui-login', 'ui-cors']) {
    git(proj, 'worktree', 'remove', '--force', join(root, `orch-app-orch-merge-${run}`))
  }
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 })
  } catch { /* a Windows file lock: the OS temp folder is cleaned later */ }
}
console.log(failed ? `ORCHESTRATOR_E2E: FAIL — ${failed} of ${total} case(s) failed` : `ORCHESTRATOR_E2E: ok — ${total} cases passed`)
process.exit(failed ? 1 : 0)
