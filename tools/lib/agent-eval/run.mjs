/**
 * Agent eval runner (contract: docs/agent/agent-evals.md). Runs one agent file against a folder of cases N times
 * per case and scores the results.
 *
 *   import { evaluate, loadAgent, findCases, claudeRunner, formatTable } from './run.mjs'
 *   const report = await evaluate({ agentFile, casesDir, runs: 2, model, runner })
 *
 * A runner is `async ({ agent, model, role, caseName, caseDir, inputDir, run }) => ({ text, tokens, costUsd })`:
 * `text` is the agent's final reply (its JSON result, fenced or bare), `tokens` and `costUsd` what the run spent.
 * Tests pass a stub runner; real use takes `claudeRunner`, which calls Claude Code non-interactively
 * (`claude -p --output-format json`) with the agent file's body as the system prompt. Node built-ins only.
 */
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdtempSync, rmSync, cpSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { parseAgentResult, validateAgentResult } from '../agent-result.mjs'
import { compareCase, caseKind } from './compare.mjs'
import { scoreCase, scoreTotal } from './score.mjs'
import { redactPlan } from '../../../core/scripts/lib/redact.mjs'

/** Tools that let an agent change files; an agent that has one is refused unless allowWrite is set. */
export const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

/** Parse an agent file: frontmatter fields and the body (the prompt). */
export function loadAgent(agentFile) {
  const text = readFileSync(agentFile, 'utf8')
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) throw new Error(`${agentFile}: no frontmatter (--- name/tools/model ---)`)
  const fields = Object.fromEntries(m[1].split(/\r?\n/).map((l) => /^(\w+):\s*(.*)$/.exec(l)).filter(Boolean).map((x) => [x[1], x[2].trim()]))
  if (!fields.name) throw new Error(`${agentFile}: frontmatter has no name:`)
  const tools = fields.tools === undefined ? null : fields.tools.split(',').map((t) => t.trim()).filter(Boolean)
  return { file: resolve(agentFile), name: fields.name, model: fields.model ?? null, effort: fields.effort ?? null, tools, body: m[2], text }
}

/**
 * Refuse a write-capable agent: one whose `tools:` names a write tool, or that has no `tools:` line (it would inherit
 * every tool). Bash can write files too: an agent with Bash runs only on a runner that isolates each case (`isolated`:
 * the case runs in a scratch copy of its input folder, outside the repository — claudeRunner does; a stub that never
 * runs the agent may say so too). Returns null when allowed, else the reason.
 */
export function writeRefusal(agent, allowWrite = false, { isolated = false } = {}) {
  if (allowWrite) return null
  if (agent.tools === null) return `${agent.name} has no tools: line, so it inherits every tool including Edit and Write — pass --allow-write to run it anyway`
  const found = agent.tools.filter((t) => WRITE_TOOLS.includes(t))
  if (found.length) return `${agent.name} can write files (tools: ${found.join(', ')}) — pass --allow-write to run it anyway`
  if (agent.tools.includes('Bash') && !isolated) return `${agent.name} can write files through Bash and this runner does not run cases in a scratch copy — use a runner that does (the default one), or pass --allow-write`
  return null
}

/**
 * The cases for an agent: `<casesDir>/<role>/<case>/` when a folder named after the agent exists, else the case
 * folders directly under casesDir. A case folder holds `expected.json` and an `input/` folder.
 */
export function findCases(casesDir, role, { only = null } = {}) {
  const root = existsSync(join(casesDir, role)) && statSync(join(casesDir, role)).isDirectory() ? join(casesDir, role) : casesDir
  if (!existsSync(root)) throw new Error(`no case folder at ${casesDir}`)
  const all = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'expected.json')))
    .map((d) => d.name)
  // A case list names the exact cases to run; one it names that is not there is an error, so "the same cases" holds.
  if (only) {
    const lost = only.filter((n) => !all.includes(n))
    if (lost.length) throw new Error(`case list names case(s) not under ${root}: ${lost.join(', ')}`)
  }
  const cases = all
    .filter((n) => !only || only.includes(n))
    .sort()
    .map((name) => {
      const caseDir = join(root, name)
      const expected = JSON.parse(readFileSync(join(caseDir, 'expected.json'), 'utf8'))
      caseKind(expected) // throws on a malformed expectation
      return { name, caseDir, inputDir: join(caseDir, 'input'), expected }
    })
  if (cases.length === 0) throw new Error(`no cases (folders with expected.json) under ${root}`)
  return cases
}

/** Score one run's reply text against a case. */
export function scoreRun(expected, reply, role) {
  let result = null
  let error = null
  let pass = null
  try {
    result = parseAgentResult(reply.text ?? '')
    const v = validateAgentResult(result)
    pass = v.pass
    if (!v.ok) error = `invalid result: ${v.errors.slice(0, 2).join('; ')}`
    else if (result.role !== role) error = `result role ${result.role} is not ${role}`
  } catch (e) {
    error = `no JSON result: ${e.message}`
  }
  const cmp = compareCase(expected, error ? null : result, { pass: error ? null : pass })
  return { ...cmp, tokens: Number(reply.tokens) || 0, costUsd: Number(reply.costUsd) || 0, error }
}

/**
 * The case names a case list (`<role>/<case>` per line, `#` comments) holds for one role, or null for "all".
 * A list with no line for the role is an error: "the same cases" must not silently become zero or all.
 */
export function caseListFor(text, role) {
  const names = String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('/')).filter((p) => p.length === 2 && p[0] === role).map((p) => p[1])
  if (!names.length) throw new Error(`the case list has no line for ${role}`)
  return names
}

/**
 * Per-run totals (plan 049): the totals of run 1 alone, of run 2 alone, … over every case. The run-to-run spread of a
 * figure is max − min of these. `caseRuns` is one array of runs per case. A run's noise is the share of the keys it
 * reported that the other runs of that case did not all report, averaged over cases.
 */
export function runTotals(caseRuns) {
  const ratio = (num, den) => (den === 0 ? 1 : num / den)
  const sum = (rows, f) => rows.reduce((s, x) => s + (Number(f(x)) || 0), 0)
  const n = Math.max(0, ...caseRuns.map((r) => r.length))
  const out = []
  for (let i = 0; i < n; i++) {
    const rows = caseRuns.map((runs) => runs[i]).filter(Boolean)
    const tp = sum(rows, (r) => r.tp)
    const fn = sum(rows, (r) => r.fn)
    const fp = sum(rows, (r) => r.fp)
    const noises = caseRuns.filter((runs) => runs.length > 1 && runs[i]).map((runs) => {
      const mine = new Set(runs[i].keys ?? [])
      if (mine.size === 0) return 0
      const others = runs.filter((_, j) => j !== i).map((r) => new Set(r.keys ?? []))
      return 1 - [...mine].filter((k) => others.every((s) => s.has(k))).length / mine.size
    })
    out.push({ recall: ratio(tp, tp + fn), precision: ratio(tp, tp + fp), noise: noises.length ? noises.reduce((s, x) => s + x, 0) / noises.length : 0, costUsd: sum(rows, (r) => r.costUsd), errors: rows.filter((r) => r.error).length })
  }
  return out
}

/** max − min of one figure over the per-run totals (0 with fewer than two runs). */
export function spreadOf(totals, figure) {
  if (totals.length < 2) return 0
  const v = totals.map((t) => t[figure])
  return Math.max(...v) - Math.min(...v)
}

/**
 * Run the agent on every case `runs` times and score it. Returns { agent, model, cases: [...], total, runTotals }.
 * `caseNames` (a case list) limits the run to those cases; `redact` and `withGate` change what the agent is shown
 * (see casePrompt) and are passed to the runner.
 */
export async function evaluate({ agentFile, casesDir, runs = 2, model = null, runner, allowWrite = false, caseNames = null, redact = false, withGate = false }) {
  const agent = loadAgent(agentFile)
  const refusal = writeRefusal(agent, allowWrite, { isolated: runner?.isolated === true })
  if (refusal) throw new Error(refusal)
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a whole number ≥ 1')
  const useModel = model ?? agent.model
  const cases = findCases(casesDir, agent.name, { only: caseNames })
  const scored = []
  const caseRuns = []
  for (const c of cases) {
    const results = []
    for (let run = 1; run <= runs; run++) {
      let reply
      try {
        reply = await runner({ agent, model: useModel, role: agent.name, caseName: c.name, caseDir: c.caseDir, inputDir: c.inputDir, run, redact, withGate })
      } catch (e) {
        results.push({ ...compareCase(c.expected, null), tokens: 0, costUsd: 0, error: `runner failed: ${e.message}` })
        continue
      }
      results.push(scoreRun(c.expected, reply, agent.name))
    }
    scored.push({ ...scoreCase(c.name, results), errorDetails: results.map((r) => r.error).filter(Boolean) })
    caseRuns.push(results)
  }
  const totals = runTotals(caseRuns)
  const total = { ...scoreTotal(scored), spread: { recall: spreadOf(totals, 'recall'), precision: spreadOf(totals, 'precision'), noise: spreadOf(totals, 'noise') } }
  return { agent: agent.name, model: useModel, ...(redact ? { redact: true } : {}), ...(withGate ? { withGate: true } : {}), cases: scored, total, runTotals: totals }
}

const pct = (x) => x.toFixed(2)
/** The report as a plain-text table: case, recall, precision, noise, tokens (and errors); a total line. */
export function formatTable(report) {
  const head = ['case', 'recall', 'precision', 'noise', 'tokens', 'cost$', 'errors']
  const row = (c) => [c.name, pct(c.recall), pct(c.precision), pct(c.noise), String(c.tokens), c.costUsd.toFixed(4), String(c.errors)]
  const rows = [head, ...report.cases.map(row), row(report.total)]
  const widths = head.map((_, i) => Math.max(...rows.map((r) => r[i].length)))
  const line = (r) => r.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  ')
  const out = [`AGENT_EVAL: ${report.agent} on ${report.model ?? 'its default model'}, ${report.cases[0]?.runs ?? 0} run(s) per case`, line(rows[0])]
  out.push(...rows.slice(1, -1).map(line), '-'.repeat(line(rows[0]).length), line(rows[rows.length - 1]))
  for (const c of report.cases) for (const e of c.errorDetails ?? []) out.push(`  ${c.name}: ${e}`)
  return out.join('\n')
}

// ---- real runner: Claude Code, non-interactive ----------------------------------------------------------------

const MAX_INLINE = 60_000

function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? listFiles(join(dir, d.name), base) : [relative(base, join(dir, d.name)).replace(/\\/g, '/')])
}

/** The user prompt for one case: what the input is and the input files inline (bounded). */
export function casePrompt({ role, inputDir, redact = false, withGate = false }) {
  // gate.json (what the project checks printed on the case's commit) is shown only with --with-gate (plan 049).
  const files = listFiles(inputDir).filter((f) => withGate || f !== 'gate.json')
  let budget = MAX_INLINE
  const parts = files.map((f) => {
    let body = readFileSync(join(inputDir, f), 'utf8')
    // --redact: the plan as a finder sees it without the builder's own claims (## Execution Notes dropped).
    if (redact && f === 'plan.md') body = redactPlan(body)
    const shown = body.length > budget ? `${body.slice(0, Math.max(0, budget))}\n…(truncated; read the file)` : body
    budget -= shown.length
    return `--- ${f} ---\n${shown}`
  })
  return [
    `This is an evaluation case for ${role}. There is no git repository: the branch's change is in the input files`,
    `(diff.patch is the diff against the base; plan.md is the plan; candidates.json, when present, holds the finders'`,
    `candidate problems; the changed source files are under their own paths).`,
    `Your working directory is the input folder. Return only your JSON result, as your instructions describe.`,
    ...(redact ? ['Judge the diff alone: read diffs only (`git diff`, `git show --format=`), never `git log` or a commit message, and take no claim of the builder\'s as evidence.'] : []),
    ...(withGate ? ['gate.json holds what the project checks printed on this branch (each command, its status and a tail): evidence, never a verdict.'] : []),
    '',
    ...parts,
  ].join('\n')
}

/** Arguments for `claude -p` (exported for tests; no model is called here). */
export function claudeArgs({ agent, model, systemPromptFile }) {
  const args = ['-p', '--output-format', 'json', '--system-prompt-file', systemPromptFile]
  // "inherit" is a kit model tier (the main session's model), not a model name: no --model, Claude Code's default.
  if (model && model !== 'inherit') args.push('--model', model)
  if (agent.tools?.length) args.push('--tools', agent.tools.join(','))
  if (!agent.tools?.some((t) => WRITE_TOOLS.includes(t))) args.push('--disallowedTools', WRITE_TOOLS.join(','))
  return args
}

/** Sum every numeric *_tokens field of a Claude Code usage object. */
export function usageTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0
  return Object.entries(usage).filter(([k, v]) => /_tokens$/.test(k) && Number.isFinite(v)).reduce((s, [, v]) => s + v, 0)
}

/**
 * Runner that calls Claude Code: the agent body (plus the shared agent-roles contract when it sits next to the
 * agent's repo) as the system prompt, the case input as the prompt, cwd = a scratch copy of the case input folder in
 * the OS temp folder (removed after the run), so a file the agent writes with Bash never lands in the cases or the
 * repository. `isolated: true` says so to evaluate().
 */
export function claudeRunner({ bin = process.env.AGENT_EVAL_CLAUDE ?? 'claude', timeoutMs = 600_000 } = {}) {
  const run = async ({ agent, model, role, inputDir: caseInput, redact = false, withGate = false }) => {
    const tmp = mkdtempSync(join(tmpdir(), 'agent-eval-'))
    const inputDir = join(tmp, 'input')
    try {
      if (existsSync(caseInput)) cpSync(caseInput, inputDir, { recursive: true })
      else mkdirSync(inputDir)
      const roles = join(dirname(agent.file), '..', '..', 'docs', 'agent', 'agent-roles.md')
      const system = existsSync(roles) ? `${agent.body}\n\n---\n# docs/agent/agent-roles.md\n\n${readFileSync(roles, 'utf8')}` : agent.body
      const systemPromptFile = join(tmp, 'system.md')
      writeFileSync(systemPromptFile, system)
      const args = claudeArgs({ agent, model, systemPromptFile })
      const win = process.platform === 'win32'
      const out = await new Promise((resolveRun, reject) => {
        const child = spawn(bin, win ? args.map((a) => `"${a}"`) : args, { cwd: inputDir, shell: win, windowsHide: true })
        let stdout = ''
        let stderr = ''
        const timer = setTimeout(() => { child.kill(); reject(new Error(`claude timed out after ${timeoutMs} ms`)) }, timeoutMs)
        child.stdout.on('data', (d) => { stdout += d })
        child.stderr.on('data', (d) => { stderr += d })
        child.on('error', (e) => { clearTimeout(timer); reject(e) })
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code !== 0) reject(new Error(`claude exited ${code}: ${stderr.trim().split(/\r?\n/).slice(-2).join(' | ')}`))
          else resolveRun(stdout)
        })
        child.stdin.end(casePrompt({ role, inputDir, redact, withGate }))
      })
      const json = JSON.parse(out)
      return { text: String(json.result ?? ''), tokens: usageTokens(json.usage), costUsd: Number(json.total_cost_usd) || 0 }
    } finally {
      // On Windows the folder can still be held a moment after the child exits (EPERM): retry, and never let a failed
      // cleanup throw away a finished run's result.
      try { rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* left in the OS temp folder */ }
    }
  }
  run.isolated = true
  return run
}
