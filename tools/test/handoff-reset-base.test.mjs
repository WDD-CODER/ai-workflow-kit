// Plan 086 B3: `handoff --reset-base` puts the builder's folder back at the plan branch's base after the hand-off file is
// written, so the fresh judgment-tier builder starts from a clean base instead of patching the failed diff. The hand-off
// file still describes the discarded attempt. Scratch repositories with a bare origin; the installed orch-state.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, cpSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit

const sh = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'orch-reset-')))
const drop = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })

function setup() {
  const parent = tmp()
  const dir = join(parent, 'main')
  mkdirSync(dir)
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 't@t')
  sh(dir, 'config', 'user.name', 't')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  mkdirSync(join(dir, 'plans'))
  writeFileSync(join(dir, 'plans', '123-reset.plan.md'), '# Plan 123 — Reset\n\nStatus: active\nDepends-on: none\n\n## Read-Write Scope\n\n```scope\nwork/**\n```\n\n## Atomic Sub-tasks\n\n- [ ] B1: build it\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'plan')
  const bare = tmp()
  sh(bare, 'init', '-q', '--bare', '-b', 'main')
  sh(dir, 'remote', 'add', 'origin', bare)
  sh(dir, 'push', '-q', '-u', 'origin', 'main')
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
  // no permanent slot: the plan builds in a folder of its own
  const statePath = join(dir, 'scripts', 'orch-state.mjs')
  writeFileSync(statePath, readFileSync(statePath, 'utf8').replace(/const USE_SLOTS = (true|false) !== false/, 'const USE_SLOTS = false !== false'))
  writeFileSync(join(dir, '.git', 'info', 'exclude'), 'scripts/\n.claude/\n.worktree-*\n')
  const state = (...a) => {
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), ...a], { cwd: dir, encoding: 'utf8', timeout: 120000 })
    const line = String(r.stdout).split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
    assert.ok(line, `${a.join(' ')}: ${r.stdout}${r.stderr}`)
    return JSON.parse(line.slice('ORCH_JSON '.length))
  }
  return { parent, dir, bare, state }
}

// A first builder's failed attempt: one pushed commit on the plan branch, one uncommitted change and one new file.
function failedAttempt(t) {
  assert.equal(t.state('init', '--run=r').ok, true)
  const info = t.state('plan-info', '--run=r', '--plan=123', '--with-worktree=yes')
  assert.equal(info.wt?.ok, true, JSON.stringify(info))
  const wt = info.wt.path
  const base = sh(t.dir, 'rev-parse', 'origin/orch/r')
  mkdirSync(join(wt, 'work'))
  writeFileSync(join(wt, 'work', 'committed.txt'), 'first builder\n')
  sh(wt, 'add', 'work/committed.txt')
  sh(wt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'first attempt')
  sh(wt, 'push', '-q', '-u', 'origin', 'feat/123-reset')
  writeFileSync(join(wt, 'a.txt'), 'a changed by the first builder\n')
  writeFileSync(join(wt, 'work', 'loose.txt'), 'untracked\n')
  return { wt, base, attempt: sh(wt, 'rev-parse', 'HEAD') }
}
const HANDOFF = ['--run=r', '--plan=123', '--step=round 2', '--check=npm test', '--tail=FAIL parser.spec: expected 2', '--tried=build builder', '--failed=npm test: FAIL parser.spec']

test('handoff --reset-base: the folder is back at the recorded base, clean; the hand-off file still describes the discarded attempt', () => {
  const t = setup()
  try {
    const a = failedAttempt(t)
    const h = t.state('handoff', ...HANDOFF, '--reset-base')
    assert.equal(h.ok, true, JSON.stringify(h))
    assert.equal(sh(a.wt, 'status', '--porcelain'), '', 'no uncommitted change and no new file left')
    assert.equal(sh(a.wt, 'rev-parse', 'HEAD'), a.base, 'HEAD is the plan branch base')
    assert.equal(sh(a.wt, 'branch', '--show-current'), 'feat/123-reset', 'still on the plan branch')
    assert.equal(existsSync(join(a.wt, 'work', 'committed.txt')), false)
    const st = JSON.parse(readFileSync(join(t.dir, '.claude', 'orchestrator-runs', 'r', 'status.json'), 'utf8'))
    assert.equal(st.plans['123'].resetToBase, a.base, 'status.json records the base')
    assert.equal(st.plans['123'].resetFrom, a.attempt, 'and the discarded head, so the attempt can be found again')
    // the plan branch on origin follows, so the fresh builder's own push is a fast-forward
    assert.equal(sh(t.bare, 'rev-parse', 'refs/heads/feat/123-reset'), a.base)
    const text = readFileSync(join(t.dir, h.path), 'utf8')
    assert.match(text, /^Failed: {10}npm test: FAIL parser\.spec$/m)
    assert.match(text, /^Output tail: {5}FAIL parser\.spec: expected 2$/m)
    assert.match(text, /^Files changed: {3}work\/committed\.txt$/m, 'the discarded attempt is still described')
  } finally {
    drop(t.parent)
    drop(t.bare)
  }
})

test('handoff without --reset-base resets nothing (today\'s behaviour)', () => {
  const t = setup()
  try {
    const a = failedAttempt(t)
    const h = t.state('handoff', ...HANDOFF)
    assert.equal(h.ok, true, JSON.stringify(h))
    assert.equal(sh(a.wt, 'rev-parse', 'HEAD'), a.attempt)
    assert.match(sh(a.wt, 'status', '--porcelain'), /a\.txt/)
    assert.equal(readFileSync(join(a.wt, 'work', 'loose.txt'), 'utf8'), 'untracked\n')
    const st = JSON.parse(readFileSync(join(t.dir, '.claude', 'orchestrator-runs', 'r', 'status.json'), 'utf8'))
    assert.equal(st.plans['123'].resetToBase, undefined)
  } finally {
    drop(t.parent)
    drop(t.bare)
  }
})
