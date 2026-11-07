// /kit-learn (plan 046): the problem ledger, regression by git ancestry, priority, the Human's reply, the plan guard, lesson
// upkeep, trend and the triage prior. Every test uses the stub driver (tools/fixtures/kit-learn/stub-driver.mjs) or plain
// objects: none opens a network connection or needs MongoDB.
//   node --test tools/test/kit-learn.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fixtureBrain, S1, S2, S3, S4 } from '../fixtures/kit-learn/brain.mjs'
import { makeKitRepo } from '../fixtures/kit-learn/kit-repo.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const cli = join(kit, 'tools', 'kit-learn.mjs')
const stub = join(kit, 'tools', 'fixtures', 'kit-learn', 'stub-driver.mjs')
const lib = (f) => import(pathToFileURL(join(kit, 'tools', 'lib', 'kit-learn', f)).href)
const ledger = await lib('ledger.mjs')
const { applyDecisions } = await lib('apply.mjs')
const { parseReply, ALLOWED } = await lib('reply.mjs')
const { planCheck, MISSING } = await lib('plan-check.mjs')
const { isProtectedPath, protectedPaths } = await lib('protected.mjs')
const { lessonUpkeep } = await lib('upkeep.mjs')
const { kitTrendRows, kitTrendLine } = await lib('trend.mjs')
const { fixCommitFor, isAncestor } = await lib('git.mjs')
const { parseFile } = await lib('lessons.mjs')

const NOW = Date.parse('2026-11-01T12:00:00.000Z')
const tmp = (p) => mkdtempSync(join(tmpdir(), `kit-learn-${p}-`))
const gone = (...dirs) => dirs.forEach((d) => rmSync(d, { recursive: true, force: true }))

/** A scratch brain (the stub driver's data file) and a small kit repository. */
function setup(mutate = (d) => d) {
  const repo = makeKitRepo()
  const dir = tmp('brain')
  const data = mutate(fixtureBrain({ old: repo.short(repo.old), current: repo.short(repo.current), fix: repo.fix }), repo)
  const file = join(dir, 'brain.json')
  writeFileSync(file, JSON.stringify(data))
  const read = () => JSON.parse(readFileSync(file, 'utf8'))
  const run = (args, { env = {} } = {}) => {
    const e = { ...process.env, KIT_BRAIN_READER_URI: 'stub://reader', KIT_STUB_DATA: file, ...env }
    const r = spawnSync(process.execPath, [cli, ...args, '--driver', stub, '--kit-repo', repo.dir, '--now', '2026-11-01T12:00:00.000Z', '--state-dir', join(dir, 'state')], { encoding: 'utf8', env: e, timeout: 60000 })
    return { ...r, lines: (r.stdout ?? '').split(/\r?\n/).filter(Boolean) }
  }
  return { repo, dir, file, read, run, done: () => gone(repo.dir, dir) }
}

const rowOf = (lines, id) => lines.find((l) => l.startsWith(`${id} `))

// ---------------------------------------------------------------------------------------------------- collect

test('collect on the fixture brain: I1 regressed first, then new issues by priority, with every column', () => {
  const t = setup()
  try {
    const r = t.run(['collect'])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.lines[0], /^COLLECT: 3 new run\(s\), 3 new issue\(s\), 4 changed$/)
    const head = r.lines[1]
    for (const col of ['kind', 'signature', 'runs', 'projects', 'min lost', 'first seen', 'last seen', 'last kit', 'plan']) assert.ok(head.includes(col), `column ${col}`)
    const ids = r.lines.filter((l) => /^I\d+ /.test(l)).map((l) => l.split(' ')[0])
    assert.deepEqual(ids, ['I1', 'I2', 'I3', 'I4'])
    assert.match(rowOf(r.lines, 'I1'), /^I1 regressed \| park \| .*\| 4 \| 2 \| 115 \| 2026-10-20 \| 2026-10-30 \| v1\.13\.0 \| 040$/)
    assert.match(rowOf(r.lines, 'I2'), /^I2 new \| timeout \|.*\| 2 \| 2 \| 50 \|/)
    assert.match(rowOf(r.lines, 'I3'), /^I3 new \| env-fail \|.*\| 1 \| 1 \| 63 \|/, 'the plan skipped for waiting on the parked one adds its minutes')
    assert.match(rowOf(r.lines, 'I4'), /^I4 new \| park \|.*\| 2 \| 1 \| 25 \|/)
    assert.equal(r.lines.at(-1), 'CARDS: I1 I2 I3 I4')
    // the ledger was written, and the cursor with it
    const d = t.read()
    assert.equal(d.issues.find((i) => i._id === 'I1').status, 'regressed')
    assert.equal(d.issues.length, 4)
    assert.equal(d.cursor.find((c) => c._id === 'collect').runKeys.length, 6)
    // a second collect finds nothing new and changes nothing
    const again = t.run(['collect'])
    assert.match(again.lines[0], /^COLLECT: 0 new run\(s\), 0 new issue\(s\), 0 changed$/)
    assert.match(rowOf(again.lines, 'I2'), /^I2 open \|/, 'no longer new')
  } finally { t.done() }
})

test('collect --dry-run writes nothing; --top limits the cards', () => {
  const t = setup()
  try {
    const before = readFileSync(t.file, 'utf8')
    const r = t.run(['collect', '--dry-run', '--top', '2'])
    assert.equal(r.status, 0, r.stderr)
    assert.equal(readFileSync(t.file, 'utf8'), before, 'the brain file is byte-identical')
    assert.equal(r.lines.at(-1), 'CARDS: I1 I2')
    assert.match(r.lines[0], /dry run: nothing written/)
  } finally { t.done() }
})

test('collect moves the cursor only after every write succeeded', () => {
  const t = setup()
  try {
    const r = t.run(['collect'], { env: { KIT_STUB_FAIL_ON: 'issues' } })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /collect failed — write denied/)
    assert.equal(t.read().cursor[0].runKeys.length, 3, 'the cursor stayed where it was')
    const ok = t.run(['collect'])
    assert.equal(ok.status, 0, ok.stderr)
    assert.equal(t.read().cursor[0].runKeys.length, 6)
  } finally { t.done() }
})

test('collect without the reader string or with a stub that cannot be loaded fails with one line and exit 1', () => {
  const t = setup()
  try {
    const r = t.run(['collect'], { env: { KIT_BRAIN_READER_URI: '' } })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /KIT_BRAIN_READER_URI is not set/)
  } finally { t.done() }
})

// ---------------------------------------------------------------------------------------------------- regression

const evidenceOf = (d, keepRuns) => ({ ...d, runs: d.runs.filter((r) => keepRuns.includes(r.run)), plans: d.plans, events: d.events.filter((e) => keepRuns.includes(e.run)) })

test('regression: a fixed issue is regressed by an event from a run whose kit has the fix as an ancestor, and stays fixed on an older kit', async () => {
  const repo = makeKitRepo()
  try {
    assert.equal(isAncestor(repo.dir, repo.fix, repo.current), true)
    assert.equal(isAncestor(repo.dir, repo.fix, repo.old), false)
    assert.equal(isAncestor(repo.dir, repo.fix, 'deadbeefdead'), null, 'an unknown commit is not an answer')
    const d = fixtureBrain({ old: repo.short(repo.old), current: repo.short(repo.current), fix: repo.fix })
    const seed = { ...d.issues[0], runKeys: [], seenRuns: 0, projects: [], seenProjects: 0, minutesLost: 0 }
    const git = { isAncestor: (a, b) => isAncestor(repo.dir, a, b), fixCommitFor: () => null }
    // only the run on the OLD kit brings the signature: still fixed
    const older = ledger.collectLedger({ evidence: { ...evidenceOf(d, ['run-a1']), toil: [], lessonsIn: [] }, issues: [seed], now: NOW, git })
    assert.equal(older.issues.find((i) => i._id === 'I1').status, 'fixed')
    // the run on the CURRENT kit (a6) brings it: regressed, with the run named
    const newer = ledger.collectLedger({ evidence: { ...evidenceOf(d, ['run-a6']), toil: [], lessonsIn: [] }, issues: [seed], now: NOW, git })
    const i1 = newer.issues.find((i) => i._id === 'I1')
    assert.equal(i1.status, 'regressed')
    assert.equal(i1.regressedRun, 'alpha-app:run-a6')
    assert.match(i1.history.at(-1).note, /v1\.13\.0 \(has fix/)
  } finally { gone(repo.dir) }
})

test('fixCommitFor finds the merge commit of a plan (merge first, subject second) and nothing for a plan that never merged', () => {
  const repo = makeKitRepo()
  try {
    assert.deepEqual(fixCommitFor(repo.dir, '040', 'origin/main'), { sha: repo.fix, how: 'merge' }, 'falls back to main when origin/main is absent')
    assert.equal(fixCommitFor(repo.dir, '041').how, 'subject')
    assert.equal(fixCommitFor(repo.dir, '041').sha, repo.current)
    assert.equal(fixCommitFor(repo.dir, '099'), null)
  } finally { gone(repo.dir) }
})

test('a planned issue gets its fixCommit when the plan merged, and becomes fixed after 5 runs on kits with the fix that did not bring it back', () => {
  const repo = makeKitRepo()
  try {
    const git = { isAncestor: (a, b) => isAncestor(repo.dir, a, b), fixCommitFor: (n) => fixCommitFor(repo.dir, n) }
    const planned = { ...fixtureBrain({ old: 'x', current: 'y', fix: 'z' }).issues[0], status: 'planned', fixCommit: null, runKeys: ['alpha-app:run-a1'], seenRuns: 1 }
    const cur = repo.short(repo.current)
    const runs = Array.from({ length: 5 }, (_, n) => ({ project: 'alpha-app', run: `r${n}`, kitVersion: '1.13.0', kitCommit: cur, startedAt: `2026-10-2${n}T00:00:00.000Z` }))
    const first = ledger.collectLedger({ evidence: { runs: runs.slice(0, 4), plans: [], events: [], grades: [], toil: [], lessonsIn: [] }, issues: [planned], now: NOW, git })
    const a = first.issues[0]
    assert.equal(a.fixCommit, repo.fix)
    assert.equal(a.status, 'planned', '4 runs are not enough')
    const second = ledger.collectLedger({ evidence: { runs, plans: [], events: [], grades: [], toil: [], lessonsIn: [] }, issues: [a], now: NOW, git })
    assert.equal(second.issues[0].status, 'fixed')
    // the same, but the signature came back in one of those runs: regressed, not fixed
    const bad = ledger.collectLedger({ evidence: { runs, plans: [], events: [{ _id: 'e', project: 'alpha-app', run: 'r2', kind: 'park', plan: null, signature: S1 }], grades: [], toil: [], lessonsIn: [] }, issues: [a], now: NOW, git })
    assert.equal(bad.issues[0].status, 'regressed')
  } finally { gone(repo.dir) }
})

// ---------------------------------------------------------------------------------------------------- priority and visibility

test('priority = minutesLost × (1 + ln(runs)) × (projects ≥ 2 ? 1.5 : 1)', () => {
  assert.equal(ledger.priority({ minutesLost: 50, seenRuns: 1, seenProjects: 1 }), 50)
  assert.equal(ledger.priority({ minutesLost: 50, seenRuns: 2, seenProjects: 2 }), Math.round(50 * (1 + Math.log(2)) * 1.5 * 100) / 100)
  assert.equal(ledger.priority({ minutesLost: 0, seenRuns: 9, seenProjects: 3 }), 0)
})

const issue = (id, over = {}) => ({ _id: id, signature: `s-${id}`, kind: 'park', title: `t-${id}`, status: 'open', history: [], runKeys: [], seenRuns: 1, projects: ['p'], seenProjects: 1, minutesLost: 10, firstSeen: '2026-10-01', lastSeen: '2026-10-02', ...over })

test('rank: regressed first, then open by priority, put-off ones below, planned and fixed last; dismissed hidden', () => {
  const rows = ledger.rank([
    issue('I1', { status: 'fixed' }), issue('I2', { minutesLost: 5 }), issue('I3', { minutesLost: 50 }), issue('I4', { status: 'regressed', minutesLost: 1 }),
    issue('I5', { minutesLost: 500, laterUntil: '2026-11-10T00:00:00.000Z' }), issue('I6', { status: 'dismissed', minutesLost: 999 }), issue('I7', { status: 'planned' }),
  ], { now: NOW, top: 3 })
  assert.deepEqual(rows.map((r) => r._id), ['I4', 'I3', 'I2', 'I5', 'I7', 'I1'])
  assert.deepEqual(rows.filter((r) => r.card).map((r) => r._id), ['I4', 'I3', 'I2'], 'at most 3 cards')
  assert.equal(ledger.rank([issue('I5', { laterUntil: '2026-10-01T00:00:00.000Z' })], { now: NOW })[0].group, 1, 'a later that ran out is an ordinary open issue')
})

test('a dismissed issue stays hidden until its run count grew by 2, then it is open again and marked reopened', () => {
  const git = { isAncestor: () => null, fixCommitFor: () => null }
  const dismissed = issue('I1', { status: 'dismissed', signature: S1, seenRuns: 2, dismissedAtRuns: 2, dismissReason: 'covered by 040', runKeys: ['p:r1', 'p:r2'] })
  const ev = (run) => ({ _id: `e-${run}`, project: 'p', run, kind: 'park', plan: null, signature: S1 })
  const base = { runs: [], plans: [], grades: [], toil: [], lessonsIn: [] }
  const one = ledger.collectLedger({ evidence: { ...base, events: [ev('r1'), ev('r2'), ev('r3')] }, issues: [dismissed], now: NOW, git })
  assert.equal(one.issues[0].status, 'dismissed', '1 more run is not enough')
  assert.equal(ledger.rank(one.issues, { now: NOW }).length, 0)
  const two = ledger.collectLedger({ evidence: { ...base, events: [ev('r1'), ev('r2'), ev('r3'), ev('r4')] }, issues: [dismissed], now: NOW, git })
  assert.equal(two.issues[0].status, 'open')
  assert.equal(two.issues[0].reopened, true)
  assert.match(ledger.rankedTable(ledger.rank(two.issues, { now: NOW })), /reopened: covered by 040/)
})

test('toil a script could do, seen in 2+ runs, becomes a toil issue; a line naming a signature adds its minutes to that issue', () => {
  const git = { isAncestor: () => null, fixCommitFor: () => null }
  const t = (run, minutes, extra = {}) => ({ _id: `p:${run}:toil:0`, project: 'p', run, step: 'rebase the plan branch by hand', minutes, script: 'yes', ...extra })
  const one = ledger.collectLedger({ evidence: { runs: [], plans: [], events: [], grades: [], toil: [t('r1', 10)], lessonsIn: [] }, issues: [], now: NOW, git })
  assert.equal(one.issues.length, 0, 'one run is not a pattern')
  const two = ledger.collectLedger({ evidence: { runs: [], plans: [], events: [], grades: [], toil: [t('r1', 10), t('r2', 15), t('r3', 7, { script: 'no' })], lessonsIn: [] }, issues: [], now: NOW, git })
  assert.equal(two.issues.length, 1)
  assert.deepEqual([two.issues[0].kind, two.issues[0].seenRuns, two.issues[0].minutesLost], ['toil', 2, 25])
  const linked = ledger.collectLedger({
    evidence: { runs: [], plans: [], events: [{ _id: 'e', project: 'p', run: 'r1', kind: 'park', plan: null, signature: S2 }], grades: [], toil: [t('r1', 12, { signature: S2 })], lessonsIn: [] }, issues: [], now: NOW, git,
  })
  assert.equal(linked.issues.length, 1)
  assert.equal(linked.issues[0].minutesLost, 12, 'the Planner linked the by-hand minutes to the problem')
})

test('lessons from projects that look alike (tokens overlap ≥ 0.6) are one lesson issue with their project count', () => {
  const git = { isAncestor: () => null, fixCommitFor: () => null }
  const l = (project, id, title, text) => ({ _id: `${project}:lesson:${id}`, project, role: 'builder', title, text, why: 'w' })
  const evidence = {
    runs: [], plans: [], events: [], grades: [], toil: [],
    lessonsIn: [
      l('alpha-app', 'a', 'A main check that reads slot state cannot pass', 'a main folder check reading slot state never passes'),
      l('beta-app', 'b', 'A main check that reads slot state cannot pass', 'a main folder check reading slot state never passes there'),
      l('beta-app', 'c', 'Quote the glob in test commands', 'on Node 24 a bare folder test glob fails'),
    ],
  }
  const r = ledger.collectLedger({ evidence, issues: [], now: NOW, git })
  const lessons = r.issues.filter((i) => i.kind === 'lesson')
  assert.equal(lessons.length, 2)
  const grouped = lessons.find((i) => i.seenProjects === 2)
  assert.ok(grouped, 'two projects, one issue')
  assert.equal(grouped.seenRuns, 2)
  const again = ledger.collectLedger({ evidence, issues: r.issues, now: NOW, git })
  assert.deepEqual(again.changed, [], 'a second collect changes nothing')
})

test('a card shown and not answered in 14 days expires and is not a card again until new evidence arrives', () => {
  const git = { isAncestor: () => null, fixCommitFor: () => null }
  const i = issue('I1', { runKeys: ['p:r1'], signature: S1 })
  const pending = { _id: 'I1:2026-10-10T00:00:00.000Z', issue: 'I1', createdAt: '2026-10-10T00:00:00.000Z', decision: null }
  const fresh = { ...pending, _id: 'I1:2026-10-30T00:00:00.000Z', createdAt: '2026-10-30T00:00:00.000Z' }
  const base = { runs: [], plans: [], grades: [], toil: [], lessonsIn: [] }
  const r = ledger.collectLedger({ evidence: { ...base, events: [{ _id: 'e', project: 'p', run: 'r1', kind: 'park', plan: null, signature: S1 }] }, issues: [i], proposals: [pending, fresh], now: NOW, git })
  assert.deepEqual(r.expired, [pending._id], 'only the old one')
  assert.equal(ledger.rank(r.issues, { now: NOW })[0].card, false)
  const grew = ledger.collectLedger({ evidence: { ...base, events: [{ _id: 'e', project: 'p', run: 'r1', kind: 'park', plan: null, signature: S1 }, { _id: 'f', project: 'p', run: 'r2', kind: 'park', plan: null, signature: S1 }] }, issues: r.issues, now: NOW, git })
  assert.equal(ledger.rank(grew.issues, { now: NOW })[0].card, true)
})

// ---------------------------------------------------------------------------------------------------- the reply

test('parseReply: the grammar, ok with overrides, and a refusal naming the allowed list', () => {
  const known = ['I1', 'I2', 'I3', 'I4']
  const r = parseReply('I1 plan · I2 lesson builder · I3 dismiss covered by 040 · I4 later', { known })
  assert.deepEqual(r.items, [{ id: 'I1', action: 'plan', arg: '' }, { id: 'I2', action: 'lesson', arg: 'builder' }, { id: 'I3', action: 'dismiss', arg: 'covered by 040' }, { id: 'I4', action: 'later', arg: '' }])
  assert.deepEqual(parseReply('I1 amend 040, I2 enforce', { known }).items.map((i) => [i.id, i.action, i.arg]), [['I1', 'amend', '040'], ['I2', 'enforce', '']])
  const ok = parseReply('ok · I3 dismiss not worth it', { known, recommend: { I1: 'plan', I2: 'amend 040', I3: 'later' } })
  assert.deepEqual(ok.items.map((i) => [i.id, i.action, i.arg]).sort(), [['I1', 'plan', ''], ['I2', 'amend', '040'], ['I3', 'dismiss', 'not worth it']])
  for (const bad of ['I1 frobnicate', 'hello', 'I1 amend', 'I1 lesson wizard', 'I1 dismiss', 'I9 plan', 'I1 plan · I1 later', 'I1 plan now']) {
    const e = parseReply(bad, { known })
    assert.ok(e.error, `refused: ${bad}`)
  }
  assert.ok(parseReply('I1 frobnicate', { known }).error.includes(ALLOWED), 'the allowed list is named')
  assert.match(parseReply('ok', { known }).error, /cards\.json/)
})

test('apply (stub driver): proposals rows with the decision, issue statuses, the follow-up steps; an unknown token is refused', () => {
  const t = setup()
  try {
    assert.equal(t.run(['collect']).status, 0)
    const bad = t.run(['apply', '--reply', 'I1 plan · I2 frobnicate'])
    assert.equal(bad.status, 1)
    assert.ok(bad.stderr.includes(ALLOWED), bad.stderr)
    assert.ok(t.read().proposals.every((p) => p.decision === null), 'a refused reply decides nothing')
    const r = t.run(['apply', '--reply', 'I1 plan · I2 lesson builder · I3 dismiss covered by 040 · I4 later'])
    assert.equal(r.status, 0, r.stderr)
    const d = t.read()
    assert.deepEqual(d.proposals.map((p) => [p.issue, p.decision, p.arg, p.autonomyLevel]).sort(), [['I1', 'plan', null, 0], ['I2', 'lesson', 'builder', 0], ['I3', 'dismiss', 'covered by 040', 0], ['I4', 'later', null, 0]])
    for (const p of d.proposals) assert.ok(p.createdAt && p.decidedAt && 'text' in p, 'createdAt, decision, decidedAt, text')
    const st = (id) => d.issues.find((i) => i._id === id)
    assert.equal(st('I1').status, 'planned')
    assert.equal(st('I2').status, 'planned')
    assert.equal(st('I3').status, 'dismissed')
    assert.equal(st('I3').dismissReason, 'covered by 040')
    assert.equal(st('I3').dismissedAtRuns, 1)
    assert.equal(st('I4').status, 'open')
    assert.equal(st('I4').laterUntil, '2026-11-15T12:00:00.000Z')
    assert.ok(r.lines.some((l) => /^NEXT: I1: run \/plan with "Source: brain issue I1"/.test(l)))
    assert.ok(r.lines.some((l) => /^NEXT: I2: node tools\/kit-lessons\.mjs add --role builder .* --issue I2/.test(l)))
    // a dismissed card is not shown again; a later one is below the new items
    const next = t.run(['collect'])
    assert.ok(!rowOf(next.lines, 'I3'), 'I3 is hidden')
    assert.match(rowOf(next.lines, 'I4'), /^I4 open \|/, 'later keeps the issue open')
    assert.match(rowOf(next.lines, 'I1'), /^I1 planned \|/)
    assert.equal(next.lines.at(-1), 'CARDS: I4', 'only the open one is a card; planned and dismissed ones are not')
  } finally { t.done() }
})

test('apply --dry-run writes nothing; ok accepts the recorded recommendations and a named card overrides', () => {
  const t = setup()
  try {
    t.run(['collect'])
    mkdirSync(join(t.dir, 'state'), { recursive: true })
    writeFileSync(join(t.dir, 'state', 'cards.json'), JSON.stringify({ I1: { recommend: 'plan', text: 'amend the regex' }, I2: { recommend: 'later' } }))
    const before = readFileSync(t.file, 'utf8')
    const dry = t.run(['apply', '--reply', 'ok · I2 dismiss duplicate of I1', '--dry-run'])
    assert.equal(dry.status, 0, dry.stderr)
    assert.equal(readFileSync(t.file, 'utf8'), before)
    assert.match(dry.lines[0], /^APPLY: 2 decision\(s\) \(dry run: nothing written\)$/)
    const real = t.run(['apply', '--reply', 'ok · I2 dismiss duplicate of I1'])
    assert.equal(real.status, 0, real.stderr)
    const p = t.read().proposals.filter((x) => x.decision)
    assert.deepEqual(p.map((x) => [x.issue, x.decision, x.accepted]).sort(), [['I1', 'plan', true], ['I2', 'dismiss', false]])
    assert.equal(p.find((x) => x.issue === 'I1').text, 'amend the regex')
  } finally { t.done() }
})

test('collect records each card as shown (a pending row, once); apply fills that row instead of adding another', () => {
  const t = setup()
  try {
    t.run(['collect'])
    assert.equal(t.read().proposals.length, 4, 'one pending row per card on the CARDS line')
    assert.ok(t.read().proposals.every((p) => p.decision === null))
    t.run(['collect'])
    assert.equal(t.read().proposals.length, 4, 'not twice')
    t.run(['apply', '--reply', 'I1 plan'])
    const p = t.read().proposals
    assert.equal(p.length, 4)
    assert.equal(p.find((x) => x.issue === 'I1').decision, 'plan')
    assert.equal(p.find((x) => x.issue === 'I1').createdAt, '2026-11-01T12:00:00.000Z')
  } finally { t.done() }
})

test('a card shown and left for 14 days is recorded expired by the next collect', () => {
  const t = setup((d) => ({ ...d, proposals: [{ _id: 'I1:2026-10-10T00:00:00.000Z', issue: 'I1', createdAt: '2026-10-10T00:00:00.000Z', decision: null }] }))
  try {
    assert.equal(t.run(['collect']).status, 0)
    assert.equal(t.read().proposals[0].decision, 'expired')
  } finally { t.done() }
})

// ---------------------------------------------------------------------------------------------------- protected paths, plan guard

test('protected paths: the graders are human-only; a proposal naming one is marked protected', () => {
  for (const p of ['tools/agent-eval.mjs', 'tools/lib/agent-eval/x.mjs', 'tools/test/brain.test.mjs', 'core/scripts/lib/brain-doc.mjs', 'tools/lib/kit-learn/ledger.mjs', 'tools/leak-check.mjs', 'core/scripts/pre-commit-secret-scan.mjs']) assert.ok(isProtectedPath(p), p)
  for (const p of ['core/scripts/run-plans.mjs', 'tools/kit-learn.mjs', 'core/scripts/brain.mjs']) assert.ok(!isProtectedPath(p), p)
  assert.deepEqual(protectedPaths(['tools\\leak-check.mjs', 'core/scripts/brain.mjs']), ['tools/leak-check.mjs'])
  const r = applyDecisions({ items: [{ id: 'I1', action: 'plan', arg: '' }], issues: [issue('I1')], cards: { I1: { text: 'x', paths: ['tools/leak-check.mjs'] } }, now: NOW, readPlan: () => null })
  assert.equal(r.proposals[0].protected, true)
  assert.deepEqual(r.proposals[0].protectedPaths, ['tools/leak-check.mjs'])
  assert.equal(r.issues[0].protected, true)
  assert.match(r.steps[0], /\[protected: tools\/leak-check\.mjs — human-only, never automated\]/)
})

const PLAN = (source, task) => `# Plan 900 — x\n\nStatus: draft\n${source}\n\n## Atomic Sub-tasks\n\n- [ ] T1: ${task} — a.mjs\n- [ ] T2: docs — README.md\n\n## Out of Scope\n- tools/test/never-counted.mjs\n`

test('plan-check: a plan from a brain issue needs a sub-task naming a path under tools/test/ or tools/fixtures/', () => {
  const dir = tmp('plans')
  try {
    const run = (name, text) => {
      const f = join(dir, name)
      writeFileSync(f, text)
      return spawnSync(process.execPath, [cli, 'plan-check', f], { encoding: 'utf8' })
    }
    const bad = run('900-bad.plan.md', PLAN('Source: brain issue I3', 'fix the check'))
    assert.equal(bad.status, 1)
    assert.ok(bad.stderr.includes(MISSING), bad.stderr)
    const good = run('900-good.plan.md', PLAN('Source: brain issue I3', 'fix the check and reproduce it in tools/test/gate.test.mjs'))
    assert.equal(good.status, 0, good.stderr)
    assert.match(good.stdout, /reproduced by tools\/test\/gate\.test\.mjs/)
    assert.equal(run('900-fix.plan.md', PLAN('Source: brain issue I3', 'a fixture tools/fixtures/kit-learn/x.json')).status, 0)
    const none = run('900-none.plan.md', PLAN('Source: a hand-off', 'fix the check'))
    assert.equal(none.status, 0, 'a plan that does not come from a brain issue is not held to the guard')
    assert.equal(planCheck(PLAN('Source: brain issue I3', 'x')).ok, false, 'a path outside the sub-tasks does not count')
    assert.equal(spawnSync(process.execPath, [cli, 'plan-check', join(dir, 'nope.plan.md')], { encoding: 'utf8' }).status, 2)
  } finally { gone(dir) }
})

test('apply refuses planned for an amended plan that carries the issue and fails plan-check; collect links a drafted plan by its Source line', () => {
  const t = setup()
  const plans = join(t.dir, 'plans')
  try {
    t.run(['collect'])
    mkdirSync(plans, { recursive: true })
    writeFileSync(join(plans, '050-x.plan.md'), PLAN('Source: brain issue I2', 'fix the check'))
    const refused = t.run(['apply', '--reply', 'I2 amend 050', '--plans-dir', plans])
    assert.equal(refused.status, 1)
    assert.ok(refused.stderr.includes(MISSING), refused.stderr)
    assert.equal(t.read().issues.find((i) => i._id === 'I2').status, 'open')
    // `plan`: the plan is drafted after the reply; the next collect finds it by its Source line and records its regression test
    assert.equal(t.run(['apply', '--reply', 'I2 plan']).status, 0)
    writeFileSync(join(plans, '051-y.plan.md'), PLAN('Source: brain issue I9', 'tools/test/x.test.mjs'))
    t.run(['collect', '--plans-dir', plans])
    assert.equal(t.read().issues.find((i) => i._id === 'I2').linkedPlan, null, 'a plan that names another issue is not the link')
    writeFileSync(join(plans, '050-x.plan.md'), PLAN('Source: brain issue I2', 'fix the check, test tools/test/gate.test.mjs'))
    t.run(['collect', '--plans-dir', plans])
    const i2 = t.read().issues.find((i) => i._id === 'I2')
    assert.deepEqual([i2.status, i2.linkedPlan, i2.fixture], ['planned', '050', 'tools/test/gate.test.mjs'])
  } finally { t.done() }
})

test('the kit /plan review runs plan-check and reads the planner lessons of both folders', () => {
  const plan = readFileSync(join(kit, 'core', '.claude', 'commands', 'plan.md'), 'utf8')
  assert.match(plan, /node tools\/kit-learn\.mjs plan-check <draft>/)
  assert.match(plan, /docs\/agent\/kit-lessons\/planner\.md/)
  assert.match(plan, /docs\/brain\/agent-lessons\/planner\.md/)
})

// ---------------------------------------------------------------------------------------------------- lessons, trend, triage prior

test('lessons: exposures and recurrences per kit lesson; 2+ recurrences is drift, a fixed issue with a fixture and no recurrence in 10 exposures is a retire candidate; safety lines never', () => {
  const file = (live) => ({ live: live.map((l) => ({ ...l, raw: `- ${l.id}: ${l.text} — why: ${l.why} (issue ${l.issue}, since v${l.since})` })), retired: [] })
  const lessons = {
    builder: file([
      { id: 'K1', text: 'quote the glob', why: 'node 24 fails', issue: 'I1', since: '1.13.0' },
      { id: 'K2', text: 'stamp the slot', why: 'checks cannot pass', issue: 'I2', since: '1.13.0' },
      { id: 'K3', text: 'never print tokens', why: 'secrets leak', issue: 'I3', since: '1.13.0' },
    ]),
  }
  const runs = Array.from({ length: 12 }, (_, n) => ({ project: 'p', run: `r${n}`, kitVersion: n < 2 ? '1.12.0' : '1.13.0', kitCommit: 'c' }))
  const plans = runs.map((r) => ({ project: 'p', run: r.run, nnn: '1', models: { 'orch-builder': {} } }))
  const ev = (run, sig) => ({ project: 'p', run, kind: 'park', signature: sig })
  const issues = [
    { _id: 'I1', signature: 'sig-1', status: 'open' }, { _id: 'I2', signature: 'sig-2', status: 'fixed', fixture: 'tools/test/gate.test.mjs' }, { _id: 'I3', signature: 'sig-3', status: 'fixed', fixture: 'tools/test/x.test.mjs' },
  ]
  const events = [ev('r0', 'sig-1'), ev('r3', 'sig-1'), ev('r5', 'sig-1'), ev('r1', 'sig-2')]
  const rows = lessonUpkeep({ lessons, issues, runs, plans, events })
  const k = (id) => rows.find((r) => r.id === id)
  assert.deepEqual([k('K1').exposures, k('K1').recurrences, k('K1').flag], [10, 2, 'drift → enforce'], 'r0 ran before the lesson existed: not counted')
  assert.deepEqual([k('K2').exposures, k('K2').recurrences, k('K2').flag], [10, 0, 'retire? enforced by tools/test/gate.test.mjs'], 'r1 is on the old kit')
  assert.deepEqual([k('K3').safety, k('K3').flag], [true, null], 'a safety lesson is never offered for retirement')
  assert.equal(lessonUpkeep({ lessons, issues, runs: runs.slice(0, 5), plans, events }).find((r) => r.id === 'K2').flag, null, 'under 10 exposures')
  // drift and retire candidates become cards in the next collect
  const git = { isAncestor: () => null, fixCommitFor: () => null }
  const r = ledger.collectLedger({ evidence: { runs: [], plans: [], events: [], grades: [], toil: [], lessonsIn: [] }, issues: [], now: NOW, git, upkeep: rows })
  assert.deepEqual(r.issues.map((i) => [i.kind, i.signature]).sort(), [['drift', 'drift:K1'], ['retire', 'retire:K2']])
})

test('lessons CLI prints one line per live kit lesson; a lesson is never retired by it', () => {
  const t = setup()
  const dir = tmp('lessons')
  try {
    writeFileSync(join(dir, 'builder.md'), '# Kit lessons — builder\nx\n- K1: quote the glob — why: node 24 fails (issue I1, since v1.13.0)\n\n## Retired\n')
    const before = readFileSync(join(dir, 'builder.md'), 'utf8')
    const r = t.run(['lessons', '--lessons-dir', dir])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /^K1 builder exposures \d+ recurrences \d+/m)
    assert.equal(readFileSync(join(dir, 'builder.md'), 'utf8'), before)
    assert.equal(parseFile(before).live.length, 1)
  } finally { t.done(); gone(dir) }
})

test('trend: one row per kit version with minutes lost per run; --line shows the last three versions', () => {
  const t = setup()
  try {
    const d = t.read()
    const rows = kitTrendRows(d)
    assert.deepEqual(rows.map((r) => r.kitVersion), ['1.12.0', '1.13.0'])
    assert.equal(rows[0].minutesLostPerRun, 38.3, '115 minutes over 3 runs')
    assert.equal(rows[1].minutesLostPerRun, 46, '138 minutes over 3 runs')
    assert.equal(rows[0].roundTripsPerRun, null, 'unknown stays unknown')
    assert.match(kitTrendLine(rows), /^kit trend \(.*\): v1\.12\.0 38\.3 · .* → v1\.13\.0 46 · /)
    const cliTable = t.run(['trend'])
    assert.equal(cliTable.status, 0, cliTable.stderr)
    assert.match(cliTable.stdout, /\| min lost\/run \| parked\/run \| fix rounds\/plan \| decisions\/plan \| ✗\/plan \| round trips\/run \| tokens\/plan \|/)
    const line = t.run(['trend', '--line'])
    assert.equal(line.lines.length, 1)
  } finally { t.done() }
})

test('triage-prior: the agreement per decision kind over every project’s grades, in the table the project file uses', () => {
  const t = setup()
  const out = join(tmp('prior'), 'triage-calibration.md')
  try {
    const dry = t.run(['triage-prior', '--dry-run'])
    assert.equal(dry.status, 0, dry.stderr)
    assert.match(dry.stdout, /\| sort-order \| 4 \| 75% \|/, 'accept/ok, accept/ok, accept/✗, ask/✗: 3 of 4')
    assert.match(dry.stdout, /\| copy \| 1 \| 100% \|/, 'a row the triage left none is not counted')
    assert.equal(t.run(['triage-prior', '--out', out]).status, 0)
    assert.equal(readFileSync(out, 'utf8'), dry.stdout, 'the file holds what the dry run printed')
  } finally { t.done(); gone(resolve(out, '..')) }
})

test('grades from a /ship run (run ship-<NNN>, no runs document, triage none) pass collect and triage-prior and are not counted', () => {
  const ship = (id, kind, humanVerdict) => ({ _id: `alpha-app:ship-${id}`, project: 'alpha-app', run: 'ship-057', plan: '057', id, kind, type: 'seen', triageVerdict: 'none', humanVerdict, kitVersion: '1.13.0' })
  const base = setup()
  const t = setup((d) => ({ ...d, grades: [...d.grades, ship('D1', 'ship-only', 'ok'), ship('D2', 'ship-only', '✗'), ship('D3', 'sort-order', '✗')] }))
  try {
    const before = base.run(['collect', '--dry-run'])
    const r = t.run(['collect', '--dry-run'])
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.lines[0], before.lines[0], 'a ship run brings no run, issue or change of its own')
    const dry = t.run(['triage-prior', '--dry-run'])
    assert.equal(dry.status, 0, dry.stderr)
    assert.ok(!/\| ship-only \|/.test(dry.stdout), 'a kind graded only with triage none has no row')
    assert.match(dry.stdout, /\| sort-order \| 4 \| 75% \|/, 'the none row of a known kind is not counted either')
    assert.equal(t.run(['trend']).stdout, base.run(['trend']).stdout, 'ship ✗ grades do not raise the orchestrator ✗/plan')
  } finally { base.done(); t.done() }
})

test('trendRows: a ✗ grade from a ship-<NNN> run is not counted toward ✗/plan; an orchestrator run\'s ✗ still is', async () => {
  const { trendRows } = await import(pathToFileURL(join(kit, 'tools', 'brain-query.mjs')).href)
  const runs = [{ kitVersion: '1', counts: { plans: 2 } }]
  const wrong = (run) => ({ run, humanVerdict: '✗', kitVersion: '1' })
  assert.equal(trendRows(runs, [wrong('ship-057'), wrong('ship-057')], 'kitVersion')[0].wrongPerPlan, 0)
  assert.equal(trendRows(runs, [wrong('run-a1'), wrong('ship-057')], 'kitVersion')[0].wrongPerPlan, 0.5)
})

test('the kit-learn tools do not exist in a project: no copy under core/, and the command file has no source in core/', () => {
  assert.ok(!existsSync(join(kit, 'core', 'scripts', 'kit-learn.mjs')))
  assert.ok(!existsSync(join(kit, 'core', '.claude', 'commands', 'kit-learn.md')))
  assert.ok(existsSync(join(kit, '.claude', 'commands', 'kit-learn.md')))
})

test('the fixture names its four signatures (a guard on the fixture itself)', () => {
  assert.equal(new Set([S1, S2, S3, S4]).size, 4)
})
