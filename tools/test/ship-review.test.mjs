// /ship learns from every Worker plan (plan 057): the rendered instructions grade every shown decision, run the checker
// pipeline on a REGULAR plan branch (light review for /ship fast unless the diff is sensitive), pass the checkers their
// lessons and rules, and write one review fact line. Reads the kit's own rendered copies and renders the sources.
//   node --test tools/test/ship-review.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
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

// review.ship = reviewer: plan-review.mjs as a command outside a run (no run folder) — a scratch repository, a fake
// claude that records its prompt, no model call.
function reviewerScratch(verdict) {
  const dir = mkdtempSync(join(tmpdir(), 'ship-review-cli-'))
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false')
  mkdirSync(join(dir, 'plans'), { recursive: true })
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true })
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'plans', '123-demo.plan.md'), '# Plan 123 — demo\n\n## Goals & Success Criteria\n- [auto] src/a.js exports one\n\n## Execution Notes\n- builder: all good BUILDER-CLAIM\n')
  copyFileSync(join(kit, '.claude', 'agents', 'plan-reviewer.md'), join(dir, '.claude', 'agents', 'plan-reviewer.md'))
  writeFileSync(join(dir, 'src', 'a.js'), 'export const one = 0\n')
  g('add', '-A'); g('commit', '-q', '-m', 'base')
  g('switch', '-q', '-c', 'feat/123-demo')
  writeFileSync(join(dir, 'src', 'a.js'), 'export const one = 1 // COMMITTED-CHANGE\n')
  g('commit', '-q', '-am', 'work')
  writeFileSync(join(dir, 'src', 'a.js'), 'export const one = 1 // UNCOMMITTED-CHANGE\n')
  writeFileSync(join(dir, 'src', 'new.js'), 'export const two = 2 // UNTRACKED-FILE\n')
  const result = { role: 'plan-reviewer', model: 'sonnet', effort: 'low', verdict, problems: verdict === 'STOP' ? [{ id: 'p1', file: 'src/a.js', line: 1, rule: 'done-when', reasoning: 'one is not exported as asked', severity: 'major' }] : [] }
  const fake = join(dir, '..', `${dir.split(/[\\/]/).pop()}-fake-claude.mjs`)
  writeFileSync(fake, `import { readFileSync, writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(dir, '..', `${dir.split(/[\\/]/).pop()}-prompt.txt`))}, readFileSync(0, 'utf8') + '\\nARGV ' + process.argv.slice(2).join(' '))\nconsole.log(JSON.stringify({ result: ${JSON.stringify(JSON.stringify(result))}, usage: {} }))\n`)
  const receipt = join(dir, '..', `${dir.split(/[\\/]/).pop()}-receipt.json`)
  writeFileSync(receipt, JSON.stringify({ lane: 'REGULAR', results: [{ command: 'npm run build', status: 'pass', exit: 0, tail: 'GATE-RECEIPT-TAIL' }] }))
  const run = () => spawnSync(process.execPath, [join(kit, 'scripts', 'lib', 'plan-review.mjs'), '--branch', 'feat/123-demo', '--base', 'main', '--receipt', receipt],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, RUN_PLANS_CLAUDE: fake } })
  const prompt = () => readFileSync(join(dir, '..', `${dir.split(/[\\/]/).pop()}-prompt.txt`), 'utf8')
  const clean = () => { for (const p of [dir, fake, receipt, join(dir, '..', `${dir.split(/[\\/]/).pop()}-prompt.txt`)]) rmSync(p, { recursive: true, force: true }) }
  return { run, prompt, clean }
}

test('plan-review.mjs --branch --base outside a run: redacted plan, working tree + untracked diff, the gate receipt, STOP → exit 1', () => {
  const s = reviewerScratch('STOP')
  try {
    const r = s.run()
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^REVIEW: STOP — 1 problem\(s\), 1 blocking \(plan-reviewer on /m)
    assert.match(r.stdout, /major src\/a\.js:1 done-when/)
    const p = s.prompt()
    assert.match(p, /UNCOMMITTED-CHANGE/, 'the working tree is reviewed, not only the commits')
    assert.match(p, /UNTRACKED-FILE/, 'untracked files are part of the diff')
    assert.match(p, /GATE-RECEIPT-TAIL/, 'the gate receipt reaches the reviewer')
    assert.ok(!p.includes('BUILDER-CLAIM'), "the plan's Execution Notes never reach the reviewer")
    assert.match(p, /--disallowedTools/, 'no write tool')
  } finally { s.clean() }
})

test('plan-review.mjs outside a run: PASS → exit 0; a branch with no plan → exit 2', () => {
  const s = reviewerScratch('PASS')
  try {
    const r = s.run()
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^REVIEW: PASS — 0 problem\(s\), 0 blocking/m)
    const none = spawnSync(process.execPath, [join(kit, 'scripts', 'lib', 'plan-review.mjs'), '--branch', 'chore/x', '--base', 'main'], { cwd: kit, encoding: 'utf8' })
    assert.equal(none.status, 2)
    assert.match(none.stdout, /REVIEW: refused — no plan file for chore\/x/)
  } finally { s.clean() }
})

test('ADR 0015 supersedes 0007, and 0007 changed only its status', () => {
  const adr = read('core/docs/brain/decisions/0015-ship-fast-picks-the-light-review-except-on-sensitive-paths.md')
  assert.match(adr, /^supersedes: 0007-ship-fast-decouples-approval-from-classification$/m)
  assert.match(adr, /^status: accepted$/m)
  const old = read('core/docs/brain/decisions/0007-ship-fast-decouples-approval-from-classification.md')
  assert.match(old, /^status: superseded by 0015$/m)
  assert.match(old, /Split the two concerns\./, 'the body is kept as it was')
})
