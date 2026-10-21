// plan-order, the shared dependency parser and scope-check --deps (plan 011), on fixture plans in scratch folders.
//   node --test tools/test/plan-order.test.mjs
// Runs the installed scripts of the kit repo (scripts/, after `node tools/sync.mjs --target . --apply` and
// `npm ci` inside scripts/). PLAN_ORDER_ROOT=<project> runs another installed copy instead (tools/e2e-check.mjs
// points it at its fresh e2e project, whose scripts/ dependencies are installed).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const project = process.env.PLAN_ORDER_ROOT ? resolve(process.env.PLAN_ORDER_ROOT) : kit
const script = (name) => join(project, 'scripts', name)
const lib = (name) => import(pathToFileURL(join(project, 'scripts', 'lib', name)).href)

const scratch = []
after(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true })
})

function plan(nnn, { title = `Plan ${nnn} fixture`, header = '', body = '', scope = [`src/p${nnn}/**`] } = {}) {
  return [
    `# Plan ${nnn} — ${title}`, '', 'Status: draft', header, '',
    '## Prerequisites', body || '- none.', '',
    '## Read-Write Scope', '', '```scope', ...scope, '```', '',
    '## Atomic Sub-tasks', `- [ ] T1: Do the work of plan ${nnn} — src`, '',
  ].join('\n')
}

// A scratch project: { '001': {header: 'Depends-on: none'}, ... } -> <dir>/plans/NNN-pNNN.plan.md
function fixture(plans, { git = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'plan-order-'))
  scratch.push(dir)
  mkdirSync(join(dir, 'plans'), { recursive: true })
  for (const [nnn, opts] of Object.entries(plans)) writeFileSync(join(dir, 'plans', `${nnn}-p${nnn}.plan.md`), plan(nnn, opts))
  if (git) gitIn(dir, 'init', '-q', '-b', 'main')
  return dir
}

function gitIn(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=plan-order-test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}

function order(dir, ...args) {
  const r = spawnSync(process.execPath, [script('plan-order.mjs'), '--root', dir, ...args], { encoding: 'utf8' })
  return { status: r.status, out: r.stdout, err: r.stderr, all: `${r.stdout}${r.stderr}` }
}

function orderJson(dir, ...args) {
  const r = order(dir, '--json', ...args)
  assert.equal(r.status, 0, r.all)
  return JSON.parse(r.out)
}

test('chain A -> B -> C gives 3 waves and one lane', () => {
  const dir = fixture({ '001': { header: 'Depends-on: none' }, '002': { header: 'Depends-on: 001' }, '003': { header: 'Depends-on: 002' } })
  const o = orderJson(dir)
  assert.deepEqual(o.waves, [['001'], ['002'], ['003']])
  assert.deepEqual(o.lanes, [['001', '002', '003']])
  const text = order(dir)
  assert.equal(text.status, 0, text.all)
  assert.match(text.out, /^WAVE 1: 001$/m)
  assert.match(text.out, /^WAVE 3: 003$/m)
})

test('diamond A -> B, A -> C, B+C -> D gives waves [A] [B,C] [D]; --json carries waves, lanes, conflicts, edges with reasons', () => {
  const dir = fixture({
    '001': { header: 'Depends-on: none' },
    '002': { header: 'Depends-on: 001' },
    '003': { header: 'Depends-on: 001' },
    '004': { header: 'Depends-on: 002, 003' },
  })
  const o = orderJson(dir, '001', '002', '003', '004')
  for (const key of ['waves', 'lanes', 'conflicts', 'edges']) assert.ok(key in o, `--json has ${key}`)
  assert.deepEqual(o.waves, [['001'], ['002', '003'], ['004']])
  assert.equal(o.lanes.flat().sort().join(','), '001,002,003,004')
  assert.deepEqual(o.conflicts, [])
  assert.equal(o.edges.length, 4)
  for (const e of o.edges) assert.match(e.reason, /^(Depends-on:|prose prerequisite|scope overlap: .+)$/)
  assert.deepEqual(o.edges.map((e) => `${e.from}>${e.to}`).sort(), ['001>002', '001>003', '002>004', '003>004'])
})

test('a cycle exits 1 and names the plans in it', () => {
  const dir = fixture({ '001': { header: 'Depends-on: 003' }, '002': { header: 'Depends-on: 001' }, '003': { header: 'Depends-on: 002' }, '004': { header: 'Depends-on: none' } })
  const r = order(dir)
  assert.equal(r.status, 1, r.all)
  const line = r.err.split(/\r?\n/).find((l) => l.startsWith('CYCLE: '))
  assert.ok(line, r.all)
  for (const n of ['001', '002', '003']) assert.ok(line.includes(n), line)
  assert.ok(!line.includes('004'), line)
  const j = order(dir, '--json')
  assert.equal(j.status, 1)
  assert.equal(JSON.parse(j.out).error, 'cycle')
})

test('a conflict pair (overlapping scope, no dependency) is one wave and one lock group', () => {
  const dir = fixture({
    '001': { header: 'Depends-on: none', scope: ['core/scripts/scope-check.mjs', 'src/a/**'] },
    '002': { header: 'Depends-on: none', scope: ['core/scripts/**', 'src/b/**'] },
    '003': { header: 'Depends-on: none', scope: ['src/c/**'] },
  })
  const o = orderJson(dir)
  assert.deepEqual(o.waves, [['001', '002', '003']])
  assert.deepEqual(o.conflicts, [{ plans: ['001', '002'], globs: ['core/scripts/scope-check.mjs'] }])
  const lock = o.edges.filter((e) => e.lock)
  assert.equal(lock.length, 1)
  assert.equal(lock[0].reason, 'scope overlap: core/scripts/scope-check.mjs')
  assert.match(order(dir).out, /^WAVE 1: 001, 002, 003 \(lock group: core\/scripts\/scope-check\.mjs\)$/m)
})

test('plans with a dependency between them are never a lock group, even with the same scope', () => {
  const dir = fixture({ '001': { header: 'Depends-on: none', scope: ['x.mjs'] }, '002': { header: 'Depends-on: 001', scope: ['x.mjs'] } })
  assert.deepEqual(orderJson(dir).conflicts, [])
})

test('the config hotspots and append-only files are left out of the overlap', async () => {
  const { computeOrder, scopeWithoutHotspots } = await lib('plan-graph.mjs')
  const plans = [
    { nnn: '001', deps: [], scope: ['src/locales/en.json', 'CHANGELOG.md', 'src/a.ts'] },
    { nnn: '002', deps: [], scope: ['src/locales/**', 'CHANGELOG.md', 'src/b.ts'] },
  ]
  const withHot = computeOrder({ plans, hotspots: ['src/locales/', 'CHANGELOG.md'] })
  assert.equal(withHot.ok, true)
  assert.deepEqual(withHot.conflicts, [])
  const without = computeOrder({ plans })
  assert.deepEqual(without.conflicts.map((c) => c.plans), [['001', '002']])
  assert.deepEqual(scopeWithoutHotspots(['src/locales/**', 'a.ts'], ['src/locales/']), ['a.ts'])
})

test('a missing dependency exits 1 and names the plan and the file it expected', () => {
  const dir = fixture({ '001': { header: 'Depends-on: 099' } })
  const r = order(dir)
  assert.equal(r.status, 1, r.all)
  assert.match(r.err, /MISSING: plan 001 depends on 099 \(Depends-on:\), expected plans\/099-\*\.plan\.md/)
})

test('a closed dependency (moved to a range folder) is met', () => {
  const dir = fixture({ '002': { header: 'Depends-on: 001' } })
  mkdirSync(join(dir, 'plans', '1-100'), { recursive: true })
  writeFileSync(join(dir, 'plans', '1-100', '001-p001.plan.md'), plan('001').replace('Status: draft', 'Status: done'))
  const o = orderJson(dir)
  assert.deepEqual(o.waves, [['002']])
  assert.match(o.done['001'], /^closed: plans\/1-100\/001-p001\.plan\.md$/)
})

test('a prose-only old plan ("Prerequisite: plan 007 merged") is read as a dependency', () => {
  const dir = fixture({ '007': { header: '' }, '008': { header: '', body: '- Prerequisite: plan 007 merged.' } })
  const o = orderJson(dir)
  assert.deepEqual(o.waves, [['007'], ['008']])
  assert.deepEqual(o.edges, [{ from: '007', to: '008', reason: 'prose prerequisite' }])
})

test('the shared parser: Depends-on line, none, prose, self', async () => {
  const d = await lib('plan-deps.mjs')
  assert.equal(d.parseDependsOn('# Plan 1\nStatus: draft\n'), null)
  assert.deepEqual(d.parseDependsOn('Depends-on: none\n'), [])
  assert.deepEqual(d.parseDependsOn('Depends-on: 7, #12, plan 13 (the API)\n'), ['007', '012', '013'])
  assert.deepEqual(d.parseProsePrerequisites('- Prerequisites: plans 7, 12 (both merged).\nThis must run after plan 3.\n').sort(), ['003', '007', '012'])
  const both = d.planDependencies('Depends-on: 005\n- Prerequisite: plan 005 merged; plan 006 too\n- Prerequisite: plan 009\n', '009')
  assert.equal(both.declared, true)
  assert.deepEqual(both.deps, [{ nnn: '005', reason: 'Depends-on:' }])
  assert.equal(d.planTitle('# Plan 011 — Plans Declare Dependencies\n'), 'Plans Declare Dependencies')
})

test('merged on an integration branch: only the anchored merge subject counts', () => {
  const dir = fixture({ '011': { header: 'Depends-on: none' }, '012': { header: 'Depends-on: 011' } }, { git: true })
  gitIn(dir, 'add', '-A')
  gitIn(dir, 'commit', '-q', '-m', 'plan(011,012): fixtures')
  gitIn(dir, 'switch', '-q', '-c', 'orch/x')
  for (const subject of [
    'feat(011): plan 011 work',
    'Merge feat/011-x into orch/x (plan 0110)',
    'Merge feat/011-x into orch/y (plan 011)',
    'Merge feat/011-x into orch/x (plan 011) and more',
    'note: Merge feat/011-x into orch/x (plan 011)',
  ]) gitIn(dir, 'commit', '-q', '--allow-empty', '-m', subject)
  const before = orderJson(dir, '--branch', 'orch/x', '--merged-from', 'git')
  assert.deepEqual(before.waves, [['011'], ['012']], 'no loose subject marks plan 011 merged')

  gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'Merge feat/011-x into orch/x (plan 011)')
  const afterMerge = orderJson(dir, '--branch', 'orch/x', '--merged-from', 'git')
  assert.deepEqual(afterMerge.waves, [['012']])
  assert.deepEqual(afterMerge.skipped, ['011'])
  assert.equal(afterMerge.done['011'], 'merged into orch/x')
  assert.deepEqual(orderJson(dir, '012', '--branch=orch/x', '--merged-from=git').waves, [['012']])
})

test('mergedPlansFromSubjects keeps the plan number exactly as written', async () => {
  const { mergedPlansFromSubjects } = await lib('plan-deps.mjs')
  const got = mergedPlansFromSubjects(['Merge feat/011-x into orch/x (plan 011)', 'Merge feat/0110-x into orch/x (plan 0110)', 'Merge a into orch/x (plan 012)\r'], 'orch/x')
  assert.deepEqual([...got].sort(), ['0110', '011', '012'].sort())
  assert.ok(!got.has('110'))
})

test('scope-check --deps: missing without a Depends-on line, ok with one (none counts)', () => {
  const dir = fixture({ '001': { header: '' }, '002': { header: 'Depends-on: none' }, '003': { header: 'Depends-on: 001, 002' } })
  const deps = (nnn) => spawnSync(process.execPath, [script('scope-check.mjs'), '--deps', `--plan=${join(dir, 'plans', `${nnn}-p${nnn}.plan.md`).replace(/\\/g, '/')}`], { encoding: 'utf8' })
  const missing = deps('001')
  assert.equal(missing.status, 1, missing.stdout + missing.stderr)
  assert.match(missing.stdout, /^DEPENDS_ON: missing$/m)
  const none = deps('002')
  assert.equal(none.status, 0, none.stdout + none.stderr)
  assert.match(none.stdout, /^DEPENDS_ON: ok/m)
  const some = deps('003')
  assert.equal(some.status, 0)
  assert.match(some.stdout, /^DEPENDS_ON: ok \(001, 002\)$/m)
})
