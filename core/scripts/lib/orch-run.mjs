/**
 * Orchestrator run — the pure rules of an orchestrator run (docs/agent/orchestrator.md), shared by
 * scripts/orch-state.mjs and scripts/orch-preflight.mjs. No file system, no git, no clock: callers pass text and
 * values in, so every rule here is tested on its own.
 */
import { parseArchImpact } from './invariants.mjs'

/** A run name: lower-case letters, digits and dashes, 1-40 characters, starting with a letter or digit. */
export const RUN_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

/** Why a run name cannot be used, or null. */
export function runNameProblem(name) {
  if (typeof name !== 'string' || !RUN_NAME_RE.test(name)) return `run name ${JSON.stringify(name ?? '')} — use lower-case letters, digits and dashes (1-40), e.g. "batch-1"`
  return null
}

/** The states a plan moves through in a run; status.json refuses any other. */
export const PLAN_STATES = ['queued', 'building', 'gate', 'checking', 'fixing', 'env-paused', 'merging', 'merged', 'parked', 'left-run', 'skipped']

/** The plan branch of a run: feat/NNN-<first four words of the file slug>. */
export function planBranch(planPath, nnn) {
  const file = String(planPath).replace(/\\/g, '/').split('/').pop()
  const slug = file.replace(/\.plan\.md$/, '').replace(/^\d+-/, '').split('-').filter(Boolean).slice(0, 4).join('-')
  return `feat/${nnn}-${slug || 'plan'}`
}

/** The tier a plan's first builder starts on: judgment when Architecture Impact names an invariant other than INV-none. */
export function startTier(planText) {
  const { entries } = parseArchImpact(String(planText))
  const named = entries.filter((e) => e.id !== 'INV-none').map((e) => e.id)
  return { tier: named.length ? 'judgment' : 'build', invariants: named }
}

/** The plan's `[human]` items (Goals / Done-when), verbatim without the tag, in file order. */
export function humanItems(planText) {
  const out = []
  for (const line of String(planText).replace(/\r\n/g, '\n').split('\n')) {
    const m = /^\s*[-*]\s*(?:\[[ x]\]\s*)?\[human\]\s*(.+)$/i.exec(line)
    if (m) out.push(m[1].trim())
  }
  return out
}

/** Free space in GB (one decimal) from a statfs result. */
export const freeGb = (st) => Math.floor((Number(st.bavail) * Number(st.bsize)) / 1e8) / 10

// ---- UI environment (orch-preflight.mjs --ui) ----------------------------------------------------------------------
// Each takes what a request returned — { status, allowOrigin } or { error } — and says what blocks the browser step.
const originOf = (url) => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** A page's dev server: any answer below 500 means it is up. */
export function serverProblem(pageUrl, res) {
  const origin = originOf(pageUrl)
  if (!origin) return `page ${JSON.stringify(pageUrl)} is not a URL`
  if (res?.error) return `dev server ${origin} does not answer (${res.error}) — start it (node scripts/slot-serve.mjs or the project's dev command)`
  if (!(res?.status < 500)) return `dev server ${origin} answered ${res?.status} — fix the server error first`
  return null
}

/** The QA login: 2xx or 3xx is a working login; 401/403 or anything else blocks every card behind it. */
export function loginProblem(loginUrl, res) {
  if (res?.error) return `login ${loginUrl} does not answer (${res.error})`
  if (!(res?.status >= 200 && res.status < 400)) return `login ${loginUrl} answered ${res?.status} — check the QA user in .env (ORCH_QA_USER / ORCH_QA_PASSWORD)`
  return null
}

/** The backend, asked with the page's Origin: it must answer, and allow that origin when it is another origin. */
export function crossOriginProblem(pageUrl, apiUrl, res) {
  const page = originOf(pageUrl)
  const api = originOf(apiUrl)
  if (!api) return `backend ${JSON.stringify(apiUrl)} is not a URL`
  if (res?.error) return `backend ${api} does not answer (${res.error}) — start it`
  if (!(res?.status < 500)) return `backend ${api} answered ${res?.status}`
  if (page && page !== api && res.allowOrigin !== '*' && res.allowOrigin !== page) {
    return `backend ${api} is cross-origin unreachable from ${page} (Access-Control-Allow-Origin: ${res.allowOrigin || 'missing'}) — allow the dev origin`
  }
  return null
}

const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\r?\n/g, ' ')
const shotCell = (c) => ((c.screenshots ?? []).length
  ? c.screenshots.map((s) => `[![${cell(c.card).replace(/[[\]]/g, '')}](${s})](${s})`).join(' ')
  : 'no screenshot')

/**
 * The validation list of the merged plans, numbers running on across groups:
 * - a screenshot grid per page (plan order): one row per checked `[ui]` card — title, verdict (who checked it: the
 *   card's script or the browser agent, and the round) and a thumbnail link to each screenshot;
 * - PLAN-DRIFT in its own section (the plan says X, the app has Y — no severity, not a bug);
 * - the `[ui]` cards no one checked and the plans' `[human]` items, which name no page, per plan.
 */
export function validationList(mergedPlans) {
  const pages = new Map()
  const drift = []
  const unchecked = []
  for (const p of mergedPlans) {
    for (const c of p.uiCards ?? []) {
      const card = { ...c, nnn: p.nnn }
      if (c.status === 'plan-drift') drift.push(card)
      else if (c.status === 'unchecked') unchecked.push(card)
      else {
        const page = c.page || `page not named (plan ${p.nnn})`
        if (!pages.has(page)) pages.set(page, [])
        pages.get(page).push(card)
      }
    }
  }
  const human = mergedPlans.filter((p) => (p.humanItems ?? []).length)
  if (!pages.size && !drift.length && !unchecked.length && !human.length) return ['- nothing to validate', '']
  let n = 0
  const out = []
  for (const [page, cards] of pages) {
    out.push(`### ${page}`, '', '| # | Card | Verdict | Screenshot |', '| --- | --- | --- | --- |')
    for (const c of cards) out.push(`| ${++n} | ${c.nnn}: ${cell(c.card)} | ${c.status} — ${c.via ?? 'browser'}, round ${c.round ?? 0} | ${shotCell(c)} |`)
    out.push('')
  }
  if (drift.length) {
    out.push('### Plan drift — the plan says X, the app has Y (not a bug; update the card or the plan)', '')
    for (const c of drift) {
      const shots = (c.screenshots ?? []).length ? c.screenshots.map((s) => `\`${s}\``).join(', ') : 'no screenshot'
      out.push(`${++n}. ${c.nnn}: ${c.card} — on ${c.page || 'a page not named'}; evidence: ${shots}`)
    }
    out.push('')
  }
  if (unchecked.length || human.length) {
    const any = pages.size || drift.length
    out.push(any ? '### Not checked by the run — the plans\' [human] items' : '### The plans\' [human] items (no UI check ran)', '')
    for (const c of unchecked) out.push(`${++n}. ${c.nnn}: ${c.card} — a [ui] card no script could check and the browser step was off; on ${c.page || 'a page not named'}`)
    for (const p of human) for (const h of p.humanItems) out.push(`${++n}. ${p.nnn} ${p.title ?? ''}: ${h}`)
    out.push('')
  }
  return out
}

/**
 * The run report (Markdown) from status.json and the merges git shows. `merged` is the ordered list of
 * { nnn, branch, sha } read from the anchored merge subjects — never a count kept in memory.
 */
export function formatReport({ status, merged, mainShaNow, finishedAt, runBranch, mainBranch }) {
  const plans = Object.values(status.plans ?? {}).sort((a, b) => (a.nnn < b.nnn ? -1 : 1))
  const mergedSet = new Map(merged.map((m) => [m.nnn, m]))
  const parked = plans.filter((p) => !mergedSet.has(p.nnn) && ['parked', 'left-run', 'skipped'].includes(p.state))
  const untouched = !status.mainShaAtStart || status.mainShaAtStart === mainShaNow
  const lines = [
    `# Orchestrator run ${status.run}`,
    '',
    `Run branch: \`${runBranch}\` (from \`origin/${mainBranch}\` at ${String(status.mainShaAtStart ?? '').slice(0, 7)}) · started ${status.startedAt ?? '?'} · finished ${finishedAt}`,
    `Result: ${merged.length} merged, ${parked.length} parked, skipped or left out, ${plans.length} in the run (counted from git and status.json).`,
    `\`${mainBranch}\` untouched: ${untouched ? 'yes' : 'NO'} — origin/${mainBranch} is ${String(mainShaNow).slice(0, 7)}.`,
    status.stopReason ? `Stopped: ${status.stopReason}` : '',
    '',
    '## Plans',
    '',
    '| Plan | State | Rounds | Builder tier | Merge | Why |',
    '| --- | --- | --- | --- | --- | --- |',
    ...plans.map((p) => {
      const m = mergedSet.get(p.nnn)
      const state = m ? 'merged' : p.state
      return `| ${p.nnn} ${p.title ?? ''} | ${state} | ${p.round ?? 0} | ${p.tier ?? ''} | ${m ? m.sha.slice(0, 7) : ''} | ${(p.reason ?? '').replace(/\|/g, '/')} |`
    }),
    '',
    '## Decisions taken',
    '',
    ...((status.notes ?? []).length ? status.notes.map((n) => `- ${n.plan ? `${n.plan}: ` : ''}${n.text}`) : ['- none']),
    '',
    '## Models per agent',
    '',
    ...plans.flatMap((p) => Object.entries(p.models ?? {}).map(([role, v]) => `- ${p.nnn} ${role}: ${v.model}${v.effort ? ` / ${v.effort}` : ''}`)),
    '',
    '## What only the Human can do',
    '',
    ...validationList(plans.filter((p) => mergedSet.has(p.nnn))),
    ...parked.map((p) => `- Decide on ${p.nnn}: ${p.reason ?? p.state}`),
    `- Review and merge the run branch (PowerShell, one line each):`,
    '',
    '```powershell',
    `git fetch origin`,
    `gh pr create --base ${mainBranch} --head ${runBranch} --title "Orchestrator run ${status.run}" --body-file .claude\\orchestrator-runs\\${status.run}.md`,
    '```',
    '',
  ]
  return lines.filter((l, i) => !(l === '' && lines[i - 1] === '')).join('\n')
}
