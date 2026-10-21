// Unit tests for the orchestrator's pure rules (scripts/lib/orch-run.mjs, installed) and the orchestrator.* config
// validation (tools/lib/kit.mjs). ORCH_ROOT = an installed project (default: this repo, the kit installed into itself).
// The end-to-end run is tools/orchestrator-e2e.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
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
  assert.equal(out[2], '1. 001: Save stores the name — UI check pass in round 0; evidence: `shots/1.png`')
  assert.equal(out[3], '2. 002: Delete asks first — UI check pass in round 0; evidence: `shots/2.png`')
  assert.equal(out[at('### https://app.example/') + 2], '3. 001: Home shows the list — UI check pass in round 1; evidence: no screenshot')
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
