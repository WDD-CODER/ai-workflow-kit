// /ship lane classification (scripts/ship-prep.mjs, installed copy): build and CI files are never a FAST ship, plan and
// todo files alone are ULTRA-TRIVIAL, and the module runs nothing when imported. Pure: no git, no scratch repository.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { pathToFileURL, fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.SHIP_PREP_ROOT ? resolve(process.env.SHIP_PREP_ROOT) : kit
const prep = await import(pathToFileURL(join(root, 'scripts', 'ship-prep.mjs')).href)

test('importing ship-prep runs nothing: laneFor and BUILD_RE are exported, no Lane line is printed', () => {
  assert.equal(typeof prep.laneFor, 'function')
  assert.ok(prep.BUILD_RE instanceof RegExp)
})

test('a package-manager move (lockfiles, package.json, ci.yml, kit.config.json) is REGULAR even at 2 files / 13 lines', () => {
  const files = ['package-lock.json', 'pnpm-lock.yaml', 'package.json', 'server/package.json', 'server/pnpm-lock.yaml', '.github/workflows/ci.yml', 'kit.config.json', 'render.yaml', 'README.md']
  const r = prep.laneFor({ files, totalLines: 13, sensitiveMatches: [] })
  assert.equal(r.lane, 'REGULAR')
  assert.match(r.laneReason, /touches package-lock\.json \(build or CI file\)/)
  for (const f of ['package.json', 'pnpm-lock.yaml', 'yarn.lock', 'server/package-lock.json', '.github/workflows/security.yml', 'kit.config.json']) assert.ok(prep.BUILD_RE.test(f), f)
  for (const f of ['src/package-list.ts', 'docs/package.json.md', 'github/workflows/x.yml']) assert.ok(!prep.BUILD_RE.test(f), f)
})

test('small doc-only and code changes keep their faster lanes; a sensitive path wins over the build rule', () => {
  assert.equal(prep.laneFor({ files: ['CHANGELOG.md'], totalLines: 4, sensitiveMatches: [], buildMatches: [] }).lane, 'ULTRA-TRIVIAL')
  assert.equal(prep.laneFor({ files: ['plans/300-x.plan.md', '.claude/todo.md'], totalLines: 90, sensitiveMatches: [], buildMatches: [] }).lane, 'ULTRA-TRIVIAL')
  assert.equal(prep.laneFor({ files: ['src/a.ts', 'src/b.ts'], totalLines: 30, sensitiveMatches: [], buildMatches: [] }).lane, 'FAST')
  assert.equal(prep.laneFor({ files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'], totalLines: 30, sensitiveMatches: [], buildMatches: [] }).lane, 'REGULAR')
  const both = prep.laneFor({ files: ['server/auth.ts', 'package.json'], totalLines: 5, sensitiveMatches: ['server/auth.ts'] })
  assert.equal(both.laneReason, 'touches server/auth.ts')
  assert.equal(prep.laneFor({ mode: 'regular', files: ['CHANGELOG.md'], totalLines: 1 }).laneReason, 'forced via --mode regular')
})

// /ship Phase 1 (`ship-prep.mjs --gate`): the build gate in code — no runner agent. One line per command, exit 1 on the
// first failure; FAST / ULTRA-TRIVIAL run no tests, REGULAR runs the test script too.
test('gate commands: FAST runs build, lint, ledger and override check; REGULAR adds the test script', () => {
  const fast = prep.shipGateCommands({ lane: 'FAST', pm: 'npm', build: 'build', lint: 'lint', test: 'test' })
  assert.deepEqual(fast, ['npm run build', 'npm run lint', 'node scripts/plan-ledger-check.mjs', 'node scripts/override-check.mjs'])
  assert.deepEqual(prep.shipGateCommands({ lane: 'ULTRA-TRIVIAL', pm: 'npm', build: 'build', lint: 'lint', test: 'test' }), fast)
  const regular = prep.shipGateCommands({ lane: 'REGULAR', pm: 'npm', build: 'build', lint: 'lint', test: 'test' })
  assert.deepEqual(regular, ['npm run build', 'npm run lint', 'npm run test', 'node scripts/plan-ledger-check.mjs', 'node scripts/override-check.mjs'])
  // testCi wins over test, an unset script is left out, pnpm is honoured
  assert.deepEqual(prep.shipGateCommands({ lane: 'REGULAR', pm: 'pnpm', build: 'build', lint: '', test: 'test', testCi: 'test:ci' }),
    ['pnpm run build', 'pnpm run test:ci', 'node scripts/plan-ledger-check.mjs', 'node scripts/override-check.mjs'])
})

test('gate run: one line per command with its exit, stops at the first failure with its tail, exit 1', () => {
  const lines = []
  const exits = { 'npm run build': 0, 'npm run lint': 2, 'node scripts/plan-ledger-check.mjs': 0 }
  const ran = []
  const run = (cmd) => { ran.push(cmd); return { exit: exits[cmd] ?? 0, out: cmd === 'npm run lint' ? 'a\nLEAK_CHECK: FAIL — 1 leak\n' : 'ok\n' } }
  const r = prep.runShipGate({ commands: ['npm run build', 'npm run lint', 'node scripts/plan-ledger-check.mjs'], run, log: (l) => lines.push(l) })
  assert.equal(r.exit, 1)
  assert.deepEqual(ran, ['npm run build', 'npm run lint'], 'nothing runs after the first failure')
  assert.equal(lines.filter((l) => /^GATE: .+ → exit \d+$/.test(l)).length, 2)
  assert.ok(lines.includes('GATE: npm run build → exit 0'))
  assert.ok(lines.includes('GATE: npm run lint → exit 2'))
  assert.ok(lines.some((l) => l.includes('LEAK_CHECK: FAIL — 1 leak')), 'the failing tail is printed')
  assert.ok(lines.includes('GATE: FAIL — npm run lint'))
  assert.deepEqual(r.results.map((x) => x.status), ['pass', 'fail'])
})

test('gate run: all pass → exit 0 and a PASS line; the ledger output is printed even on exit 0 (its warnings are advisory)', () => {
  const lines = []
  const run = (cmd) => ({ exit: 0, out: cmd.includes('plan-ledger') ? 'PLAN_LEDGER: warn — duplicate 042\n' : 'fine\n' })
  const r = prep.runShipGate({ commands: ['npm run build', 'node scripts/plan-ledger-check.mjs'], run, log: (l) => lines.push(l) })
  assert.equal(r.exit, 0)
  assert.ok(lines.some((l) => l.includes('PLAN_LEDGER: warn — duplicate 042')))
  assert.ok(lines.includes('GATE: PASS — 2 command(s)'))
  assert.ok(!lines.some((l) => l.includes('fine')), 'a passing command prints only its GATE line')
})
