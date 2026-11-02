// /ship learns from every Worker plan (plan 057): the rendered instructions grade every shown decision, run the checker
// pipeline on a REGULAR plan branch (light review for /ship fast unless the diff is sensitive), pass the checkers their
// lessons and rules, and write one review fact line. Reads the kit's own rendered copies and renders the sources.
//   node --test tools/test/ship-review.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { applyConditionals } from '../lib/kit.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p) => readFileSync(join(kit, p), 'utf8').replace(/\r\n/g, '\n')
const flat = (s) => s.replace(/\s+/g, ' ')
const ship = flat(read('.claude/commands/ship.md'))
const regular = flat(read('docs/agent/ship-regular.md'))
const reviewIt = flat(read('.claude/commands/review-it.md'))

test('ship.md: decisions come from decision-log.mjs pending, and every grade reply is graded under ship-<NNN> before the learning step', () => {
  assert.match(ship, /node scripts\/decision-log\.mjs pending --plan <the plan file> --out <scratch>\/decisions\.json/)
  assert.match(ship, /\[graded D<n> ok\|✗ YYYY-MM-DD\]/)
  const gradeAt = ship.indexOf('node scripts/decision-log.mjs grade --run ship-<NNN>')
  const learnAt = ship.indexOf('node scripts/decision-log.mjs learn --reply')
  assert.ok(gradeAt > 0, 'the grade step is there')
  assert.ok(gradeAt < learnAt, 'grade runs before the learn/add gate')
  assert.match(ship, /--decisions <scratch>\/decisions\.json --mark <the plan file>/)
  assert.match(ship, /`decisions: ok` included/)
  assert.ok(!/not graded them in this session/.test(ship), 'no more "graded in this session" rule')
})

test('ship.md and ship-regular.md: /ship fast on a REGULAR plan branch runs the light review, unless the diff is sensitive', () => {
  assert.ok(!/Doesn't change lane classification or review depth/.test(ship), 'the old Flags note is gone')
  assert.match(ship, /Doesn't change lane classification\. On a REGULAR plan branch it picks the light review \(`\/review`\) instead of the checker pipeline, unless the diff touches a sensitive path — then the checkers still run \(ADR 0015/)
  assert.match(ship, /`--skip-review` is unchanged/)
  assert.match(regular, /Checkers \(below\) when: plan branch AND `review\.ship` is `checkers` AND \(`fast` not passed OR sensitive\)/)
  assert.match(regular, /`fast` on a REGULAR plan branch therefore keeps the light review, unless the diff is sensitive \(ADR 0015\)/)
  assert.match(regular, /Sensitive\*\* = `sensitiveMatches` in `node scripts\/ship-prep\.mjs --json` is not empty/)
  assert.match(regular, /Plain `\/ship` and `\/ship regular` keep the checkers/)
})

test('ship-regular.md: the checker review runs /review-it inline with one fix-and-recheck by orch-verify only', () => {
  assert.match(regular, /Plan branch\*\* = the current branch is `feat\/NNN-<slug>` or `fix\/NNN-<slug>` and `plans\/NNN-\*\.plan\.md` exists/)
  assert.match(regular, /Read `\.claude\/commands\/review-it\.md` and run its steps 1–6 inline/)
  assert.match(regular, /re-check \*\*exactly once\*\*: hand `orch-verify` only the findings you fixed, with the new diff/)
  assert.match(regular, /No second set of finders/)
  assert.match(regular, /Review: checkers <Decision> — kept <n>, dropped <m>/)
  assert.match(regular, /Review: light \(fast\) PASS/)
  assert.ok(!/One sub-agent only/.test(ship), 'ship.md no longer says kit-runner is its only sub-agent')
  assert.match(ship, /also starts the `\/review-it` finders and `orch-verify`/)
})

test('ship-regular.md: one review fact line per ship, with light (fast) as its own mode and no tokens', () => {
  assert.match(regular, /- review: <checkers\|light\|light \(fast\)> kept <n> dropped <m> rechecked <k> minutes <t> models <role=model,…>/)
  assert.match(regular, /`light \(fast\)` = `fast` chose the light review/)
  assert.match(regular, /No token counts/)
})

test('review-it.md: the checkers get their own LESSONS (kit first) and RULES ## checkers from the main folder', () => {
  assert.match(reviewIt, /git rev-parse --path-format=absolute --git-common-dir/)
  assert.match(reviewIt, /node "<main folder>\/scripts\/orch-state\.mjs" context` \(no `--run`\)/)
  assert.match(reviewIt, /`LESSONS` = `\[\.\.\.kitLessons\[<role>\], \.\.\.lessons\[<role>\]\]`/)
  assert.match(reviewIt, /`RULES` = `rules\.checkers`/)
  assert.match(reviewIt, /Never pass the `builder`, `gate`, `readiness` or `ui` lessons/)
  assert.match(reviewIt, /its own `LESSONS` and `RULES` \(above\)/)
  assert.match(reviewIt, /the verifier's `LESSONS` and `RULES`, to `orch-verify`/)
  assert.match(read('layers/cursor/.cursor/commands/review-it.md'), /Follow `\.claude\/commands\/review-it\.md` exactly/, 'the Cursor copy defers to it')
})

test('review.ship=light renders its note in ship-regular.md; checkers leaves it out', () => {
  const src = read('core/docs/agent/ship-regular.md')
  assert.match(applyConditionals(src, { 'review.ship': 'light' }), /This project sets `review\.ship` to `light`/)
  assert.ok(!/This project sets `review\.ship`/.test(applyConditionals(src, { 'review.ship': 'checkers' })))
})

test('ADR 0015 supersedes 0007, and 0007 changed only its status', () => {
  const adr = read('core/docs/brain/decisions/0015-ship-fast-picks-the-light-review-except-on-sensitive-paths.md')
  assert.match(adr, /^supersedes: 0007-ship-fast-decouples-approval-from-classification$/m)
  assert.match(adr, /^status: accepted$/m)
  const old = read('core/docs/brain/decisions/0007-ship-fast-decouples-approval-from-classification.md')
  assert.match(old, /^status: superseded by 0015$/m)
  assert.match(old, /Split the two concerns\./, 'the body is kept as it was')
})
