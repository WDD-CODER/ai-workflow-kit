// Plan 083: on a park, the builder's uncommitted work is committed on the fixed branch park/<run>-<NNN>, pushed, and the
// slot is given back. Scratch repositories with a bare origin; the installed orch-state.mjs, with slots switched on.
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
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'orch-park-')))
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
  writeFileSync(join(dir, 'plans', '001-x.plan.md'), '# Plan 001 — X\n\nStatus: active\nDepends-on: none\n\n## Read-Write Scope\n\n```scope\nwork/**\n```\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'plan')
  const bare = tmp()
  sh(bare, 'init', '-q', '--bare', '-b', 'main')
  sh(dir, 'remote', 'add', 'origin', bare)
  sh(dir, 'push', '-q', '-u', 'origin', 'main')
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
  // The kit's own config renders useSlots false; this test needs a permanent slot, so the installed copy is switched on.
  const statePath = join(dir, 'scripts', 'orch-state.mjs')
  writeFileSync(statePath, readFileSync(statePath, 'utf8').replace(/const USE_SLOTS = (true|false) !== false/, 'const USE_SLOTS = true !== false'))
  writeFileSync(join(dir, '.git', 'info', 'exclude'), 'scripts/\n.claude/\n.worktree-*\n')
  // one idle permanent slot beside the main folder, with the scripts' packages (an idle slot is used as it is)
  const slot = join(parent, 'main-wt-1')
  sh(dir, 'worktree', 'add', '-q', '--detach', slot, 'main')
  cpSync(join(dir, 'scripts'), join(slot, 'scripts'), { recursive: true, dereference: true })
  const state = (...a) => {
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), ...a], { cwd: dir, encoding: 'utf8', timeout: 120000 })
    const line = String(r.stdout).split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
    assert.ok(line, `${a.join(' ')}: ${r.stdout}${r.stderr}`)
    return JSON.parse(line.slice('ORCH_JSON '.length))
  }
  return { parent, dir, bare, slot, state }
}
const remoteHead = (bare, branch) => spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: bare, encoding: 'utf8' }).stdout.trim()

test('park-save: uncommitted work goes to park/<run>-<NNN> on origin, the slot is released; a second park adds to the same branch; nothing to commit makes no branch', () => {
  const t = setup()
  try {
    assert.equal(t.state('init', '--run=r').ok, true)
    const wt = t.state('worktree', '--run=r', '--plan=001')
    assert.equal(wt.ok, true, JSON.stringify(wt))
    assert.equal(wt.slot, 1, 'the idle slot was claimed')
    // the builder marker the db-write ask reads, in the slot's own git dir (never among its files)
    const marker = join(sh(t.slot, 'rev-parse', '--absolute-git-dir'), 'orch-builder.json')
    assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), { run: 'r', plan: '001', planPath: 'plans/001-x.plan.md', branch: 'feat/001-x', planRef: 'origin/orch/r' })
    const branch = 'park/r-001'

    // nothing uncommitted: no branch
    const none = t.state('park-save', '--run=r', '--plan=001')
    assert.deepEqual([none.ok, none.saved], [true, false])
    assert.equal(remoteHead(t.bare, branch), '')

    // first park: a changed tracked file and a new file
    writeFileSync(join(t.slot, 'a.txt'), 'a changed\n')
    mkdirSync(join(t.slot, 'work'))
    writeFileSync(join(t.slot, 'work', 'new.txt'), 'new\n')
    const first = t.state('park-save', '--run=r', '--plan=001')
    assert.deepEqual([first.ok, first.saved, first.pushed, first.branch, first.released], [true, true, true, branch, true], JSON.stringify(first))
    assert.equal(remoteHead(t.bare, branch), first.sha)
    assert.equal(sh(t.bare, 'log', '-1', '--format=%s', branch), 'WIP: park r 001')
    assert.equal(sh(t.bare, 'show', `${branch}:work/new.txt`), 'new')
    assert.equal(sh(t.bare, 'show', `${branch}:a.txt`), 'a changed')
    // the slot: detached, no marker, clean
    assert.equal(sh(t.slot, 'branch', '--show-current'), '')
    assert.equal(existsSync(join(t.slot, '.worktree-plan')), false)
    assert.equal(existsSync(marker), false, 'the builder marker goes with the slot')
    assert.equal(sh(t.slot, 'status', '--porcelain'), '')
    // the plan branch itself was not moved by the save: it is still at the run branch it was made from
    assert.equal(sh(t.dir, 'rev-parse', 'feat/001-x'), sh(t.dir, 'rev-parse', 'origin/orch/r'))

    // second park of the same plan: the slot is claimed again, new work, the commit goes on top of the first
    const again = t.state('worktree', '--run=r', '--plan=001')
    assert.equal(again.ok, true, JSON.stringify(again))
    // the plan branch never held the first save, so work/ is gone after the reclaim
    mkdirSync(join(t.slot, 'work'), { recursive: true })
    writeFileSync(join(t.slot, 'work', 'more.txt'), 'more\n')
    const second = t.state('park-save', '--run=r', '--plan=001')
    assert.equal(second.saved, true, JSON.stringify(second))
    assert.equal(sh(t.bare, 'rev-parse', `${branch}~1`), first.sha, 'the second save adds to the same branch')
    assert.equal(sh(t.bare, 'show', `${branch}:work/more.txt`), 'more')
  } finally {
    drop(t.parent)
    drop(t.bare)
  }
})
