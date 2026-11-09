// tools/validate-orchestrator.mjs — the case runner and the report, with stand-in cases (no sandbox, no run):
// a time-out is FAIL, only an explicit PASS passes, sandboxes go unless --keep, one report row per case, the case filter,
// and the dry run of real mode calls no model.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runCases, selectCases } from '../lib/validate/run.mjs'
import { report, verdictLine } from '../lib/validate/report.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const tool = join(kit, 'tools', 'validate-orchestrator.mjs')
const sandboxStub = () => {
  const s = { root: '/tmp/stub', cleaned: false, cleanup() { s.cleaned = true } }
  return s
}
const stub = (id, run) => ({ id, title: `case ${id}`, plan: '000', calls: [], run })

test('a case that runs past its time limit is FAIL "timed out after <n> s", never PASS', async () => {
  const [row] = await runCases([stub('V9', (ctx) => new Promise((res) => ctx.signal.addEventListener('abort', () => res({ verdict: 'PASS', why: 'too late' }))))], { kit, timeoutMs: 1000 })
  assert.equal(row.verdict, 'FAIL')
  assert.equal(row.why, 'timed out after 1 s')
})

test('only an explicit PASS passes: an error, no verdict or another word is FAIL', async () => {
  const rows = await runCases([
    stub('V1', () => { throw new Error('boom') }),
    stub('V2', () => undefined),
    stub('V3', () => ({ verdict: 'pass', why: 'lower case' })),
    stub('V4', () => ({ verdict: 'PASS', why: 'ok', evidence: ['status.json phase: finished'] })),
  ], { kit, timeoutMs: 5000 })
  assert.deepEqual(rows.map((r) => r.verdict), ['FAIL', 'FAIL', 'FAIL', 'PASS'])
  assert.match(rows[0].why, /^error: boom/)
  assert.equal(rows[1].why, 'the case returned no verdict')
  assert.deepEqual(rows[3].evidence, ['status.json phase: finished'])
})

test('a sandbox is removed after its case, also after a time-out, unless keep', async () => {
  const a = sandboxStub()
  const b = sandboxStub()
  await runCases([stub('V1', (ctx) => { ctx.sandbox(a); return { verdict: 'PASS', why: 'ok' } }), stub('V2', (ctx) => { ctx.sandbox(b); return new Promise(() => {}) })], { kit, timeoutMs: 1000 })
  assert.equal(a.cleaned, true)
  assert.equal(b.cleaned, true)
  const c = sandboxStub()
  const [row] = await runCases([stub('V1', (ctx) => { ctx.sandbox(c); return { verdict: 'PASS', why: 'ok' } })], { kit, keep: true })
  assert.equal(c.cleaned, false)
  assert.deepEqual(row.kept, ['/tmp/stub'])
})

test('the report has the verdict line first and one row per case, each case\'s evidence quoted', () => {
  const rows = [
    { id: 'V1', title: 'one', plan: '100', verdict: 'PASS', why: 'ok', evidence: ['status.json phase: finished'], seconds: 3, kept: [] },
    { id: 'V2', title: 'two', plan: '101', verdict: 'FAIL', why: 'timed out after 300 s', evidence: [], seconds: 300, kept: [], logs: '/tmp/logs/V2' },
  ]
  const text = report(rows, { mode: 'fake', kit: 'working tree at abc1234', date: '2026-11-09' })
  assert.match(text, /\*\*VALIDATION: FAIL — 1 of 2 cases failed: V2\*\*/)
  assert.equal(text.split('\n').filter((l) => /^\| V\d /.test(l)).length, 2)
  assert.match(text, /```text\nstatus\.json phase: finished\n```/)
  assert.match(text, /Run files of this case: `\/tmp\/logs\/V2`/)
  assert.equal(verdictLine([rows[0]]), 'VALIDATION: PASS — 1 of 1 cases passed')
  assert.equal(verdictLine([]), 'VALIDATION: FAIL — no case ran')
})

test('--cases keeps only the named cases in their order; an unknown id is refused', () => {
  const all = ['V1', 'V2', 'V3', 'V4', 'V5'].map((id) => stub(id, () => null))
  assert.deepEqual(selectCases(all, 'v4,V2').map((c) => c.id), ['V2', 'V4'])
  assert.deepEqual(selectCases(all, null).map((c) => c.id), ['V1', 'V2', 'V3', 'V4', 'V5'])
  assert.throws(() => selectCases(all, 'V2,V7'), /unknown case\(s\): V7/)
  const r = spawnSync(process.execPath, [tool, '--cases', 'V2,V4', '--dry-run'], { cwd: kit, encoding: 'utf8', windowsHide: true })
  assert.equal(r.status, 0, r.stderr)
  const ids = [...new Set(r.stdout.split('\n').filter((l) => /^V\d /.test(l)).map((l) => l.slice(0, 2)))]
  assert.deepEqual(ids, ['V2', 'V4'])
  assert.equal(spawnSync(process.execPath, [tool, '--cases', 'V9'], { cwd: kit, encoding: 'utf8', windowsHide: true }).status, 2)
})

test('real mode --dry-run prints each builder call on Sonnet, the token cap and the sandbox folder, and calls no model', () => {
  const r = spawnSync(process.execPath, [tool, '--mode', 'real', '--dry-run'], { cwd: kit, encoding: 'utf8', windowsHide: true, env: { ...process.env, PATH: '' } })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /V1 {2}plan 901 builder: claude -p .*--model sonnet/)
  assert.match(r.stdout, /token cap: 3000000 input tokens/)
  assert.match(r.stdout, /sandbox folder: .*kit-rp-<random>/)
  assert.equal(r.stdout.split('\n').filter((l) => /^V\d /.test(l) && /builder/.test(l)).length >= 5, true)
  const capped = spawnSync(process.execPath, [tool, '--mode', 'real', '--dry-run', '--max-input-tokens', '500000'], { cwd: kit, encoding: 'utf8', windowsHide: true })
  assert.match(capped.stdout, /token cap: 500000 input tokens/)
})
