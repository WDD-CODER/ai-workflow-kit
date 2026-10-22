/**
 * Orchestrator state — everything the orchestrator workflow (.claude/workflows/orchestrate.js) cannot do itself:
 * a workflow script has no file system, git or clock, so it runs this script through the mechanical runner agent.
 * Git is the ledger; status.json is the readable state. Rules: docs/agent/orchestrator.md.
 *
 *   node scripts/orch-state.mjs init       --run <name> [--started <iso>]   run branch + merge folder + status.json
 *   node scripts/orch-state.mjs order      --run <name> --plans <NNN,NNN>  waves from plan-order (merged plans left out)
 *   node scripts/orch-state.mjs done       --run <name>                     plans merged into the run branch (from git)
 *   node scripts/orch-state.mjs plan-info  --run <name> --plan <NNN>        path, branch, start tier, [human] and [ui] items
 *   node scripts/orch-state.mjs worktree   --run <name> --plan <NNN>        the builder's folder on its plan branch
 *   node scripts/orch-state.mjs diff       --run <name> --plan <NNN>        changed files vs the run branch, sensitive?
 *   node scripts/orch-state.mjs set        --run <name> --plan <NNN> [--state s] [--round n] [--tier t] [--sha x]
 *                                          [--role r --model m --effort e | --roles r=m/e,r2=m2/e2] [--reason "<text>"]
 *                                          [--card "<title>" --card-status s --page <url> --shots a.png,b.png --via script|browser]
 *   node scripts/orch-state.mjs handoff    --run <name> --plan <NNN> --step s --check c --tail t --tried x
 *                                          the hand-off file a fresh judgment-tier builder reads
 *   node scripts/orch-state.mjs note       --run <name> [--plan <NNN>] --text "<decision>"
 *   node scripts/orch-state.mjs stop       --run <name> --reason "<why the run stopped>"
 *   node scripts/orch-state.mjs disk       [--min <gb>]                     free disk vs orchestrator.minFreeDiskGb
 *   node scripts/orch-state.mjs clean      --run <name>                     the merge folder has no uncommitted file
 *   node scripts/orch-state.mjs finish     --run <name>                     report on the run branch + local copy
 *
 * Every command prints its facts, then one last line `ORCH_JSON <json>` the workflow reads. Exit 0 when `ok`, else 1.
 * Values arrive as `--key=value` arguments (the workflow) or `--key value` (a value may not start with "-"), never as a
 * shell string; an unknown flag is refused; nothing from plan text is run. Paths:
 *   status     .claude/orchestrator-runs/<run>/status.json (main folder, gitignored; copied to the run branch by finish)
 *   report     docs/orchestrator/runs/<run>/report.md on the run branch, and .claude/orchestrator-runs/<run>.md
 *   merge      <parent>/<repo>-orch-merge-<run> (a worktree on the run branch; only merges and the report commit)
 *   builders   <parent>/<repo>-orch-<run>-<NNN> (a worktree on the plan branch)
 * ORCH_FREE_GB (a number) replaces the measured free disk — for tests only.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statfsSync, openSync, closeSync, statSync, unlinkSync, renameSync } from 'fs'
import { spawnSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { findOpenPlan } from './lib/plan-paths.mjs'
import { planNumber, planTitle, mergeSubjectRe } from './lib/plan-deps.mjs'
import { uiItems } from './lib/done-when.mjs'
import { runNameProblem, PLAN_STATES, planBranch, planBranchProblem, startTier, humanItems, freeGb, formatReport, addedCodeFiles, uiCardProblem } from './lib/orch-run.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAIN = 'main'
const PREFIX = 'orch/'
const MIN_FREE_GB = 5
const REPO = 'ai-workflow-kit'
// Sensitive paths (the security reviewer runs on them): the same reading as ship-prep — a regex string replaces the
// built-in list, a list of globs is added to it.
const DEFAULT_SENSITIVE_RE = /auth|crypto|guard|interceptor|security|permission|payment|migration|secret|\.env|\.github\/workflows/i
const SENSITIVE_CFG = ["tools/lib/source.mjs","core/scripts/pre-commit-secret-scan.mjs"]
// Added lines that name auth or permission code (the security reviewer runs on them whatever the file path).
// No word boundary before the stems, so camelCase names (checkAuthToken, hasPermission) match too.
const SENSITIVE_CODE_RE = /auth|permission|password|jwt|session[_-]?id|tokens?\b|\broles?\b/i

// Every flag takes a value. The workflow passes `--key=value` (one token, so a value can never become a flag); a
// human may write `--key value`, where a value starting with "-" is refused. An unknown flag (--root among them: the
// folder is always this script's own project) or a second positional word stops the command.
const FLAGS = new Set(['run', 'started', 'plans', 'plan', 'state', 'round', 'tier', 'sha', 'role', 'model', 'effort', 'roles', 'reason', 'card', 'card-status', 'page', 'shots', 'via', 'step', 'check', 'tail', 'tried', 'text', 'min'])
function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      if (out._.length) return { problem: `unexpected argument "${a}" — values go in --key=value` }
      out._.push(a)
      continue
    }
    const eq = a.indexOf('=')
    const key = eq > 0 ? a.slice(2, eq) : a.slice(2)
    if (!FLAGS.has(key)) return { problem: `unknown flag --${key}` }
    if (eq > 0) out[key] = a.slice(eq + 1)
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) out[key] = argv[++i]
    else return { problem: `--${key} needs a value (use --${key}=<value>)` }
  }
  return { args: out }
}

const parsed = parseArgs(process.argv.slice(2))
const args = parsed.args ?? { _: [] }
const cmd = args._[0]
const root = resolve(join(__dirname, '..'))
const repoName = REPO || root.split(/[\\/]/).pop()
const parent = dirname(root)
const nowIso = () => new Date().toISOString()

function emit(result, lines = []) {
  for (const l of lines) console.log(l)
  console.log(`ORCH_JSON ${JSON.stringify(result)}`)
  process.exit(result.ok ? 0 : 1)
}
const fail = (error, extra = {}) => emit({ ok: false, error, ...extra }, [`ORCH_STATE: FAIL — ${error}`])
if (parsed.problem) fail(parsed.problem)

function git(cwd, ...a) {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
  // truncated: the output hit maxBuffer (ENOBUFS) — a reader must not trust it.
  return { status: r.status ?? 1, out: (r.stdout ?? '').replace(/\r?\n+$/, ''), err: (r.stderr ?? '').trim(), truncated: r.error?.code === 'ENOBUFS' }
}
const refExists = (ref) => git(root, 'rev-parse', '--verify', '--quiet', ref).status === 0

function runName() {
  const name = args.run
  const why = runNameProblem(name)
  if (why) fail(why)
  return name
}
const runBranch = (run) => `${PREFIX}${run}`
const runsDir = () => join(root, '.claude', 'orchestrator-runs')
const statusPath = (run) => join(runsDir(), run, 'status.json')
const mergeFolder = (run) => join(parent, `${repoName}-orch-merge-${run}`)
const builderFolder = (run, nnn) => join(parent, `${repoName}-orch-${run}-${nnn}`)

// Plans of one wave run in parallel, so several orch-state processes can read-modify-write status.json at once.
// Every read takes the run's lock file (an O_EXCL create, retried; a lock older than LOCK_STALE_MS is taken over) and
// holds it until this short-lived process exits; every write goes to a temp file renamed into place.
const LOCK_STALE_MS = 30000
const LOCK_WAIT_MS = 60000
const lockPath = (run) => join(runsDir(), `${run}.lock`)
const heldLocks = new Set()
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
function lockRun(run) {
  if (heldLocks.has(run)) return
  const p = lockPath(run)
  mkdirSync(runsDir(), { recursive: true })
  const until = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      closeSync(openSync(p, 'wx'))
      heldLocks.add(run)
      return
    } catch (e) {
      if (!['EEXIST', 'EPERM', 'EACCES'].includes(e.code)) throw e
    }
    try {
      if (Date.now() - statSync(p).mtimeMs > LOCK_STALE_MS) unlinkSync(p)
    } catch { /* gone already, or another process took it over */ }
    if (Date.now() > until) fail(`status.json of run "${run}" stays locked by ${p} — another orch-state process is stuck`, { envFailure: true })
    pause(15 + Math.floor(Math.random() * 25))
  }
}
process.on('exit', () => {
  for (const run of heldLocks) {
    try {
      unlinkSync(lockPath(run))
    } catch { /* already gone */ }
  }
})
function readStatus(run) {
  lockRun(run)
  const p = statusPath(run)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8'))
}
function writeStatus(run, status) {
  lockRun(run)
  status.updatedAt = nowIso()
  const p = statusPath(run)
  mkdirSync(dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`)
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, p)
      return
    } catch (e) {
      // Windows: a virus scanner or indexer can hold the target for a moment.
      if (i >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e
      pause(25)
    }
  }
}
function needStatus(run) {
  const s = readStatus(run)
  if (!s) fail(`no run "${run}" — start it with: node scripts/orch-state.mjs init --run ${run}`)
  return s
}

function diskGb() {
  if (process.env.ORCH_FREE_GB !== undefined && process.env.ORCH_FREE_GB !== '') return Number(process.env.ORCH_FREE_GB)
  try {
    return freeGb(statfsSync(root))
  } catch {
    return null
  }
}

/** The merges into the run branch, oldest first: [{ nnn, branch, sha }] — read from the anchored merge subjects only. */
function mergedPlans(run) {
  const branch = runBranch(run)
  const ref = refExists(branch) ? branch : refExists(`origin/${branch}`) ? `origin/${branch}` : null
  if (!ref) return []
  const log = git(root, 'log', '--reverse', '--first-parent', '--format=%H%x09%s', ref)
  const re = mergeSubjectRe(branch)
  const out = []
  for (const line of log.out.split('\n').filter(Boolean)) {
    const [sha, subject] = line.split('\t')
    const m = subject.match(re)
    if (m) out.push({ nnn: planNumber(m[1]), branch: subject.split(' ')[1], sha })
  }
  return out
}

function planPath(nnn) {
  const p = findOpenPlan(root, nnn)
  if (!p) fail(`plan ${nnn} not found in the open plan folders`)
  return p
}

/** The plan's branch; refused unless it is feat/<NNN>-<lower-case words> (it reaches git and agent commands). */
function branchOf(path, nnn) {
  const b = planBranch(path, nnn)
  const why = planBranchProblem(b)
  if (why) fail(why)
  return b
}

/** The script names of the project's package.json: the only `npm run` checks the workflow accepts. */
function npmScripts() {
  try {
    return Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {})
  } catch {
    return []
  }
}

function sensitiveTests() {
  const globRe = (g) => new RegExp(`^${g.split('**').map((part) => part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`)
  if (Array.isArray(SENSITIVE_CFG)) return [DEFAULT_SENSITIVE_RE, ...SENSITIVE_CFG.filter(Boolean).map(globRe)]
  if (typeof SENSITIVE_CFG === 'string' && SENSITIVE_CFG) {
    try {
      return [new RegExp(SENSITIVE_CFG)]
    } catch { /* not a regex: the built-in list */ }
  }
  return [DEFAULT_SENSITIVE_RE]
}

function fetchOrigin() {
  const f = git(root, 'fetch', '--quiet', 'origin')
  if (f.status !== 0) fail(`git fetch origin failed: ${f.err.split('\n').pop()}`, { envFailure: true })
}

const commands = {
  init() {
    const run = runName()
    const branch = runBranch(run)
    fetchOrigin()
    if (!refExists(`origin/${MAIN}`)) fail(`origin/${MAIN} not found`)
    const lines = []
    if (!refExists(`refs/heads/${branch}`)) {
      const from = refExists(`origin/${branch}`) ? `origin/${branch}` : `origin/${MAIN}`
      const b = git(root, 'branch', '--no-track', branch, from)
      if (b.status !== 0) fail(`git branch ${branch} ${from}: ${b.err}`)
      lines.push(`created ${branch} from ${from}`)
    }
    if (!refExists(`origin/${branch}`)) {
      const p = git(root, 'push', '--quiet', '-u', 'origin', branch)
      if (p.status !== 0) fail(`git push origin ${branch}: ${p.err.split('\n').pop()}`, { envFailure: true })
      lines.push(`pushed ${branch}`)
    }
    const mf = mergeFolder(run)
    if (!existsSync(mf)) {
      const w = git(root, 'worktree', 'add', '--quiet', mf, branch)
      if (w.status !== 0) fail(`git worktree add ${mf} ${branch}: ${w.err}`)
      lines.push(`merge folder ${mf}`)
    } else {
      const head = git(mf, 'rev-parse', '--abbrev-ref', 'HEAD').out
      if (head !== branch) fail(`the merge folder ${mf} is on ${head || '(no branch)'}, not ${branch}`)
      const dirty = git(mf, 'status', '--porcelain').out
      if (dirty) fail(`the merge folder ${mf} has uncommitted files: ${dirty.split('\n').map((l) => l.slice(3)).join(', ')}`)
      const ff = git(mf, 'merge', '--quiet', '--ff-only', `origin/${branch}`)
      if (ff.status !== 0) fail(`the merge folder cannot fast-forward to origin/${branch}: ${ff.err}`)
    }
    const done = mergedPlans(run)
    const prev = readStatus(run)
    const status = prev ?? { run, branch, base: MAIN, startedAt: args.started || nowIso(), mainShaAtStart: git(root, 'rev-parse', `origin/${MAIN}`).out, plans: {}, notes: [], attempts: 0 }
    status.attempts = (status.attempts ?? 0) + 1
    status.phase = 'running'
    delete status.stopReason
    if (args.started) status.lastStartedAt = args.started
    for (const m of done) {
      status.plans[m.nnn] = { ...(status.plans[m.nnn] ?? { nnn: m.nnn, round: 0, models: {} }), state: 'merged', sha: m.sha }
    }
    status.freeDiskGb = diskGb()
    writeStatus(run, status)
    emit({ ok: true, run, branch, mergeFolder: mf.replace(/\\/g, '/'), done: done.map((m) => m.nnn), mainSha: status.mainShaAtStart, attempt: status.attempts },
      [...lines, `run ${run}: ${done.length} plan(s) already merged into ${branch}${done.length ? ` (${done.map((m) => m.nnn).join(', ')})` : ''}`])
  },

  order() {
    const run = runName()
    const plans = String(args.plans ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    if (!plans.length) fail('--plans is empty')
    for (const p of plans) if (!/^\d{1,4}$/.test(p)) fail(`--plans takes plan numbers, got "${p}"`)
    // Merged plans are read from the run branch when it exists (a relaunch); before the first start there is none.
    const branch = runBranch(run)
    const fromGit = refExists(branch) || refExists(`origin/${branch}`) ? ['--branch', branch, '--merged-from', 'git'] : []
    const r = spawnSync(process.execPath, [join(root, 'scripts', 'plan-order.mjs'), ...plans, '--json', ...fromGit], { cwd: root, encoding: 'utf8' })
    let j
    try {
      j = JSON.parse(r.stdout)
    } catch {
      fail(`plan-order exit ${r.status}: ${(r.stderr || r.stdout).trim().split('\n').pop()}`)
    }
    if (r.status !== 0) fail(`plan-order exit ${r.status}: ${(r.stderr || '').trim().split('\n').join(' | ')}`, { order: j })
    emit({ ok: true, waves: j.waves, waveLocks: j.waveLocks, plans: j.plans, skipped: j.skipped, done: Object.keys(j.done ?? {}) },
      j.waves.map((w, i) => `WAVE ${i + 1}: ${w.join(', ')}`))
  },

  done() {
    const run = runName()
    const done = mergedPlans(run)
    emit({ ok: true, done: done.map((m) => m.nnn), merges: done }, done.map((m) => `MERGED ${m.nnn} ${m.sha.slice(0, 7)} (${m.branch})`))
  },

  'plan-info'() {
    const run = runName()
    const nnn = planNumber(args.plan ?? '')
    if (!nnn) fail('--plan takes a plan number')
    const path = planPath(nnn)
    const text = readFileSync(join(root, path), 'utf8')
    const { tier, invariants } = startTier(text)
    const info = { ok: true, nnn, path, title: planTitle(text), branch: branchOf(path, nnn), npmScripts: npmScripts(), worktree: builderFolder(run, nnn).replace(/\\/g, '/'), startTier: tier, invariants, humanItems: humanItems(text), uiItems: uiItems(text) }
    const status = readStatus(run)
    if (status) {
      // plan-info starts each attempt at a plan: an earlier attempt (a relaunch) moves to `earlier`, so state, round,
      // reason and models describe this attempt only.
      const prev = status.plans[nnn]
      const earlier = prev ? [...(prev.earlier ?? []), (({ earlier: _e, history: _h, humanItems: _i, ...rest }) => rest)(prev)] : []
      status.plans[nnn] = { nnn, title: info.title, branch: info.branch, state: 'queued', round: 0, tier: tier, models: {}, humanItems: info.humanItems, history: prev?.history ?? [], ...(earlier.length ? { earlier } : {}) }
      writeStatus(run, status)
    }
    emit(info, [`${nnn} ${info.title}: branch ${info.branch}, starts on ${tier}${invariants.length ? ` (${invariants.join(', ')})` : ''}`])
  },

  worktree() {
    const run = runName()
    const nnn = planNumber(args.plan ?? '')
    if (!nnn) fail('--plan takes a plan number')
    const branch = branchOf(planPath(nnn), nnn)
    const base = `origin/${runBranch(run)}`
    const wt = builderFolder(run, nnn)
    fetchOrigin()
    if (!refExists(base)) fail(`${base} not found — run init first`)
    const lines = []
    if (!existsSync(wt)) {
      const exists = refExists(`refs/heads/${branch}`)
      const w = exists ? git(root, 'worktree', 'add', '--quiet', wt, branch) : git(root, 'worktree', 'add', '--quiet', '-b', branch, wt, base)
      if (w.status !== 0) fail(`git worktree add ${wt}: ${w.err}`)
      lines.push(`${exists ? 'reused branch' : 'created'} ${branch} in ${wt}`)
    }
    const head = git(wt, 'rev-parse', '--abbrev-ref', 'HEAD').out
    if (head !== branch) fail(`${wt} is on ${head || '(no branch)'}, not ${branch}`)
    const dirty = git(wt, 'status', '--porcelain').out.split('\n').filter(Boolean).map((l) => l.slice(3))
    if (!dirty.length) {
      const m = git(wt, 'merge', '--quiet', '--no-edit', base)
      if (m.status !== 0) {
        git(wt, 'merge', '--abort')
        fail(`merging ${base} into ${branch} conflicts: ${m.out.split('\n').filter((l) => /CONFLICT/.test(l)).join(' | ') || m.err}`)
      }
    }
    emit({ ok: true, path: wt.replace(/\\/g, '/'), branch, base, head: git(wt, 'rev-parse', 'HEAD').out, dirty }, lines)
  },

  diff() {
    const run = runName()
    const nnn = planNumber(args.plan ?? '')
    if (!nnn) fail('--plan takes a plan number')
    const branch = branchOf(planPath(nnn), nnn)
    fetchOrigin()
    const head = refExists(`origin/${branch}`) ? `origin/${branch}` : branch
    const d = git(root, 'diff', '--name-only', `origin/${runBranch(run)}...${head}`)
    if (d.status !== 0) fail(`git diff ${runBranch(run)}...${head}: ${d.err}`)
    const files = d.out.split('\n').filter(Boolean)
    const tests = sensitiveTests()
    const sensitiveFiles = files.filter((f) => tests.some((re) => re.test(f)))
    // A diff that adds auth or permission code to a file whose path does not say so: its added lines name it.
    // A diff git could not give in full (an error, or output cut off) counts as sensitive: fail closed.
    const added = addedCodeFiles(git(root, 'diff', '-U0', '--no-color', `origin/${runBranch(run)}...${head}`), SENSITIVE_CODE_RE, sensitiveFiles)
    const codeFiles = added.files
    const unread = added.failed || d.truncated
    const sensitive = sensitiveFiles.length > 0 || codeFiles.length > 0 || unread
    emit({ ok: true, files, sensitive, sensitiveFiles, sensitiveCode: codeFiles, ...(unread ? { diffUnread: true } : {}), head: git(root, 'rev-parse', head).out },
      [`${files.length} file(s) changed, ${sensitiveFiles.length} sensitive by path, ${codeFiles.length} by added auth/permission code${unread ? '; the diff could not be read in full: sensitive' : ''}`])
  },

  set() {
    const run = runName()
    const nnn = planNumber(args.plan ?? '')
    if (!nnn) fail('--plan takes a plan number')
    if (args.card !== undefined) {
      const why = uiCardProblem({ card: args.card, page: args.page, shots: args.shots ? String(args.shots).split(',').filter(Boolean) : [] })
      if (why) fail(why)
    }
    const status = needStatus(run)
    const p = (status.plans[nnn] ??={ nnn, round: 0, models: {}, state: 'queued' })
    if (args.state !== undefined) {
      if (!PLAN_STATES.includes(args.state)) fail(`--state "${args.state}" — allowed: ${PLAN_STATES.join(', ')}`)
      p.state = args.state
    }
    if (args.round !== undefined) {
      if (!/^\d+$/.test(String(args.round))) fail('--round takes a whole number')
      p.round = Number(args.round)
    }
    for (const k of ['tier', 'sha', 'reason']) if (args[k] !== undefined && args[k] !== true) p[k] = String(args[k])
    p.models ??= {}
    if (args.role) p.models[String(args.role)] = { model: String(args.model ?? 'unknown'), ...(args.effort ? { effort: String(args.effort) } : {}) }
    // --roles orch-builder=sonnet/medium,orch-gate=haiku/low: the model each agent of this step echoed.
    if (args.roles && args.roles !== true) {
      for (const item of String(args.roles).split(',').filter(Boolean)) {
        const m = /^([\w-]+)=([^/]+)(?:\/(.*))?$/.exec(item)
        if (!m) fail(`--roles item "${item}" — use role=model/effort`)
        p.models[m[1]] = { model: m[2], ...(m[3] ? { effort: m[3] } : {}) }
      }
    }
    // --card "<title>" --card-status pass --page "<url>" --shots a.png,b.png --via script|browser: one [ui] card result
    // (its script or the browser agent), the evidence the run report groups by page. `unchecked`: a card no script could
    // check while the browser step was off. The same card title again replaces the earlier result.
    if (args.card && args.card !== true) {
      const status = String(args['card-status'] ?? '')
      if (!['pass', 'fail', 'plan-drift', 'unchecked'].includes(status)) fail(`--card-status "${status}" — allowed: pass, fail, plan-drift, unchecked`)
      const via = args.via && args.via !== true ? String(args.via) : 'browser'
      if (!['script', 'browser', 'none'].includes(via)) fail(`--via "${via}" — allowed: script, browser, none`)
      const card = { card: String(args.card), status, via, page: args.page && args.page !== true ? String(args.page) : '', screenshots: args.shots && args.shots !== true ? String(args.shots).split(',').filter(Boolean) : [], round: p.round }
      p.uiCards = [...(p.uiCards ?? []).filter((c) => c.card !== card.card), card]
    }
    p.freeDiskGb = diskGb()
    status.freeDiskGb = p.freeDiskGb
    p.history ??= []
    p.history.push({ at: nowIso(), state: p.state, round: p.round })
    writeStatus(run, status)
    emit({ ok: true, plan: nnn, state: p.state, round: p.round }, [`${nnn}: ${p.state}, round ${p.round}`])
  },

  // The hand-off file a fresh builder reads (docs/agent/model-routing.md rule 5), written from the failure facts.
  handoff() {
    const run = runName()
    const nnn = planNumber(args.plan ?? '')
    if (!nnn) fail('--plan takes a plan number')
    const branch = branchOf(planPath(nnn), nnn)
    const head = refExists(`origin/${branch}`) ? `origin/${branch}` : branch
    const files = git(root, 'diff', '--name-only', `origin/${runBranch(run)}...${head}`).out.split('\n').filter(Boolean)
    const val = (k) => (args[k] && args[k] !== true ? String(args[k]) : '(not given)')
    const rel = `.claude/sessions/orch-${run}/handoff-${nnn}.md`
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), [
      `Step:            ${val('step')} of plan ${nnn} (run ${run}, branch ${branch})`,
      `Files changed:   ${files.join(', ') || '(none)'}`,
      `Tried:           ${val('tried')}`,
      `Failing check:   ${val('check')}`,
      `Output tail:     ${val('tail')}`,
      'Suspected cause: (a guess) see the output tail; rerun the failing check first',
      '',
    ].join('\n'))
    emit({ ok: true, path: rel }, [`hand-off file ${rel}`])
  },

  note() {
    const run = runName()
    if (!args.text || args.text === true) fail('--text is empty')
    const status = needStatus(run)
    status.notes ??= []
    status.notes.push({ at: nowIso(), ...(args.plan ? { plan: planNumber(args.plan) } : {}), text: String(args.text) })
    writeStatus(run, status)
    emit({ ok: true, notes: status.notes.length })
  },

  stop() {
    const run = runName()
    const status = needStatus(run)
    status.phase = 'stopped'
    status.stopReason = String(args.reason ?? 'stopped')
    writeStatus(run, status)
    emit({ ok: true, phase: status.phase })
  },

  disk() {
    const min = args.min !== undefined ? Number(args.min) : MIN_FREE_GB
    const free = diskGb()
    const ok = free !== null && free >= min
    emit({ ok, freeGb: free, minGb: min, ...(ok ? {} : { envFailure: true, error: `free disk ${free} GB is below orchestrator.minFreeDiskGb ${min} GB` }) },
      [`${ok ? 'OK  ' : 'FAIL'} disk: ${free} GB free, ${min} GB needed`])
  },

  clean() {
    const run = runName()
    const mf = mergeFolder(run)
    if (!existsSync(mf)) fail(`no merge folder ${mf}`)
    const files = git(mf, 'status', '--porcelain').out.split('\n').filter(Boolean).map((l) => l.slice(3))
    emit({ ok: files.length === 0, clean: files.length === 0, files, ...(files.length ? { error: `uncommitted files in the merge folder: ${files.join(', ')}` } : {}) })
  },

  finish() {
    const run = runName()
    const branch = runBranch(run)
    const status = needStatus(run)
    const mf = mergeFolder(run)
    if (!existsSync(mf)) fail(`no merge folder ${mf}`)
    fetchOrigin()
    const dirty = git(mf, 'status', '--porcelain').out
    if (dirty) fail(`the merge folder ${mf} has uncommitted files: ${dirty.split('\n').map((l) => l.slice(3)).join(', ')}`)
    const ff = git(mf, 'merge', '--quiet', '--ff-only', `origin/${branch}`)
    if (ff.status !== 0) fail(`the merge folder cannot fast-forward to origin/${branch}: ${ff.err}`)
    const merged = mergedPlans(run)
    for (const m of merged) if (status.plans[m.nnn]) Object.assign(status.plans[m.nnn], { state: 'merged', sha: m.sha })
    if (status.phase === 'running') status.phase = 'finished'
    status.finishedAt = nowIso()
    writeStatus(run, status)
    const report = formatReport({ status, merged, mainShaNow: git(root, 'rev-parse', `origin/${MAIN}`).out, finishedAt: status.finishedAt, runBranch: branch, mainBranch: MAIN })
    const rel = `docs/orchestrator/runs/${run}`
    mkdirSync(join(mf, rel), { recursive: true })
    writeFileSync(join(mf, rel, 'report.md'), report)
    writeFileSync(join(mf, rel, 'status.json'), `${JSON.stringify(status, null, 2)}\n`)
    const add = git(mf, 'add', '--', `${rel}/report.md`, `${rel}/status.json`)
    if (add.status !== 0) fail(`git add the report: ${add.err}`)
    const c = git(mf, 'commit', '--quiet', '-m', `orch(${run}): run report`)
    if (c.status !== 0 && !/nothing to commit/.test(c.out + c.err)) fail(`git commit the report: ${(c.err || c.out).split('\n').pop()}`)
    const p = git(mf, 'push', '--quiet', 'origin', branch)
    if (p.status !== 0) fail(`git push origin ${branch}: ${p.err.split('\n').pop()}`, { envFailure: true })
    const local = join(runsDir(), `${run}.md`)
    mkdirSync(runsDir(), { recursive: true })
    writeFileSync(local, report)
    const left = git(mf, 'status', '--porcelain').out
    const parked = Object.values(status.plans).filter((x) => x.state === 'parked' || x.state === 'left-run').map((x) => x.nnn)
    emit({ ok: !left, report: `${rel}/report.md`, local: local.replace(/\\/g, '/'), merged: merged.map((m) => m.nnn), parked, phase: status.phase, ...(left ? { error: `merge folder not clean: ${left}` } : {}) },
      [`report: ${rel}/report.md on ${branch}; local copy ${local}`, `merged ${merged.length}: ${merged.map((m) => m.nnn).join(', ') || 'none'}; parked ${parked.length}: ${parked.join(', ') || 'none'}`])
  },
}

if (!commands[cmd]) {
  console.error(`usage: node scripts/orch-state.mjs <${Object.keys(commands).join('|')}> --run <name> …`)
  process.exit(2)
}
commands[cmd]()
