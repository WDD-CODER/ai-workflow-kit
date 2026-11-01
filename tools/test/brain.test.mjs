// The kit brain (core/scripts/brain.mjs + lib/brain-doc.mjs, tools/brain-query.mjs, brain.* config): documents from a run's
// status.json with no network and no model, signatures, redaction, a queue that never loses a document and never fails a run,
// and the kit's read side. Every test uses a stub driver (tools/fixtures/orchestrator/brain/*-driver.mjs): none opens a network
// connection, and the real driver is asserted never loaded.
//   node --test tools/test/brain.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, cpSync, utimesSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { brainProblems } from '../lib/kit.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const script = join(kit, 'core', 'scripts', 'brain.mjs')
const fixture = join(kit, 'tools', 'fixtures', 'orchestrator', 'brain')
const stub = join(fixture, 'stub-driver.mjs')
const lib = await import(pathToFileURL(join(kit, 'core', 'scripts', 'lib', 'brain-doc.mjs')).href)
const query = await import(pathToFileURL(join(kit, 'tools', 'brain-query.mjs')).href)
const FENCE = '`'.repeat(3)
const URI = `mongodb${'+srv'}://writer:pw@cluster.example.net/kitbrain` // never a real string; built so no secret scan fires on this file

const tmp = (p) => mkdtempSync(join(tmpdir(), `brain-${p}-`))
const gone = (...dirs) => dirs.forEach((d) => rmSync(d, { recursive: true, force: true }))

/** A scratch project holding the fixture run (and its grade rows) the way a project keeps them. */
function project({ runs = ['run-fx'], grades = true } = {}) {
  const dir = tmp('project')
  for (const run of runs) {
    mkdirSync(join(dir, '.claude', 'orchestrator-runs', run), { recursive: true })
    writeFileSync(join(dir, '.claude', 'orchestrator-runs', run, 'status.json'), readFileSync(join(fixture, 'status.json'), 'utf8').replace(/run-fx/g, run))
  }
  if (grades) {
    mkdirSync(join(dir, 'docs', 'brain'), { recursive: true })
    cpSync(join(fixture, 'decision-grades.jsonl'), join(dir, 'docs', 'brain', 'decision-grades.jsonl'))
  }
  mkdirSync(join(dir, '.kit'), { recursive: true })
  writeFileSync(join(dir, '.kit', 'config.json'), JSON.stringify({ brain: { projectId: 'fx-app' } }))
  writeFileSync(join(dir, '.kit', 'install.json'), JSON.stringify({ kit: { version: '1.13.0' }, commit: 'abc123def4567890', source: 'local:.' }))
  return dir
}

/** Runs brain.mjs with its own brain home, an empty transcript home, and the stub driver unless told otherwise. */
function brain(dir, args, { env = {}, home = join(dir, '.home'), driver = stub, uri = URI } = {}) {
  mkdirSync(home, { recursive: true })
  const e = { ...process.env, KIT_BRAIN_HOME: home, KIT_BRAIN_TRANSCRIPTS_HOME: join(dir, '.no-transcripts'), ...env }
  delete e.KIT_BRAIN_URI
  if (uri) e.KIT_BRAIN_URI = uri
  const r = spawnSync(process.execPath, [script, ...args, '--root', dir, ...(driver ? ['--driver', driver] : [])], { encoding: 'utf8', env: e, timeout: 60000 })
  return { ...r, line: (r.stdout ?? '').split(/\r?\n/).find((l) => l.startsWith('BRAIN:')) ?? '', home }
}
const digest = (dir) => brain(dir, ['digest', '--run', 'run-fx', '--dry-run'], { uri: '' }).stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l))
const queueFiles = (home) => (existsSync(join(home, '.kit-brain', 'queue')) ? readdirSync(join(home, '.kit-brain', 'queue')) : [])
const stubLog = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])

test('digest: runs, plans and events from the fixture as JSON lines, minutes per phase from history[].at, the same _id on a second call', () => {
  const dir = project()
  try {
    const first = digest(dir)
    const second = digest(dir)
    assert.deepEqual(first, second, 'idempotent: a second call gives the same documents')
    const by = (c) => first.filter((x) => x.collection === c).map((x) => x.doc)
    assert.deepEqual(by('runs').map((d) => d._id), ['fx-app:run-fx:run:-'])
    assert.deepEqual(by('plans').map((d) => d._id).sort(), ['fx-app:run-fx:plan:701', 'fx-app:run-fx:plan:702'])
    const run = by('runs')[0]
    assert.deepEqual([run.project, run.kitVersion, run.kitCommit, run.schema, run.machine.length], ['fx-app', '1.13.0', 'abc123def456', 1, 8])
    assert.deepEqual(run.counts, { plans: 2, merged: 0, parked: 1, skipped: 1, fixRounds: 2, flakes: 1, decisions: 1, notes: 2 })
    assert.equal(run.minutes, 35)
    const p701 = by('plans').find((d) => d.nnn === '701')
    assert.deepEqual(p701.minutes, { readiness: 2, building: 13, gate: 7, checks: 8, ui: null, merge: null, finalGate: null, envPaused: null })
    const p702 = by('plans').find((d) => d.nnn === '702')
    assert.ok(Object.values(p702.minutes).every((m) => m === null), 'a phase with no timestamps is null')
    assert.equal(p701.attempts, 2, 'the earlier attempt counts')
    const kinds = by('events').map((d) => d.kind).sort()
    assert.deepEqual(kinds, ['flake', 'park', 'park', 'runner-retry', 'timeout'])
    for (const e of by('events')) assert.ok(e._id.startsWith('fx-app:run-fx:event:') && typeof e.signature === 'string' && e.signature, `${e.kind}: has a signature`)
    assert.ok(JSON.stringify(first).indexOf('"sentAt"') === -1, 'no wall-clock field: that is what keeps the ids and fields stable')
  } finally { gone(dir) }
})

test('signature: the same problem in two runs matches (path, number, hash, time, slot differ); two different problems do not', () => {
  const a = 'gate (main folder): node scripts/log-query.mjs --since=plan-start --level=error in C:\\work\\app-wt-1 (round 2) at 2026-10-29T10:00:00Z sha 9f3a7c21b'
  const b = 'gate (main folder): node scripts/log-query.mjs --since=plan-start --level=error in D:\\other\\app-wt-3 (round 3) at 2026-11-01T08:15:30Z sha 0ab4d99e1'
  assert.equal(lib.signature(a), lib.signature(b))
  assert.equal(lib.signature('park: wt-1 failed after 12 tries'), lib.signature('park: wt-3 failed after 7 tries'))
  assert.equal(lib.signature('cannot find "src/a.ts" (round 2)'), lib.signature('cannot find "lib/zz.ts" (round 5)'))
  assert.notEqual(lib.signature('gate: node scripts/log-query.mjs --level=error'), lib.signature('gate: node scripts/other-check.mjs --level=error'))
  assert.notEqual(lib.signature('timed out: npm run e2e'), lib.signature('env-fail rerun: npm run e2e'))
  assert.ok(lib.signature('x'.repeat(500)).length <= 120)
  // A secret in a park reason never reaches the signature (it is stored and compared across projects).
  const leaky = lib.signature(`gate failed: Bearer ${'t0kenvalue'.repeat(3)} and ${URI} and api_key="${'abcd1234'.repeat(2)}"`)
  assert.ok(!/t0kenvalue|writer:pw|abcd1234/.test(leaky), leaky)
  assert.match(leaky, /redacted/)
  assert.equal(lib.signature('src/app/x.ts failed'), '<p> failed', 'a relative path is a path')
  assert.equal(lib.signature('gate: node scripts/log-query.mjs --level=error'), 'gate: node scripts/log-query.mjs --level=error', 'the script a command runs names what failed and stays')
  assert.equal(lib.signature('either/or and/or'), 'either/or and/or', 'a slash in plain words is not a path')
  // Park reasons of the hardened checkers: the same problem in two runs matches whatever the sha, rounds or file.
  assert.equal(
    lib.signature('no progress: head 9f3a7c21b unchanged across 2 fix rounds (fix rounds used: 2 of 2)'),
    lib.signature('no progress: head 0ab4d99e1c22 unchanged across 3 fix rounds (fix rounds used: 3 of 5)'))
  assert.equal(
    lib.signature('replan needed: the scope lacks C:\\work\\app-wt-1\\src\\a.ts'),
    lib.signature('replan needed: the scope lacks D:\\other\\app-wt-3\\lib\\b.ts'))
  assert.equal(lib.signature('replan needed: the scope lacks src/app/a.ts'), lib.signature('replan needed: the scope lacks src/app/b.ts'))
  assert.equal(lib.signature('replan needed: the scope lacks src/a.ts:12'), lib.signature('replan needed: the scope lacks lib/z.ts:340'))
  assert.notEqual(lib.signature('replan needed: the scope lacks src/a.ts'), lib.signature('no progress: head 9f3a7c21b unchanged across 2 fix rounds'))
  assert.equal(lib.signature('failed in /home/u/proj/a/b.ts', {}), 'failed in <p>')
  assert.equal(lib.signature('failed in C:/work/app/x', { projectRoot: 'C:\\work\\app' }), 'failed in <p>/x', 'the project root is cut out')
})

test('redaction: keys, database strings and bearer tokens become [redacted:<pattern>]; a code fence or a diff hunk keeps its first line and [code cut]', () => {
  const key = `api_key="${'abcd1234'.repeat(2)}"`
  const out = lib.redact(`park: ${key} and ${URI} and Bearer ${'x'.repeat(24)} done`)
  assert.match(out, /\[redacted:generic-api-key\]/)
  assert.match(out, /\[redacted:mongo-uri-creds\]/)
  assert.match(out, /\[redacted:bearer-token\]/)
  assert.ok(!out.includes('abcd1234') && !out.includes('writer:pw') && !out.includes('xxxxxxxx'), out)
  const fenced = lib.redact(`before\n${FENCE}ts\nconst first = 1\nsecond()\n${FENCE}\nafter`)
  assert.equal(fenced, 'before\nconst first = 1 [code cut]\nafter')
  const hunk = lib.redact('note\n@@ -1,2 +1,3 @@ fn\n+added line\n-removed line\n\nlater text')
  assert.equal(hunk, 'note\n@@ -1,2 +1,3 @@ fn [code cut]\n\nlater text')
  assert.equal(lib.redact(`note\n${FENCE}\nfirst()\nsecond()`), 'note\nfirst() [code cut]', 'an unterminated fence is cut to the end')
  // Every string field of a document passes through it.
  const doc = lib.lessonDoc({ role: 'builder', title: 'T', text: `use ${key} here`, why: `${URI}` }, { root: tmpdir() })
  assert.ok(!JSON.stringify(doc).includes('abcd1234') && !JSON.stringify(doc).includes('writer:pw'))
})

test('pre-commit-secret-scan: importing it runs no git command and exports the patterns brain-doc redacts with; run directly it still blocks a staged secret', async () => {
  const scan = join(kit, 'core', 'scripts', 'pre-commit-secret-scan.mjs')
  const mod = await import(pathToFileURL(scan).href)
  assert.deepEqual(mod.PATTERNS.map((p) => p.name), ['aws-access-key', 'generic-api-key', 'bearer-token', 'private-key-block', 'google-api-key', 'mongo-uri-creds'])
  assert.deepEqual(lib.SECRET_PATTERNS.slice(0, 6).map((p) => p.name), mod.PATTERNS.map((p) => p.name), 'one list: brain-doc imports it')
  assert.ok(lib.SECRET_PATTERNS.every((p) => p.re.flags.includes('g')))
  const dir = tmp('scan')
  try {
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
    git('init', '--quiet')
    writeFileSync(join(dir, 'ok.js'), 'const a = 1\n')
    git('add', 'ok.js')
    assert.equal(spawnSync(process.execPath, [scan], { cwd: dir, encoding: 'utf8' }).status, 0, 'a clean staged file passes')
    writeFileSync(join(dir, 'bad.js'), `const k = { api_key: "${'abcd1234'.repeat(2)}" }\n`)
    git('add', 'bad.js')
    const r = spawnSync(process.execPath, [scan], { cwd: dir, encoding: 'utf8' })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /secret-scan: blocked bad\.js — matched pattern "generic-api-key"/)
    // The scan must not be skipped by how the script is named: a differently-cased path (Windows) or a symlink to it.
    if (process.platform === 'win32') {
      const cased = spawnSync(process.execPath, [scan.replace(/pre-commit-secret-scan/, 'PRE-COMMIT-SECRET-SCAN')], { cwd: dir, encoding: 'utf8' })
      assert.equal(cased.status, 1, `a differently-cased path still scans: ${cased.stderr}`)
    }
    const link = join(dir, 'scan-link.mjs')
    let linked = true
    try { symlinkSync(scan, link) } catch { linked = false } // no symlink right on this machine: skip this part
    if (linked) {
      const viaLink = spawnSync(process.execPath, [link], { cwd: dir, encoding: 'utf8' })
      assert.equal(viaLink.status, 1, `a symlink to the script still scans: ${viaLink.stderr}`)
    }
  } finally { gone(dir) }
})

test('send without KIT_BRAIN_URI: the documents are queued, the line says why, exit 0', () => {
  const dir = project()
  try {
    const n = digest(dir).length
    const r = brain(dir, ['send', '--run', 'run-fx'], { uri: '' })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.line, `BRAIN: queued ${n} (KIT_BRAIN_URI not set)`)
    assert.equal(queueFiles(r.home).length, n)
    const q = brain(dir, ['queue'], { uri: '' })
    assert.match(q.stdout, new RegExp(`BRAIN: ${n} queued`))
    // Under node --test without a named brain home the send is off: a test run never fills a developer's real queue.
    const e = { ...process.env }
    delete e.KIT_BRAIN_HOME
    const off = spawnSync(process.execPath, [script, 'send', '--run', 'run-fx', '--root', dir], { encoding: 'utf8', env: { ...e, NODE_TEST_CONTEXT: 'child-v8' } })
    assert.match(off.stdout, /^BRAIN: off \(under node --test/)
  } finally { gone(dir) }
})

test('send with a driver that throws: queued with the first error line, exit 0; a later good send drains the queue, oldest first', () => {
  const dir = project()
  try {
    const n = digest(dir).length
    const log = join(dir, 'stub.log')
    const failed = brain(dir, ['send', '--run', 'run-fx'], { env: { KIT_STUB_MODE: 'throw', KIT_STUB_LOG: log } })
    assert.equal(failed.status, 0)
    assert.equal(failed.line, `BRAIN: queued ${n} (connection refused)`)
    assert.equal(queueFiles(failed.home).length, n, 'nothing lost')
    // An older queued document (events) and the run's grade rows (new): the older one goes first.
    const qdir = join(failed.home, '.kit-brain', 'queue')
    for (const f of queueFiles(failed.home)) {
      const t = new Date(Date.now() - (f.includes(':event:') || f.includes('_event_') ? 3600e3 : 60e3))
      utimesSync(join(qdir, f), t, t)
    }
    const good = brain(dir, ['send', '--grades', '--run', 'run-fx'], { env: { KIT_STUB_LOG: log }, home: failed.home })
    assert.equal(good.status, 0)
    assert.equal(good.line, `BRAIN: sent 2, queue drained ${n}`)
    assert.deepEqual(queueFiles(failed.home), [])
    const inserts = stubLog(log).filter((x) => x.op === 'insertMany')
    assert.equal(inserts[0].collection, 'events', 'the oldest queued documents go first')
    assert.ok(inserts.every((x) => x.opts.ordered === false && x.db === 'kitbrain'))
    assert.deepEqual(stubLog(log).filter((x) => x.op === 'new').map((x) => x.opts.serverSelectionTimeoutMS), [10000, 10000])
  } finally { gone(dir) }
})

test('send: a duplicate-key error on a document counts as sent and leaves the queue', () => {
  const dir = project()
  try {
    const docs = digest(dir)
    const dupId = docs.find((d) => d.collection === 'plans').doc._id
    const queued = brain(dir, ['send', '--run', 'run-fx'], { uri: '' })
    const r = brain(dir, ['send', '--grades', '--run', 'run-fx'], { env: { KIT_STUB_MODE: 'dup', KIT_STUB_DUP: dupId }, home: queued.home })
    assert.equal(r.status, 0)
    // insertMany fails with E11000, then each document is tried alone: only the listed one is a duplicate, the rest insert.
    assert.equal(r.line, `BRAIN: sent 2, queue drained ${docs.length}`)
    assert.deepEqual(queueFiles(queued.home), [])
  } finally { gone(dir) }
})

test('send to a store that does not answer: queued after the time limit, exit 0, nothing hangs', () => {
  const dir = project()
  try {
    const t0 = Date.now()
    const r = brain(dir, ['send', '--run', 'run-fx'], { env: { KIT_STUB_MODE: 'hang', KIT_BRAIN_TIMEOUT_MS: '800' } })
    assert.equal(r.status, 0)
    assert.match(r.line, /^BRAIN: queued \d+ \(no answer within 1 s\)$/)
    assert.ok(Date.now() - t0 < 20000)
  } finally { gone(dir) }
})

test('the real driver is never loaded when a stub driver is named, or when the machine is not set up', () => {
  const dir = project()
  try {
    const home = join(dir, '.home')
    const marker = join(dir, 'real-driver-loaded')
    mkdirSync(join(home, '.kit-brain', 'node_modules', 'mongodb'), { recursive: true })
    writeFileSync(join(home, '.kit-brain', 'node_modules', 'mongodb', 'package.json'), '{"name":"mongodb","main":"index.js"}')
    writeFileSync(join(home, '.kit-brain', 'node_modules', 'mongodb', 'index.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'loaded'); exports.MongoClient = class {}`)
    brain(dir, ['send', '--run', 'run-fx'], { home })
    brain(dir, ['send', '--run', 'run-fx'], { home, uri: '' })
    brain(dir, ['send', '--grades', '--run', 'run-fx'], { home, driver: '' }) // no stub: this one may load it
    assert.equal(existsSync(marker), true, 'without a stub the driver comes from <home>/.kit-brain/node_modules/mongodb')
    rmSync(marker)
    brain(dir, ['send', '--run', 'run-fx'], { home })
    brain(dir, ['check'], { home })
    brain(dir, ['backfill'], { home })
    assert.equal(existsSync(marker), false, 'with --driver the real driver is not touched')
  } finally { gone(dir) }
})

test('send --toil and --lesson-file: the Planner\'s by-hand lines (at most 8) and one lesson, redacted', () => {
  const dir = project()
  try {
    const log = join(dir, 'stub.log')
    const none = brain(dir, ['send', '--toil', '--run', 'run-fx'])
    assert.match(none.line, /nothing to send/)
    mkdirSync(join(dir, '.claude', 'sessions'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'sessions', 'toil-run-fx.json'), JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ step: `fix manifest ${i}`, minutes: 5, script: i % 2 ? 'yes' : 'no' }))))
    const toil = brain(dir, ['send', '--toil', '--run', 'run-fx'], { env: { KIT_STUB_LOG: log } })
    assert.equal(toil.line, 'BRAIN: sent 8, queue drained 0')
    assert.equal(stubLog(log).find((x) => x.op === 'insertMany').collection, 'toil')
    const lessonFile = join(dir, 'lesson.json')
    writeFileSync(lessonFile, JSON.stringify({ role: 'builder', title: 'Read the receipt', text: `A general lesson ${'x'.repeat(5)}`, why: 'it repeated' }))
    const l = brain(dir, ['send', '--lesson-file', lessonFile], { env: { KIT_STUB_LOG: log } })
    assert.equal(l.line, 'BRAIN: sent 1, queue drained 0')
    assert.equal(stubLog(log).filter((x) => x.op === 'insertMany').pop().collection, 'lessonsIn')
    const bad = brain(dir, ['send', '--lesson-file', join(dir, 'nope.json')])
    assert.equal(bad.status, 2)
  } finally { gone(dir) }
})

test('send with brain.enabled false does nothing', () => {
  const dir = project()
  try {
    writeFileSync(join(dir, '.kit', 'config.json'), JSON.stringify({ brain: { enabled: false } }))
    const r = brain(dir, ['send', '--run', 'run-fx'], { uri: '' })
    assert.equal(r.line, 'BRAIN: off (brain.enabled is false)')
    assert.deepEqual(queueFiles(r.home), [])
  } finally { gone(dir) }
})

test('backfill: every status.json of the project once (dry run lists them), the grade rows too; ids are the same each time', () => {
  const dir = project({ runs: ['run-fx', 'run-fy'] })
  try {
    const dry = brain(dir, ['backfill', '--dry-run'], { uri: '' })
    assert.match(dry.stdout, /2 run\(s\)/)
    assert.ok(dry.stdout.includes('run-fx') && dry.stdout.includes('run-fy'))
    assert.deepEqual(queueFiles(dry.home), [], 'a dry run sends and queues nothing')
    const log = join(dir, 'stub.log')
    const per = brain(dir, ['digest', '--run', 'run-fy', '--dry-run'], { uri: '' }).stdout.split('\n').filter(Boolean).length
    const r = brain(dir, ['backfill'], { env: { KIT_STUB_LOG: log } })
    assert.equal(r.line, `BRAIN: sent ${per * 2 + 3}, queue drained 0`, '2 runs of the same shape + the 3 grade rows')
    const again = brain(dir, ['backfill'], { env: { KIT_STUB_LOG: log, KIT_STUB_MODE: 'dup', KIT_STUB_DUP: 'fx-app:run-fx:run:-' }, home: r.home })
    assert.equal(again.status, 0)
    const ids = stubLog(log).filter((x) => x.op === 'insertMany').flatMap((x) => x.ids)
    assert.equal(ids.length, per * 2 + 3 + per * 2 + 3)
    assert.deepEqual(ids.slice(0, ids.length / 2).sort(), ids.slice(ids.length / 2).sort(), 'the same _ids both times')
  } finally { gone(dir) }
})

test('check: insert allowed and read denied is ok; a user that can read is a WARN; no string or a failing store is a failure', () => {
  const dir = project()
  try {
    const log = join(dir, 'stub.log')
    const ok = brain(dir, ['check'], { env: { KIT_STUB_LOG: log } })
    assert.equal(ok.status, 0)
    assert.equal(ok.line, 'BRAIN: ok — reachable, insert allowed, read denied')
    const ins = stubLog(log).find((x) => x.op === 'insertOne')
    assert.equal(ins.collection, 'events')
    assert.ok(stubLog(log).some((x) => x.op === 'find'), 'least privilege is checked, not assumed')
    const warn = brain(dir, ['check'], { env: { KIT_STUB_CAN_READ: '1' } })
    assert.match(warn.line, /^BRAIN: WARN — this user can read/)
    assert.equal(brain(dir, ['check'], { uri: '' }).status, 1)
    const down = brain(dir, ['check'], { env: { KIT_STUB_MODE: 'throw' } })
    assert.equal(down.status, 1)
    assert.match(down.line, /^BRAIN: FAIL — connection refused$/)
  } finally { gone(dir) }
})

test('setup prints the install command first and touches no project folder (dry run)', () => {
  const dir = project()
  try {
    const r = brain(dir, ['setup', '--dry-run'], { uri: '' })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /npm install --prefix .*\.kit-brain mongodb@6 --no-audit --no-fund/)
    assert.deepEqual(readdirSync(dir).sort(), ['.claude', '.home', '.kit', 'docs'])
  } finally { gone(dir) }
})

test('bad arguments exit 2', () => {
  const dir = project()
  try {
    assert.equal(brain(dir, ['send']).status, 2)
    assert.equal(brain(dir, ['nonsense']).status, 2)
    assert.equal(brain(dir, ['digest']).status, 2)
  } finally { gone(dir) }
})

test('trend --by kitVersion: one row per version from a stub reader; tokens are "-" when no run had them', () => {
  const runs = [
    { kitVersion: '1.12.0', project: 'a', counts: { plans: 4, parked: 1, fixRounds: 2, flakes: 0, decisions: 8 }, minutes: 80, tokens: null },
    { kitVersion: '1.12.0', project: 'b', counts: { plans: 2, parked: 0, fixRounds: 0, flakes: 2, decisions: 2 }, minutes: 40, tokens: null },
    { kitVersion: '1.13.0', project: 'a', counts: { plans: 3, parked: 0, fixRounds: 1, flakes: 0, decisions: 3 }, minutes: 45, tokens: { total: { input: 1000, output: 500, cacheRead: 1000, cacheCreation: 500 } } },
  ]
  const grades = [{ kitVersion: '1.12.0', humanVerdict: '✗' }, { kitVersion: '1.12.0', humanVerdict: 'ok' }, { kitVersion: '1.12.0', humanVerdict: '✗' }, { kitVersion: '1.13.0', humanVerdict: '✗' }]
  const rows = query.trendRows(runs, grades, 'kitVersion')
  assert.deepEqual(rows[0], { kitVersion: '1.12.0', runs: 2, plans: 6, parkedPerRun: 0.5, fixRoundsPerPlan: 0.3, minutesPerPlan: 20, decisionsPerPlan: 1.7, wrongPerPlan: 0.3, flakesPerRun: 1, tokensPerPlan: null })
  assert.deepEqual(rows[1], { kitVersion: '1.13.0', runs: 1, plans: 3, parkedPerRun: 0, fixRoundsPerPlan: 0.3, minutesPerPlan: 15, decisionsPerPlan: 1, wrongPerPlan: 0.3, flakesPerRun: 0, tokensPerPlan: 1000 })
  const dir = tmp('reader')
  try {
    const data = join(dir, 'data.json')
    writeFileSync(data, JSON.stringify({ runs, grades, plans: [], events: [] }))
    const cli = (args, env = {}) => spawnSync(process.execPath, [join(kit, 'tools', 'brain-query.mjs'), ...args, '--driver', join(fixture, 'reader-driver.mjs')], { encoding: 'utf8', env: { ...process.env, KIT_BRAIN_READER_URI: URI, KIT_STUB_DATA: data, ...env } })
    const t = cli(['trend', '--by', 'kitVersion'])
    assert.equal(t.status, 0, t.stderr)
    const lines = t.stdout.trim().split('\n')
    assert.equal(lines.length, 4)
    assert.match(lines[0], /kitVersion \| runs \| plans \| parked\/run \| fix rounds\/plan \| min\/plan \| decisions\/plan \| ✗\/plan \| flakes\/run \| tokens\/plan/)
    assert.equal(lines[2], '| 1.12.0 | 2 | 6 | 0.5 | 0.3 | 20 | 1.7 | 0.3 | 1 | - |')
    assert.equal(cli(['trend', '--by', 'colour']).status, 2)
    const noUri = cli(['trend', '--by', 'project'], { KIT_BRAIN_READER_URI: '' })
    assert.equal(noUri.status, 1)
    assert.match(noUri.stderr, /KIT_BRAIN_READER_URI is not set/)
  } finally { gone(dir) }
})

test('brain-query runs shows minutes per phase; events groups by signature across projects', () => {
  const dir = tmp('reader2')
  try {
    const run = { project: 'a', run: 'run-fx', kitVersion: '1.13.0', startedAt: '2026-10-29T10:00:00Z', minutes: 35, counts: { plans: 1, parked: 1, fixRounds: 2 } }
    const plans = [{ project: 'a', run: 'run-fx', nnn: '701', state: 'parked', minutes: { readiness: 2, building: 13, gate: 7, checks: 8, ui: null, merge: null } }]
    const ev = (project, run2, at) => ({ project, run: run2, kind: 'park', signature: 'gate: node scripts/log-query.mjs', at })
    const events = [ev('a', 'r1', '2026-10-01T00:00:00Z'), ev('b', 'r2', '2026-10-02T00:00:00Z'), ev('b', 'r3', '2026-09-01T00:00:00Z'), { project: 'a', run: 'r1', kind: 'setup-check', signature: 'x', at: '2026-10-01T00:00:00Z' }]
    const data = join(dir, 'data.json')
    writeFileSync(data, JSON.stringify({ runs: [run], plans, grades: [], events }))
    const cli = (args) => spawnSync(process.execPath, [join(kit, 'tools', 'brain-query.mjs'), ...args, '--driver', join(fixture, 'reader-driver.mjs')], { encoding: 'utf8', env: { ...process.env, KIT_BRAIN_READER_URI: URI, KIT_STUB_DATA: data } })
    const r = cli(['runs', '--last', '3'])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /run-fx \(a, kit 1\.13\.0, 2026-10-29T10:00\) 35 min · 1 plans · 1 parked · 2 fix rounds/)
    assert.match(r.stdout, /701 parked — readiness 2 · building 13 · gate 7 · checks 8 · ui - · merge -/)
    const e = cli(['events', '--kind', 'park', '--since', '2026-09-15'])
    assert.match(e.stdout, /^2× park — gate: node scripts\/log-query\.mjs \(a, b; 2 run\(s\)\)$/m)
    assert.ok(!/setup-check/.test(e.stdout))
  } finally { gone(dir) }
})

test('brain.* config: a connection string is refused whatever the key, projectId must be a slug, enabled a boolean', () => {
  assert.deepEqual(brainProblems({ 'brain.projectId': 'my-app', 'brain.enabled': true }), [])
  assert.deepEqual(brainProblems({ 'brain.projectId': '', 'brain.enabled': false }), [])
  assert.deepEqual(brainProblems({}), [])
  assert.deepEqual(brainProblems({ 'brain.uri': URI }), ['brain.uri is not a config key — the connection string lives in KIT_BRAIN_URI'])
  assert.deepEqual(brainProblems({ 'brain.note': `mongodb://h:1/db` }), ['brain.note is not a config key — the connection string lives in KIT_BRAIN_URI'])
  assert.match(brainProblems({ 'brain.projectId': 'My App' })[0], /brain\.projectId is "My App" — it must be a short slug/)
  assert.match(brainProblems({ 'brain.enabled': 'yes' })[0], /brain\.enabled is "yes" — it must be true or false/)
})

// ---- B11: tokens from the workflow transcripts ---------------------------------------------------------------------------

/** A transcript home with one workflow folder: agents with a workflowPhase, assistant lines with usage (one message twice). */
function transcripts(root, { phase = 'Build', meta = true, when = new Date('2026-10-29T10:20:00Z') } = {}) {
  const home = tmp('transcripts')
  const wf = join(lib.transcriptDir(root, home), 'sess-1', 'subagents', 'workflows', 'wf_abc')
  mkdirSync(wf, { recursive: true })
  const line = (id, i, o, cr, cc) => JSON.stringify({ type: 'assistant', uuid: `u-${id}`, message: { id, usage: { input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cc } } })
  const agent = (name, ph, type, lines) => {
    writeFileSync(join(wf, `${name}.jsonl`), `${lines.join('\n')}\n{"type":"user"}\n`)
    const m = { description: 'free text we never read', workflowPhase: ph }
    if (type !== undefined) m.agentType = type
    if (meta) writeFileSync(join(wf, `${name}.meta.json`), JSON.stringify(m))
    utimesSync(join(wf, `${name}.jsonl`), when, when)
  }
  agent('agent-a1', phase, 'orch-builder', [line('m1', 10, 5, 100, 50), line('m1', 10, 5, 100, 50), line('m2', 1, 2, 3, 4)])
  agent('agent-a2', 'Readiness', 'workflow-subagent', [line('m3', 7, 7, 7, 7)])
  agent('agent-a3', phase, 'orch-gate', [line('m4', 2, 2, 2, 2)])
  agent('agent-a4', phase, undefined, [line('m5', 3, 3, 3, 3)])
  return home
}

test('tokens: summed per workflowPhase (a message id counts once), mixed phases are marked, description is never read', () => {
  const root = join(tmpdir(), 'brain-tok-proj')
  const home = transcripts(root)
  try {
    const t = lib.tokensForRun({ root, startedAt: '2026-10-29T10:00:00.000Z', finishedAt: '2026-10-29T10:35:00.000Z', home })
    assert.equal(t.note, null)
    assert.deepEqual(t.tokens.byPhase.Build, { input: 16, output: 12, cacheRead: 108, cacheCreation: 59, agents: 3, roles: ['orch-builder', 'orch-gate'], fallback: 1, mixedRoles: true })
    assert.equal(t.tokens.byPhase.Readiness.input, 7)
    assert.equal(t.tokens.byPhase.Readiness.mixedRoles, true, 'a generic agent in a phase the kit lists with several roles: mixed, and not given a guessed role')
    // The role is the meta file's agentType; "workflow-subagent" or no agentType falls back to the phase, never to description.
    assert.deepEqual(Object.keys(t.tokens.byRole).sort(), ['orch-builder', 'orch-gate', 'phase:Build', 'phase:Readiness'])
    assert.deepEqual(t.tokens.byRole['orch-builder'], { input: 11, output: 7, cacheRead: 103, cacheCreation: 54, agents: 1, phases: ['Build'] })
    assert.deepEqual(t.tokens.byRole['phase:Build'], { input: 3, output: 3, cacheRead: 3, cacheCreation: 3, agents: 1, phases: ['Build'] })
    assert.deepEqual(t.tokens.total, { input: 23, output: 19, cacheRead: 115, cacheCreation: 66, agents: 4 })
    const odd = transcripts(root, { phase: 'Something New' })
    const u = lib.tokensForRun({ root, startedAt: '2026-10-29T10:00:00.000Z', finishedAt: '2026-10-29T10:35:00.000Z', home: odd })
    assert.deepEqual(u.tokens.byPhase['Something New'].roles, ['orch-builder', 'orch-gate'], 'a phase the kit does not know still splits by agentType')
    gone(odd)
  } finally { gone(home) }
})

test('tokens: any shape it does not know, no folder or another time window gives null with a note, never a throw', () => {
  const root = join(tmpdir(), 'brain-tok-proj2')
  const window = { startedAt: '2026-10-29T10:00:00.000Z', finishedAt: '2026-10-29T10:35:00.000Z' }
  const noMeta = transcripts(root, { meta: false })
  const late = transcripts(root, { when: new Date('2026-11-05T10:00:00Z') })
  const empty = tmp('transcripts-empty')
  try {
    assert.match(lib.tokensForRun({ root, ...window, home: noMeta }).note, /no workflowPhase — format not recognised/)
    assert.equal(lib.tokensForRun({ root, ...window, home: noMeta }).tokens, null)
    assert.match(lib.tokensForRun({ root, ...window, home: late }).note, /no workflow transcripts for this run/)
    assert.match(lib.tokensForRun({ root, ...window, home: empty }).note, /no transcript folder/)
    assert.match(lib.tokensForRun({ root, startedAt: 'x', finishedAt: 'y', home: empty }).note, /no start or finish time/)
    assert.equal(lib.tokensForRun({ root, ...window, home: join(empty, 'missing') }).tokens, null)
  } finally { gone(noMeta, late, empty) }
})
