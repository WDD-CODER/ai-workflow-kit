// Plan 086 B6: `plan-park.mjs` is the one idempotent teardown of a parked plan — its servers stopped, its uncommitted work
// saved on park/<run>-<NNN> (pushed), the slot's .claude/.session-lock deleted, its own folder removed or its slot freed,
// the local park/ branch deleted (the remote one keeps the work) and the park recorded once. Run twice, it exits 0 both
// times and the second run changes nothing. Scratch repositories with a bare origin; the installed scripts.
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
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'plan-park-')))
const drop = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
const ref = (cwd, r) => spawnSync('git', ['rev-parse', '--verify', '--quiet', r], { cwd, encoding: 'utf8' }).stdout.trim()

function setup({ slots }) {
  const parent = tmp()
  const dir = join(parent, 'main')
  mkdirSync(dir)
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 't@t')
  sh(dir, 'config', 'user.name', 't')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  mkdirSync(join(dir, 'plans'))
  writeFileSync(join(dir, 'plans', '123-park.plan.md'), '# Plan 123 — Park\n\nStatus: active\nDepends-on: none\n\n## Read-Write Scope\n\n```scope\nwork/**\n```\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'plan')
  const bare = tmp()
  sh(bare, 'init', '-q', '--bare', '-b', 'main')
  sh(dir, 'remote', 'add', 'origin', bare)
  sh(dir, 'push', '-q', '-u', 'origin', 'main')
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
  const statePath = join(dir, 'scripts', 'orch-state.mjs')
  writeFileSync(statePath, readFileSync(statePath, 'utf8').replace(/const USE_SLOTS = (true|false) !== false/, `const USE_SLOTS = ${slots} !== false`))
  writeFileSync(join(dir, '.git', 'info', 'exclude'), 'scripts/\n.claude/\n.worktree-*\n')
  let slot = null
  if (slots) {
    slot = join(parent, 'main-wt-1')
    sh(dir, 'worktree', 'add', '-q', '--detach', slot, 'main')
    cpSync(join(dir, 'scripts'), join(slot, 'scripts'), { recursive: true, dereference: true })
  }
  const state = (...a) => {
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), ...a], { cwd: dir, encoding: 'utf8', timeout: 120000 })
    const line = String(r.stdout).split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
    assert.ok(line, `${a.join(' ')}: ${r.stdout}${r.stderr}`)
    return JSON.parse(line.slice('ORCH_JSON '.length))
  }
  const park = () => {
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'plan-park.mjs'), '--plan', '123', '--reason', 'x'], { cwd: dir, encoding: 'utf8', timeout: 180000 })
    const line = String(r.stdout).split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
    return { status: r.status, out: `${r.stdout}${r.stderr}`, json: line ? JSON.parse(line.slice('ORCH_JSON '.length)) : null }
  }
  return { parent, dir, bare, slot, state, park }
}
// A plan in the middle of a build: its folder holds uncommitted work and a live session lock.
function building(t) {
  assert.equal(t.state('init', '--run=r').ok, true)
  const info = t.state('plan-info', '--run=r', '--plan=123', '--with-worktree=yes')
  assert.equal(info.wt?.ok, true, JSON.stringify(info))
  const wt = info.wt.path
  mkdirSync(join(wt, 'work'), { recursive: true })
  writeFileSync(join(wt, 'work', 'half.txt'), 'half done\n')
  mkdirSync(join(wt, '.claude'), { recursive: true })
  writeFileSync(join(wt, '.claude', '.session-lock'), JSON.stringify({ heartbeat_epoch: Math.floor(Date.now() / 1000) }))
  return wt
}
const statusOf = (t) => JSON.parse(readFileSync(join(t.dir, '.claude', 'orchestrator-runs', 'r', 'status.json'), 'utf8'))

test('plan-park in a wt-N slot: twice in a row exits 0; the lock and the local park/ branch are gone, the work is on origin, the slot is free, the park recorded once', () => {
  const t = setup({ slots: true })
  try {
    const wt = building(t)
    assert.equal(wt.replace(/\\/g, '/'), t.slot.replace(/\\/g, '/'), 'the plan claimed the idle slot')
    const first = t.park()
    assert.equal(first.status, 0, first.out)
    assert.equal(first.json?.ok, true, first.out)
    assert.equal(existsSync(join(t.slot, '.claude', '.session-lock')), false, 'no session lock in the slot')
    assert.equal(ref(t.dir, 'refs/heads/park/r-123'), '', 'no local park/ branch')
    assert.equal(sh(t.bare, 'show', 'park/r-123:work/half.txt'), 'half done', 'the remote park branch keeps the WIP commit')
    assert.equal(sh(t.bare, 'log', '-1', '--format=%s', 'park/r-123'), 'WIP: park r 123')
    // the slot is a permanent folder: freed (detached, no plan marker, clean), never removed
    assert.equal(existsSync(t.slot), true)
    assert.equal(sh(t.slot, 'branch', '--show-current'), '')
    assert.equal(existsSync(join(t.slot, '.worktree-plan')), false)
    assert.equal(sh(t.slot, 'status', '--porcelain'), '')
    const park1 = statusOf(t).plans['123'].park
    assert.equal(park1.reason, 'x')
    assert.equal(statusOf(t).plans['123'].state, 'parked')
    const saved = sh(t.bare, 'rev-parse', 'park/r-123')

    const second = t.park()
    assert.equal(second.status, 0, second.out)
    assert.equal(second.json?.ok, true, second.out)
    assert.deepEqual(statusOf(t).plans['123'].park, park1, 'the park is recorded once')
    assert.equal(sh(t.bare, 'rev-parse', 'park/r-123'), saved, 'no second WIP commit')
  } finally {
    drop(t.parent)
    drop(t.bare)
  }
})

test('plan-park in a folder of its own: twice in a row exits 0; the folder is removed, no local park/ branch, the park recorded once', () => {
  const t = setup({ slots: false })
  try {
    const wt = building(t)
    assert.match(wt, /-orch-r-123$/)
    const first = t.park()
    assert.equal(first.status, 0, first.out)
    assert.equal(existsSync(wt), false, 'the worktree folder is removed')
    assert.doesNotMatch(sh(t.dir, 'worktree', 'list', '--porcelain'), /-orch-r-123/)
    assert.equal(ref(t.dir, 'refs/heads/park/r-123'), '', 'no local park/ branch')
    assert.equal(sh(t.bare, 'show', 'park/r-123:work/half.txt'), 'half done')
    const park1 = statusOf(t).plans['123'].park
    assert.ok(park1?.at, 'the park is recorded')

    const second = t.park()
    assert.equal(second.status, 0, second.out)
    assert.equal(second.json?.ok, true, second.out)
    assert.deepEqual(statusOf(t).plans['123'].park, park1, 'the park is recorded once')
    // the workflow's way in: `orch-state.mjs park` runs plan-park.mjs and hands back its answer
    const viaState = t.state('park', '--run=r', '--plan=123', '--reason=x')
    assert.equal(viaState.ok, true, JSON.stringify(viaState))
    assert.equal(viaState.recorded, false, 'already recorded')
    assert.ok(viaState.steps.some((s) => s.step === 'record'), JSON.stringify(viaState.steps))
    assert.deepEqual(statusOf(t).plans['123'].park, park1)
  } finally {
    drop(t.parent)
    drop(t.bare)
  }
})
