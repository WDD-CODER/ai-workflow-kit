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
    ...plans.filter((p) => mergedSet.has(p.nnn) && (p.humanItems ?? []).length).flatMap((p) => [`### ${p.nnn} ${p.title ?? ''}`, '', ...p.humanItems.map((h, i) => `${i + 1}. ${h}`), '']),
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
