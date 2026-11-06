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
 * until the reviewer's measured precision reaches 0.50, plan 087) records a STOP and lets the plan merge.
 * Also the result validator for the reviewer (moved here from the kit's eval tool, which imports it). Node built-ins only.
 */
import { runAgent, parseResult } from './claude-run.mjs'

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
