// Plan 113: scripts/worktree-clean.mjs (installed) — the kit removes the worktree folders it and its agents made, by
// script, once they are safe to remove; every other folder stays with one reason line. Runs in a scratch repo with an
// origin. ORCH_ROOT = an installed project (default: this repo, the kit installed into itself).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { pathToFileURL, fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit
const src = readFileSync(join(root, 'scripts', 'worktree-clean.mjs'), 'utf8')
const wc = await import(pathToFileURL(join(root, 'scripts', 'worktree-clean.mjs')).href)
const repo = /^const REPO = '([^']*)'$/m.exec(src)[1] || 'proj'
const slotSuffix = /^const SLOT_SUFFIX = '([^']*)'$/m.exec(src)[1]
const runPrefix = JSON.parse(/^const RUN_PREFIX = (.+)$/m.exec(src)[1])

const norm = (p) => p.replace(/\\/g, '/')
function g(cwd, ...a) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

// A project with an origin: main pushed, .claude/ excluded; returns helpers.
function scratch() {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'wt-clean-')))
  const main = join(parent, repo)
  const origin = join(parent, 'origin.git')
  mkdirSync(main)
  g(parent, 'init', '-q', '--bare', '-b', 'main', origin)
  g(main, 'init', '-q', '-b', 'main')
  writeFileSync(join(main, '.git', 'info', 'exclude'), '.claude/\n')
  writeFileSync(join(main, 'a.txt'), 'a\n')
  g(main, 'add', '-A')
  g(main, 'commit', '-q', '-m', 'base')
  g(main, 'remote', 'add', 'origin', origin)
  g(main, 'push', '-q', '-u', 'origin', 'main')
  const at = (name) => join(parent, `${repo}-${name}`)
  const commit = (dir, msg) => { writeFileSync(join(dir, `${msg}.txt`), msg); g(dir, 'add', '-A'); g(dir, 'commit', '-q', '-m', msg) }
  const status = (run, phase) => {
    mkdirSync(join(main, '.claude', 'orchestrator-runs', run), { recursive: true })
    writeFileSync(join(main, '.claude', 'orchestrator-runs', run, 'status.json'), JSON.stringify({ phase, updatedAt: new Date().toISOString() }))
  }
  return { parent, main, at, commit, status, done: () => rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
}

const lineFor = (lines, path) => lines.find((l) => norm(l).toLowerCase().startsWith(`${norm(path).toLowerCase()}:`)) ?? `(no line for ${path}: ${lines.join(' | ')})`

test('the sweep removes every kit-made folder whose work is safe elsewhere, keeps the rest with a reason, and never touches other folders', () => {
  const s = scratch()
  try {
    const { main, at, commit } = s
    // removed
    g(main, 'worktree', 'add', '-q', '-b', 'feat/001-a', at('orch-old-001'))
    commit(at('orch-old-001'), 'w001')
    g(at('orch-old-001'), 'push', '-q', 'origin', `feat/001-a:${runPrefix}old`)
    g(main, 'fetch', '-q', 'origin')
    g(main, 'worktree', 'add', '-q', '-b', 'fix/541-x', at('fix-541'))
    g(main, 'worktree', 'add', '-q', '-b', 'chore/gone', at('scratch-gone'))
    commit(at('scratch-gone'), 'gone')
    g(at('scratch-gone'), 'push', '-q', '-u', 'origin', 'chore/gone')
    g(main, 'push', '-q', 'origin', '--delete', 'chore/gone')
    g(main, 'fetch', '-q', '--prune', 'origin')
    g(main, 'worktree', 'add', '-q', '--detach', at('orch-review-old-009'), 'origin/main')
    g(main, 'branch', '--no-track', `${runPrefix}fin`, 'main')
    g(main, 'worktree', 'add', '-q', at('orch-merge-fin'), `${runPrefix}fin`)
    commit(at('orch-merge-fin'), 'fin')
    g(at('orch-merge-fin'), 'push', '-q', 'origin', `${runPrefix}fin`)
    g(main, 'fetch', '-q', 'origin')
    s.status('fin', 'finished')
    mkdirSync(join(main, '.claude', 'worktrees'), { recursive: true })
    g(main, 'worktree', 'add', '-q', '-b', 'worktree-cc', join(main, '.claude', 'worktrees', 'cc'))
    // kept
    g(main, 'worktree', 'add', '-q', '-b', 'feat/002-b', at('orch-old-002'))
    commit(at('orch-old-002'), 'w002')
    g(main, 'worktree', 'add', '-q', '-b', 'feat/003-c', at('orch-old-003'))
    writeFileSync(join(at('orch-old-003'), 'wip.txt'), 'not committed\n')
    g(main, 'worktree', 'add', '-q', '-b', 'park/old-004', at('orch-old-004'))
    g(main, 'worktree', 'add', '-q', '-b', 'feat/005-e', at('orch-old-005'))
    mkdirSync(join(main, '.claude', 'sessions', 'orch-old'), { recursive: true })
    writeFileSync(join(main, '.claude', 'sessions', 'orch-old', 'handoff-005.md'), `Folder: ${norm(at('orch-old-005'))}\n`)
    g(main, 'worktree', 'add', '-q', '-b', 'feat/006-f', at('orch-live-006'))
    s.status('live', 'running')
    g(main, 'worktree', 'add', '-q', '--detach', at('review-010'), 'main')
    commit(at('review-010'), 'lost')
    g(main, 'branch', 'local-only', 'main')
    g(main, 'worktree', 'add', '-q', '--detach', at('review-011'), 'main')
    commit(at('review-011'), 'local')
    g(at('review-011'), 'branch', '-f', 'local-only', 'HEAD')
    g(main, 'branch', '--no-track', `${runPrefix}unp`, 'main')
    g(main, 'worktree', 'add', '-q', at('orch-merge-unp'), `${runPrefix}unp`)
    commit(at('orch-merge-unp'), 'unp')
    g(main, 'worktree', 'add', '-q', '-b', 'fix/lock', at('fix-lock'))
    g(main, 'worktree', 'lock', at('fix-lock'))
    mkdirSync(at('orch-old-020'))
    mkdirSync(at('orch-old-021-stale-1731200000000'))
    // never touched
    g(main, 'worktree', 'add', '-q', '-b', 'chore/mine', at('mvp-review'))
    const slot = join(s.parent, `${repo}${slotSuffix.replace('N', '1')}`)
    g(main, 'worktree', 'add', '-q', '--detach', slot, 'main')

    const lines = wc.sweep({ root: main, youngMs: 0 })
    const removed = { 'orch-old-001': /removed — feat\/001-a is merged into origin\/.*old \(branch kept\)/, 'fix-541': /removed — fix\/541-x is merged into origin\/main/, 'scratch-gone': /removed — chore\/gone was merged and its remote branch deleted/, 'orch-review-old-009': /removed — its commit is on .* \(detached\)/ }
    for (const [name, re] of Object.entries(removed)) {
      assert.match(lineFor(lines, at(name)), re, name)
      assert.equal(existsSync(at(name)), false, `${name} is gone`)
    }
    assert.match(lineFor(lines, join(main, '.claude', 'worktrees', 'cc')), /removed — worktree-cc is merged into origin\/main/)
    assert.equal(existsSync(join(main, '.claude', 'worktrees', 'cc')), false)
    assert.ok(g(main, 'branch', '--list', 'feat/001-a').includes('feat/001-a'), 'the local branch is kept')
    const kept = { 'orch-old-002': /kept — feat\/002-b is not merged/, 'orch-old-003': /kept — it has uncommitted files/, 'orch-old-004': /kept — it is on park\/old-004/, 'orch-old-005': /kept — a parked plan's hand-off names it/, 'orch-live-006': /kept — run live is live/, 'review-010': /kept — it is on no branch and its commit is on no origin branch/, 'review-011': /kept — it is on no branch and its commit is on no origin branch/, 'orch-merge-unp': /kept — .*unp is not merged into origin\/main/, 'orch-merge-fin': /kept — .*fin is not merged into origin\/main \(the run's grade and lessons still use this folder\)/, 'fix-lock': /kept — git has it locked/, 'orch-old-020': /kept — git does not list it as a worktree/ }
    for (const [name, re] of Object.entries(kept)) {
      assert.match(lineFor(lines, at(name)), re, name)
      assert.ok(existsSync(at(name)), `${name} stays`)
    }
    assert.match(lineFor(lines, at('orch-old-021-stale-1731200000000')), /removed — an earlier removal moved it aside/)
    assert.equal(existsSync(at('mvp-review')), true, 'the Human\'s own folder stays')
    assert.equal(existsSync(slot), true, 'a permanent slot stays')
    for (const p of [at('mvp-review'), slot, main]) assert.ok(!lines.some((l) => norm(l).toLowerCase().startsWith(`${norm(p).toLowerCase()}:`)), `no line for ${p}`)
  } finally {
    s.done()
  }
})

test('a sweep keeps an agent folder made in the last two hours; --path judges it at once', () => {
  const s = scratch()
  try {
    g(s.main, 'worktree', 'add', '-q', '-b', 'fix/young', s.at('fix-young'))
    assert.match(lineFor(wc.sweep({ root: s.main }), s.at('fix-young')), /kept — made less than 120 minutes ago/)
    const wt = wc.listWorktrees(s.main).find((w) => w.path.toLowerCase().endsWith('fix-young'))
    const r = wc.cleanOne(norm(s.main), wt, { repo, live: new Set(), handoffs: [], youngMs: 0 })
    assert.match(r.line, /removed — fix\/young is merged into origin\/main/)
  } finally {
    s.done()
  }
})

test('a folder git cannot remove (Windows "Directory not empty", a held file): 3 tries, then the script deletes it; when that fails too, one kept line and the sweep goes on', () => {
  const s = scratch()
  try {
    g(s.main, 'worktree', 'add', '-q', '-b', 'fix/held', s.at('fix-held'))
    let tries = 0
    const failingGit = (cwd, ...a) => (a[0] === 'worktree' && a[1] === 'remove' ? (tries++, { status: 1, out: '', err: "error: failed to delete 'x': Directory not empty" }) : wc.gitIn(cwd, ...a))
    const r = wc.removeWorktree(s.main, s.at('fix-held'), { git: failingGit, waitMs: 1 })
    assert.equal(tries, 3)
    assert.equal(r.ok, true)
    assert.match(r.note, /git worktree remove failed: .*Directory not empty; deleted by script/)
    assert.equal(existsSync(s.at('fix-held')), false)
    assert.ok(!wc.listWorktrees(s.main).some((w) => w.path.toLowerCase().endsWith('fix-held')), 'git no longer lists it')

    g(s.main, 'worktree', 'add', '-q', '-b', 'fix/held2', s.at('fix-held2'))
    g(s.main, 'worktree', 'add', '-q', '-b', 'fix/next', s.at('fix-next'))
    const stuck = (root, path) => (path.endsWith('held2') ? { ok: false, note: 'could not remove: Directory not empty; EBUSY — a server, editor or shell may still hold it' } : wc.removeWorktree(root, path))
    const lines = wc.sweep({ root: s.main, youngMs: 0, remove: stuck })
    assert.match(lineFor(lines, s.at('fix-held2')), /kept — could not remove: .*may still hold it/)
    assert.match(lineFor(lines, s.at('fix-next')), /removed —/, 'the sweep went on')
  } finally {
    s.done()
  }
})

test('the agent helper makes <repo>-<name> beside the project and removes it by the same rules', () => {
  const s = scratch()
  try {
    const a = wc.addWorktree(s.main, 'scratch-t1', { branch: 'chore/t1' })
    assert.equal(a.ok, true, a.error)
    assert.equal(norm(a.path).toLowerCase(), norm(s.at('scratch-t1')).toLowerCase())
    assert.equal(g(s.at('scratch-t1'), 'branch', '--show-current'), 'chore/t1')
    assert.match(wc.addWorktree(s.main, 'mine', { branch: 'x' }).error, /starts with review-, fix- or scratch-/)
    assert.match(wc.addWorktree(s.main, 'scratch-t1', { branch: 'chore/t1' }).error, /exists already/)
    const d = wc.addWorktree(s.main, 'review-113', { detach: 'origin/main' })
    assert.equal(d.ok, true, d.error)
    writeFileSync(join(a.path, 'wip.txt'), 'x\n')
    const opts = { repo, live: new Set(), handoffs: [], youngMs: 0 }
    const find = (end) => wc.listWorktrees(s.main).find((w) => w.path.toLowerCase().endsWith(end))
    assert.match(wc.cleanOne(norm(s.main), find('scratch-t1'), opts).line, /kept — it has uncommitted files/)
    assert.match(wc.cleanOne(norm(s.main), find('review-113'), opts).line, /removed — its commit is on .* \(detached\)/)
  } finally {
    s.done()
  }
})

test('prune-merged-worktrees.sh no longer force-deletes: it hands each folder to worktree-clean.mjs', () => {
  const sh = readFileSync(join(kit, 'core', 'scripts', 'prune-merged-worktrees.sh'), 'utf8')
  assert.ok(!/--force/.test(sh), 'no --force')
  assert.ok(!/rm -rf/.test(sh), 'no rm -rf')
  assert.match(sh, /worktree-clean\.mjs" --path/)
})

test('run from a slot, the sweep reads the main checkout\'s run state: a live run\'s builder folder stays', () => {
  const s = scratch()
  try {
    const slot = join(s.parent, `${repo}${slotSuffix.replace('N', '2')}`)
    g(s.main, 'worktree', 'add', '-q', '--detach', slot, 'main')
    g(s.main, 'worktree', 'add', '-q', '-b', 'feat/007-g', s.at('orch-busy-007'))
    s.status('busy', 'running')
    const lines = wc.sweep({ root: slot, youngMs: 0 })
    assert.match(lineFor(lines, s.at('orch-busy-007')), /kept — run busy is live/)
    assert.ok(existsSync(s.at('orch-busy-007')))
    assert.ok(!lines.some((l) => norm(l).toLowerCase().startsWith(`${norm(s.main).toLowerCase()}:`)), 'the main folder is never judged')
  } finally {
    s.done()
  }
})

test('when git refuses and the folder has changed since it was judged, the scripted delete does not run', () => {
  const s = scratch()
  try {
    g(s.main, 'worktree', 'add', '-q', '-b', 'fix/late', s.at('fix-late'))
    const refuse = (cwd, ...a) => {
      if (a[0] === 'worktree' && a[1] === 'remove') {
        writeFileSync(join(s.at('fix-late'), 'saved-late.txt'), 'new work\n')
        return { status: 1, out: '', err: 'fatal: contains modified or untracked files' }
      }
      return wc.gitIn(cwd, ...a)
    }
    let deleted = false
    const r = wc.removeWorktree(s.main, s.at('fix-late'), { git: refuse, waitMs: 1, rmFolder: () => { deleted = true; return { ok: true } } })
    assert.equal(r.ok, false)
    assert.match(r.note, /new changes since it was judged/)
    assert.equal(deleted, false)
    assert.ok(existsSync(join(s.at('fix-late'), 'saved-late.txt')))
  } finally {
    s.done()
  }
})
