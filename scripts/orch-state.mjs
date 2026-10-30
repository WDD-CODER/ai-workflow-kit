/**
 * Orchestrator state — everything the orchestrator workflow (.claude/workflows/orchestrate.js) cannot do itself:
 * a workflow script has no file system, git or clock, so it runs this script through the mechanical runner agent.
 * Git is the ledger; status.json is the readable state. Rules: docs/agent/orchestrator.md.
 *
 *   node scripts/orch-state.mjs init       --run <name> [--started <iso>]   run branch + merge folder + status.json
 *   node scripts/orch-state.mjs order      --run <name> --plans <NNN,NNN>  waves from plan-order (merged plans left out)
 *   node scripts/orch-state.mjs done       --run <name>                     plans merged into the run branch (from git)
 *   node scripts/orch-state.mjs check-files --plan <NNN> --files a,b        the check files that do not exist and that the plan does not create
 *   node scripts/orch-state.mjs plan-info  --run <name> --plan <NNN>        path, branch, start tier, [human] and [ui] items
 *   node scripts/orch-state.mjs worktree   --run <name> --plan <NNN>        the builder's folder on its plan branch: an idle
 *                                          wt-N slot first (orchestrator.useSlots), else its own folder; packages installed
 *   node scripts/orch-state.mjs release    --run <name> --plan <NNN>        gives the plan's slot back (detached, marker removed)
 *   node scripts/orch-state.mjs diff       --run <name> --plan <NNN>        changed files vs the run branch, sensitive?
 *   node scripts/orch-state.mjs set        --run <name> --plan <NNN> [--state s] [--round n] [--tier t] [--sha x]
 *                                          [--role r --model m --effort e | --roles r=m/e,r2=m2/e2] [--reason "<text>"]
 *                                          [--card "<title>" --card-status s --page <url> --shots a.png,b.png --via script|browser]
 *   node scripts/orch-state.mjs handoff    --run <name> --plan <NNN> --step s --check c --tail t --tried x
 *                                          the hand-off file a fresh judgment-tier builder reads
 *   node scripts/orch-state.mjs note       --run <name> [--plan <NNN>] --text "<decision>"
 *   node scripts/orch-state.mjs stop       --run <name> --reason "<why the run stopped>"   (gives every held slot back)
 *   node scripts/orch-state.mjs watch      --run <name> [--stale-min <n>]   one line: RUNNING, FINISHED, STOPPED: <why>
 *                                          or STUCK: plan <NNN> · <state> · no progress for <n> min · last: <note>
 *                                          (exit 1); reads status.json only — no git, no agent, no lock
 *   node scripts/orch-state.mjs disk       [--min <gb>]                     free disk vs orchestrator.minFreeDiskGb
 *   node scripts/orch-state.mjs clean      --run <name>                     the merge folder has no uncommitted file
 *   node scripts/orch-state.mjs finish     --run <name>                     report on the run branch + local copy
 *                                          (the local copy first, so a report exists whatever the merge folder's state;
 *                                          gives every held slot back)
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
import { readFileSync, writeFileSync, mkdirSync, existsSync, statfsSync, openSync, closeSync, statSync, unlinkSync, renameSync, linkSync } from 'fs'
import { spawnSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { findOpenPlan } from './lib/plan-paths.mjs'
import { planNumber, planTitle, mergeSubjectRe } from './lib/plan-deps.mjs'
import { uiItems } from './lib/done-when.mjs'
import { listSlots } from './lib/slot.mjs'
import { ensureDeps, idleSlot, claimSlot, releaseSlot, releaseRunSlots } from './lib/orch-folders.mjs'
import { runNameProblem, PLAN_STATES, planBranch, planBranchProblem, startTier, humanItems, freeGb, formatReport, addedCodeFiles, uiCardProblem, watchLine, logQueryArgs } from './lib/orch-run.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAIN = 'main'
const PREFIX = 'orch/'
const MIN_FREE_GB = 5
const REPO = 'ai-workflow-kit'
const PM = 'npm' === 'pnpm' ? 'pnpm' : 'npm'
const USE_SLOTS = true !== false
const SERVER_ROOT = ''
// Minutes without a status.json update after which `watch` prints STUCK (orchestrator.staleMin).
const STALE_MIN = 10
// The project's log query (commands.logQuery, optional): `finish` runs it once from the main folder for the report's
// "App errors since the run started" section, with --since=plan-start replaced by the run's start time.
const LOG_QUERY = ""
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
const FLAGS = new Set(['run', 'started', 'plans', 'plan', 'state', 'round', 'tier', 'sha', 'role', 'model', 'effort', 'roles', 'reason', 'card', 'card-status', 'page', 'shots', 'via', 'step', 'check', 'tail', 'tried', 'text', 'min', 'stale-min', 'files'])
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
// Every read takes the run's lock file (an O_EXCL create, retried; a lock older than LOCK_STALE_MS is taken over, see
// takeOverStale) and holds it until this short-lived process exits; every write goes to a temp file renamed into place.
const LOCK_STALE_MS = 30000
const LOCK_WAIT_MS = 60000
// The lock file holds its owner's token. A stale lock is taken over by renaming it to a name of this process's own
// (a rename moves one file once, so two takers never both remove the same lock) and checking the moved file is the
// stale lock that was seen; a fresh lock moved by mistake (another taker replaced the stale one in between) is put
// back with an exclusive link. Only the O_EXCL create makes an owner. On exit a process removes the lock only while
// it still holds its own token.
const lockPath = (run) => join(runsDir(), `${run}.lock`)
const heldLocks = new Map()
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const readLock = (p) => {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}
function takeOverStale(p, token) {
  let seen
  try {
    if (Date.now() - statSync(p).mtimeMs <= LOCK_STALE_MS) return
    seen = readLock(p)
  } catch {
    return // gone already
  }
  if (seen === null) return
  const moved = `${p}.${token}.stale`
  try {
    renameSync(p, moved)
  } catch {
    return // another taker moved it first
  }
  let movedStale = false
  try {
    movedStale = Date.now() - statSync(moved).mtimeMs > LOCK_STALE_MS
  } catch { /* unreadable: treated as fresh */ }
  if (!movedStale || readLock(moved) !== seen) {
    // Not the stale lock seen above: a fresh owner's lock. Put it back (link fails when a lock exists again).
    try {
      linkSync(moved, p)
    } catch { /* a new lock is in place */ }
  }
  try {
    unlinkSync(moved)
  } catch { /* already gone */ }
}
function lockRun(run) {
  if (heldLocks.has(run)) return
  const p = lockPath(run)
  mkdirSync(runsDir(), { recursive: true })
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const until = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      const fd = openSync(p, 'wx')
      try {
        writeFileSync(fd, token)
      } finally {
        closeSync(fd)
      }
      heldLocks.set(run, token)
      return
    } catch (e) {
      if (!['EEXIST', 'EPERM', 'EACCES'].includes(e.code)) throw e
    }
    takeOverStale(p, token)
    if (Date.now() > until) fail(`status.json of run "${run}" stays locked by ${p} — another orch-state process is stuck`, { envFailure: true })
    pause(15 + Math.floor(Math.random() * 25))
  }
}
process.on('exit', () => {
  for (const [run, token] of heldLocks) {
    try {
      if (readLock(lockPath(run)) === token) unlinkSync(lockPath(run))
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
      if (refExists(`origin/${branch}`)) {
        const ff = git(mf, 'merge', '--quiet', '--ff-only', `origin/${branch}`)
        if (ff.status !== 0) fail(`the merge folder cannot fast-forward to origin/${branch}: ${ff.err}`)
      }
    }
    if (!refExists(`origin/${branch}`)) {
      // The run branch gets a first commit of its own (empty). A builder branch cut from it is then never an ancestor
      // of origin/<main>, so a Planner session's free-merged-slots cannot free a slot the run has just claimed (a fresh
      // branch equal to origin/<main> looks merged until its first file change).
      if (git(mf, 'rev-list', '--count', `origin/${MAIN}..HEAD`).out === '0') {
        const c = git(mf, 'commit', '--quiet', '--allow-empty', '-m', `orch(${run}): run start`)
        if (c.status !== 0) fail(`git commit the run start in ${mf}: ${(c.err || c.out).split('\n').pop()}`, { envFailure: true })
        lines.push(`run start commit on ${branch}`)
      }
      const p = git(mf, 'push', '--quiet', '-u', 'origin', branch)
      if (p.status !== 0) fail(`git push origin ${branch}: ${p.err.split('\n').pop()}`, { envFailure: true })
      lines.push(`pushed ${branch}`)
    }
    // The merge step runs the project checks in this folder: a worktree starts without packages (a run lost its
    // finished plan to `'ng' is not recognized`). A reused folder that has them installs nothing.
    let deps
    try {
      deps = ensureDeps({ mainRoot: root, dst: mf, serverRoot: SERVER_ROOT, pm: PM })
    } catch (e) {
      fail(`installing the packages in the merge folder ${mf}: ${e.message}`, { envFailure: true })
    }
    lines.push(...deps.lines)
    if (!deps.ok) fail(`the merge folder ${mf} has no scripts/node_modules (picomatch): ${deps.lines.join('; ') || 'no package.json in scripts/?'}`, { envFailure: true })
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
    // The final gate adds the kit manifest check (the PR's rules job) when the project has both the manifest and the script.
    const kitManifest = existsSync(join(mf, 'docs', 'workflow-kit', 'manifest.json')) && existsSync(join(mf, 'scripts', 'kit-manifest-check.mjs'))
    emit({ ok: true, run, branch, mergeFolder: mf.replace(/\\/g, '/'), done: done.map((m) => m.nnn), mainSha: status.mainShaAtStart, attempt: status.attempts, startedAt: status.startedAt, kitManifest },
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

  // Readiness asks which of a plan's check files cannot exist when the check runs: a file that is neither in the main
  // folder nor named in the plan's own text (a plan may create its own script) can never pass, whatever a builder does.
  'check-files'() {
    const nnn = planNumber(args.plan ?? '')
    if (!nnn) fail('--plan takes a plan number')
    const text = readFileSync(join(root, planPath(nnn)), 'utf8')
    const files = String(args.files ?? '').split(',').map((f) => f.trim()).filter(Boolean)
    if (files.some((f) => !/^(?!-)(?!.*\.\.)[A-Za-z0-9_./-]+$/.test(f))) fail('--files takes safe relative paths, comma-separated')
    const missing = files.filter((f) => !existsSync(join(root, f)) && !text.includes(f))
    emit({ ok: true, nnn, missing }, [missing.length ? `plan ${nnn}: no such file, and the plan does not create it: ${missing.join(', ')}` : `plan ${nnn}: every check file exists or is created by the plan`])
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
    const own = builderFolder(run, nnn)
    fetchOrigin()
    if (!refExists(base)) fail(`${base} not found — run init first`)
    const lines = []
    const planFile = planPath(nnn)
    const exists = refExists(`refs/heads/${branch}`)
    // A folder this plan already has wins (a relaunch): its own folder, or the slot it claimed earlier. Else an idle
    // permanent slot (detached, no marker, clean — a slot a person is using is never taken), else a new folder.
    const slots = USE_SLOTS ? listSlots() : []
    let slot = slots.find((s) => s.plan === planFile && s.branch === branch) ?? null
    let wt = slot ? slot.path : own
    if (!slot && !existsSync(own)) {
      const free = idleSlot(slots)
      if (free) {
        const c = claimSlot({ slot: free, branch, base, planPath: planFile, branchExists: exists })
        if (!c.ok) fail(c.error)
        slot = free
        wt = free.path
        lines.push(`claimed slot wt-${free.slot} (${wt}) for plan ${nnn}: ${branch}`)
      } else {
        const w = exists ? git(root, 'worktree', 'add', '--quiet', own, branch) : git(root, 'worktree', 'add', '--quiet', '-b', branch, own, base)
        if (w.status !== 0) fail(`git worktree add ${own}: ${w.err}`)
        lines.push(`${exists ? 'reused branch' : 'created'} ${branch} in ${own}${USE_SLOTS ? ' (no idle slot)' : ''}`)
      }
    }
    // An idle slot already has its packages; a folder of its own installs once, before the builder starts (the scope
    // guard refuses every edit without scripts/node_modules).
    let deps
    try {
      deps = ensureDeps({ mainRoot: root, dst: wt, serverRoot: SERVER_ROOT, pm: PM })
    } catch (e) {
      fail(`installing the packages in ${wt}: ${e.message}`, { envFailure: true })
    }
    lines.push(...deps.lines)
    if (!deps.ok) fail(`${wt} has no scripts/node_modules (picomatch): the scope guard would refuse every edit — ${deps.lines.join('; ') || 'no package.json in scripts/?'}`, { envFailure: true })
    const st = readStatus(run)
    if (st?.plans?.[nnn]) {
      if (slot) st.plans[nnn].slot = wt.replace(/\\/g, '/')
      else delete st.plans[nnn].slot
      writeStatus(run, st)
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
    // Commits the branch already has beyond the run branch: a relaunch or a stopped run continues from them.
    const ahead = Number(git(wt, 'rev-list', '--count', `${base}..HEAD`).out) || 0
    emit({ ok: true, path: wt.replace(/\\/g, '/'), branch, base, head: git(wt, 'rev-parse', 'HEAD').out, dirty, ...(slot ? { slot: slot.slot } : {}), ...(ahead ? { resumed: ahead } : {}) }, lines)
  },

  // Gives the plan's slot back once the plan is merged or parked. Never discards: a slot with uncommitted files or
  // unpushed commits stays claimed, and the line says why. A plan that built in its own folder has nothing to release.
  release() {
    const run = runName()
    const nnn = planNumber(args.plan ?? '')
    if (!nnn) fail('--plan takes a plan number')
    const branch = branchOf(planPath(nnn), nnn)
    const planFile = planPath(nnn)
    const slot = listSlots().find((s) => s.plan === planFile) ?? null
    if (!slot) emit({ ok: true, released: false, why: 'built in its own folder' }, [`plan ${nnn}: no slot to release`])
    fetchOrigin()
    const target = `origin/${runBranch(run)}`
    const r = releaseSlot({ path: slot.path, branch, target: refExists(target) ? target : `origin/${MAIN}` })
    const st = readStatus(run)
    if (r.released && st?.plans?.[nnn]) {
      delete st.plans[nnn].slot
      writeStatus(run, st)
    }
    emit({ ok: true, ...r, slot: slot.slot }, [r.released ? `plan ${nnn}: slot wt-${slot.slot} released` : `plan ${nnn}: slot wt-${slot.slot} kept — ${r.why}`])
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
    const slots = giveSlotsBack(run, status)
    writeStatus(run, status)
    emit({ ok: true, phase: status.phase, slots: slots.lines }, slots.lines)
  },

  // One line that says whether the run is stuck, from status.json only (no git, no agent, no lock): RUNNING,
  // FINISHED, STOPPED: <reason>, or STUCK: … (exit 1) when the run made no progress for orchestrator.staleMin
  // minutes (--stale-min overrides) or one plan noted the same reason twice in a row.
  watch() {
    const run = runName()
    const p = statusPath(run)
    if (!existsSync(p)) fail(`no run "${run}" — start it with: node scripts/orch-state.mjs init --run ${run}`)
    let status
    try {
      status = JSON.parse(readFileSync(p, 'utf8'))
    } catch (e) {
      fail(`status.json of run "${run}" is unreadable: ${e.message}`)
    }
    const staleMin = args['stale-min'] !== undefined ? Number(args['stale-min']) : STALE_MIN
    if (!(Number.isFinite(staleMin) && staleMin > 0)) fail('--stale-min takes a number of minutes')
    const w = watchLine(status, { nowMs: Date.now(), staleMin })
    emit({ ok: !w.stuck, stuck: w.stuck, line: w.line, phase: status.phase ?? 'unknown', updatedAt: status.updatedAt ?? null }, [w.line])
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

  // The report, every time: the local copy (.claude/orchestrator-runs/<run>.md) is written first, from status.json and
  // the merges git shows, so a merge folder that is dirty or cannot fast-forward still leaves a report; the copy on the
  // run branch is committed after, and a failure there names the local file.
  finish() {
    const run = runName()
    const branch = runBranch(run)
    const status = needStatus(run)
    const mf = mergeFolder(run)
    fetchOrigin()
    const merged = mergedPlans(run)
    for (const m of merged) if (status.plans[m.nnn]) Object.assign(status.plans[m.nnn], { state: 'merged', sha: m.sha })
    if (status.phase === 'running') status.phase = 'finished'
    status.finishedAt = nowIso()
    const slots = giveSlotsBack(run, status)
    writeStatus(run, status)
    const mainShaNow = git(root, 'rev-parse', `origin/${MAIN}`).out
    // The files main changed during the run: a commit that touches only plans and the todo list (the Planner's own
    // pushes) does not make main "touched".
    const changed = status.mainShaAtStart && status.mainShaAtStart !== mainShaNow ? git(root, 'diff', '--name-only', status.mainShaAtStart, mainShaNow) : null
    const mainChangedFiles = changed && changed.status === 0 ? changed.out.split('\n').map((l) => l.trim()).filter(Boolean) : null
    const appErrors = runLogQuery(status.startedAt)
    const report = formatReport({ status, merged, mainShaNow, finishedAt: status.finishedAt, runBranch: branch, mainBranch: MAIN, mainChangedFiles, appErrors })
    const local = join(runsDir(), `${run}.md`)
    mkdirSync(runsDir(), { recursive: true })
    writeFileSync(local, report)
    const parked = Object.values(status.plans).filter((x) => x.state === 'parked' || x.state === 'left-run').map((x) => x.nnn)
    const rel = `docs/orchestrator/runs/${run}`
    const base = { report: `${rel}/report.md`, local: local.replace(/\\/g, '/'), merged: merged.map((m) => m.nnn), parked, phase: status.phase, slots: slots.lines }
    const notCommitted = (error, extra = {}) => emit({ ok: false, ...base, reportCommitted: false, error: `${error} — the report is in ${local}`, ...extra },
      [...slots.lines, `report: local copy ${local} (not committed to ${branch}: ${error})`])
    if (!existsSync(mf)) notCommitted(`no merge folder ${mf}`)
    const dirty = git(mf, 'status', '--porcelain').out
    if (dirty) notCommitted(`the merge folder ${mf} has uncommitted files: ${dirty.split('\n').map((l) => l.slice(3)).join(', ')}`)
    const ff = git(mf, 'merge', '--quiet', '--ff-only', `origin/${branch}`)
    if (ff.status !== 0) notCommitted(`the merge folder cannot fast-forward to origin/${branch}: ${ff.err}`)
    mkdirSync(join(mf, rel), { recursive: true })
    writeFileSync(join(mf, rel, 'report.md'), report)
    writeFileSync(join(mf, rel, 'status.json'), `${JSON.stringify(status, null, 2)}\n`)
    const add = git(mf, 'add', '--', `${rel}/report.md`, `${rel}/status.json`)
    if (add.status !== 0) notCommitted(`git add the report: ${add.err}`)
    const c = git(mf, 'commit', '--quiet', '-m', `orch(${run}): run report`)
    if (c.status !== 0 && !/nothing to commit/.test(c.out + c.err)) notCommitted(`git commit the report: ${(c.err || c.out).split('\n').pop()}`)
    const p = git(mf, 'push', '--quiet', 'origin', branch)
    if (p.status !== 0) notCommitted(`git push origin ${branch}: ${p.err.split('\n').pop()}`, { envFailure: true })
    const left = git(mf, 'status', '--porcelain').out
    emit({ ok: !left, ...base, reportCommitted: true, ...(left ? { error: `merge folder not clean: ${left}` } : {}) },
      [...slots.lines, `report: ${rel}/report.md on ${branch}; local copy ${local}`, `merged ${merged.length}: ${merged.map((m) => m.nnn).join(', ') || 'none'}; parked ${parked.length}: ${parked.join(', ') || 'none'}`])
  },
}

// The app errors logged since the run started, for the report: the project's commands.logQuery run once from the main
// folder (no shell; node scripts/… or node tools/… only), --since=plan-start replaced by the run's start time. The
// output is shown as is (first 20 lines), never parsed. Unset → null (no section).
function runLogQuery(startedAt) {
  const args = logQueryArgs(LOG_QUERY, startedAt)
  if (!args) return null
  if (args.error) return { command: String(LOG_QUERY), error: args.error }
  const r = spawnSync(process.execPath, args.args, { cwd: root, encoding: 'utf8', timeout: 60000, shell: false })
  if (r.error) return { command: args.command, error: r.error.message }
  const lines = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim())
  return { command: args.command, exit: r.status, lines: lines.slice(0, 20), more: Math.max(0, lines.length - 20) }
}

// Every slot the run still holds (status.plans[n].slot) is given back when the run stops or finishes, through the
// same releaseSlot as `release`: a slot with uncommitted files or unpushed commits is kept and the line says why.
// The target is the run branch on origin, else origin/<main>, else the local main branch (a scratch repository).
function giveSlotsBack(run, status) {
  const held = Object.values(status.plans ?? {}).filter((p) => p.slot)
  if (!held.length) return { lines: [], released: 0 }
  const target = [`origin/${runBranch(run)}`, `origin/${MAIN}`, MAIN].find((ref) => refExists(ref)) ?? MAIN
  const r = releaseRunSlots({ status, slots: listSlots(), target })
  if (r.lines.length) {
    status.notes ??= []
    status.notes.push({ at: nowIso(), text: `slots given back when the run ${status.phase}: ${r.lines.join('; ')}` })
  }
  return r
}

if (!commands[cmd]) {
  console.error(`usage: node scripts/orch-state.mjs <${Object.keys(commands).join('|')}> --run <name> …`)
  process.exit(2)
}
commands[cmd]()
