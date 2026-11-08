/**
 * Orchestrator state — the run's state and git steps, called by scripts/run-plans.mjs.
 * Git is the ledger; status.json is the readable state. Rules: docs/agent/orchestrator.md.
 *
 *   node scripts/orch-state.mjs init       --run <name> [--started <iso>]   run branch + merge folder + status.json
 *   node scripts/orch-state.mjs order      --run <name> --plans <NNN,NNN>  waves from plan-order (merged plans left out)
 *   node scripts/orch-state.mjs done       --run <name>                     plans merged into the run branch (from git)
 *   node scripts/orch-state.mjs check-files --plan <NNN> --files a,b        the check files that do not exist and that the plan does not create
 *   node scripts/orch-state.mjs scripts                                      package.json scripts as { name: body } (readiness maps npx checks)
 *   node scripts/orch-state.mjs prepare    --missing <path> --script <name> [--in <folder>] [--pm npm|pnpm]   runs the script when <path> is absent (orchestrator.prepare)
 *   node scripts/orch-state.mjs plan-info  --run <name> --plan <NNN>        path, branch, start tier, [human] and [ui] items
 *                                          [--no-notes]: also a copy without ## Execution Notes (reviewPath, the checkers' PLAN)
 *   node scripts/orch-state.mjs worktree   --run <name> --plan <NNN>        the builder's folder on its plan branch: an idle
 *                                          wt-N slot first (orchestrator.useSlots), else its own folder; packages installed
 *   node scripts/orch-state.mjs release    --run <name> --plan <NNN>        gives the plan's slot back (detached, marker removed)
 *   node scripts/orch-state.mjs park-save  --run <name> --plan <NNN>        uncommitted work to park/<run>-<NNN> (pushed), slot released
 *   node scripts/orch-state.mjs park-record --run <name> --plan <NNN> [--reason t] [--sha x]   the park, recorded once
 *   node scripts/orch-state.mjs park       --run <name> --plan <NNN> [--reason-b64 b]   the whole teardown (runs plan-park.mjs), then park-branch
 *   node scripts/orch-state.mjs park-branch --run <name> --plan <NNN>      feat/<NNN>-<slug> renamed to park/<run>-<NNN> (local and origin)
 *   node scripts/orch-state.mjs merge-verify --run <name> --plan <NNN>      HEAD^2 of the merge folder == checkedHead, else reset to HEAD^
 *   node scripts/orch-state.mjs touch      --run <name>                     renews updatedAt (run-plans' heartbeat while a step runs)
 *   node scripts/orch-state.mjs diff       --run <name> --plan <NNN>        changed files vs the run branch, sensitive?
 *   node scripts/orch-state.mjs set        --run <name> --plan <NNN> [--state s] [--round n] [--tier t] [--sha x]
 *                                          [--role r --model m --effort e | --roles r=m/e,r2=m2/e2] [--reason "<text>"]
 *                                          [--card "<title>" --card-status s --page <url> --shots a.png,b.png --via script|browser]
 *                                          facts for the lessons: [--candidates m --refuted n --refuted-rules "a|b" --verify-by "role=m/n/a|b;…"
 *                                          --late-low "a|b" --reappeared "a|b"] [--miss "<what>"] [--round-cause "round 2: <why>"]
 *                                          [--gate-event "<text>"] [--asked "q1 || q2" --ready yes|no]
 *                                          [--calls-b64 <base64 JSON list of { stage, model, seconds, input, output, exit }>]
 *   node scripts/orch-state.mjs flake     --run <name> [--plan <NNN>] --command "<cmd>" [--round n] --via rerun|same-commit --where gate|main|final [--sha x]
 *                                          records a check that passed only on a rerun (plans[NNN].flakes[], run-level flakes[])
 *   node scripts/orch-state.mjs handoff    --run <name> --plan <NNN> --step s --check c --tail t --tried x [--failed t] [--replan yes|no --replan-why t --not-done t]
 *                                          the hand-off file a fresh judgment-tier builder reads (the escalation is recorded);
 *                                          its Done: line is derived here (ticked sub-task ids in the plan + the branch diff)
 *                                          [--reset-base]: then the plan's folder goes back to the branch's base (clean,
 *                                          origin/<branch> follows with a lease); status.json keeps resetToBase / resetFrom
 *   node scripts/orch-state.mjs context    [--run <name>]                   LESSONS / RULES / RECENT_RUNS for the roles (read-only) and their size
 *   node scripts/orch-state.mjs lessons    --run <name>                     lesson lines from status.json into docs/brain/agent-lessons/ (no model call)
 *   node scripts/orch-state.mjs note       --run <name> [--plan <NNN>] --text "<decision>"
 *   node scripts/orch-state.mjs decision   --run <name> --plan <NNN> --id D<n> --text "<line>" [--verdict v --kind k --confidence n
 *                                          --rec "<text>" --why "<text>" --forced f]   record one decision (upsert by id), or
 *                                          --plan <NNN> --dup-of D<n> --text "<line>" --role r --round n   a duplicate of one
 *   node scripts/orch-state.mjs decisions  --run <name> --b64 <base64 of a JSON list of decision objects>   every decision in one call, all-or-nothing
 *   node scripts/orch-state.mjs brain-commit --run <name>                   commit docs/brain in the merge folder, push the run branch
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
 * Every command prints its facts, then one last line `ORCH_JSON <json>` run-plans.mjs reads. Exit 0 when `ok`, else 1.
 * Values arrive as `--key=value` arguments (run-plans.mjs) or `--key value` (a value may not start with "-"), never as a
 * shell string; an unknown flag is refused; nothing from plan text is run. Paths:
 *   status     .claude/orchestrator-runs/<run>/status.json (main folder, gitignored; copied to the run branch by finish)
 *   report     docs/orchestrator/runs/<run>/report.md on the run branch, and .claude/orchestrator-runs/<run>.md
 *   merge      <parent>/<repo>-orch-merge-<run> (a worktree on the run branch; only merges and the report commit)
 *   builders   <parent>/<repo>-orch-<run>-<NNN> (a worktree on the plan branch)
 * ORCH_FREE_GB (a number) replaces the measured free disk — for tests only.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statfsSync, openSync, closeSync, statSync, unlinkSync, renameSync, linkSync } from 'fs'
import { spawnSync } from 'child_process'
import { resolve, dirname, join, relative } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { findOpenPlan } from './lib/plan-paths.mjs'
import { extractScopeGlobs, testFilesOutOfScope, removedLinesByFile } from './lib/plan-scope.mjs'
import { scopeTestsLint } from './lib/scope-tests-lint.mjs'
import { planNumber, planTitle, mergeSubjectRe } from './lib/plan-deps.mjs'
import { uiItems } from './lib/done-when.mjs'
import { listSlots } from './lib/slot.mjs'
import { ensureDeps, idleSlot, claimSlot, releaseSlot, releaseRunSlots } from './lib/orch-folders.mjs'
import { agreementStats, addLesson, lessonParts, ruleLines, LESSON_ROLES } from './decision-log.mjs'
import { planWithoutNotes, triageForce, triageView, decisionsInView, mergePlanFile, decisionType, runNameProblem, PLAN_STATES, planBranch, planBranchProblem, startTier, humanItems, freeGb, formatReport, addedCodeFiles, uiCardProblem, watchLine, planLines, logQueryArgs, lessonFacts, runLogRow, updateRunLog, parseRunLog, parseDecisionRows, trendOf, contextBudget, INJECTED_ROLES } from './lib/orch-run.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAIN = '{{git.mainBranch}}'
const PREFIX = '{{orchestrator.runBranchPrefix}}'
const MIN_FREE_GB = {{orchestrator.minFreeDiskGb|json}}
const REPO = '{{project.repoName}}'
const PM = '{{project.packageManager}}' === 'pnpm' ? 'pnpm' : 'npm'
// Builders take a Human's wt-N slot only when a project sets orchestrator.useSlots to true (the scaffold says false);
// otherwise they get folders of their own (one per plan in flight, so at most orchestrator.concurrency at once).
const USE_SLOTS = {{orchestrator.useSlots|json}} !== false
const SERVER_ROOT = '{{paths.serverRoot}}'
// Minutes without a status.json update after which `watch` prints STUCK (orchestrator.staleMin).
const STALE_MIN = {{orchestrator.staleMin|json}}
// The project's log query (commands.logQuery, optional): `finish` runs it once from the main folder for the report's
// "App errors since the run started" section, with --since=plan-start replaced by the run's start time.
const LOG_QUERY = {{commands.logQuery|json}}
// The decision triage (docs/agent/decision-review.md §5): how the report shows the decisions, and when a kind collapses.
// Fixed since the triage keys left the config (scripts/run-plans.mjs runs no triage; the report shows every decision).
const TRIAGE = "shadow"
const TRIAGE_MIN_AGREEMENT = 0.9
const TRIAGE_MIN_GRADED = 20
// Minutes one `prepare` script may run before it is stopped (orchestrator.gateTimeoutMin, the gate's own limit).
const GATE_TIMEOUT_MIN = {{orchestrator.gateTimeoutMin|json}}
// Sensitive paths (the security reviewer runs on them): the same reading as ship-prep — a regex string replaces the
// built-in list, a list of globs is added to it.
const DEFAULT_SENSITIVE_RE = /auth|crypto|guard|interceptor|security|permission|payment|migration|secret|\.env|\.github\/workflows/i
const picomatch = createRequire(import.meta.url)('picomatch') // scripts/node_modules (the scope guard needs it too)
const SENSITIVE_CFG ={{security.sensitivePaths|json}}
// Added lines that name auth or permission code (the security reviewer runs on them whatever the file path).
// No word boundary before the stems, so camelCase names (checkAuthToken, hasPermission) match too.
const SENSITIVE_CODE_RE = /auth|permission|password|jwt|session[_-]?id|tokens?\b|\broles?\b/i

// Every flag takes a value. run-plans.mjs passes `--key=value` (one token, so a value can never become a flag); a
// human may write `--key value`, where a value starting with "-" is refused. An unknown flag (--root among them: the
// folder is always this script's own project) or a second positional word stops the command.
const FLAGS = new Set(['run', 'started', 'plans', 'plan', 'state', 'round', 'tier', 'sha', 'checked-head','role', 'model', 'effort', 'roles', 'reason', 'card', 'card-status', 'page', 'shots', 'via', 'step', 'check', 'tail', 'tried', 'text', 'min', 'stale-min', 'files', 'cmd', 'id', 'verdict', 'kind', 'confidence', 'rec', 'why', 'forced', 'dup-of', 'command', 'where',
  // facts recorded for the lessons (docs/agent/orchestrator.md "State rules"), and `finish` options
  'candidates', 'refuted', 'refuted-rules', 'verify-by', 'late-low', 'reappeared', 'miss', 'round-cause', 'gate-event', 'asked', 'ready', 'final-gate', 'final-gate-command', 'final-gate-command-b64', 'final-gate-tail-b64', 'final-gate-plans', 'result',
  // the hand-off's replan verdict and the builder's receipt
  'replan', 'replan-why', 'not-done', 'failed',
  // run notes riding on set, and the one-call decisions list
  'note', 'b64', 'with-worktree',
  // a reason as base64 of its UTF-8 text (quotes, brackets and $ survive any shell)
  'reason-b64',
  // `prepare`: the generated path, the npm script, the folder it runs in and the package manager
  'missing', 'script', 'in', 'pm',
  // switches (no value needed; `--key=<value>` is accepted too): plan-info's redacted copy, handoff's reset to the base
  'no-notes', 'reset-base',
  // run-plans.mjs: the model calls of a step (base64 JSON list of { stage, model, seconds, input, output, exit })
  'calls-b64',
  // run-plans.mjs: the tier of the model a call starts on (with --role/--model)
  'model-tier',
  // the plan-file change record (plan-changed) and the park branch a resumed plan is cut from (worktree, plan-info)
  'commit', 'author', 'subject', 'diff-b64', 'warning-b64', 'from-branch'])
const SWITCHES = new Set(['no-notes', 'reset-base'])
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
    else if (SWITCHES.has(key)) out[key] = true
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) out[key] = argv[++i]
    else return { problem: `--${key} needs a value (use --${key}=<value>)` }
  }
  return { args: out }
}

const parsed = parseArgs(process.argv.slice(2))
const args = parsed.args ?? { _: [] }
// --reason-b64 stands for --reason: decoded here, so every command that reads a reason takes either form.
if (args['reason-b64'] !== undefined) {
  const raw = String(args['reason-b64'])
  const text = Buffer.from(raw, 'base64').toString('utf8')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || Buffer.from(text, 'utf8').toString('base64').replace(/=+$/, '') !== raw.replace(/=+$/, '')) parsed.problem ??= '--reason-b64 is not base64 of UTF-8 text'
  else args.reason = text
}
const cmd = args._[0]
const root = resolve(join(__dirname, '..'))
const repoName = REPO || root.split(/[\\/]/).pop()
const parent = dirname(root)
const nowIso = () => new Date().toISOString()

// `plan-info --with-worktree` runs `worktree` inside the same call: while `capture` is set, emit hands the answer back
// (thrown) instead of printing it and exiting.
let capture = false
function emit(result, lines = []) {
  if (capture) throw Object.assign(new Error('captured'), { captured: { result, lines } })
  for (const l of lines) console.log(l)
  console.log(`ORCH_JSON ${JSON.stringify(result)}`)
  process.exit(result.ok ? 0 : 1)
}
const fail = (error, extra = {}) => emit({ ok: false, error, ...extra }, [`ORCH_STATE: FAIL — ${error}`])
if (parsed.problem) fail(parsed.problem)

// Run notes: pushed to status.notes in order (`note`, and `--note "a || b"` on set for this plan).
/** The report's "## Plans changed during the run" section (from status.plansChanged), placed before the run notes. */
function withPlansChanged(status, report) {
  const list = Array.isArray(status.plansChanged) ? status.plansChanged : []
  if (!list.length) return report
  const block = ['## Plans changed during the run', '', ...list.flatMap((c) => [`- plan ${c.plan}: ${c.commit} ${c.author} — ${c.subject}`, '', '```diff', String(c.diff ?? '').split('\n').slice(0, 40).join('\n'), '```', '']), '']
  const at = report.indexOf('## Run notes')
  return at < 0 ? `${report}\n\n${block.join('\n')}` : `${report.slice(0, at)}${block.join('\n')}\n${report.slice(at)}`
}

function addNotes(status, items) {
  status.notes ??= []
  // An item with an id is recorded once: a rerun or a re-sent queue carries the same ids (status.noteIds).
  const seen = new Set(status.noteIds ?? [])
  for (const it of items) {
    const text = String(it.text ?? '').trim()
    const id = it.id === undefined ? null : String(it.id)
    if (!text || (id && seen.has(id))) continue
    if (id) {
      seen.add(id)
      ;(status.noteIds ??= []).push(id)
    }
    status.notes.push({ at: nowIso(), ...(it.plan ? { plan: it.plan } : {}), text })
  }
}

// One flake entry (the `flake` command); `a` has the flags of a `flake` call as keys. Returns { dup, text, flakes }.
function applyFlake(status, a) {
  const bad = (m) => fail(m)
  const command = a.command && a.command !== true ? String(a.command).trim() : ''
  if (!command || /[\r\n]/.test(command) || command.length > 300) bad('--command takes one check command (one line, at most 300 characters)')
  const via = String(a.via ?? '')
  if (!['rerun', 'same-commit'].includes(via)) bad(`--via "${via}" — allowed: rerun, same-commit`)
  const where = String(a.where ?? '')
  if (!['gate', 'main', 'final'].includes(where)) bad(`--where "${where}" — allowed: gate, main, final`)
  if (a.round !== undefined && !/^\d+$/.test(String(a.round))) bad('--round takes a whole number')
  const round = a.round !== undefined ? Number(a.round) : undefined
  const nnn = a.plan !== undefined ? planNumber(String(a.plan)) : null
  if (a.plan !== undefined && !nnn) bad('--plan takes a plan number')
  if (nnn && round === undefined) bad('--round is needed with --plan')
  const holder = nnn ? (status.plans[nnn] ??= { nnn, round: 0, models: {}, state: 'queued' }) : status
  holder.flakes ??= []
  const text = nnn ? `flake: ${command} (plan ${nnn}, round ${round})` : `flake: ${command} (final gate)`
  const dup = holder.flakes.some((x) => x.command === command && x.round === round)
  if (!dup) holder.flakes.push({ command, ...(round !== undefined ? { round } : {}), via, where, ...(a.sha && a.sha !== true ? { sha: String(a.sha) } : {}), at: nowIso(), text })
  return { dup, text, flakes: holder.flakes.length }
}

// The rules of one decision (shared by `decision` and `decisions`); `a` has the flags of a `decision` call as keys.
function applyDecision(status, a, where = '') {
  const bad = (m) => fail(where + m)
  const text = typeof a.text === 'string' ? a.text.trim() : ''
  if (!text) bad('--text is empty')
  status.decisions ??= []
  const plan = a.plan ? planNumber(String(a.plan)) : undefined
  if (a['dup-of']) {
    const parent = status.decisions.find((d) => d.id === a['dup-of'])
    if (!parent) bad(`no decision ${a['dup-of']} to attach a duplicate to`)
    parent.alsoFrom ??= []
    if (text !== parent.text && !parent.alsoFrom.some((x) => x.text === text)) parent.alsoFrom.push({ text, role: String(a.role ?? 'agent'), round: Number(a.round) || 0 })
    return { ok: true, id: parent.id, alsoFrom: parent.alsoFrom.length }
  }
  if (!/^D\d+$/.test(String(a.id ?? ''))) bad('--id must be D<number>')
  const at = status.decisions.findIndex((d) => d.id === a.id)
  const prev = at >= 0 ? status.decisions[at] : null
  const next = { ...(prev ?? {}), id: a.id, plan: plan ?? prev?.plan, type: decisionType(text), text, alsoFrom: prev?.alsoFrom ?? [], attempt: prev?.attempt ?? status.attempts ?? 1 }
  if (a.verdict !== undefined || !prev) {
    const confidence = a.confidence === undefined || a.confidence === '' || a.confidence === null ? null : Number(a.confidence)
    const forced = triageForce({ type: next.type, text, verdict: a.verdict, confidence })
    next.verdict = forced.verdict
    if (forced.forced) next.forced = forced.forced
    else delete next.forced
    next.kind = /^[a-z0-9][a-z0-9-]*$/.test(String(a.kind ?? '')) ? a.kind : '-'
    next.confidence = Number.isFinite(confidence) && confidence >= 0 && confidence <= 100 ? confidence : null
    next.rec = String(a.rec ?? '').slice(0, 160)
    next.why = String(a.why ?? '').slice(0, 120)
  }
  if (at >= 0) status.decisions[at] = next
  else status.decisions.push(next)
  return { ok: true, id: next.id, verdict: next.verdict, forced: next.forced ?? null, decisions: status.decisions.length }
}

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
// The builder marker `worktree` writes (lib/db-write.mjs), removed when the folder is given back. A slot released some
// other way keeps it, but it names the plan branch, and a released slot is detached: the guard then ignores it.
const dropBuilderMarker = (folder) => {
  const gitDir = git(folder, 'rev-parse', '--absolute-git-dir').out
  if (!gitDir) return
  try {
    unlinkSync(join(gitDir, 'orch-builder.json'))
  } catch { /* none */ }
}

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

// ---- the final gate's result (status.finalGate: { ok, command, at, attempt, blamed }) ------------------------------------
// One writer for run-plans.mjs (riding on `finish`) and the Human (`final-gate`): the lesson routing, the report and the run-log
// row all read this one place. A repeat of the stored outcome (same result, command, blamed plans) is a retry, not a new
// attempt, so re-sending a call changes nothing.
const cutText = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
// ---- the facts the lessons name: written here by the script, from the code's own results, never a model's text ----
/** The first path of `files` that the text names (a failing test or a lint line names the file it failed in). */
const firstNamed = (files, text) => (files ?? []).find((f) => String(text ?? '').includes(f)) ?? null
const fgWord = (status) => (status.finalGate ? (status.finalGate.ok ? 'ok' : 'failed') : 'none')
function applyFinalGate(status, result, { command = '', plans = '', tail = '' } = {}) {
  const ok = result === 'ok'
  const cmd = ok ? null : cutText(command, 200) || null
  const blamed = ok ? [] : [...new Set(String(plans).split(',').map((x) => x.trim()).filter((x) => /^\d+$/.test(x)))].sort()
  // The first failing file: a path of the blamed plans' (else any plan's) branch diff that the failing output names.
  const pool = Object.values(status.plans ?? {}).filter((q) => !blamed.length || blamed.includes(String(q.nnn))).flatMap((q) => q.diffFiles ?? [])
  const prev = status.finalGate
  // no output given (a repeat, or the Human's call): the stored file of the same command stands
  const file = ok ? null : tail ? firstNamed(pool, tail) : (prev?.command ?? null) === cmd ? prev?.file ?? null : null
  let changed = false
  if (!(prev && prev.ok === ok && (prev.command ?? null) === cmd && (prev.file ?? null) === file && JSON.stringify(prev.blamed ?? []) === JSON.stringify(blamed))) {
    status.finalGate = { ok, command: cmd, at: nowIso(), attempt: (Number(prev?.attempt) || 0) + 1, blamed, ...(file ? { file } : {}) }
    changed = true
  }
  if (ok) {
    // A pass removes what an earlier failure left: the legacy `final gate …` misses and a stop that was the final gate's.
    for (const p of Object.values(status.plans ?? {})) {
      const left = (p.misses ?? []).filter((m) => !/^final gate/.test(String(m)))
      if (left.length !== (p.misses ?? []).length) {
        p.misses = left
        changed = true
      }
    }
    // and the run notes an earlier failing gate wrote, so the report does not show a failure next to "ok"
    const notes = (status.notes ?? []).filter((n) => !/^final gate (failed|could not run)/.test(String(n?.text ?? '')))
    if (notes.length !== (status.notes ?? []).length) {
      status.notes = notes
      changed = true
    }
    if (/^final gate/.test(String(status.stopReason ?? ''))) {
      delete status.stopReason
      status.phase = status.finishedAt ? 'finished' : 'running'
      changed = true
    }
  }
  return changed
}
// The command may come base64-encoded (the workflow's way: any real command, quotes and `*` included, survives the runner's
// shell); applyFinalGate makes it one line of at most 200 characters.
const fgArgs = () => ({
  result: String(args['final-gate'] ?? ''),
  command: args['final-gate-command-b64'] !== undefined ? Buffer.from(String(args['final-gate-command-b64']), 'base64').toString('utf8') : args['final-gate-command'],
  plans: args['final-gate-plans'],
  // the failing output (cut by the workflow); only used to find which path of the branch diff it names, never stored
  tail: args['final-gate-tail-b64'] !== undefined ? Buffer.from(String(args['final-gate-tail-b64']), 'base64').toString('utf8') : '',
})

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

/** The plan without its ## Execution Notes, at .claude/orchestrator-runs/<run>/plan-<NNN>.reviewed.md; returns that path. */
function writeReviewCopy(run, nnn, text) {
  const rel = `.claude/orchestrator-runs/${run}/plan-${nnn}.reviewed.md`
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), planWithoutNotes(text))
  return rel
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

/**
 * A parked plan's branch feat/<NNN>-<slug> becomes park/<run>-<NNN> (local and origin), so the next run cuts a fresh
 * feat/<NNN> from its own run branch instead of reusing a stale one. The name is the one park-save writes: a park that
 * saved uncommitted work and a park that renamed the branch end on the same branch. Never loses a commit: park/… gets
 * the plan branch (or already holds it), and a plan branch and a park branch that went apart are joined by one merge
 * commit (the newer side's files). A branch still checked out in a folder is kept. Answers { renamed, parkBranch, what }
 * or { error }.
 */
function renameParkedBranch(run, nnn) {
  const branch = branchOf(planPath(nnn), nnn)
  const park = `park/${run}-${nnn}`
  const f = git(root, 'fetch', '--quiet', 'origin')
  if (f.status !== 0) return { renamed: false, parkBranch: null, what: `not renamed — git fetch origin: ${f.err.split('\n').pop()}`, error: `git fetch origin failed: ${f.err.split('\n').pop()}` }
  const sha = (ref) => git(root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`).out
  const isAncestor = (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: root }).status === 0
  const local = sha(`refs/heads/${branch}`)
  const remote = sha(`refs/remotes/origin/${branch}`)
  const feat = local || remote
  if (!feat) return { renamed: false, parkBranch: null, what: `no ${branch} to rename` }
  const busy = git(root, 'worktree', 'list', '--porcelain').out.split('\n').some((l) => l.trim() === `branch refs/heads/${branch}`)
  if (busy) return { renamed: false, parkBranch: null, what: `${branch} kept — still checked out in a folder` }
  // a remote plan branch with commits the local one lacks: both are kept in the park branch
  let tip = feat
  if (local && remote && !isAncestor(remote, local)) tip = isAncestor(local, remote) ? remote : null
  const parked = sha(`refs/remotes/origin/${park}`) || sha(`refs/heads/${park}`)
  const join2 = (a, b) => {
    const newer = Number(git(root, 'log', '-1', '--format=%ct', a).out) >= Number(git(root, 'log', '-1', '--format=%ct', b).out) ? a : b
    const c = git(root, 'commit-tree', `${newer}^{tree}`, '-p', a, '-p', b, '-m', `park ${run} ${nnn}: join ${branch} and ${park}`)
    return c.status === 0 ? c.out : null
  }
  if (!tip) tip = join2(local, remote)
  if (!tip) return { renamed: false, parkBranch: null, what: `${branch} kept — its local and origin heads could not be joined`, error: `joining ${branch} and origin/${branch} failed` }
  let target = tip
  if (parked) target = isAncestor(tip, parked) ? parked : isAncestor(parked, tip) ? tip : join2(parked, tip)
  if (!target) return { renamed: false, parkBranch: null, what: `${branch} kept — it could not be joined with ${park}`, error: `joining ${branch} and ${park} failed` }
  if (target !== sha(`refs/remotes/origin/${park}`)) {
    const p = git(root, 'push', '--quiet', 'origin', `${target}:refs/heads/${park}`)
    if (p.status !== 0) return { renamed: false, parkBranch: null, what: `${branch} kept — push of ${park} failed: ${p.err.split('\n').pop()}`, error: `push of ${park} failed: ${p.err.split('\n').pop()}` }
  }
  // origin holds every commit now: the plan branch goes, here and on origin (never a forced delete).
  if (sha(`refs/heads/${park}`)) git(root, 'update-ref', '-d', `refs/heads/${park}`)
  if (local) {
    git(root, 'update-ref', '-d', `refs/heads/${branch}`, local)
    git(root, 'config', '--remove-section', `branch.${branch}`)
  }
  if (remote) {
    const d = git(root, 'push', '--quiet', 'origin', '--delete', branch)
    if (d.status !== 0) return { renamed: true, parkBranch: park, what: `${branch} → ${park} (${target.slice(0, 7)}); origin/${branch} not deleted: ${d.err.split('\n').pop()}` }
  }
  const st = readStatus(run)
  if (st?.plans?.[nnn]) {
    st.plans[nnn].parkBranch = park
    writeStatus(run, st)
  }
  return { renamed: true, parkBranch: park, what: `${branch} → ${park} (${target.slice(0, 7)}), local and origin` }
}

// ---- what the run learns (docs/agent/decision-review.md §0; no model call) ---------------------------------------------------
const readIf = (file) => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}
// The folder the learning files are READ from (`context`): the run's merge folder (the run branch) when it
// exists, else this folder (before `init` there is no merge folder yet). Nothing is ever written here: `lessons` and
// `finish` write in the merge folder only.
const learnBase = (run) => (run && existsSync(mergeFolder(run)) ? mergeFolder(run) : root)
const LESSONS_REL = (role) => `docs/brain/agent-lessons/${role}.md`
const RUN_LOG_REL = 'docs/brain/run-log.md'

/** The lesson lines of every role: the files under `base`, a path in `files` (not written yet) taking precedence. */
function lessonsIn(base, files = new Map()) {
  const out = {}
  for (const role of LESSON_ROLES) {
    const text = files.get(LESSONS_REL(role)) ?? readIf(join(base, LESSONS_REL(role)))
    out[role] = text ? lessonParts(text).body.map((l) => l.replace(/^-\s+/, '')) : []
  }
  return out
}
/**
 * The kit's own lessons: the live lines `- K<n>: …` (before `## Retired`) of docs/agent/kit-lessons/<role>.md,
 * without the leading dash, for the injected roles. A missing file is an empty list. The kit owns these files.
 */
function kitLessonsIn(base) {
  const out = {}
  for (const role of INJECTED_ROLES) {
    const text = readIf(join(base, 'docs', 'agent', 'kit-lessons', `${role}.md`))
    if (!text) continue
    const lines = []
    for (const l of text.replace(/\r\n/g, '\n').split('\n').slice(2)) {
      if (l.trim() === '## Retired') break
      if (/^- K\d+: /.test(l)) lines.push(l.replace(/^-\s+/, ''))
    }
    if (lines.length) out[role] = lines
  }
  return out
}
/** The kit's triage prior (docs/agent/kit-lessons/triage-calibration.md): { kind: { graded, agree, agreement } } from its table. */
function kitTriagePrior(base) {
  const out = {}
  for (const l of (readIf(join(base, 'docs', 'agent', 'kit-lessons', 'triage-calibration.md')) ?? '').split('\n')) {
    const m = /^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)%\s*\|$/.exec(l)
    if (!m) continue
    // Values are clamped: graded and agree are whole numbers >= 0 (agree <= graded), agreement is within 0..1.
    const graded = Math.max(0, Math.floor(Number(m[2])))
    const agreement = Math.min(1, Math.max(0, Number(m[3]) / 100))
    out[m[1]] = { graded, agree: Math.min(graded, Math.max(0, Math.round(graded * agreement))), agreement }
  }
  return out
}
/**
 * The project's agreement per kind; a kind it graded fewer than `minGraded` times takes the kit's row when the kit has one —
 * except that the kit never raises a kind above the project's own graded rows: when the project has graded rows for it with
 * lower agreement, the project's row stays.
 */
function withKitPrior(stats, prior, minGraded) {
  const kinds = { ...stats.kinds }
  for (const [kind, row] of Object.entries(prior)) {
    const own = kinds[kind]
    if ((own?.graded ?? 0) >= minGraded) continue
    if (own && own.graded > 0 && own.agreement < row.agreement) continue
    kinds[kind] = row
  }
  return { ...stats, kinds }
}
const rulesIn = (base) => {
  const t = readIf(join(base, 'docs', 'brain', 'agent-rules.md')) ?? ''
  return { checkers: ruleLines(t, 'checkers'), readiness: ruleLines(t, 'readiness'), ui: ruleLines(t, 'ui') }
}
/** The last three run-log rows as one line each, with their parked reasons (`context` RECENT_RUNS). */
const recentRunsOf = (rows) => rows.slice(-3).map((r) => `${r.date} ${r.run}: ${String(r.plans).split(',').filter(Boolean).length} plans, ${r.merged} merged, ${r.parked} parked (${r.reasons}), fix rounds ${r.fixRounds}, escalations ${r.escalations}, gate fails ${r.gateFails}, final gate ${r.finalGate}`)

/**
 * The lesson lines (and, with `runLog`, the run-log row) a run adds, computed in memory: { files: Map(path -> text),
 * added, dropped, budget, trend }. Nothing is written here; the caller writes `files` under `base`.
 */
function learnRun(run, status, base, { merged = [], finalGate = 'none', finishedAt = null, runLog = false } = {}) {
  const files = new Map()
  const date = String(finishedAt ?? nowIso()).slice(0, 10)
  const added = []
  const dropped = []
  for (const f of lessonFacts(status)) {
    const rel = LESSONS_REL(f.role)
    const r = addLesson(files.get(rel) ?? readIf(join(base, rel)) ?? '', f.role, { date, run, text: f.text, dedupe: f.has ?? null })
    if (!r.added) continue
    files.set(rel, r.text)
    added.push({ role: f.role, text: f.text })
    dropped.push(...r.dropped.map((line) => ({ role: f.role, line })))
  }
  let rows = parseRunLog(readIf(join(base, RUN_LOG_REL)) ?? '').rows
  if (runLog) {
    const text = updateRunLog(readIf(join(base, RUN_LOG_REL)) ?? '', runLogRow({ status, merged, finalGate, date }), parseDecisionRows(readIf(join(base, 'docs', 'brain', 'decision-log.md'))))
    files.set(RUN_LOG_REL, text)
    rows = parseRunLog(text).rows
  }
  const budget = contextBudget({ lessons: lessonsIn(base, files), rules: rulesIn(base), recent: recentRunsOf(rows) })
  return { files, added, dropped, budget, trend: trendOf(rows) }
}
function writeLearned(base, files) {
  for (const [rel, text] of files) {
    mkdirSync(dirname(join(base, rel)), { recursive: true })
    writeFileSync(join(base, rel), text)
  }
}
const budgetLines = (b) => [...b.blocks.map((x) => `CONTEXT ${x.name}: ${x.chars} chars`), `CONTEXT ${b.line}`]

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
    delete status.finalGate // per launch: an earlier launch's result must not stand for this one
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
    emit({ ok: true, run, branch, mergeFolder: mf.replace(/\\/g, '/'), done: done.map((m) => m.nnn), mainSha: status.mainShaAtStart, attempt: status.attempts, startedAt: status.startedAt, kitManifest, npmScripts: npmScripts(), priorDecisions: status.decisions ?? [] },
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
    // The test-location check (`scope-check --tests`) for every plan of the run: a plan that changes code and names no
    // test location is asked about at readiness, before any builder, instead of parking at the test-file gate later.
    const testLocations = {}
    for (const nnn of j.waves.flat()) {
      const rel = j.plans?.[nnn]?.path
      const text = rel ? readIf(join(root, rel)) : null
      if (!text) continue
      const lint = scopeTestsLint(text)
      if (lint.status === 'warn') testLocations[nnn] = lint.codeGlobs
    }
    emit({ ok: true, waves: j.waves, waveLocks: j.waveLocks, edges: (j.edges ?? []).filter((e) => !e.met), plans: j.plans, skipped: j.skipped, done: Object.keys(j.done ?? {}), testLocations },
      [...j.waves.map((w, i) => `WAVE ${i + 1}: ${w.join(', ')}`), ...Object.entries(testLocations).map(([n, g]) => `plan ${n}: changes code (${g.join(', ')}) and no scope line names a test location`)])
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

  // Readiness maps an `npx <tool> …` check to the package.json script whose body is that command: it needs the bodies.
  scripts() {
    let scripts = {}
    try {
      const s = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts
      if (s && typeof s === 'object') scripts = Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === 'string'))
    } catch { /* unreadable package.json: no scripts */ }
    emit({ ok: true, scripts }, [`package.json: ${Object.keys(scripts).length} scripts`])
  },


  // A gate command (orchestrator.prepare): makes a generated file the project can generate. Runs in THIS folder (the
  // worktree or merge folder the gate runs in), writes only what the project's own script writes, touches no run state.
  prepare() {
    const missing = String(args.missing ?? '').trim()
    const script = String(args.script ?? '').trim()
    const inDir = String(args.in ?? '.').trim() || '.'
    const pm = String(args.pm ?? 'npm').trim()
    const entry = `{ "missing": ${JSON.stringify(missing)}, "script": ${JSON.stringify(script)}, "in": ${JSON.stringify(inDir)} }`
    const safePath = (p) => p !== '' && !/^([A-Za-z]:|[\\/])/.test(p) && !p.split(/[\\/]/).includes('..') && /^[A-Za-z0-9_./@\\-]+$/.test(p)
    const allowed = 'a repo-relative path of letters, digits and _ . / @ - only (no absolute path, no "..")'
    if (!safePath(missing)) fail(`prepare: --missing must be ${allowed}: ${entry}`)
    if (!safePath(inDir)) fail(`prepare: --in must be ${allowed}: ${entry}`)
    if (!/^[A-Za-z0-9:_-]+$/.test(script)) fail(`prepare: --script must be one npm script name, not a command: ${entry}`)
    if (pm !== 'npm' && pm !== 'pnpm') fail(`prepare: --pm must be npm or pnpm: ${entry}`)
    if (existsSync(join(root, missing))) emit({ ok: true, state: 'present', missing }, ['PREPARE: ok (present)'])
    const r = spawnSync(pm, ['run', script], { cwd: join(root, inDir), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: GATE_TIMEOUT_MIN * 60000, shell: process.platform === 'win32' })
    if (existsSync(join(root, missing))) emit({ ok: true, state: 'generated', missing }, ['PREPARE: ok (generated)'])
    const tail = `${r.stdout ?? ''}\n${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-20)
    emit({ ok: false, error: `prepare: ${missing} still missing after ${pm} run ${script}`, entry }, [...tail, `PREPARE: FAIL — ${missing} is missing after \`${pm} run ${script}\` in ${inDir} (exit ${r.status ?? 'none'}); repeat by hand: ${entry}`])
  },


  'plan-info'() {
    const run = runName()
    const nnn = planNumber(args.plan ?? '')
    if (!nnn) fail('--plan takes a plan number')
    const path = planPath(nnn)
    const text = readFileSync(join(root, path), 'utf8')
    const { tier, invariants } = startTier(text)
    const info = { ok: true, nnn, path, title: planTitle(text), branch: branchOf(path, nnn), npmScripts: npmScripts(), worktree: builderFolder(run, nnn).replace(/\\/g, '/'), startTier: tier, invariants, humanItems: humanItems(text), uiItems: uiItems(text) }
    // --no-notes: the plan without its ## Execution Notes section, next to the run's status file — the copy the checkers
    // read (PLAN: reviewPath), so the builder's own account never reaches them. The plan file itself is not touched.
    if (args['no-notes'] !== undefined) info.reviewPath = writeReviewCopy(run, nnn, text)
    const status = readStatus(run)
    // A plan branch an earlier run left that is not built on this run's branch (neither holds the other) is renamed to
    // park/stale-<NNN>, local and origin, and a fresh one is cut: nothing is lost, the run is not stopped. A relaunch of
    // this run (its status holds the plan) and a branch that is based on the run branch (or the other way) are kept.
    let staleNote = null
    if (status && !status.plans[nnn]) {
      fetchOrigin()
      const base = `origin/${runBranch(run)}`
      const anc = (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: root }).status === 0
      const stale = refExists(base) && [`refs/heads/${info.branch}`, `refs/remotes/origin/${info.branch}`].some((ref) => refExists(ref) && !anc(base, ref) && !anc(ref, base))
      if (stale) {
        const b = renameParkedBranch('stale', nnn)
        if (!b.renamed) fail(`stale branch ${info.branch} (not built on ${base}) could not be renamed: ${b.what}`)
        staleNote = `stale ${info.branch} renamed to ${b.parkBranch}; a fresh ${info.branch} is cut from ${base}`
      }
    }
    if (status) {
      // plan-info starts each attempt at a plan: an earlier attempt (a relaunch) moves to `earlier`, so state, round,
      // reason and models describe this attempt only.
      const prev = status.plans[nnn]
      if (staleNote) addNotes(status, [{ plan: nnn, text: staleNote }])
      const earlier = prev ? [...(prev.earlier ?? []), (({ earlier: _e, history: _h, humanItems: _i, ...rest }) => rest)(prev)] : []
      status.plans[nnn] = { nnn, title: info.title, branch: info.branch, state: 'queued', round: 0, tier: tier, models: {}, humanItems: info.humanItems, history: prev?.history ?? [], ...(earlier.length ? { earlier } : {}) }
      writeStatus(run, status)
    }
    const lines = [`${nnn} ${info.title}: branch ${info.branch}, starts on ${tier}${invariants.length ? ` (${invariants.join(', ')})` : ''}`, ...(staleNote ? [staleNote] : [])]
    // --with-worktree: the plan's folder is made in the same call (one runner call instead of two) when the branch name is
    // one the run accepts; the answer is `wt` (what a `worktree` call prints). A worktree that fails is `wt.ok: false`
    // (with envFailure when the environment is to blame): the workflow then goes on with its own `worktree` retry path.
    if (args['with-worktree'] !== undefined && !planBranchProblem(info.branch)) {
      capture = true
      let got
      try {
        commands.worktree()
      } catch (e) {
        if (!e.captured) throw e
        got = e.captured
      } finally {
        capture = false
      }
      emit({ ...info, wt: got.result }, [...lines, ...got.lines, ...(got.result.ok ? [] : [`ORCH_STATE: FAIL — ${got.result.error}`])])
    }
    emit(info, lines)
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
    // --from-branch <ref>: a relaunch that continues a parked plan cuts the plan branch from the park branch (its saved
    // commits), not from the run branch. Only when the plan branch is not there yet.
    const from = args['from-branch'] && args['from-branch'] !== true ? String(args['from-branch']) : ''
    if (from && !refExists(`refs/heads/${branch}`) && !refExists(`refs/remotes/origin/${branch}`) && refExists(`refs/remotes/origin/${from}`)) {
      const c = git(root, 'branch', '--no-track', branch, `refs/remotes/origin/${from}`)
      if (c.status !== 0) fail(`git branch ${branch} from origin/${from}: ${c.err}`)
      lines.push(`cut ${branch} from origin/${from} (the saved work of the parked attempt)`)
    }
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
        const w = exists ? git(root, 'worktree', 'add', '--quiet', own, branch) : git(root, 'worktree', 'add', '--quiet', '--no-track', '-b', branch, own, base)
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
    // A plan branch tracks only its own remote branch: one an earlier run made with git's default upstream loses it
    // (a bare push from the builder would go to that run branch — this run's, or an earlier run's after a relaunch under
    // a new name). An upstream that is its own remote branch is kept.
    const upstream = git(root, 'config', '--get', `branch.${branch}.merge`).out
    if (upstream && upstream !== `refs/heads/${branch}`) {
      git(root, 'config', '--unset', `branch.${branch}.merge`)
      git(root, 'config', '--unset', `branch.${branch}.remote`)
      lines.push(`${branch}: upstream ${upstream.replace(/^refs\/heads\//, '')} removed`)
    }
    const dirty = git(wt, 'status', '--porcelain').out.split('\n').filter(Boolean).map((l) => l.slice(3))
    if (!dirty.length) {
      const m = git(wt, 'merge', '--quiet', '--no-edit', base)
      if (m.status !== 0) {
        // The plan's own file is the one conflict the script resolves: the run branch's text (a later Planner or
        // readiness edit) with the builder's ticks and its new Execution Notes lines put back (mergePlanFile). Any other
        // conflicted path aborts the merge and parks as before, naming every conflicted path.
        const conflicted = git(wt, 'diff', '--name-only', '--diff-filter=U').out.split('\n').map((l) => l.trim()).filter(Boolean)
        const rel = planFile.replace(/\\/g, '/')
        if (conflicted.length === 1 && conflicted[0] === rel) {
          // the two sides untrimmed (git() trims): 2 = this branch, 3 = the run branch
          const side = (stage) => spawnSync('git', ['show', `:${stage}:${rel}`], { cwd: wt, encoding: 'utf8' })
          const ours = side(2)
          const theirs = side(3)
          if (ours.status === 0 && theirs.status === 0) {
            writeFileSync(join(wt, rel), mergePlanFile({ ours: ours.stdout, theirs: theirs.stdout }))
            const a = git(wt, 'add', '--', rel)
            const c = a.status === 0 ? git(wt, 'commit', '--quiet', '--no-edit') : a
            if (c.status === 0) lines.push(`merged ${base} into ${branch}: ${rel} conflicted — the run branch's text kept, the builder's ticks and notes put back`)
            else {
              git(wt, 'merge', '--abort')
              fail(`merging ${base} into ${branch}: resolving ${rel} failed: ${c.err || c.out}`)
            }
          } else {
            git(wt, 'merge', '--abort')
            fail(`merging ${base} into ${branch} conflicts: ${rel} (its two sides could not be read)`)
          }
        } else {
          git(wt, 'merge', '--abort')
          fail(`merging ${base} into ${branch} conflicts: ${conflicted.length ? conflicted.join(', ') : m.out.split('\n').filter((l) => /CONFLICT/.test(l)).join(' | ') || m.err}`)
        }
      }
    }
    // Commits the branch already has beyond the run branch: a relaunch or a stopped run continues from them.
    const ahead = Number(git(wt, 'rev-list', '--count', `${base}..HEAD`).out) || 0
    // The builder marker, in the worktree's own git dir (never in its files): the scope guard asks about a database write
    // the plan does not list only where this marker names the branch checked out (lib/db-write.mjs).
    const gitDir = git(wt, 'rev-parse', '--absolute-git-dir').out
    if (gitDir) writeFileSync(join(gitDir, 'orch-builder.json'), `${JSON.stringify({ run, plan: nnn, planPath: planFile, branch, planRef: git(root, 'rev-parse', base).out })}\n`)
    emit({ ok: true, path: wt.replace(/\\/g, '/'), branch, base, head: git(wt, 'rev-parse', 'HEAD').out, dirty, ...(slot ? { slot: slot.slot } : {}), ...(ahead ? { resumed: ahead } : {}) }, lines)
  },

  // May a plan be merged on its own (`/orchestrate` merge mode: no builder, gate or checker)?
  //   node scripts/orch-state.mjs merge-ready --run <name> --plan <NNN>
  // Only when status.json recorded the head that passed its gate and checkers (checkedHead) and the plan branch on origin
  // is still at that head. Answers { ready, branch, head, checkedHead, round, tier } or { ready: false, why }.
  'merge-ready'() {
    const run = runName()
    const nnn = planNumber(args.plan ?? '')
    if (!nnn) fail('--plan takes a plan number')
    const p = needStatus(run).plans?.[nnn]
    const no = (why) => emit({ ok: true, ready: false, why }, [`plan ${nnn}: not merged on its own — ${why}`])
    if (!p) no(`plan ${nnn} is not in run ${run}`)
    if (p.state === 'merged') no(`plan ${nnn} is already merged (${String(p.sha ?? '').slice(0, 7)})`)
    if (!p.checkedHead) no(`no checked head recorded for plan ${nnn}: its gate and checkers never passed in this run — relaunch it in a normal run`)
    const branch = p.branch || branchOf(planPath(nnn), nnn)
    fetchOrigin()
    const head = git(root, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`).out
    if (!head) no(`origin/${branch} not found`)
    if (head !== p.checkedHead) no(`origin/${branch} is at ${head.slice(0, 7)}, not the checked head ${String(p.checkedHead).slice(0, 7)} — the branch changed after its checks`)
    emit({ ok: true, ready: true, branch, head, checkedHead: p.checkedHead, round: p.round ?? 0, tier: p.tier ?? '' }, [`plan ${nnn}: ${branch} at the checked head ${head.slice(0, 7)} — ready to merge on its own`])
  },

  // The merge pin (the script checks, then pushes — one push per merge): after `git merge --no-ff` of the plan branch in the merge folder and
  // before any push,
  //   node scripts/orch-state.mjs merge-verify --run <name> --plan <NNN>
  // checks that the merge commit's second parent (HEAD^2) is the head that passed the gate and the review
  // (plans[NNN].checkedHead). Equal → ok. Different → the merge folder is reset to HEAD^ (the run branch on origin never
  // saw the merge), the reason names both shas, exit 1. A plan with no checked head (an older status.json) is merged
  // unpinned and a run note says the pin was not checked.
  'merge-verify'() {
    const run = runName()
    const nnn = planNumber(args.plan ?? '')
    if (!nnn) fail('--plan takes a plan number')
    const mf = mergeFolder(run)
    if (!existsSync(mf)) fail(`no merge folder ${mf}`)
    const head = git(mf, 'rev-parse', 'HEAD').out
    const second = git(mf, 'rev-parse', '--verify', '--quiet', 'HEAD^2').out
    if (!/^[0-9a-f]{40}$/.test(second)) fail(`the merge folder's HEAD ${head.slice(0, 7)} is not a merge commit — nothing to verify`)
    const status = needStatus(run)
    const p = status.plans?.[nnn]
    if (!p?.checkedHead) {
      addNotes(status, [{ plan: nnn, text: `merge pin not checked: plan ${nnn} has no checked head recorded (merged ${second.slice(0, 7)})` }])
      writeStatus(run, status)
      emit({ ok: true, pinned: false, sha: head, merged: second }, [`plan ${nnn}: no checked head recorded — merged unpinned (${second.slice(0, 7)})`])
    }
    if (second === p.checkedHead) emit({ ok: true, pinned: true, sha: head, merged: second, checkedHead: p.checkedHead }, [`plan ${nnn}: merge ${head.slice(0, 7)} takes the checked head ${second.slice(0, 7)}`])
    const reason = `the branch moved after its checks: the merge took ${second} but the checked head is ${p.checkedHead}`
    // Only a merge the run branch on origin does not have yet is undone here; a pushed one is never rewritten.
    const remote = git(mf, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${runBranch(run)}`).out
    if (remote === head) fail(`${reason} — and the merge is already on origin/${runBranch(run)}; not reset`, { refused: true, merged: second, checkedHead: p.checkedHead })
    const r = git(mf, 'reset', '--quiet', '--hard', 'HEAD^')
    if (r.status !== 0) fail(`${reason} — and git reset --hard HEAD^ in ${mf} failed: ${r.err}`, { refused: true, merged: second, checkedHead: p.checkedHead })
    p.reason = reason
    writeStatus(run, status)
    emit({ ok: false, refused: true, error: reason, merged: second, checkedHead: p.checkedHead, resetTo: git(mf, 'rev-parse', 'HEAD').out }, [`plan ${nnn}: merge refused — ${reason}; the merge folder is back at HEAD^`])
  },

  // A heartbeat while a long step runs (a builder may work for many minutes): status.json's updatedAt is renewed, so
  // `watch` does not print STUCK for a run that is busy. Nothing else changes.
  touch() {
    const run = runName()
    const status = needStatus(run)
    writeStatus(run, status)
    emit({ ok: true, updatedAt: status.updatedAt })
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
    if (r.released) dropBuilderMarker(slot.path)
    if (r.released && st?.plans?.[nnn]) {
      delete st.plans[nnn].slot
      writeStatus(run, st)
    }
    emit({ ok: true, ...r, slot: slot.slot }, [r.released ? `plan ${nnn}: slot wt-${slot.slot} released` : `plan ${nnn}: slot wt-${slot.slot} kept — ${r.why}`])
  },

  // A parked plan's uncommitted work, saved before its folder is given back:
  //   node scripts/orch-state.mjs park-save --run <name> --plan <NNN>
  // The plan's folder (its slot, else its own builder folder) is snapshotted — tracked changes and new files, never an
  // ignored one — as one commit `WIP: park <run> <NNN>` on the fixed branch park/<run>-<NNN> (on top of that branch when
  // an earlier park made it, else on the folder's HEAD), pushed to origin; the plan branch itself is not touched. Then
  // the folder is cleaned and a slot is released (detached at the run branch, marker removed): the work is on origin.
  // Nothing uncommitted → no branch, nothing changed. A push that fails leaves the folder as it was.
  'park-save'() {
    const run = runName()
    const nnn = planNumber(args.plan ?? '')
    if (!nnn) fail('--plan takes a plan number')
    const st = readStatus(run)
    const own = builderFolder(run, nnn)
    const planFile = planPath(nnn)
    const slot = USE_SLOTS ? listSlots().find((s) => s.plan === planFile) ?? null : null
    const folder = slot ? slot.path : existsSync(own) ? own : null
    if (!folder) emit({ ok: true, saved: false, why: 'the plan has no folder' }, [`plan ${nnn}: no folder to save`])
    const changed = git(folder, 'status', '--porcelain').out.split('\n').filter((l) => l && !/^\?\? \.worktree-/.test(l))
    if (!changed.length) emit({ ok: true, saved: false, why: 'nothing uncommitted' }, [`plan ${nnn}: nothing uncommitted to save`])
    const branch = `park/${run}-${nnn}`
    fetchOrigin()
    const head = git(folder, 'rev-parse', 'HEAD').out
    const local = git(folder, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`)
    const remote = git(folder, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`)
    const parentSha = local.status === 0 ? local.out : remote.status === 0 ? remote.out : head
    // A separate index: the folder's own index and branch stay as they are until the commit is safely on origin.
    const index = join(git(folder, 'rev-parse', '--absolute-git-dir').out || folder, `park-index-${process.pid}`)
    const gi = (...a) => {
      const r = spawnSync('git', a, { cwd: folder, encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: index } })
      return { status: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
    }
    let commit = ''
    try {
      for (const step of [['read-tree', 'HEAD'], ['add', '-A', '--', '.', ':(exclude).worktree-*']]) {
        const r = gi(...step)
        if (r.status !== 0) fail(`park-save: git ${step.join(' ')} in ${folder}: ${r.err}`)
      }
      const tree = gi('write-tree')
      if (tree.status !== 0) fail(`park-save: git write-tree in ${folder}: ${tree.err}`)
      const c = gi('commit-tree', tree.out, '-p', parentSha, '-m', `WIP: park ${run} ${nnn}`, '-m', `The uncommitted work of plan ${nnn} when run ${run} parked it (folder ${folder.replace(/\\/g, '/')}, HEAD ${head.slice(0, 7)}).`)
      if (c.status !== 0) fail(`park-save: git commit-tree in ${folder}: ${c.err}`)
      commit = c.out
    } finally {
      try {
        unlinkSync(index)
      } catch { /* none written */ }
    }
    const u = git(folder, 'update-ref', `refs/heads/${branch}`, commit)
    if (u.status !== 0) fail(`park-save: git update-ref ${branch}: ${u.err}`)
    const p = git(folder, 'push', '--quiet', 'origin', `${branch}:refs/heads/${branch}`)
    if (p.status !== 0) emit({ ok: false, saved: true, pushed: false, branch, sha: commit, error: `push of ${branch} failed: ${p.err.split('\n').pop()} — the folder is kept as it was` }, [`plan ${nnn}: saved on ${branch} (${commit.slice(0, 7)}), push failed — folder kept`])
    // The work is on origin: clean the folder and give a slot back.
    git(folder, 'reset', '--quiet', '--hard')
    git(folder, 'clean', '-fdq', '--exclude=.worktree-*')
    const lines = [`plan ${nnn}: uncommitted work saved on ${branch} (${commit.slice(0, 7)}) and pushed`]
    let released = false
    if (slot) {
      const target = refExists(`origin/${runBranch(run)}`) ? `origin/${runBranch(run)}` : `origin/${MAIN}`
      const d = git(folder, 'switch', '--quiet', '--detach', target)
      if (d.status === 0) {
        try {
          unlinkSync(join(folder, '.worktree-plan'))
        } catch { /* no marker */ }
        dropBuilderMarker(folder)
        released = true
        if (st?.plans?.[nnn]) {
          delete st.plans[nnn].slot
          st.plans[nnn].parkBranch = branch
          writeStatus(run, st)
        }
        lines.push(`plan ${nnn}: slot wt-${slot.slot} released`)
      } else lines.push(`plan ${nnn}: slot wt-${slot.slot} kept — git switch --detach ${target}: ${d.err.split('\n').pop()}`)
    } else if (st?.plans?.[nnn]) {
      st.plans[nnn].parkBranch = branch
      writeStatus(run, st)
    }
    emit({ ok: true, saved: true, pushed: true, branch, sha: commit, released, ...(slot ? { slot: slot.slot } : {}) }, lines)
  },

  // The whole teardown of a parked plan, through this script (every runner command of a run is orch-state.mjs or
  // orch-preflight.mjs):
  //   node scripts/orch-state.mjs park --run <name> --plan <NNN> [--reason-b64 <b64>]
  // runs scripts/plan-park.mjs and hands back its answer (steps, recorded). plan-park itself calls park-save, release and
  // park-record as separate orch-state processes, so this one holds no status lock while it runs.
  park() {
    const run = runName()
    const nnn = planNumber(args.plan ?? '')
    if (!nnn) fail('--plan takes a plan number')
    const reason = args.reason && args.reason !== true ? String(args.reason) : ''
    const r = spawnSync(process.execPath, [join(root, 'scripts', 'plan-park.mjs'), `--run=${run}`, `--plan=${nnn}`, ...(reason ? [`--reason-b64=${Buffer.from(reason, 'utf8').toString('base64')}`] : [])], { cwd: root, encoding: 'utf8', timeout: 600000 })
    const out = String(r.stdout ?? '').split(/\r?\n/)
    const line = out.slice().reverse().find((l) => l.startsWith('ORCH_JSON '))
    let answer = null
    try {
      answer = line ? JSON.parse(line.slice('ORCH_JSON '.length)) : null
    } catch { /* unreadable */ }
    if (!answer) fail(`plan-park.mjs gave no answer (exit ${r.status}): ${String(r.stderr ?? '').trim().split('\n').pop() ?? ''}`)
    // Last step: the plan branch becomes park/<run>-<NNN>, so the next run cuts a fresh feat/<NNN> from its run branch.
    const b = renameParkedBranch(run, nnn)
    const steps = [...(answer.steps ?? []), { step: 'rename', what: b.what }]
    emit({ ...answer, ok: true, steps, renamed: b.renamed, parkBranch: b.parkBranch }, [...out.filter((l) => l.startsWith('plan-park: ')), `plan-park: rename: ${b.what}`])
  },

  // A parked plan's branch, renamed on its own (the `park` command runs this as its last step):
  //   node scripts/orch-state.mjs park-branch --run <name> --plan <NNN>
  'park-branch'() {
    const run = runName()
    const nnn = planNumber(args.plan ?? '')
    if (!nnn) fail('--plan takes a plan number')
    const b = renameParkedBranch(run, nnn)
    if (b.error) fail(b.error)
    emit({ ok: true, ...b }, [`plan ${nnn}: ${b.what}`])
  },

  // A park, recorded once (plan-park.mjs's last step):
  //   node scripts/orch-state.mjs park-record --run <name> --plan <NNN> [--reason "<why>"] [--sha <park commit>]
  // plans[NNN].park = { at, reason, branch?, sha? } and the state parked. A plan that already has a park record keeps it as
  // it is (recorded: false): a second teardown of the same park changes nothing.
  'park-record'() {
    const run = runName()
    const nnn = planNumber(args.plan ?? '')
    if (!nnn) fail('--plan takes a plan number')
    const st = needStatus(run)
    const p = (st.plans[nnn] ??= { nnn, state: 'parked', round: 0, models: {} })
    if (p.park) emit({ ok: true, recorded: false, park: p.park }, [`plan ${nnn}: park already recorded at ${p.park.at}`])
    const reason = args.reason && args.reason !== true ? cutText(args.reason, 400) : (p.reason ?? '(no reason given)')
    p.park = { at: nowIso(), reason, ...(p.parkBranch ? { branch: p.parkBranch } : {}), ...(/^[0-9a-f]{40}$/.test(String(args.sha ?? '')) ? { sha: args.sha } : {}) }
    p.state = 'parked'
    p.reason ??= reason
    writeStatus(run, st)
    emit({ ok: true, recorded: true, park: p.park }, [`plan ${nnn}: park recorded`])
  },

  diff() {
    const run = runName()
    const nnn = planNumber(args.plan ?? '')
    if (!nnn) fail('--plan takes a plan number')
    const branch = branchOf(planPath(nnn), nnn)
    fetchOrigin()
    const head = refExists(`origin/${branch}`) ? `origin/${branch}` : branch
    // --no-renames: a moved-away file is listed under its old path too, so a renamed test file is still a changed test file.
    const d = git(root, 'diff', '--name-only', '--no-renames', `origin/${runBranch(run)}...${head}`)
    if (d.status !== 0) fail(`git diff ${runBranch(run)}...${head}: ${d.err}`)
    const files = d.out.split('\n').filter(Boolean)
    const tests = sensitiveTests()
    const sensitiveFiles = files.filter((f) => tests.some((re) => re.test(f)))
    // A diff that adds auth or permission code to a file whose path does not say so: its added lines name it.
    // A diff git could not give in full (an error, or output cut off) counts as sensitive: fail closed.
    const zeroDiff = git(root, 'diff', '-U0', '--no-color', `origin/${runBranch(run)}...${head}`)
    const added = addedCodeFiles(zeroDiff, SENSITIVE_CODE_RE, sensitiveFiles)
    const codeFiles = added.files
    const unread = added.failed || d.truncated
    const sensitive = sensitiveFiles.length > 0 || codeFiles.length > 0 || unread
    // Test-file gate: a changed test file no scope line naming a test location lists. The scope is read from the plan
    // as the run branch holds it (the plan before the builder), never from the plan branch: a builder that adds a test
    // glob to its own scope block must not approve its own test edits. Else the copy in this folder.
    const rel = planPath(nnn)
    const onBase = git(root, 'show', `origin/${runBranch(run)}:${rel}`)
    const planText = onBase.status === 0 ? onBase.out : (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : '')
    const scopeGlobs = extractScopeGlobs(planText) ?? []
    const testsOutOfScope = testFilesOutOfScope(files.filter((f) => f !== rel && !f.startsWith('.claude/sessions/')), scopeGlobs, (g) => picomatch(g, { dot: true }), removedLinesByFile(zeroDiff.out))
    // --no-notes: the checkers' copy of the plan (the same run-branch text, without ## Execution Notes), written next to
    // the status file just before the checkers read it.
    const reviewPath = args['no-notes'] !== undefined && planText ? writeReviewCopy(run, nnn, planText) : null
    emit({ ok: true, files, sensitive, sensitiveFiles, sensitiveCode: codeFiles, testsOutOfScope, ...(unread ? { diffUnread: true } : {}), ...(reviewPath ? { reviewPath } : {}), head: git(root, 'rev-parse', head).out },
      [`${files.length} file(s) changed, ${sensitiveFiles.length} sensitive by path, ${codeFiles.length} by added auth/permission code${testsOutOfScope.length ? `, ${testsOutOfScope.length} test file(s) outside the scope` : ''}${unread ? '; the diff could not be read in full: sensitive' : ''}`])
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
    // Every tier a builder of this plan ran on, in order (a change of tier appends): the report lists them all, not the last.
    if (args.tier !== undefined && args.tier !== true) {
      const tiers = p.tiers ?? (p.tier ? [p.tier] : [])
      if (tiers[tiers.length - 1] !== String(args.tier)) tiers.push(String(args.tier))
      p.tiers = tiers
    }
    for (const k of ['tier', 'sha', 'reason']) if (args[k] !== undefined && args[k] !== true) p[k] = String(args[k])
    // --checked-head <sha>: the branch head that passed the gate and the checkers (what `merge-ready` compares with).
    if (args['checked-head'] !== undefined && args['checked-head'] !== true) {
      if (!/^[0-9a-f]{40}$/.test(String(args['checked-head']))) fail('--checked-head takes a full 40-character commit sha')
      p.checkedHead = String(args['checked-head'])
    }
    p.models ??= {}
    // --role <stage> --model <m> [--model-tier <tier>]: the model a call of this plan runs on, set when the call starts
    // (`at`), so `watch` and status.json show it while the call runs.
    if (args.role) p.models[String(args.role)] = { model: String(args.model ?? 'unknown'), ...(args.effort ? { effort: String(args.effort) } : {}), ...(args['model-tier'] && args['model-tier'] !== true ? { tier: String(args['model-tier']) } : {}), at: new Date().toISOString() }
    // --roles orch-builder=sonnet/medium,plan-reviewer=sonnet/medium: the model each agent of this step echoed.
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
      // A card that passed earlier and fails now is marked: the `ui` lesson ("card failed after it had passed").
      const before = (p.uiCards ?? []).find((c) => c.card === card.card)
      if ((before?.status === 'pass' && status === 'fail') || before?.regressed) card.regressed = true
      p.uiCards = [...(p.uiCards ?? []).filter((c) => c.card !== card.card), card]
    }
    // Facts the lessons are written from (lessonFacts in lib/orch-run.mjs). `--candidates/--refuted/--refuted-rules/
    // --verify-by/--late-low/--reappeared` are the verifier's totals so far for this plan (a later call replaces them);
    // `--miss`, `--round-cause` and `--gate-event` add one line each (the same line twice is kept once); `--asked`
    // ("q1 || q2") and `--ready yes|no` come from the readiness result.
    const text = (k) => (args[k] !== undefined && args[k] !== true ? String(args[k]).trim() : '')
    const list = (v) => String(v).split('|').map((x) => x.trim()).filter(Boolean)
    const count = (k) => {
      if (!/^\d+$/.test(text(k))) fail(`--${k} takes a whole number`)
      return Number(text(k))
    }
    if (['candidates', 'refuted', 'refuted-rules', 'verify-by', 'late-low', 'reappeared'].some((k) => args[k] !== undefined)) {
      const v = (p.verify ??= { candidates: 0, refuted: 0, refutedRules: [], byRole: {}, lateLow: [], reappeared: [] })
      if (args.candidates !== undefined) v.candidates = count('candidates')
      if (args.refuted !== undefined) v.refuted = count('refuted')
      if (args['refuted-rules'] !== undefined) v.refutedRules = list(text('refuted-rules'))
      if (args['late-low'] !== undefined) v.lateLow = list(text('late-low'))
      if (args.reappeared !== undefined) v.reappeared = list(text('reappeared'))
      if (args['verify-by'] !== undefined) {
        v.byRole = {}
        // role=candidates/refuted/rule a|rule b;role2=… — an entry the 400-character argument cut short is skipped.
        for (const item of text('verify-by').split(';')) {
          const m = /^([\w-]+)=(\d+)\/(\d+)\/(.*)$/.exec(item.trim())
          if (m) v.byRole[m[1]] = { candidates: Number(m[2]), refuted: Number(m[3]), rules: list(m[4]) }
        }
      }
    }
    for (const [flag, field] of [['miss', 'misses'], ['round-cause', 'roundCauses'], ['gate-event', 'gateEvents']]) {
      if (text(flag)) p[field] = [...new Set([...(p[field] ?? []), ...text(flag).split(' || ').map((x) => x.trim().slice(0, 300)).filter(Boolean)])]
    }
    if (args.asked !== undefined) p.asked = text('asked').split(' || ').map((x) => x.trim()).filter(Boolean).slice(0, 5)
    if (args.ready !== undefined) {
      if (!['yes', 'no'].includes(text('ready'))) fail('--ready takes yes or no')
      p.ready = text('ready') === 'yes'
    }
    // --note "a || b": run notes for this plan, in order (one call instead of one per note).
    // --calls-b64: the model calls run-plans.mjs made for this plan since its last `set`, appended to plans[NNN].calls.
    if (args['calls-b64'] !== undefined && args['calls-b64'] !== true) {
      let items
      try {
        items = JSON.parse(Buffer.from(String(args['calls-b64']), 'base64').toString('utf8'))
      } catch (e) {
        fail(`--calls-b64 is not base64 of a JSON list: ${e.message}`)
      }
      if (!Array.isArray(items) || items.some((c) => !c || typeof c !== 'object')) fail('--calls-b64 must hold a JSON list of { stage, model, seconds, input, output, exit }')
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
      p.calls = [...(p.calls ?? []), ...items.map((c) => ({ stage: cutText(c.stage, 60), model: cutText(c.model, 60), seconds: num(c.seconds), tokens: { input: num(c.input), output: num(c.output) }, exit: c.exit === null || c.exit === undefined ? null : num(c.exit), ...(c.error ? { error: cutText(c.error, 200) } : {}) }))]
    }
    if (args.note !== undefined) addNotes(status, text('note').split(' || ').map((t) => ({ plan: nnn, text: t })))
    p.freeDiskGb = diskGb()
    status.freeDiskGb = p.freeDiskGb
    p.history ??= []
    p.history.push({ at: nowIso(), state: p.state, round: p.round })
    writeStatus(run, status)
    emit({ ok: true, plan: nnn, state: p.state, round: p.round }, [`${nnn}: ${p.state}, round ${p.round}`])
  },

  // A check that passed only on a rerun (the gate's env-fail rerun, or the next gate on the same commit): one entry in
  // plans[NNN].flakes[] (no --plan: the run-level flakes[], the final gate's). The same command and round is one entry.
  flake() {
    const run = runName()
    const status = needStatus(run)
    const r = applyFlake(status, args)
    if (!r.dup) writeStatus(run, status)
    emit({ ok: true, recorded: !r.dup, flakes: r.flakes }, [r.dup ? `${r.text} (already recorded)` : r.text])
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
    // Done: derived here from run facts, never from the builder's receipt (Human amendment 1): the sub-task ids ticked
    // `[x]` in the plan file on the plan branch (the copy on disk when the branch has none) and the files in the branch diff.
    const planRel = relative(root, resolve(root, planPath(nnn))).replace(/\\/g, '/')
    const onBranch = git(root, 'show', `${head}:${planRel}`)
    const planText = onBranch.status === 0 ? onBranch.out : readFileSync(resolve(root, planPath(nnn)), 'utf8')
    const ticked = []
    for (const line of planText.replace(/\r\n/g, '\n').split('\n')) {
      const m = /^\s*[-*]\s*\[x\]\s*([A-Za-z]\d+[A-Za-z]?)\b/i.exec(line)
      if (m && !ticked.includes(m[1])) ticked.push(m[1])
    }
    const done = `sub-tasks ticked: ${ticked.join(', ') || '(none)'}; files changed: ${files.join(', ') || '(none)'}`
    // --reset-base: the fresh builder starts from the plan branch's base, not from the failed diff (a script step: the
    // agents keep their deny list). Found before the file is written, so the file names it; done after.
    let reset = null
    if (args['reset-base'] !== undefined) {
      const slot = USE_SLOTS ? listSlots().find((s) => s.plan === planPath(nnn)) ?? null : null
      const own = builderFolder(run, nnn)
      const folder = slot ? slot.path : existsSync(own) ? own : null
      if (!folder) fail(`handoff --reset-base: plan ${nnn} has no folder to reset`)
      fetchOrigin()
      const from = git(folder, 'rev-parse', 'HEAD').out
      const base = git(folder, 'merge-base', 'HEAD', `origin/${runBranch(run)}`).out
      if (!/^[0-9a-f]{40}$/.test(base)) fail(`handoff --reset-base: no common base of ${branch} and origin/${runBranch(run)} in ${folder}`)
      reset = { folder, from, base }
    }
    // Does the plan itself have to change? yes | no; anything else is "no".
    const replan = args.replan === 'yes' ? 'yes' : 'no'
    const replanWhy = args['replan-why'] && args['replan-why'] !== true ? String(args['replan-why']) : '(not given)'
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), [
      `Step:            ${val('step')} of plan ${nnn} (run ${run}, branch ${branch})`,
      `Files changed:   ${files.join(', ') || '(none)'}`,
      `Done:            ${done}`,
      `Failed:          ${val('failed')}`,
      `Tried:           ${val('tried')}`,
      `Failing check:   ${val('check')}`,
      `Output tail:     ${val('tail')}`,
      'Suspected cause: (a guess) see the output tail; rerun the failing check first',
      `Replan:          ${replan} — ${replanWhy}`,
      ...(args['not-done'] && args['not-done'] !== true ? [`Not done:        ${String(args['not-done'])}`] : []),
      ...(reset ? [`Reset:           the folder is back at the base ${reset.base.slice(0, 7)}; the discarded attempt is ${reset.from.slice(0, 7)} (git show ${reset.from.slice(0, 7)})`] : []),
      '',
    ].join('\n'))
    if (reset) {
      const { folder, from, base } = reset
      for (const step of [['checkout', '--', '.'], ['clean', '-fdq', '--exclude=.worktree-*'], ['reset', '--quiet', '--hard', base]]) {
        const r = git(folder, ...step)
        if (r.status !== 0) fail(`handoff --reset-base: git ${step.join(' ')} in ${folder}: ${r.err}`)
      }
      // The plan branch on origin follows (lease: only while it is still at the head this script saw), so the fresh
      // builder's own `git push -u origin <branch>` is a fast-forward. The discarded head stays in status.json (resetFrom).
      const remote = git(folder, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`).out
      if (remote && remote !== base) {
        const p = git(folder, 'push', '--quiet', `--force-with-lease=refs/heads/${branch}:${remote}`, 'origin', `${base}:refs/heads/${branch}`)
        if (p.status !== 0) fail(`handoff --reset-base: moving origin/${branch} to the base ${base.slice(0, 7)} failed: ${p.err.split('\n').pop()}`)
      }
    }
    // The escalation is a fact the builder lessons are written from (lessonFacts): its step and the failing check.
    const st = readStatus(run)
    if (st?.plans?.[nnn]) {
      const e = { step: val('step'), check: val('check').slice(0, 200) }
      st.plans[nnn].escalations = [...(st.plans[nnn].escalations ?? []).filter((x) => x.step !== e.step || x.check !== e.check), e]
      st.plans[nnn].replan = `${replan} — ${replanWhy}`
      if (reset) {
        st.plans[nnn].resetToBase = reset.base
        st.plans[nnn].resetFrom = reset.from
      }
      writeStatus(run, st)
    }
    emit({ ok: true, path: rel, ...(reset ? { resetToBase: reset.base, resetFrom: reset.from } : {}) }, [`hand-off file ${rel}`, ...(reset ? [`${reset.folder.replace(/\\/g, '/')}: reset to the base ${reset.base.slice(0, 7)} (discarded ${reset.from.slice(0, 7)})`] : [])])
  },

  note() {
    const run = runName()
    if (!args.text || args.text === true) fail('--text is empty')
    const status = needStatus(run)
    addNotes(status, [{ plan: args.plan ? planNumber(args.plan) : undefined, text: String(args.text) }])
    writeStatus(run, status)
    emit({ ok: true, notes: status.notes.length })
  },

  // The record of a plan file changed on the run branch while its builder worked (written by run-plans from git):
  //   node scripts/orch-state.mjs plan-changed --run <name> --plan <NNN> --commit <sha> --author <a> --subject <s> [--diff-b64 b] [--warning-b64 b]
  // a run note, a section of the report, and a run warning (a note starting "warning:") for a plan-file commit with no reason.
  'plan-changed'() {
    const run = runName()
    const nnn = planNumber(args.plan ?? '')
    if (!nnn) fail('--plan takes a plan number')
    const status = needStatus(run)
    const dec = (k) => (args[k] && args[k] !== true ? Buffer.from(String(args[k]), 'base64').toString('utf8') : '')
    const commit = String(args.commit ?? '').slice(0, 40)
    const author = String(args.author ?? '').slice(0, 80)
    const subject = String(args.subject ?? '').slice(0, 200)
    status.plansChanged = [...(status.plansChanged ?? []).filter((c) => !(c.plan === nnn && c.commit === commit)), { plan: nnn, commit, author, subject, diff: dec('diff-b64').split('\n').slice(0, 40).join('\n') }]
    const notes = [{ plan: nnn, text: `plan ${nnn} changed during the run: ${commit} ${author} — ${subject}`, id: `plan-changed-${nnn}-${commit}` }]
    for (const w of dec('warning-b64').split('\n').filter(Boolean)) notes.push({ plan: nnn, text: `warning: ${w}`, id: `plan-warning-${nnn}-${w.slice(0, 60)}` })
    addNotes(status, notes)
    writeStatus(run, status)
    emit({ ok: true, plansChanged: status.plansChanged.length })
  },

  // One decision of the run, kept in status.json (not a note: notes are capped per plan, decisions never are). With --id
  // it upserts the decision by id (a runner retry is safe) and applies the hard triage rules once more; with --dup-of it
  // files a differently worded duplicate under the kept decision's alsoFrom.
  decision() {
    const run = runName()
    const status = needStatus(run)
    const r = applyDecision(status, args)
    writeStatus(run, status)
    emit(r)
  },

  // Every decision (and repeat marker) of a run in one call: --b64 is the base64 of a JSON list; each item holds the
  // flags of one `decision` call as keys (plan, id, text, verdict, kind, confidence, rec, why — or plan, dup-of, text,
  // role, round). Same rules per item; one bad item exits 1 and writes nothing.
  decisions() {
    const run = runName()
    let items
    try {
      items = JSON.parse(Buffer.from(String(args.b64 ?? ''), 'base64').toString('utf8'))
    } catch (e) {
      fail(`--b64 is not base64 of a JSON list: ${e.message}`)
    }
    if (!Array.isArray(items) || !items.length || items.some((i) => !i || typeof i !== 'object' || Array.isArray(i))) fail('--b64 must hold a non-empty JSON list of objects')
    const status = needStatus(run)
    const out = items.map((it, n) => applyDecision(status, it, `item ${n + 1}: `))
    writeStatus(run, status)
    emit({ ok: true, count: out.length, decisions: status.decisions.length, ids: out.map((r) => r.id) })
  },

  // The run's brain files (docs/brain: grades, calibration, follow-ups, rules) are committed on the run branch in the
  // merge folder, so the pull request carries them — main takes only plan and todo pushes.
  'brain-commit'() {
    const run = runName()
    const branch = runBranch(run)
    const mf = mergeFolder(run)
    if (!existsSync(mf)) fail(`no merge folder ${mf}`)
    if (!existsSync(join(mf, 'docs', 'brain'))) emit({ ok: true, committed: 0, branch }, ['BRAIN: nothing to commit'])
    // docs/brain, and the eval cases the learning step scaffolds from a graded checker miss (`decision-log.mjs case`).
    const paths = ['docs/brain', ...(existsSync(join(mf, 'docs', 'agent-evals', 'cases')) ? ['docs/agent-evals/cases'] : [])]
    const add = git(mf, 'add', '--', ...paths)
    if (add.status !== 0) fail(`git add ${paths.join(' ')} in ${mf}: ${add.err}`)
    const staged = git(mf, 'diff', '--cached', '--name-only', '--', ...paths).out.split('\n').filter(Boolean)
    if (!staged.length) emit({ ok: true, committed: 0, branch }, ['BRAIN: nothing to commit'])
    const c = git(mf, 'commit', '--quiet', '-m', `orch(${run}): decision grades`, '--', ...paths)
    if (c.status !== 0) fail(`git commit docs/brain in ${mf}: ${(c.err || c.out).split('\n').pop()}`, { envFailure: true })
    const p = git(mf, 'push', '--quiet', 'origin', branch)
    if (p.status !== 0) fail(`git push origin ${branch}: ${p.err.split('\n').pop()} — the commit is in ${mf}`, { envFailure: true })
    emit({ ok: true, committed: staged.length, branch }, [`BRAIN: committed ${staged.length} file(s) on ${branch}`])
  },

  // What the workflow hands each role at launch (LESSONS, RULES, RECENT_RUNS): read-only, from the run's merge folder when
  // it exists, else this folder. A missing file is an empty list — a project without the seeds starts with none.
  context() {
    const run = args.run !== undefined ? runName() : null
    const base = learnBase(run)
    const all = lessonsIn(base)
    const lessons = Object.fromEntries(INJECTED_ROLES.filter((r) => all[r].length).map((r) => [r, all[r]]))
    const rules = rulesIn(base)
    const recent = recentRunsOf(parseRunLog(readIf(join(base, RUN_LOG_REL)) ?? '').rows)
    const budget = contextBudget({ lessons: all, rules, recent })
    // The kit's lessons come from the main checkout only: the merge folder is a branch a builder can edit.
    const kitLessons = kitLessonsIn(root)
    emit({ ok: true, lessons, kitLessons, rules, recent, chars: budget.total, line: budget.line }, budgetLines(budget))
  },

  // The lesson lines of the run, derived from status.json by code (no model call), appended to docs/brain/agent-lessons/
  // (the run branch's merge folder). `finish` does the same and adds the run-log row. A merge folder that is gone (the run
  // was merged and `free-merged-slots` removed it) is an error: the lessons are never written into the main checkout.
  lessons() {
    const run = runName()
    const status = needStatus(run)
    if (!existsSync(mergeFolder(run))) fail(`the merge folder ${mergeFolder(run)} of run ${run} is gone (a merged run's folder is removed) — lessons are written on the run branch, never in the main checkout`)
    const base = mergeFolder(run)
    const merged = mergedPlans(run)
    // A `--final-gate ok|failed` argument is recorded first, so the lines are cut from the newest result.
    const fa = fgArgs()
    if (['ok', 'failed'].includes(fa.result) && applyFinalGate(status, fa.result, fa)) writeStatus(run, status)
    const learned = learnRun(run, status, base, { merged, finalGate: fgWord(status) })
    writeLearned(base, learned.files)
    emit({ ok: true, base: base.replace(/\\/g, '/'), added: learned.added, dropped: learned.dropped.length, chars: learned.budget.total, line: learned.budget.line },
      [...learned.added.map((a) => `LESSON ${a.role}: ${a.text}`), ...learned.dropped.map((d) => `DROPPED ${d.role}: ${d.line}`), `lessons: ${learned.added.length} line(s) added`, ...budgetLines(learned.budget)])
  },


  stop() {
    const run = runName()
    const status = needStatus(run)
    status.phase = 'stopped'
    // Every stop is kept in stops[] (a later attempt's stop never replaces an earlier one); stopReason stays the latest.
    status.stopReason = String(args.reason ?? 'stopped')
    status.stops = [...(Array.isArray(status.stops) ? status.stops : []), { at: nowIso(), reason: status.stopReason, attempt: status.attempts ?? 1 }]
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
    // One line per plan under the run's line: stage, round, tier + model, minutes in that stage, the last calls.csv row.
    const csv = join(runsDir(), run, 'calls.csv')
    const perPlan = planLines(status, { nowMs: Date.now(), calls: existsSync(csv) ? readFileSync(csv, 'utf8') : '' })
    emit({ ok: !w.stuck, stuck: w.stuck, line: w.line, phase: status.phase ?? 'unknown', updatedAt: status.updatedAt ?? null }, [w.line, ...perPlan])
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
    // The final gate's result rides on this call (status.finalGate); `none` leaves a stored result alone.
    const fa = fgArgs()
    if (['ok', 'failed'].includes(fa.result)) applyFinalGate(status, fa.result, fa)
    const slots = giveSlotsBack(run, status)
    writeStatus(run, status)
    publishReport(run, status, { merged, slots, message: `orch(${run}): run report`, brain: true })
  },

  // Records the final gate's result by hand (after a run stopped at the final gate, the Human fixed the cause and re-ran it):
  //   node scripts/orch-state.mjs final-gate --run <name> --result ok|failed [--command "<failing command>"] [--plans <NNN,NNN>]
  // On a run that already has its report the report (local copy and the run branch's) and the run-log row are rewritten from
  // the stored result in the same call; the same call twice changes nothing.
  'final-gate'() {
    const run = runName()
    const result = String(args.result ?? '')
    if (!['ok', 'failed'].includes(result)) fail('--result takes ok or failed')
    const status = needStatus(run)
    const changed = applyFinalGate(status, result, { command: args.command, plans: args.plans })
    if (changed) writeStatus(run, status)
    const fg = status.finalGate
    if (!status.finishedAt || !['finished', 'stopped'].includes(status.phase)) emit({ ok: true, finalGate: fg, changed, rewritten: false }, [`final gate: ${result} (attempt ${fg.attempt}); the run has no report yet, \`finish\` writes it`])
    fetchOrigin()
    publishReport(run, status, { merged: mergedPlans(run), slots: { lines: [] }, message: `orch(${run}): final gate ${result}`, brain: false })
  },
}

// The report, the lesson lines and the run-log row from status.json, then their commit: the tail of `finish`, and what a
// recorded final gate rewrites. `slots` is what giveSlotsBack returned (empty when the slots were given back already).
function publishReport(run, status, { merged, slots, message, brain }) {
  const branch = runBranch(run)
  const mf = mergeFolder(run)
  {
    const mainShaNow = git(root, 'rev-parse', `origin/${MAIN}`).out
    // The files main changed during the run: a commit that touches only plans and the todo list (the Planner's own
    // pushes) does not make main "touched".
    const changed = status.mainShaAtStart && status.mainShaAtStart !== mainShaNow ? git(root, 'diff', '--name-only', status.mainShaAtStart, mainShaNow) : null
    const mainChangedFiles = changed && changed.status === 0 ? changed.out.split('\n').map((l) => l.trim()).filter(Boolean) : null
    const appErrors = runLogQuery(status.startedAt)
    // The grade rows (docs/brain/decision-grades.jsonl) of the merge folder, else of the main folder: agreement per kind.
    const gradeRows = readGradeRows([join(mf, 'docs', 'brain', 'decision-grades.jsonl'), join(root, 'docs', 'brain', 'decision-grades.jsonl')])
    const triage = { mode: TRIAGE, stats: withKitPrior(agreementStats(gradeRows), kitTriagePrior(root), TRIAGE_MIN_GRADED), minAgreement: TRIAGE_MIN_AGREEMENT, minGraded: TRIAGE_MIN_GRADED }
    // What the run teaches the next one: lesson lines from status.json, this run's row of the run log, and the trend line and
    // character budget the report ends with. Computed here in memory (a failure never stops the report); the files are
    // written and committed below, with the report, in the merge folder.
    let learned = null
    let learnError = null
    try {
      learned = learnRun(run, status, existsSync(mf) ? mf : root, { merged, finalGate: fgWord(status), finishedAt: status.finishedAt, runLog: true })
    } catch (e) {
      learnError = e.message
    }
    const report = withPlansChanged(status, formatReport({ status, merged, mainShaNow, finishedAt: status.finishedAt, runBranch: branch, mainBranch: MAIN, mainChangedFiles, appErrors, decisions: status.decisions ?? [], triage, learning: learned ? { budget: learned.budget.line, trend: learned.trend.line } : null }))
    // What the command prints: this launch's decisions, and an earlier launch's that has no grade for this run yet.
    const attempt = status.attempts ?? 1
    const inView = decisionsInView(status.decisions ?? [], { attempt, run, gradeRows })
    const earlier = inView.filter((d) => (d.attempt ?? 1) < attempt)
    const view = triageView({ decisions: inView, ...triage })
    const ids = (list) => list.map((d) => d.id)
    const triageOut = { mode: TRIAGE, line: view.line, ask: ids(view.ask), askMore: ids(view.askMore), accepted: ids(view.accepted), followUps: ids(view.followUps), noise: ids(view.noise), none: ids(view.none), collapsed: ids(view.collapsed) }
    const local = join(runsDir(), `${run}.md`)
    mkdirSync(runsDir(), { recursive: true })
    writeFileSync(local, report)
    // The run's facts go to the kit brain (docs/agent/kit-brain.md): after the local report exists, before the branch commit,
    // so a failed push still sends. It can never change this command's exit code or the report.
    const brainLine = brain ? brainSend(['--run', run, `--final-gate=${fgWord(status)}`]) : null
    const parked = Object.values(status.plans).filter((x) => x.state === 'parked' || x.state === 'left-run').map((x) => x.nnn)
    const rel = `docs/orchestrator/runs/${run}`
    const learningOut = learned ? { lessonsAdded: learned.added.length, lessonsDropped: learned.dropped.length, budget: learned.budget.line, chars: learned.budget.total, trend: learned.trend.line } : { error: learnError }
    const learningLines = learned ? [`lessons: ${learned.added.length} line(s) added, ${learned.dropped.length} dropped`, ...budgetLines(learned.budget), learned.trend.line] : [`lessons: not written (${learnError})`]
    const base = { triage: triageOut, ...(earlier.length ? { earlierDecisions: earlier } : {}), report: `${rel}/report.md`, local: local.replace(/\\/g, '/'), merged: merged.map((m) => m.nnn), parked, phase: status.phase, slots: slots.lines, learning: learningOut, ...(brainLine ? { brain: brainLine } : {}) }
    const notCommitted = (error, extra = {}) => emit({ ok: false, ...base, reportCommitted: false, error: `${error} — the report is in ${local}`, ...extra },
      [...slots.lines, `report: local copy ${local} (not committed to ${branch}: ${error})`, ...learningLines, ...(brainLine ? [brainLine] : [])])
    if (!existsSync(mf)) notCommitted(`no merge folder ${mf}`)
    const dirty = git(mf, 'status', '--porcelain').out
    if (dirty) notCommitted(`the merge folder ${mf} has uncommitted files: ${dirty.split('\n').map((l) => l.slice(3)).join(', ')}`)
    const ff = git(mf, 'merge', '--quiet', '--ff-only', `origin/${branch}`)
    if (ff.status !== 0) notCommitted(`the merge folder cannot fast-forward to origin/${branch}: ${ff.err}`)
    mkdirSync(join(mf, rel), { recursive: true })
    writeFileSync(join(mf, rel, 'report.md'), report)
    writeFileSync(join(mf, rel, 'status.json'), `${JSON.stringify(status, null, 2)}\n`)
    if (learned) writeLearned(mf, learned.files)
    const add = git(mf, 'add', '--', `${rel}/report.md`, `${rel}/status.json`, ...(learned ? [...learned.files.keys()] : []))
    if (add.status !== 0) notCommitted(`git add the report: ${add.err}`)
    const c = git(mf, 'commit', '--quiet', '-m', message)
    if (c.status !== 0 && !/nothing to commit/.test(c.out + c.err)) notCommitted(`git commit the report: ${(c.err || c.out).split('\n').pop()}`)
    const p = git(mf, 'push', '--quiet', 'origin', branch)
    if (p.status !== 0) notCommitted(`git push origin ${branch}: ${p.err.split('\n').pop()}`, { envFailure: true })
    const left = git(mf, 'status', '--porcelain').out
    emit({ ok: !left, ...base, reportCommitted: true, ...(left ? { error: `merge folder not clean: ${left}` } : {}) },
      [...slots.lines, `report: ${rel}/report.md on ${branch}; local copy ${local}`, `merged ${merged.length}: ${merged.map((m) => m.nnn).join(', ') || 'none'}; parked ${parked.length}: ${parked.join(', ') || 'none'}`, ...learningLines, ...(brainLine ? [brainLine] : [])])
  }
}

// The kit brain (docs/agent/kit-brain.md): `node scripts/brain.mjs send …` in a child process that is killed after 15 s
// (KIT_BRAIN_KILL_MS shortens it in tests). Returns its one `BRAIN:` line; a script that is not installed gives null.
// Whatever happens here — a throw, a hang, a non-zero exit — the caller's exit code and report are untouched.
function brainSend(extra) {
  const script = join(root, 'scripts', 'brain.mjs')
  if (!existsSync(script)) return null
  const kill = Number(process.env.KIT_BRAIN_KILL_MS) > 0 ? Number(process.env.KIT_BRAIN_KILL_MS) : 15000
  try {
    const r = spawnSync(process.execPath, [script, 'send', ...extra], { cwd: root, encoding: 'utf8', timeout: kill, killSignal: 'SIGKILL' })
    if (r.error?.code === 'ETIMEDOUT' || r.signal) return `BRAIN: queued (the send did not finish within ${Math.round(kill / 1000)} s; its documents wait in the queue)`
    return (r.stdout ?? '').split(/\r?\n/).find((l) => l.startsWith('BRAIN:')) ?? `BRAIN: no answer (exit ${r.status})`
  } catch (e) {
    return `BRAIN: not sent (${String(e.message).split('\n')[0]})`
  }
}

// The grade rows of the first file that exists (one JSON object per line); an unreadable line is skipped.
function readGradeRows(files) {
  const file = files.find((f) => existsSync(f))
  if (!file) return []
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)]
    } catch {
      return []
    }
  })
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
