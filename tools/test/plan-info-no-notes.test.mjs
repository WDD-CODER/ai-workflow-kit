// Plan 086 B1: `plan-info --no-notes` writes a copy of the plan without its `## Execution Notes` section next to the run's
// status file and reports it as `reviewPath` — the checkers read that copy, never the notes the builder wrote.
// A scratch repository with the installed orch-state.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, cpSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit

const PLAN = [
  '# Plan 123 — Example',
  '',
  'Status: active',
  'Depends-on: none',
  '',
  '## Atomic Sub-tasks',
  '',
  '- [ ] B1: build it',
  '',
  '## Execution Notes',
  '- B1: all checks passed (trust me)',
  '```text',
  '## not a heading inside a fence',
  '```',
  '- decision: behaviour: did a thing',
  '',
  '## Out of Scope',
  '- nothing else',
  '',
].join('\n')
const EXPECTED = [
  '# Plan 123 — Example',
  '',
  'Status: active',
  'Depends-on: none',
  '',
  '## Atomic Sub-tasks',
  '',
  '- [ ] B1: build it',
  '',
  '## Out of Scope',
  '- nothing else',
  '',
].join('\n')

function setup() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'orch-nonotes-')))
  mkdirSync(join(dir, 'plans'))
  writeFileSync(join(dir, 'plans', '123-example.plan.md'), PLAN)
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
  const run = (...a) => {
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), ...a], { cwd: dir, encoding: 'utf8', timeout: 60000 })
    const line = String(r.stdout).split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
    assert.ok(line, `${a.join(' ')}: ${r.stdout}${r.stderr}`)
    return { status: r.status, json: JSON.parse(line.slice('ORCH_JSON '.length)) }
  }
  return { dir, run }
}

test('plan-info --no-notes: a copy of the plan without ## Execution Notes, reported as reviewPath; the plan is untouched', () => {
  const t = setup()
  try {
    const r = t.run('plan-info', '--run', 'r', '--plan', '123', '--no-notes')
    assert.equal(r.status, 0, JSON.stringify(r.json))
    assert.equal(r.json.reviewPath, '.claude/orchestrator-runs/r/plan-123.reviewed.md')
    const copy = join(t.dir, '.claude', 'orchestrator-runs', 'r', 'plan-123.reviewed.md')
    assert.ok(existsSync(copy), 'the reviewed copy is written next to the run status file')
    assert.equal(readFileSync(copy, 'utf8'), EXPECTED)
    assert.doesNotMatch(readFileSync(copy, 'utf8'), /Execution Notes|trust me|behaviour:/)
    assert.equal(readFileSync(join(t.dir, 'plans', '123-example.plan.md'), 'utf8'), PLAN, 'the plan file itself is not changed')
    // the --key=value form the workflow sends works the same
    const w = t.run('plan-info', '--run=r', '--plan=123', '--no-notes=yes')
    assert.equal(w.json.reviewPath, r.json.reviewPath)
  } finally {
    rmSync(t.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('plan-info without --no-notes writes no copy and reports no reviewPath (today\'s behaviour)', () => {
  const t = setup()
  try {
    const r = t.run('plan-info', '--run', 'r', '--plan', '123')
    assert.equal(r.status, 0, JSON.stringify(r.json))
    assert.equal(r.json.reviewPath, undefined)
    assert.equal(existsSync(join(t.dir, '.claude', 'orchestrator-runs', 'r', 'plan-123.reviewed.md')), false)
  } finally {
    rmSync(t.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
