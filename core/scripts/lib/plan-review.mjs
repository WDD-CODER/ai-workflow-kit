/**
 * The single reviewer of a built plan (docs/agent/orchestrator.md "Model calls"; agent: .claude/agents/plan-reviewer.md).
 * One headless call (lib/claude-run.mjs) with no write tool, in a review folder at the checked head:
 *
 *   import { review } from './lib/plan-review.mjs'
 *   const r = await review({ agentFile, model, cwd, nnn, run, planText, base, branch, diffText, receipt, mode })
 *   // r = { verdict: 'PASS'|'STOP', enforced, problems, note, call }
 *
 * The prompt holds the plan without its ## Execution Notes (orch-state.mjs `diff --no-notes` writes that copy: the
 * builder's own account never reaches the reviewer), the diff BASE...BRANCH and the gate receipt. The verdict is computed
 * here from the kept problems — STOP when any is `blocker` or `major` — never taken from the model; a model verdict
 * that disagrees is noted. `mode`: "gate" enforces a STOP (a fix round, then the plan parks); "advisory" (the default
 * until the reviewer's measured precision reaches 0.50 in the kit's eval) records a STOP and lets the plan merge.
 * Also the result validator for the reviewer (moved here from the kit's eval tool, which imports it). Node built-ins only.
 *
 * Outside a run (`/ship` Phase 2 with `review.ship` = `reviewer`), as a command in the project root:
 *
 *   node scripts/lib/plan-review.mjs --branch <current branch> --base origin/<main> [--plan <file>] [--model <m>] [--json]
 *
 * The plan comes from the branch name (`feat|fix/NNN-<slug>` → `plans/**\/NNN-*.plan.md`), redacted (lib/redact.mjs) into
 * the OS temp folder and left out of the diff; the diff is the branch point (`git merge-base <base> <branch>`) against
 * the working tree when the branch is the current one (uncommitted and untracked files included), else
 * `<base>...<branch>`; the receipt is the last `ship-prep.mjs --gate` run's, used only while it matches the tree
 * (readShipGateReceipt); the agent file is read from `<base>` (shipReview). The verdict is enforced (mode gate). Prints one
 * `REVIEW: PASS|STOP — …` line and one line per problem; exit 0 PASS, 1 STOP, 2 when the review could not run.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, renameSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runAgent, parseResult, readAgent } from './claude-run.mjs'
import { redactPlan } from './redact.mjs'

export const SEVERITIES = ['blocker', 'major', 'minor', 'nit']
export const FAILING = ['blocker', 'major']
export const REVIEWER_VERDICTS = ['PASS', 'STOP']
export const REVIEWER_MODES = ['gate', 'advisory']
/** The diff shown inline at most (characters); the rest the reviewer reads with git diff in its folder. */
export const MAX_DIFF = 60_000

const isStr = (v) => typeof v === 'string' && v.trim() !== ''

/** STOP when any problem is blocker or major, else PASS — the only verdict that counts. */
export const reviewVerdict = (problems) => ((problems ?? []).some((p) => FAILING.includes(p?.severity)) ? 'STOP' : 'PASS')

/**
 * Validate one reviewer result for the agent named `role`: the finder schema of docs/agent/agent-roles.md (`problems[]`
 * of `{id, file, line, rule, reasoning, severity}`, `model`, `effort`, optional `decisions` and `pass`) plus
 * `verdict: PASS|STOP`. Returns { ok, errors, pass }; `pass` is computed from the problems, and a result whose own
 * `pass` or `verdict` disagrees with it is rejected.
 */
export function validateReviewerResult(result, role = 'plan-reviewer') {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { ok: false, errors: ['result must be a JSON object'], pass: null }
  const errors = []
  if (result.role !== role) errors.push(`role must be ${role} (got ${JSON.stringify(result.role)})`)
  if (!isStr(result.model)) errors.push('model is required: the model id the agent ran on')
  if (!isStr(result.effort)) errors.push('effort is required')
  if (result.decisions !== undefined && (!Array.isArray(result.decisions) || !result.decisions.every(isStr))) errors.push('decisions must be a list of strings')
  let pass = null
  if (!Array.isArray(result.problems)) errors.push('problems must be a list')
  else {
    result.problems.forEach((p, i) => {
      const at = `problems[${i}]`
      if (!p || typeof p !== 'object') return errors.push(`${at} must be an object`)
      for (const k of ['id', 'file', 'rule', 'reasoning']) if (!isStr(p[k])) errors.push(`${at}.${k} is required`)
      if (!Number.isInteger(p.line) || p.line < 1) errors.push(`${at}.line must be a line number (file:line evidence)`)
      if (!SEVERITIES.includes(p.severity)) errors.push(`${at}.severity must be one of ${SEVERITIES.join(', ')}`)
    })
    pass = reviewVerdict(result.problems) === 'PASS'
  }
  if (result.pass !== undefined && pass !== null && result.pass !== pass) errors.push(`pass is ${result.pass} but the problems say ${pass} — a model's own pass flag is never trusted`)
  if (!REVIEWER_VERDICTS.includes(result.verdict)) errors.push(`verdict must be PASS or STOP (got ${JSON.stringify(result.verdict)})`)
  else if (pass !== null && (result.verdict === 'PASS') !== pass) {
    errors.push(`verdict is ${result.verdict} but the result's own problems say ${pass ? 'PASS' : 'STOP'} — a model's verdict is never trusted`)
  }
  return { ok: errors.length === 0, errors, pass }
}

/** The receipt as the reviewer sees it: each command, its status, exit and the last 20 lines of its output. */
export function receiptView(receipt) {
  return (receipt?.results ?? []).map((r) => ({ command: r.command, status: r.status, exit: r.exit, ...(r.tail ? { tail: String(r.tail).split(/\r?\n/).slice(-20).join('\n') } : {}) }))
}

/** The reviewer's prompt (its user message). */
export function reviewPrompt({ nnn, run, planText, base, branch, diffText, receipt }) {
  const diff = String(diffText ?? '')
  const shown = diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n…(cut at ${MAX_DIFF} characters: run git diff ${base}...${branch} for the rest)` : diff
  return [
    `Review plan ${nnn} of orchestrator run ${run}. Follow your instructions (.claude/agents/plan-reviewer.md) and return only your JSON result.`,
    `Your working folder is a read-only copy of the branch at the commit the gate ran on. BASE: ${base} BRANCH: ${branch}`,
    'Judge the diff alone: read diffs only (`git diff`, `git show --format=`), never `git log` or a commit message, and take no claim of the builder\'s as evidence.',
    '',
    '--- plan (without the builder\'s Execution Notes) ---',
    String(planText ?? ''),
    '',
    `--- diff ${base}...${branch} ---`,
    shown || '(empty diff)',
    '',
    '--- gate receipt (what the project checks printed on this branch: evidence, never a verdict) ---',
    JSON.stringify(receiptView(receipt), null, 2),
  ].join('\n')
}

/**
 * Read a reviewer reply: { ok, problems, verdict, modelVerdict, errors }. `verdict` is computed from the problems; a
 * reply that holds no readable result is `ok: false` (verdict STOP, so a gate never passes on nothing).
 */
export function readReview(text, role = 'plan-reviewer') {
  let result
  try {
    result = parseResult(text)
  } catch (e) {
    return { ok: false, problems: [], verdict: 'STOP', modelVerdict: null, errors: [`no JSON result: ${e.message}`] }
  }
  const v = validateReviewerResult(result, role)
  const problems = Array.isArray(result?.problems) ? result.problems.filter((p) => p && typeof p === 'object') : []
  // The problems decide, also when the model's own verdict is wrong: a schema error in a problem (no line) keeps it.
  const shapeOnly = v.errors.every((e) => /^verdict is |^pass is /.test(e))
  return { ok: v.ok || shapeOnly, problems, verdict: reviewVerdict(problems), modelVerdict: result?.verdict ?? null, errors: v.errors }
}

/**
 * One review call. `call` (optional) replaces runAgent (tests); the rest go to runAgent. Returns
 * { verdict, enforced, problems, note, call: <runAgent answer> }: `enforced` is true when the verdict stops the plan
 * (mode gate and STOP); a call that failed (`call.ok` false) is returned as is for the caller (a rate limit pauses the run).
 */
export async function review({ agentFile, model, cwd, nnn, run, planText, base, branch, diffText, receipt, mode = 'advisory', timeoutMs = 600_000, bin, call = runAgent }) {
  const prompt = reviewPrompt({ nnn, run, planText, base, branch, diffText, receipt })
  const r = await call({ agentFile, model, cwd, prompt, timeoutMs, ...(bin ? { bin } : {}) })
  if (!r.ok) return { verdict: null, enforced: false, problems: [], note: null, call: r }
  const read = readReview(r.text)
  const notes = []
  if (!read.ok) notes.push(`reviewer result unreadable: ${read.errors.slice(0, 2).join('; ')}`)
  else if (read.modelVerdict && read.modelVerdict !== read.verdict) notes.push(`reviewer said ${read.modelVerdict}, its problems say ${read.verdict} — the problems decide`)
  const gate = mode === 'gate'
  // An unreadable result is a STOP in gate mode (a gate never passes on nothing) and only a note in advisory mode.
  const verdict = read.ok ? read.verdict : 'STOP'
  if (!gate && verdict === 'STOP') notes.push(`advisory review STOP (not enforced): ${blocking(read.problems).map(problemLine).join('; ') || 'no readable result'}`)
  return { verdict, enforced: gate && verdict === 'STOP', problems: read.problems, note: notes.join(' · ') || null, call: r }
}

/** The blocking problems (blocker / major) of a review. */
export const blocking = (problems) => (problems ?? []).filter((p) => FAILING.includes(p?.severity))
/** One problem as `severity file:line rule`. */
export const problemLine = (p) => `${p.severity} ${p.file}:${p.line} ${p.rule}`

// ---- outside a run: the /ship reviewer -------------------------------------------------------------------------

const gitOut = (root, ...a) => {
  const r = spawnSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { status: r.status, out: String(r.stdout ?? '').replace(/\r?\n$/, ''), err: String(r.stderr ?? '') }
}

/**
 * Where `ship-prep.mjs --gate` leaves its receipt: inside this checkout's own git folder (`git rev-parse
 * --absolute-git-dir`, one per worktree) — never a shared temp path another user or checkout could write.
 */
export function shipGateReceiptPath(root) {
  const dir = gitOut(root, 'rev-parse', '--absolute-git-dir').out
  return dir ? join(dir, 'kit-ship-gate.json') : null
}

/**
 * What the checks ran on: HEAD, the index tree (`git write-tree`) and a hash of the working-tree changes against HEAD
 * plus the untracked file names. A receipt whose stamp differs is stale (the code changed after the gate) and ignored.
 */
export function worktreeStamp(root) {
  const head = gitOut(root, 'rev-parse', 'HEAD').out
  const tree = gitOut(root, 'write-tree').out
  const dirty = createHash('sha1').update(gitOut(root, 'diff', '--no-color', 'HEAD').out).update('\0')
    .update(gitOut(root, 'ls-files', '--others', '--exclude-standard').out).digest('hex')
  return { head, tree, dirty }
}

/** Write the gate receipt atomically (a private temp file in the same folder, then rename), bound to the stamp. */
export function writeShipGateReceipt(root, data) {
  const file = shipGateReceiptPath(root)
  if (!file) throw new Error('not a git checkout')
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(tmp, JSON.stringify({ ...data, stamp: worktreeStamp(root) }, null, 2), { mode: 0o600, flag: 'wx' })
  renameSync(tmp, file)
  return file
}

/** The receipt when it belongs to this exact tree: { receipt, why } — receipt null when missing, unreadable or stale. */
export function readShipGateReceipt(root) {
  const file = shipGateReceiptPath(root)
  if (!file || !existsSync(file)) return { receipt: null, why: 'no gate receipt (run ship-prep --gate first)' }
  let r
  try { r = JSON.parse(readFileSync(file, 'utf8')) } catch { return { receipt: null, why: 'gate receipt unreadable' } }
  const now = worktreeStamp(root)
  const s = r?.stamp ?? {}
  if (s.head !== now.head || s.tree !== now.tree || s.dirty !== now.dirty) return { receipt: null, why: 'gate receipt is stale (the tree changed after the gate) — ignored' }
  return { receipt: r, why: null }
}

/** The plan file of a `feat|fix/NNN-<slug>` branch: the first `NNN-*.plan.md` under plans/ (any folder), else null. */
export function planForBranch(root, branch) {
  const m = /^(?:feat|fix)\/(\d{3,4})-/.exec(String(branch ?? ''))
  if (!m) return null
  const walk = (rel) => {
    let entries = []
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }) } catch { return null }
    const hit = entries.find((e) => e.isFile() && e.name.startsWith(`${m[1]}-`) && e.name.endsWith('.plan.md'))
    if (hit) return `${rel}/${hit.name}`
    for (const e of entries) if (e.isDirectory()) { const f = walk(`${rel}/${e.name}`); if (f) return f }
    return null
  }
  return walk('plans')
}

/** Files the review cannot trust when the branch changes them: the reviewer's own prompt and the Claude settings. */
export const REVIEW_TAMPER_RE = /^\.claude\/(settings[^/]*\.json|agents\/plan-reviewer\.md)$/

/**
 * The diff under review and the files it touches: on the current branch the working tree against the branch point
 * (staged, unstaged and the untracked files as new files: at /ship the work is not committed yet), else
 * `<base>...<branch>`. The plan file is left out (`exclude`): its `## Execution Notes` must not reach the reviewer
 * through the diff either; the plan reaches it redacted.
 */
export function shipDiff(root, base, branch, exclude = null) {
  const current = gitOut(root, 'branch', '--show-current').out
  const spec = exclude ? ['--', '.', `:(exclude)${exclude}`] : []
  if (branch !== current) {
    const range = `${base}...${branch}`
    return { text: gitOut(root, 'diff', '--no-color', range, ...spec).out, files: gitOut(root, 'diff', '--name-only', range, ...spec).out.split('\n').filter(Boolean) }
  }
  const point = gitOut(root, 'merge-base', base, 'HEAD').out || base
  const parts = [gitOut(root, 'diff', '--no-color', point, ...spec).out]
  const files = gitOut(root, 'diff', '--name-only', point, ...spec).out.split('\n').filter(Boolean)
  for (const f of gitOut(root, 'ls-files', '--others', '--exclude-standard').out.split('\n').filter(Boolean)) {
    if (exclude && f === exclude) continue
    files.push(f)
    parts.push(gitOut(root, 'diff', '--no-color', '--no-index', '--', '/dev/null', f).out)
  }
  return { text: parts.filter(Boolean).join('\n'), files }
}

function cliArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) { o[a.slice(2)] = next; i++ } else o[a.slice(2)] = true
  }
  return o
}

/**
 * The /ship reviewer: one gate-mode review of `branch` against `base` in `root`. Returns the exit code (0 PASS,
 * 1 STOP, 2 no verdict). Trust: the agent file comes from `base` (`git show`), never the branch's working tree; a
 * diff that touches the reviewer's prompt or a Claude settings file gets no verdict; the call runs in a detached
 * worktree at HEAD (no local settings file, `trustCwdSettings: false`) with no write tool and the narrow read-only Bash.
 */
export async function shipReview({ root = process.cwd(), branch, base, plan = null, model = null, json = false, bin, log = console.log }) {
  if (typeof branch !== 'string' || typeof base !== 'string') {
    log('REVIEW: refused — usage: node scripts/lib/plan-review.mjs --branch <branch> --base <base> [--plan <file>] [--model <m>] [--json]')
    return 2
  }
  const planPath = typeof plan === 'string' ? plan.replace(/\\/g, '/') : planForBranch(root, branch)
  if (!planPath || !existsSync(join(root, planPath))) {
    log(`REVIEW: refused — no plan file for ${branch} (name it with --plan <file>)`)
    return 2
  }
  const agentText = gitOut(root, 'show', `${base}:.claude/agents/plan-reviewer.md`)
  if (agentText.status !== 0 || !agentText.out.trim()) {
    log(`REVIEW: refused — ${base} has no .claude/agents/plan-reviewer.md (the reviewer's prompt is read from the base, never the branch)`)
    return 2
  }
  // The shared role contract the system prompt carries (claude-run.mjs systemPromptOf) comes from the base as well.
  const rolesText = gitOut(root, 'show', `${base}:docs/agent/agent-roles.md`)
  if (rolesText.status !== 0 || !rolesText.out.trim()) {
    log(`REVIEW: refused — ${base} has no docs/agent/agent-roles.md (the reviewer's contract is read from the base, never the branch)`)
    return 2
  }
  const diff = shipDiff(root, base, branch, planPath)
  const tampered = diff.files.filter((f) => REVIEW_TAMPER_RE.test(f))
  if (tampered.length) {
    log(`REVIEW: no verdict — the diff changes ${tampered.join(', ')} (the reviewer's prompt or settings); review it with the checkers instead`)
    return 2
  }
  const tmp = mkdtempSync(join(tmpdir(), 'ship-review-'))
  const folder = join(tmp, 'tree')
  try {
    // Laid out as systemPromptOf expects: <tmp>/.claude/agents/<agent> + <tmp>/docs/agent/agent-roles.md, both from base.
    const agentFile = join(tmp, '.claude', 'agents', 'plan-reviewer.md')
    mkdirSync(dirname(agentFile), { recursive: true })
    mkdirSync(join(tmp, 'docs', 'agent'), { recursive: true })
    writeFileSync(agentFile, `${agentText.out}\n`)
    writeFileSync(join(tmp, 'docs', 'agent', 'agent-roles.md'), `${rolesText.out}\n`)
    const agent = readAgent(agentFile)
    const useModel = typeof model === 'string' ? model : agent.model
    if (/haiku/i.test(String(useModel ?? ''))) {
      log(`REVIEW: refused — the reviewer never runs on Haiku (got ${useModel})`)
      return 2
    }
    const { receipt, why } = readShipGateReceipt(root)
    if (why) log(`  receipt: ${why}`)
    // The redacted plan lives in the OS temp folder (no run folder outside a run): the builder's notes never reach it.
    const planText = redactPlan(readFileSync(join(root, planPath), 'utf8'))
    writeFileSync(join(tmp, 'plan.md'), planText)
    const nnn = /(\d{3,4})-/.exec(planPath.split('/').pop())?.[1] ?? '?'
    const add = gitOut(root, 'worktree', 'add', '--quiet', '--detach', folder, 'HEAD')
    if (add.status !== 0) {
      log(`REVIEW: could not run — git worktree add: ${add.err.trim().split(/\r?\n/).pop()}`)
      return 2
    }
    const r = await review({
      agentFile, model: useModel, cwd: folder, nnn, run: 'ship', planText, base, branch, diffText: diff.text, receipt: receipt ?? { results: [] }, mode: 'gate',
      call: (args) => runAgent({ ...args, agent, allow: true, trustCwdSettings: false, ...(bin ? { bin } : {}) }),
    })
    if (!r.call.ok) {
      log(`REVIEW: could not run — ${r.call.error}`)
      return 2
    }
    const block = blocking(r.problems)
    log(`REVIEW: ${r.verdict} — ${r.problems.length} problem(s), ${block.length} blocking (plan-reviewer on ${useModel ?? 'inherit'})`)
    for (const p of r.problems) log(`  ${problemLine(p)} — ${String(p.reasoning ?? '').split(/\r?\n/)[0]}`)
    if (r.note) log(`  note: ${r.note}`)
    if (json) log(`REVIEW_JSON ${JSON.stringify({ verdict: r.verdict, problems: r.problems, model: useModel, plan: planPath, receipt: Boolean(receipt) })}`)
    return r.verdict === 'PASS' ? 0 : 1
  } finally {
    if (existsSync(folder)) gitOut(root, 'worktree', 'remove', '--force', folder)
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const o = cliArgs(process.argv.slice(2))
  shipReview({ branch: o.branch, base: o.base, plan: o.plan, model: o.model, json: Boolean(o.json) }).then(
    (code) => { process.exitCode = code },
    (e) => { console.log(`REVIEW: could not run — ${e?.message ?? e}`); process.exitCode = 2 },
  )
}
