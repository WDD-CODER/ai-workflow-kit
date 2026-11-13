// The final gate's stop reason and report name the failing tests, not the last lines of the output (K15); when no plan
// of the run changed a file the failure names, they say it may be this machine (K12).
//   node --test tools/test/final-gate-failing.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const lib = await import(pathToFileURL(join(kit, 'scripts', 'lib', 'orch-run.mjs')).href)
const runPlans = await import(pathToFileURL(join(kit, 'scripts', 'run-plans.mjs')).href)

// What the FoodVibe final gate printed (cut): the failing names sit in the middle, the build and pnpm lines at the end.
const KARMA = [
  '> foodvibe@1.0.0 test:ci',
  '- Generating browser application bundles (phase: setup)...',
  'Chrome Headless 130.0 (Windows 10) DateRangeComponent should show the picker on touch FAILED',
  '\tExpected false to be true.',
  'Chrome Headless 130.0 (Windows 10): Executed 120 of 309 (1 FAILED) (0 secs / 1.2 secs)',
  'Chrome Headless 130.0 (Windows 10) DateUtil formats the short date FAILED',
  'Chrome Headless 130.0 (Windows 10): Executed 309 of 309 (2 FAILED) (4.1 secs / 3.9 secs)',
  'TOTAL: 2 FAILED, 307 SUCCESS',
  '✔ Browser application bundle generation complete.',
  '',
  ' ELIFECYCLE  Command failed with exit code 1.',
].join('\n')

test('failingLines: Karma names the failing tests and the totals line, never the bundle or ELIFECYCLE lines', () => {
  const lines = lib.failingLines(KARMA)
  assert.deepEqual(lines, [
    'TOTAL: 2 FAILED, 307 SUCCESS',
    'Chrome Headless 130.0 (Windows 10) DateRangeComponent should show the picker on touch FAILED',
    'Chrome Headless 130.0 (Windows 10) DateUtil formats the short date FAILED',
  ])
})

test('failingLines: node:test, jest/vitest and mocha failures; at most five names', () => {
  const node = 'ok 1 - a\nnot ok 2 - parses the date\n  ---\n  error: x\nℹ tests 2\nℹ fail 1\n'
  assert.deepEqual(lib.failingLines(node), ['ℹ fail 1', 'not ok 2 - parses the date'])
  const jest = 'PASS src/a.test.ts\nFAIL src/b.test.ts\n  ● dates › formats the day\n\nTests:       1 failed, 9 passed, 10 total\nnpm ERR! code ELIFECYCLE\n'
  assert.deepEqual(lib.failingLines(jest), ['Tests:       1 failed, 9 passed, 10 total', 'FAIL src/b.test.ts', '● dates › formats the day'])
  const mocha = '  9 passing\n  1 failing\n\n  1) dates\n       formats the day:\n     Error: expected 1 to equal 2\n'
  assert.deepEqual(lib.failingLines(mocha), ['1 failing', '1) dates', 'Error: expected 1 to equal 2'])
  const many = Array.from({ length: 9 }, (_, i) => `not ok ${i + 1} - case ${i + 1}`).join('\n')
  assert.equal(lib.failingLines(many).length, 5)
})

test('failingLines: no failure marker falls back to the last three lines that are not empty', () => {
  assert.deepEqual(lib.failingLines('one\ntwo\n\nthree\nfour\n\n'), ['two', 'three', 'four'])
  assert.deepEqual(lib.failingLines(''), [])
})

test('finalGateStopReason: the failing names, and "may be this machine" only when no plan changed a file the output names', () => {
  const merged = { 101: ['src/app/menu.ts'], 102: ['docs/x.md'] }
  const r = runPlans.finalGateStopReason({ command: 'pnpm run test:ci', tail: KARMA, merged })
  assert.match(r, /^final gate failed: pnpm run test:ci — /)
  assert.match(r, /TOTAL: 2 FAILED, 307 SUCCESS/)
  assert.match(r, /DateUtil formats the short date FAILED/)
  assert.doesNotMatch(r, /ELIFECYCLE|bundle generation complete/)
  assert.match(r, /no plan in this run changed the failing files — may be this machine \(try the same command on the run's base commit\)/)
  const named = runPlans.finalGateStopReason({ command: 'npm test', tail: 'FAIL src/app/menu.ts\nTests: 1 failed', merged })
  assert.doesNotMatch(named, /may be this machine/)
  assert.equal(runPlans.planFileNamed({ output: 'FAIL src\\app\\menu.ts', merged }), true, 'Windows slashes')
  assert.equal(runPlans.planFileNamed({ output: KARMA, merged }), false)
})

test('the report names the failing lines and the may-be-this-machine note', () => {
  const status = { run: 'g', phase: 'stopped', plans: {}, finalGate: { ok: false, command: 'pnpm run test:ci', at: 'T', attempt: 1, blamed: [], failing: ['TOTAL: 2 FAILED, 307 SUCCESS', 'DateUtil formats the short date FAILED'], noPlanFile: true } }
  const report = lib.formatReport({ status, merged: [], mainShaNow: 'aaaaaaa1', finishedAt: 'T1', runBranch: 'orch/g', mainBranch: 'main' })
  assert.match(report, /Final gate: failed: pnpm run test:ci \(attempt 1\)/)
  assert.match(report, /Failing: TOTAL: 2 FAILED, 307 SUCCESS \/ DateUtil formats the short date FAILED/)
  assert.match(report, /no plan in this run changed the failing files — may be this machine/)
})
