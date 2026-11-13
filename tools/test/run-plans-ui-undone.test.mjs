// A [ui] Done-when item the builder wrote but could not run is not "left undone" (FoodVibe chain report 2026-11-13, K7).
// The builder's folder has no running app and no QA login, so a [ui] item is noted as written-not-run for the run's
// [ui] step and the Human — never a failure, a fix round or a tier escalation. An [auto] item left undone still fails.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const runPlans = await import(pathToFileURL(join(kit, 'scripts', 'run-plans.mjs')).href)

const plan = [
  '# Plan 9 — x', '', '## Goals & Success Criteria',
  '- [auto] `node --test tools/test/x.test.mjs` passes',
  '- [ui] The settings page shows the text "Saved" after one click', '',
].join('\n')

test('a [ui] item in notDone is written-not-run, not a failure', () => {
  assert.equal(typeof runPlans.undoneSplit, 'function', 'run-plans.mjs must export undoneSplit')
  const r = runPlans.undoneSplit(plan, ['The settings page shows the text "Saved" after one click: spec written, not run — needs the dev server and a QA login'])
  assert.deepEqual(r.fail, [], 'a [ui] item the builder could not run must not fail the gate')
  assert.equal(r.uiNotRun.length, 1)
  assert.match(r.uiNotRun[0].item, /^\[ui\] The settings page/)
})

test('an [auto] item in notDone still fails', () => {
  assert.equal(typeof runPlans.undoneSplit, 'function', 'run-plans.mjs must export undoneSplit')
  const r = runPlans.undoneSplit(plan, ['node --test tools/test/x.test.mjs not run: ran out of time'])
  assert.equal(r.fail.length, 1)
  assert.match(r.fail[0].item, /^\[auto\] `node --test/)
  assert.deepEqual(r.uiNotRun, [])
})

test('the gate fails only on the [auto] part and notes the [ui] part', () => {
  const src = readFileSync(join(kit, 'scripts', 'run-plans.mjs'), 'utf8')
  assert.match(src, /undoneSplit\(planText, result\.notDone\)/)
  assert.match(src, /written, not run — checked by the run's \[ui\] step \/ the Human/)
})

test('the builder is told to write the [ui] spec, not run it, and never ask for QA credentials', () => {
  const md = readFileSync(join(kit, '.claude', 'agents', 'orch-builder.md'), 'utf8')
  assert.match(md, /written, not run/)
  assert.match(md, /[Nn]ever ask for QA credentials/)
})
