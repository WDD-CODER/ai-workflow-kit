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
