/**
 * The problem ledger (plan 046): pure functions from the brain's evidence and the ledger so far to the ledger now. No I/O —
 * the store, git and the clock come in as arguments, so every rule here is tested with plain objects.
 *
 * Evidence: { runs, plans, events, grades, toil, lessonsIn } (documents of docs/agent/kit-brain.md "Schema").
 * An issue: { _id: "I<n>", signature, kind, title, status, history[], runKeys[], seenRuns, projects[], seenProjects, firstSeen,
 *   lastSeen, lastRunAt, lastKitVersion, lastKitCommit, minutesLost, toilIds[], linkedPlan, fixCommit, fixture,
 *   dismissedAtRuns, dismissReason, laterUntil, expiredAtRuns, createdAt }.
 * A run key is `<project>:<run>`; an issue counts a run once however many events it brought.
 */
import { tokenize, scoreOverlap } from '../../../scripts/plan-name-similarity.mjs'
import { signature as signatureOf } from '../../../core/scripts/lib/brain-doc.mjs'

export const STATUSES = ['open', 'planned', 'fixed', 'regressed', 'dismissed']
export const DAY_MS = 86400000
export const LATER_DAYS = 14
export const EXPIRE_DAYS = 14
export const FIX_HOLD_RUNS = 5
export const REOPEN_AFTER_RUNS = 2
export const LESSON_SIMILARITY = 0.6

export const runKey = (d) => `${d.project}:${d.run}`
const num = (v) => (Number.isFinite(v) ? v : 0)
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d
const dateOf = (iso) => (iso ? String(iso).slice(0, 10) : null)
const idNum = (id) => Number(String(id).slice(1)) || 0

// ---------------------------------------------------------------------------------------------------- minutes

/** Minutes a plan spent from its first build to the end: building + gate + checks + ui + merge (readiness is not lost work). */
export const workMinutes = (p) => ['building', 'gate', 'checks', 'ui', 'merge'].reduce((s, k) => s + num(p?.minutes?.[k]), 0)
/** Minutes a skipped plan waited: every phase it has a time for. */
export const waitMinutes = (p) => Object.entries(p?.minutes ?? {}).filter(([k]) => k !== 'envPaused').reduce((s, [, v]) => s + num(v), 0)

/**
 * Minutes one run lost to one problem: each parked plan the problem's park/timeout/env-fail events name, once (its work
 * minutes), plus the waiting time of every plan the run skipped with a reason that names that plan.
 */
export function minutesLostInRun(events, runPlans) {
  const byNnn = new Map(runPlans.map((p) => [String(p.nnn), p]))
  const counted = new Set()
  let lost = 0
  for (const e of events) {
    if (!e.plan || !['park', 'timeout', 'env-fail'].includes(e.kind)) continue
    const nnn = String(e.plan)
    const p = byNnn.get(nnn)
    if (!p || !['parked', 'left-run'].includes(p.state) || counted.has(nnn)) continue
    counted.add(nnn)
    lost += workMinutes(p)
    for (const s of runPlans) if (s.state === 'skipped' && new RegExp(`\\b${nnn}\\b`).test(s.reason ?? '')) lost += waitMinutes(s)
  }
  return lost
}

// ---------------------------------------------------------------------------------------------------- priority and ranking

/** minutesLost × (1 + ln(runs)) × (projects ≥ 2 ? 1.5 : 1). */
export const priority = (i) => round(num(i.minutesLost) * (1 + Math.log(Math.max(1, num(i.seenRuns)))) * (num(i.seenProjects) >= 2 ? 1.5 : 1), 2)

const isLater = (i, now) => i.laterUntil && Date.parse(i.laterUntil) > now
const isExpired = (i) => i.expiredAtRuns !== undefined && i.expiredAtRuns !== null && num(i.seenRuns) <= i.expiredAtRuns

/** 0 regressed, 1 open, 2 open but put off by `later`, 3 planned, 4 fixed; dismissed has none (hidden). */
function group(i, now) {
  if (i.status === 'regressed') return 0
  if (i.status === 'open') return isLater(i, now) ? 2 : 1
  if (i.status === 'planned') return 3
  if (i.status === 'fixed') return 4
  return null
}

/** The visible issues, ranked: regressed first, then open by priority, put-off ones, planned, fixed. Each gets `priority`, `card`. */
export function rank(issues, { now, top = 5 } = {}) {
  const rows = issues
    .map((i) => ({ ...i, priority: priority(i), group: group(i, now) }))
    .filter((i) => i.group !== null)
    .sort((a, b) => a.group - b.group || b.priority - a.priority || num(b.seenRuns) - num(a.seenRuns) || String(b.lastSeen ?? '').localeCompare(String(a.lastSeen ?? '')) || idNum(a._id) - idNum(b._id))
  let cards = 0
  for (const r of rows) {
    r.card = r.group <= 2 && !isExpired(r) && cards < top
    if (r.card) cards++
  }
  return rows
}

// ---------------------------------------------------------------------------------------------------- collect

const semver = (v) => String(v ?? '').replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0)
export function semverCmp(a, b) {
  const [x, y] = [semver(a), semver(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

const by = (list, keyFn) => {
  const m = new Map()
  for (const x of list) {
    const k = keyFn(x)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(x)
  }
  return m
}

const newIssue = (id, signature, kind, title, now) => ({
  _id: id, id, signature, kind, title: String(title).slice(0, 120), status: 'open', history: [{ at: new Date(now).toISOString(), status: 'open', note: 'first seen' }],
  runKeys: [], seenRuns: 0, projects: [], seenProjects: 0, firstSeen: null, lastSeen: null, lastRunAt: null, lastKitVersion: null, lastKitCommit: null,
  minutesLost: 0, toilIds: [], linkedPlan: null, fixCommit: null, fixture: null, createdAt: new Date(now).toISOString(),
})

const setStatus = (i, status, now, note) => {
  i.status = status
  i.history = [...(i.history ?? []), { at: new Date(now).toISOString(), status, note }]
}

/**
 * The ledger after reading the evidence. `git` = { isAncestor(fix, commit) → true|false|null, fixCommitFor(nnn) → { sha } | null }.
 * Returns { issues (all, changed or not), changed: [ids], created: [ids], newRuns, cursor, expired: [proposal ids to mark] }.
 * Nothing is written: the caller writes `changed` and, only after every write succeeded, the cursor.
 */
export function collectLedger({ evidence, issues = [], proposals = [], cursor = null, now, git, upkeep = [] }) {
  const clock = typeof now === 'number' ? now : Date.parse(now)
  const out = new Map(issues.map((i) => [i._id, JSON.parse(JSON.stringify(i))]))
  const before = new Map(issues.map((i) => [i._id, JSON.stringify(i)]))
  const created = []
  const runs = new Map(evidence.runs.map((r) => [runKey(r), r]))
  const plansByRun = by(evidence.plans, runKey)
  const sigIssues = new Map([...out.values()].map((i) => [i.signature, i]))
  let nextNum = Math.max(0, ...[...out.keys()].map(idNum)) + 1
  const make = (signature, kind, title) => {
    const i = newIssue(`I${nextNum++}`, signature, kind, title, clock)
    out.set(i._id, i)
    sigIssues.set(signature, i)
    created.push(i._id)
    return i
  }
  const seenKeys = new Set(cursor?.runKeys ?? [])
  const allKeys = new Set([...runs.keys(), ...evidence.events.map(runKey)])
  const newRuns = [...allKeys].filter((k) => !seenKeys.has(k)).sort()

  const when = (rk, fallback) => runs.get(rk)?.startedAt ?? fallback ?? null
  const touch = (i, rk, at, extra = {}) => {
    i.runKeys.push(rk)
    i.seenRuns = i.runKeys.length
    const project = rk.split(':')[0]
    if (!i.projects.includes(project)) i.projects.push(project)
    i.seenProjects = i.projects.length
    const d = dateOf(at)
    if (d && (!i.firstSeen || d < i.firstSeen)) i.firstSeen = d
    if (d && (!i.lastSeen || d > i.lastSeen)) i.lastSeen = d
    const run = runs.get(rk)
    if (run && (!i.lastRunAt || String(run.startedAt ?? '') >= i.lastRunAt)) {
      i.lastRunAt = run.startedAt ?? i.lastRunAt
      i.lastKitVersion = run.kitVersion ?? i.lastKitVersion
      i.lastKitCommit = run.kitCommit ?? i.lastKitCommit
    }
    Object.assign(i, extra)
  }

  // 1. A planned issue whose plan merged into the kit: record the merge commit as its fix.
  for (const i of out.values()) {
    if (i.status === 'planned' && !i.linkedPlan) {
      // The plan drafted from this issue carries `Source: brain issue <id>`: that line is the link.
      const p = git.planFor?.(i._id)
      if (p) {
        i.linkedPlan = p.nnn
        i.fixture = p.fixture ?? i.fixture ?? null
        i.history.push({ at: new Date(clock).toISOString(), status: i.status, note: `plan ${p.nnn} carries Source: brain issue ${i._id}` })
      }
    }
    if (i.status === 'planned' && i.linkedPlan && !i.fixCommit) {
      const f = git.fixCommitFor(i.linkedPlan)
      if (f) {
        i.fixCommit = f.sha
        i.history.push({ at: new Date(clock).toISOString(), status: i.status, note: `plan ${i.linkedPlan} merged: ${f.sha.slice(0, 7)} (${f.how})` })
      }
    }
  }

  // 2. Events, by signature: one issue per signature; each run counted once per issue.
  const events = evidence.events.filter((e) => e.kind !== 'setup-check' && typeof e.signature === 'string' && e.signature !== '')
  const bySig = by(events, (e) => e.signature)
  const order = [...bySig.keys()].sort((a, b) => {
    const first = (s) => bySig.get(s).map((e) => when(runKey(e), e.at) ?? '9999').sort()[0]
    return first(a).localeCompare(first(b)) || (a < b ? -1 : 1)
  })
  const regressedNow = new Set()
  for (const sig of order) {
    const evs = bySig.get(sig)
    let i = sigIssues.get(sig)
    if (!i) {
      const counts = by(evs, (e) => e.kind)
      const kind = [...counts.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))[0][0]
      i = make(sig, kind, sig)
    }
    const byRun = by(evs, runKey)
    for (const [rk, list] of [...byRun.entries()].sort((a, b) => (when(a[0], a[1][0].at) ?? '').localeCompare(when(b[0], b[1][0].at) ?? ''))) {
      if (i.runKeys.includes(rk)) continue
      const runPlans = plansByRun.get(rk) ?? []
      touch(i, rk, when(rk, list[0].at))
      i.minutesLost = round(num(i.minutesLost) + minutesLostInRun(list, runPlans))
      const run = runs.get(rk)
      if (['fixed', 'planned'].includes(i.status) && i.fixCommit && git.isAncestor(i.fixCommit, run?.kitCommit) === true) {
        setStatus(i, 'regressed', clock, `seen in ${rk} on kit v${run.kitVersion} (has fix ${i.fixCommit.slice(0, 7)})`)
        i.regressedRun = rk
        regressedNow.add(i._id)
      }
    }
  }

  // 3. Toil: by-hand lines a script could do. A line that names a signature adds its minutes to that issue; the rest group
  //    by what the step says and become an issue when 2+ runs had it.
  const toilDocs = evidence.toil ?? []
  const loose = []
  for (const t of toilDocs) {
    const linked = typeof t.signature === 'string' ? sigIssues.get(t.signature) : null
    if (linked) {
      if (!(linked.toilIds ?? []).includes(t._id)) {
        linked.toilIds = [...(linked.toilIds ?? []), t._id]
        linked.minutesLost = round(num(linked.minutesLost) + num(t.minutes))
      }
    } else if (t.script === 'yes') loose.push(t)
  }
  for (const [sig, list] of by(loose, (t) => signatureOf(t.step ?? '')).entries()) {
    const keys = [...new Set(list.map(runKey))]
    let i = sigIssues.get(`toil:${sig}`)
    if (!i && keys.length < 2) continue
    if (!i) i = make(`toil:${sig}`, 'toil', list[0].step)
    for (const t of list) {
      if ((i.toilIds ?? []).includes(t._id)) continue
      i.toilIds = [...(i.toilIds ?? []), t._id]
      i.minutesLost = round(num(i.minutesLost) + num(t.minutes))
      if (!i.runKeys.includes(runKey(t))) touch(i, runKey(t), when(runKey(t)))
    }
  }

  // 4. Lessons from projects: look-alikes (tokens overlap ≥ 0.6) are one issue with a project count.
  const lessonIssues = () => [...out.values()].filter((i) => i.kind === 'lesson')
  for (const l of [...(evidence.lessonsIn ?? [])].sort((a, b) => (a._id < b._id ? -1 : 1))) {
    const tokens = [...new Set(tokenize(`${l.title ?? ''} ${l.text ?? ''}`))]
    if (!tokens.length) continue
    let i = lessonIssues().find((x) => Math.max(scoreOverlap(tokens, x.tokens ?? []), scoreOverlap(x.tokens ?? [], tokens)) >= LESSON_SIMILARITY)
    if (!i) {
      let sig = `lesson:${tokens.slice(0, 8).join(' ')}`
      for (let n = 2; sigIssues.has(sig); n++) sig = `lesson:${tokens.slice(0, 8).join(' ')} #${n}`
      i = make(sig, 'lesson', l.title || l.text)
      i.tokens = tokens
      i.role = l.role ?? null
    }
    if (i.runKeys.includes(l._id)) continue
    touch(i, `${l.project}:${l._id}`, new Date(clock).toISOString())
    i.runKeys[i.runKeys.length - 1] = l._id
    i.seenRuns = i.runKeys.length
  }

  // 5. A fix that held: planned + fixCommit, and 5 runs containing the fix brought no event with the signature.
  for (const i of out.values()) {
    if (i.status !== 'planned' || !i.fixCommit || regressedNow.has(i._id)) continue
    const after = [...runs.entries()].filter(([, r]) => git.isAncestor(i.fixCommit, r.kitCommit) === true).map(([k]) => k)
    if (after.length >= FIX_HOLD_RUNS && !after.some((k) => i.runKeys.includes(k))) setStatus(i, 'fixed', clock, `${after.length} runs on kits with the fix, none brought it back`)
  }

  // 6. A dismissed problem that came back in 2+ more runs is open again.
  for (const i of out.values()) {
    if (i.status === 'dismissed' && num(i.seenRuns) - num(i.dismissedAtRuns) >= REOPEN_AFTER_RUNS) {
      setStatus(i, 'open', clock, `reopened: seen in ${num(i.seenRuns) - num(i.dismissedAtRuns)} more runs since the dismissal`)
      i.reopened = true
    }
  }

  // 6b. A kit lesson that drifted (its problem came back) or can be retired becomes a card (upkeep.mjs).
  for (const u of upkeep.filter((r) => r.flag)) {
    const drift = u.flag.startsWith('drift')
    const sig = `${drift ? 'drift' : 'retire'}:${u.id}`
    let i = sigIssues.get(sig)
    if (!i) {
      i = make(sig, drift ? 'drift' : 'retire', drift ? `${u.id} (${u.role}) did not hold: its problem came back ${u.recurrences}× after it shipped — enforce it in code` : `${u.id} (${u.role}) can be retired: ${u.flag.replace(/^retire\? /, '')}`)
      i.linkedLesson = u.id
    }
    i.seenRuns = drift ? u.recurrences : 1
    i.runKeys = []
  }

  // 7. A card shown and not answered in 14 days is `expired`; it is shown again only after new evidence.
  const expired = []
  for (const p of proposals) {
    if (p.decision || !p.createdAt || clock - Date.parse(p.createdAt) < EXPIRE_DAYS * DAY_MS) continue
    expired.push(p._id)
    const i = out.get(p.issue)
    if (i) i.expiredAtRuns = num(i.seenRuns)
  }

  const changed = [...out.values()].filter((i) => before.get(i._id) !== JSON.stringify(i)).map((i) => i._id)
  const nextCursor = { _id: 'collect', runKeys: [...new Set([...seenKeys, ...allKeys])].sort(), at: new Date(clock).toISOString() }
  return { issues: [...out.values()], changed, created, newRuns, cursor: nextCursor, expired }
}

// ---------------------------------------------------------------------------------------------------- the table

const cell = (v) => (v === null || v === undefined || v === '' ? '-' : String(v))
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s))

/** The ranked table: one line per issue, `<id> <status> | kind | signature | runs | projects | min lost | first | last | kit | plan`. */
export function rankedTable(rows, { created = [] } = {}) {
  const head = ['id status', 'kind', 'signature', 'runs', 'projects', 'min lost', 'first seen', 'last seen', 'last kit', 'plan']
  const lines = rows.map((r) => {
    const status = created.includes(r._id) ? 'new' : r.status
    const plan = [r.reopened ? `reopened: ${clip(r.dismissReason ?? '', 30)}` : '', r.linkedPlan ?? '', isExpired(r) && r.group <= 2 ? 'expired' : ''].filter(Boolean).join(' ')
    return [`${r._id} ${status}`, r.kind, clip(r.title ?? r.signature, 70), r.seenRuns, r.seenProjects, r.minutesLost, r.firstSeen, r.lastSeen, r.lastKitVersion ? `v${r.lastKitVersion}` : null, plan].map(cell).join(' | ')
  })
  return [head.join(' | '), head.map(() => '---').join(' | '), ...lines].join('\n')
}
