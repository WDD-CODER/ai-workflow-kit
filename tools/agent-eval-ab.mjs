/**
 * Agent-eval A/B — compare two (or more) `agent-eval.mjs --json` runs of the same cases and print a verdict per figure,
 * computed here and never typed by hand (plan 049; contract: docs/agent/agent-evals.md).
 *
 *   node tools/agent-eval-ab.mjs --before <dir> --after <dir> [--arm <name>=<dir> ...] [--adopt-rule redaction] [--out <file.md>]
 *
 * A dir holds one `--json` report per role (any file name ending .json; the report's `agent` is the role). Per role and
 * figure (recall, precision, noise, errors, cost) the real difference is d = max(0.05, 2 × s), s = the larger of the
 * two arms' run-to-run spread (the report's total.spread: max − min of the per-run totals). Verdicts:
 *   recall     improved: after − before ≥ d            regressed: before − after ≥ d
 *   precision  improved: after − before ≥ d            regressed: after < before − 0.02  (orch-verify: any value below 1.00)
 *   noise      improved: before − after ≥ d            regressed: after − before ≥ d
 *   errors     regressed: +2 or more over before       (never "improved")
 *   cost       reported per case; named when over +20 %
 * Anything else is "no real change". `--adopt-rule redaction` adds, for the finders (orch-check-bugs / plan / rules),
 * ADOPT when recall rises by ≥ d and precision after ≥ precision before (two decimals), otherwise REJECT.
 * Exit 0; 2 on a usage error. Node built-ins only.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const EPS = 1e-9
const r2 = (x) => Math.round(x * 100) / 100
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a')
export const FINDERS = ['orch-check-bugs', 'orch-check-plan', 'orch-check-rules']

/** Every `*.json` report in a dir, keyed by the report's agent (role). */
export function loadReports(dir) {
  const root = resolve(dir)
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`no folder ${dir}`)
  const out = {}
  for (const f of readdirSync(root).filter((n) => n.endsWith('.json')).sort()) {
    const r = JSON.parse(readFileSync(join(root, f), 'utf8'))
    if (!r?.agent || !r?.total) continue
    out[r.agent] = r
  }
  return out
}

/** The real-difference threshold of one figure: max(0.05, 2 × the larger spread of the two arms). */
export function threshold(before, after, figure) {
  const s = Math.max(before.total.spread?.[figure] ?? 0, after.total.spread?.[figure] ?? 0)
  return { s, d: Math.max(0.05, 2 * s) }
}

/** The verdict per figure of `after` against `before` for one role. */
export function judge(before, after) {
  const role = after.agent
  const rows = []
  for (const figure of ['recall', 'precision', 'noise']) {
    const b = before.total[figure]
    const a = after.total[figure]
    const { s, d } = threshold(before, after, figure)
    let verdict = 'no real change'
    if (figure === 'recall') verdict = a - b >= d - EPS ? 'improved' : b - a >= d - EPS ? 'regressed' : verdict
    else if (figure === 'precision') {
      if (role === 'orch-verify') verdict = r2(a) < 1 ? 'regressed' : 'no real change'
      else verdict = a - b >= d - EPS ? 'improved' : a < b - 0.02 - EPS ? 'regressed' : verdict
    } else verdict = b - a >= d - EPS ? 'improved' : a - b >= d - EPS ? 'regressed' : verdict
    rows.push({ figure, before: b, after: a, s, d, verdict })
  }
  const eb = before.total.errors ?? 0
  const ea = after.total.errors ?? 0
  rows.push({ figure: 'errors', before: eb, after: ea, s: 0, d: 2, verdict: ea - eb >= 2 ? 'regressed' : 'no real change' })
  const perCase = (r) => (r.total.costUsd ?? 0) / Math.max(1, r.cases?.length ?? 1)
  const cb = perCase(before)
  const ca = perCase(after)
  rows.push({ figure: 'cost', before: cb, after: ca, s: 0, d: 0, verdict: cb > 0 && ca / cb - 1 > 0.2 ? 'over +20 %' : 'reported' })
  return rows
}

/** The redaction adoption rule for one finder: recall up by ≥ d and precision (two decimals) not lower. */
export function adoptRedaction(before, after) {
  const { d } = threshold(before, after, 'recall')
  const gain = after.total.recall - before.total.recall
  const precisionHeld = r2(after.total.precision) >= r2(before.total.precision)
  const adopt = gain >= d - EPS && precisionHeld
  return { adopt, gain, d, precisionBefore: before.total.precision, precisionAfter: after.total.precision, line: `${adopt ? 'ADOPT' : 'REJECT'} ${after.agent} — recall ${f2(before.total.recall)} → ${f2(after.total.recall)} (needs +${f2(d)}), precision ${f2(before.total.precision)} → ${f2(after.total.precision)} (must not drop)` }
}

// Unscored (plan 091): findings the scorer left out of tp and fp; a report from before plan 091 has none and shows n/a.
const rowText = (name, r) => `| ${name} | ${f2(r.total.recall)} | ${f2(r.total.precision)} | ${f2(r.total.noise)} | ${r.total.unscored ?? 'n/a'} | ${r.total.errors ?? 0} | ${f2(r.total.spread?.recall ?? 0)} / ${f2(r.total.spread?.precision ?? 0)} / ${f2(r.total.spread?.noise ?? 0)} | ${f2(r.total.costUsd ?? 0)} |`

/** The whole comparison as markdown. `arms` is [{ name, reports }] after the before run; the last one is the "after" run. */
export function compare({ before, arms, adoptRule = null }) {
  const lines = []
  // A role is compared when the before run and the last arm (the "after" run) have it; an experiment arm that
  // covers only some roles (the redaction arm has the finders, the gate arm the verifier) is shown for those.
  const last = arms[arms.length - 1]
  const roles = Object.keys(before).filter((role) => last.reports[role])
  const verdicts = []
  for (const role of roles) {
    lines.push(`### ${role}`, '', '| Run | Recall | Precision | Noise | Unscored | Errors | Spread (recall / precision / noise) | Cost (USD) |', '| --- | --- | --- | --- | --- | --- | --- | --- |', rowText('before', before[role]))
    const here = arms.filter((a) => a.reports[role])
    for (const a of here) lines.push(rowText(a.name, a.reports[role]))
    lines.push('')
    for (const a of here) {
      const rows = judge(before[role], a.reports[role])
      lines.push(`Verdicts, ${a.name} vs before:`, '', '| Figure | Before | After | s | d | Verdict |', '| --- | --- | --- | --- | --- | --- |')
      for (const r of rows) lines.push(`| ${r.figure} | ${f2(r.before)} | ${f2(r.after)} | ${f2(r.s)} | ${f2(r.d)} | ${r.verdict} |`)
      lines.push('')
      verdicts.push(...rows.map((r) => ({ role, arm: a.name, ...r })))
      // The adoption rule judges the experiment arm named "redact" (or, with no such arm, the last one).
      const judged = arms.some((x) => x.name === 'redact') ? a.name === 'redact' : a === last
      if (adoptRule === 'redaction' && judged && FINDERS.includes(role)) lines.push(`Adoption rule (redaction), ${a.name}: **${adoptRedaction(before[role], a.reports[role]).line}**`, '')
    }
  }
  return { text: lines.join('\n'), verdicts, roles }
}

function parseArgs(argv) {
  const o = { arms: [], adoptRule: null, out: null }
  const val = (i, n) => {
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${n} needs a value`)
    return argv[i + 1]
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--before') o.before = val(i++, a)
    else if (a === '--after') o.after = val(i++, a)
    else if (a === '--arm') { const v = val(i++, a); const eq = v.indexOf('='); if (eq < 1) throw new Error('--arm takes name=dir'); o.arms.push({ name: v.slice(0, eq), dir: v.slice(eq + 1) }) }
    else if (a === '--adopt-rule') { o.adoptRule = val(i++, a); if (o.adoptRule !== 'redaction') throw new Error(`unknown adopt rule ${o.adoptRule} (known: redaction)`) }
    else if (a === '--out') o.out = val(i++, a)
    else if (a === '--head') o.head = val(i++, a)
    else throw new Error(`unknown argument ${a}`)
  }
  if (!o.before || !o.after) throw new Error('--before and --after are required')
  return o
}

function main() {
  let o
  try { o = parseArgs(process.argv.slice(2)) } catch (e) {
    console.error(`AGENT_EVAL_AB: ${e.message}\nusage: node tools/agent-eval-ab.mjs --before <dir> --after <dir> [--arm name=dir ...] [--adopt-rule redaction] [--out file.md]`)
    return 2
  }
  try {
    const before = loadReports(o.before)
    const arms = [...o.arms.map((a) => ({ name: a.name, reports: loadReports(a.dir) })), { name: 'after', reports: loadReports(o.after) }]
    const { text, verdicts, roles } = compare({ before, arms, adoptRule: o.adoptRule })
    if (!roles.length) throw new Error('no role has a report in every folder')
    const regressed = verdicts.filter((v) => v.verdict === 'regressed')
    const summary = [text, `AGENT_EVAL_AB: ${roles.length} role(s), ${verdicts.filter((v) => v.verdict === 'improved').length} improved, ${regressed.length} regressed${regressed.length ? ` (${regressed.map((v) => `${v.role} ${v.arm} ${v.figure}`).join('; ')})` : ''}`].join('\n')
    // --head <file>: hand-written prose placed above the script-printed tables (the verdicts stay script output).
    if (o.out) writeFileSync(resolve(o.out), `${o.head ? `${readFileSync(resolve(o.head), 'utf8').trimEnd()}\n\n` : ''}${text}\n`)
    console.log(summary)
    return 0
  } catch (e) {
    console.error(`AGENT_EVAL_AB: ${e.message}`)
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main()
