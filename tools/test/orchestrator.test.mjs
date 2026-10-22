// Unit tests for the orchestrator's pure rules (scripts/lib/orch-run.mjs, installed) and the orchestrator.* config
// validation (tools/lib/kit.mjs). ORCH_ROOT = an installed project (default: this repo, the kit installed into itself).
// The end-to-end run is tools/orchestrator-e2e.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve, basename } from 'path'
import { spawnSync, spawn } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, utimesSync, readdirSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { pathToFileURL, fileURLToPath } from 'url'
import { orchestratorProblems, commandProblems } from '../lib/kit.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit
const lib = await import(pathToFileURL(join(root, 'scripts', 'lib', 'orch-run.mjs')).href)

test('run names: lower-case words with dashes only', () => {
  assert.equal(lib.runNameProblem('batch-1'), null)
  for (const bad of ['', 'Batch', 'a b', '../x', 'x/y', '-x', 'a'.repeat(41)]) assert.match(lib.runNameProblem(bad), /run name/)
})

test('plan branch: feat/NNN- and the first four slug words', () => {
  assert.equal(lib.planBranch('plans/451-add-the-new-parser-and-tests.plan.md', '451'), 'feat/451-add-the-new-parser')
  assert.equal(lib.planBranch('plans\\design\\012-x.plan.md', '012'), 'feat/012-x')
})

test('start tier: judgment only when Architecture Impact names an invariant other than INV-none', () => {
  const plan = (lines) => `# Plan\n\n## Architecture Impact\n${lines}\n\n## Next\n`
  assert.deepEqual(lib.startTier(plan('- INV-none: preserves — nothing')), { tier: 'build', invariants: [] })
  assert.deepEqual(lib.startTier(plan('- INV-3: preserves — touches it\n- INV-none: preserves')), { tier: 'judgment', invariants: ['INV-3'] })
  assert.deepEqual(lib.startTier('# Plan with no section'), { tier: 'build', invariants: [] })
})

test('[human] items are read verbatim, [auto] ones are not', () => {
  const t = '- [auto] node x.mjs exits 0\n- [human] Open the page and see "Saved"\n  - [ ] [human] Second one\n'
  assert.deepEqual(lib.humanItems(t), ['Open the page and see "Saved"', 'Second one'])
})

test('free disk in GB from statfs', () => {
  assert.equal(lib.freeGb({ bavail: 2_500_000, bsize: 4096 }), 10.2)
})

test('the report: counts from git merges, main untouched, the Human items and the PowerShell lines', () => {
  const status = {
    run: 'r1', startedAt: 'T0', mainShaAtStart: 'aaaaaaa1',
    plans: {
      '001': { nnn: '001', title: 'One', state: 'merging', round: 1, tier: 'build', humanItems: ['Check the page'], models: { 'orch-builder': { model: 'sonnet', effort: 'medium' } } },
      '002': { nnn: '002', title: 'Two', state: 'parked', round: 2, reason: 'gate: npm run test (fix rounds used: 2 of 2)', models: {} },
      '003': { nnn: '003', title: 'Three', state: 'skipped', reason: 'not started' },
    },
    notes: [{ plan: '001', text: 'kept the old flag' }],
  }
  const r = lib.formatReport({ status, merged: [{ nnn: '001', branch: 'feat/001-one', sha: 'bbbbbbb2' }], mainShaNow: 'aaaaaaa1', finishedAt: 'T1', runBranch: 'orch/r1', mainBranch: 'main' })
  assert.match(r, /Result: 1 merged, 2 parked, skipped or left out, 3 in the run/)
  assert.match(r, /`main` untouched: yes/)
  assert.match(r, /\| 001 One \| merged \| 1 \| build \| bbbbbbb \|/)
  assert.match(r, /- 001: kept the old flag/)
  assert.ok(r.includes("### The plans' [human] items (no UI check ran)\n\n1. 001 One: Check the page"), r)
  assert.match(r, /- Decide on 002: gate: npm run test/)
  assert.match(r, /gh pr create --base main --head orch\/r1/)
  const moved = lib.formatReport({ status, merged: [], mainShaNow: 'ccccccc3', finishedAt: 'T1', runBranch: 'orch/r1', mainBranch: 'main' })
  assert.match(moved, /`main` untouched: NO/)
})

test('the report: one validation list grouped by page with the UI evidence, numbers running on', () => {
  const plans = [
    { nnn: '001', title: 'One', humanItems: ['Open the app'], uiCards: [
      { card: 'Save stores the name', status: 'pass', page: 'https://app.example/settings', screenshots: ['shots/1.png'], round: 0 },
      { card: 'Home shows the list', status: 'pass', page: 'https://app.example/', screenshots: [], round: 1 },
    ] },
    { nnn: '002', title: 'Two', humanItems: [], uiCards: [{ card: 'Delete asks first', status: 'pass', page: 'https://app.example/settings', screenshots: ['shots/2.png'], round: 0 }] },
  ]
  const out = lib.validationList(plans)
  const at = (l) => out.indexOf(l)
  assert.ok(at('### https://app.example/settings') === 0, out.join(' | '))
  assert.equal(out[2], '| # | Card | Verdict | Screenshot |')
  assert.equal(out[4], '| 1 | 001: Save stores the name | pass — browser, round 0 | [![Save stores the name](shots/1.png)](shots/1.png) |')
  assert.equal(out[5], '| 2 | 002: Delete asks first | pass — browser, round 0 | [![Delete asks first](shots/2.png)](shots/2.png) |')
  assert.equal(out[at('### https://app.example/') + 4], '| 3 | 001: Home shows the list | pass — browser, round 1 | no screenshot |')
  assert.equal(out[at("### Not checked by the run — the plans' [human] items") + 2], '4. 001 One: Open the app')
  assert.deepEqual(lib.validationList([{ nnn: '003', humanItems: [] }]), ['- nothing to validate', ''])
})

test('orchestrator.* config: defaults pass, bad values name the key', () => {
  const ok = { 'orchestrator.runBranchPrefix': 'orch/', 'orchestrator.maxFixRounds': 2, 'orchestrator.minFreeDiskGb': 5, 'git.mainBranch': 'main' }
  assert.deepEqual(orchestratorProblems(ok), [])
  assert.deepEqual(orchestratorProblems({ ...ok, 'orchestrator.runBranchPrefix': 'runs/batch/' }), [])
  const bad = (k, v) => orchestratorProblems({ ...ok, [k]: v })
  assert.match(bad('orchestrator.runBranchPrefix', 'orch')[0], /^orchestrator\.runBranchPrefix is "orch"/)
  assert.match(bad('orchestrator.runBranchPrefix', 'main/')[0], /not the main branch/)
  assert.match(bad('orchestrator.runBranchPrefix', 'a..b/')[0], /^orchestrator\.runBranchPrefix/)
  assert.match(bad('orchestrator.maxFixRounds', 6)[0], /^orchestrator\.maxFixRounds is 6/)
  assert.match(bad('orchestrator.maxFixRounds', 1.5)[0], /whole number/)
  assert.match(bad('orchestrator.minFreeDiskGb', '5')[0], /^orchestrator\.minFreeDiskGb is "5"/)
  // install and sync read the problems through commandProblems
  assert.ok(commandProblems({ ...ok, 'orchestrator.maxFixRounds': 0, 'models.mechanical': 'haiku', 'models.analysis': 'sonnet', 'models.judgment': 'inherit', 'models.build': 'sonnet' }).some((m) => m.startsWith('orchestrator.maxFixRounds is 0')))
})

test('plan branch: the slug is lower-case letters, digits and dashes only; any other branch is refused', () => {
  assert.equal(lib.planBranch('plans/451-Add_$(rm -rf x);The `parser`.plan.md', '451'), 'feat/451-add-rm-rf-x')
  assert.equal(lib.planBranch('plans/452-"; touch pwned #.plan.md', '452'), 'feat/452-touch-pwned')
  assert.equal(lib.planBranch('plans/453-$$$.plan.md', '453'), 'feat/453-plan')
  for (const b of ['feat/451-add-the-parser', 'feat/12-x']) assert.equal(lib.planBranchProblem(b), null)
  for (const b of ['feat/451-Add', 'feat/451-a;b', 'feat/451-a b', 'fix/451-a', 'feat/451-', 'feat/x-a', '--upload-pack=x', undefined]) assert.match(lib.planBranchProblem(b), /does not match/)
})

test('added-code check: a failed or cut-off git diff counts as sensitive (fail closed)', () => {
  const re = /auth/i
  const out = '+++ b/src/a.js\n+const auth = 1\n+++ b/src/b.js\n+const x = 1'
  assert.deepEqual(lib.addedCodeFiles({ status: 0, out }, re), { failed: false, files: ['src/a.js'] })
  assert.deepEqual(lib.addedCodeFiles({ status: 0, out }, re, ['src/a.js']), { failed: false, files: [] })
  assert.equal(lib.addedCodeFiles({ status: 128, out: '' }, re).failed, true)
  assert.equal(lib.addedCodeFiles({ status: 0, out, truncated: true }, re).failed, true)
  assert.equal(lib.addedCodeFiles(null, re).failed, true)
})

test('[ui] card values: page an http(s) URL, card not starting with "-", safe screenshot paths', () => {
  assert.equal(lib.uiCardProblem({ card: 'Save shows Saved', page: 'https://app.example/settings', shots: ['screens/1.png'] }), null)
  assert.equal(lib.uiCardProblem({ card: 'x', page: '' }), null)
  assert.match(lib.uiCardProblem({ card: '--state=merged' }), /^card/)
  assert.match(lib.uiCardProblem({ card: ' -x' }), /^card/)
  for (const page of ['file:///etc/passwd', 'javascript:alert(1)', 'https://a.example/$(id)', 'http://a b']) assert.match(lib.uiCardProblem({ card: 'x', page }), /^page/)
  for (const shot of ['-rf', '../x.png', 'a;b.png', 'a b.png', '$(id).png']) assert.match(lib.uiCardProblem({ card: 'x', shots: [shot] }), /^screenshot/)
})

test('orch-state.mjs: unknown flags (--root among them), a value that looks like a flag and unsafe card values are refused', () => {
  const run = (...a) => spawnSync(process.execPath, [join(root, 'scripts', 'orch-state.mjs'), ...a], { cwd: root, encoding: 'utf8' })
  const refused = (r, re) => {
    assert.notEqual(r.status, 0, `${r.stdout}${r.stderr}`)
    assert.match(r.stdout, re)
  }
  refused(run('disk', '--bogus=1'), /unknown flag --bogus/)
  refused(run('disk', '--root=C:/elsewhere'), /unknown flag --root/)
  refused(run('disk', '--root', '..'), /unknown flag --root/)
  refused(run('set', '--run', 'x', '--card', '--state=merged'), /--card needs a value/)
  refused(run('set', '--run', 'x', '--plan', '001', 'extra'), /unexpected argument "extra"/)
  refused(run('set', '--run=x', '--plan=001', '--card=-x', '--card-status=pass'), /card "-x"/)
  refused(run('set', '--run=x', '--plan=001', '--card=ok', '--card-status=pass', '--page=file:///etc/passwd'), /page "file:\/\/\/etc\/passwd"/)
  refused(run('set', '--run=x', '--plan=001', '--card=ok', '--card-status=pass', '--shots=a.png,-rf'), /screenshot "-rf"/)
  const ok = run('disk', '--min=0')
  assert.equal(ok.status, 0, `${ok.stdout}${ok.stderr}`)
  assert.match(ok.stdout, /^ORCH_JSON \{"ok":true/m)
})

test('orch-state lock: concurrent takers of a stale lock never both hold it (no note is lost)', async () => {
  // A scratch copy of the installed scripts and their packages (orch-state.mjs works in its own project folder).
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'orch-lock-')))
  try {
    cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
    const runs = join(dir, '.claude', 'orchestrator-runs')
    mkdirSync(join(runs, 'race'), { recursive: true })
    writeFileSync(join(runs, 'race', 'status.json'), `${JSON.stringify({ run: 'race', phase: 'running', plans: {}, notes: [] })}\n`)
    // A stale lock left by a process that died: older than the 30 s takeover limit.
    const lock = join(runs, 'race.lock')
    writeFileSync(lock, 'dead-owner')
    const old = new Date(Date.now() - 10 * 60 * 1000)
    utimesSync(lock, old, old)
    const N = 4
    const note = (i) => new Promise((done) => {
      const c = spawn(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), 'note', '--run=race', `--text=note ${i}`], { cwd: dir })
      let out = ''
      c.stdout.on('data', (d) => (out += d))
      c.on('close', (code) => done({ code, out }))
    })
    const results = await Promise.all(Array.from({ length: N }, (_, i) => note(i)))
    for (const r of results) assert.equal(r.code, 0, r.out)
    const status = JSON.parse(readFileSync(join(runs, 'race', 'status.json'), 'utf8'))
    assert.deepEqual(status.notes.map((n) => n.text).sort(), Array.from({ length: N }, (_, i) => `note ${i}`).sort(), 'every note is there: no two writers held the lock at once')
    assert.equal(existsSync(lock), false, 'the lock is released')
    assert.deepEqual(readdirSync(runs).filter((f) => /\.stale$/.test(f)), [], 'no moved stale lock is left behind')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
