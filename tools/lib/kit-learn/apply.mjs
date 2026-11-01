/**
 * The Human's decisions become records (plan 046, K5/K6): a `proposals` row per card, the issue's new status, and the steps
 * that follow. Pure: the plan files and git come in as functions, nothing is written here.
 */
import { protectedPaths } from './protected.mjs'
import { planCheck, MISSING } from './plan-check.mjs'
import { LATER_DAYS, DAY_MS } from './ledger.mjs'

const iso = (ms) => new Date(ms).toISOString()

const STEPS = {
  plan: (id) => `${id}: run /plan with "Source: brain issue ${id}" and the card as its problem statement; the plan needs a sub-task naming a test under tools/test/ or tools/fixtures/ (plan-check). The next collect finds the plan by its Source line and links it`,
  amend: (id, arg) => `${id}: edit open plan ${arg} (its sub-tasks, a regression test sub-task) and add the line "Source: brain issue ${id}"; \`node tools/kit-learn.mjs plan-check <plan>\` must pass`,
  lesson: (id, arg) => `${id}: node tools/kit-lessons.mjs add --role ${arg} --text "<the lesson>" --why "<why>" --issue ${id}`,
  enforce: (id) => `${id}: run /plan for the check that makes the lesson unnecessary ("Source: brain issue ${id}")`,
  dismiss: (id, arg) => `${id}: dismissed (${arg}); it is shown again when 2 more runs bring it back`,
  later: (id) => `${id}: stays open, ranked below new items for ${LATER_DAYS} days`,
}

/**
 * { proposals: [rows], issues: [changed issues], steps: [lines] } or { error }. `items` come from reply.parseReply;
 * `cards` = { id: { text, paths } } the session recorded; `readPlan(nnn)` → the plan's text or null; `git.fixCommitFor(nnn)`.
 */
export function applyDecisions({ items, issues, proposals = [], cards = {}, now, readPlan, git }) {
  const rows = []
  const changed = []
  const steps = []
  const used = new Set(proposals.map((p) => p._id))
  for (const it of items) {
    const issue = issues.find((i) => i._id === it.id)
    if (!issue) return { error: `${it.id} is not in the ledger` }
    const next = JSON.parse(JSON.stringify(issue))
    const note = (status) => next.history.push({ at: iso(now), status, note: `${it.action}${it.arg ? ` ${it.arg}` : ''}${it.accepted ? ' (accepted the recommendation)' : ''}` })
    if (it.action === 'amend') {
      const text = readPlan(it.arg)
      if (text !== null) {
        const pc = planCheck(text)
        if (pc.issue === it.id && !pc.ok) return { error: `${it.id} cannot be planned on plan ${it.arg}: ${MISSING}` }
      }
      next.linkedPlan = it.arg
      const f = git?.fixCommitFor?.(it.arg)
      if (f) next.fixCommit = f.sha
    }
    if (['plan', 'amend', 'lesson', 'enforce'].includes(it.action)) {
      next.status = 'planned'
      note('planned')
      next.action = it.action
      if (it.action === 'lesson') next.lessonRole = it.arg
    } else if (it.action === 'dismiss') {
      next.status = 'dismissed'
      next.dismissedAt = iso(now)
      next.dismissedAtRuns = next.seenRuns ?? 0
      next.dismissReason = it.arg
      next.reopened = false
      note('dismissed')
    } else if (it.action === 'later') {
      next.laterUntil = iso(now + LATER_DAYS * DAY_MS)
      note(next.status)
    }
    const card = cards[it.id] ?? {}
    const prot = protectedPaths(card.paths ?? [])
    if (prot.length) next.protected = true
    const pending = [...proposals].reverse().find((p) => p.issue === it.id && !p.decision)
    let _id = pending?._id ?? `${it.id}:${iso(now)}`
    for (let n = 2; !pending && used.has(_id); n++) _id = `${it.id}:${iso(now)}#${n}`
    used.add(_id)
    rows.push({
      ...(pending ?? {}), _id, issue: it.id, action: it.action, arg: it.arg || null, text: card.text ?? card.recommend ?? `${it.action}${it.arg ? ` ${it.arg}` : ''}`,
      createdAt: pending?.createdAt ?? iso(now), decision: it.action, decidedAt: iso(now), autonomyLevel: 0, accepted: Boolean(it.accepted),
      ...(prot.length ? { protected: true, protectedPaths: prot } : {}),
    })
    changed.push(next)
    steps.push(STEPS[it.action](it.id, it.arg) + (prot.length ? ` [protected: ${prot.join(', ')} — human-only, never automated]` : ''))
  }
  return { proposals: rows, issues: changed, steps }
}

/** A card on the CARDS line is a card shown: one pending `proposals` row (decision empty), so an unanswered card can expire. */
export function pendingRows({ ids, proposals, issues, now }) {
  return ids
    .filter((id) => issues.some((i) => i._id === id) && !proposals.some((p) => p.issue === id && !p.decision))
    .map((id) => ({ _id: `${id}:${iso(now)}`, issue: id, action: null, text: null, createdAt: iso(now), decision: null, decidedAt: null, autonomyLevel: 0 }))
}
