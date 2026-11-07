// Plan 083 M1: a merge of a plan already built and checked is pinned to its checked head; a plan with no recorded
// checked head, or whose branch moved past it, is refused. The installed orch-state.mjs (set --checked-head,
// merge-ready, merge-verify) runs on a scratch repository with a bare origin.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, cpSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit

const of = (r, type) => r.calls.filter((c) => c.type === type)

const sh = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
// Plan 088 M4 (plan 085 M1, shape A): merge-verify in the merge folder, after `git merge --no-ff` and before any push.
test('merge-verify: HEAD^2 == checkedHead passes; another sha is refused with both shas and the merge folder reset to HEAD^; no checked head merges unpinned with a note', () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'orch-mv-')))
  const bare = realpathSync(mkdtempSync(join(tmpdir(), 'orch-mv-bare-')))
  try {
    const dir = join(parent, 'main')
    mkdirSync(join(dir, 'plans'), { recursive: true })
    sh(dir, 'init', '-q', '-b', 'main')
    sh(dir, 'config', 'user.email', 't@t')
    sh(dir, 'config', 'user.name', 't')
    for (const n of ['085', '086', '087']) writeFileSync(join(dir, 'plans', `${n}-x.plan.md`), `# Plan ${n} — X\n\nStatus: active\nDepends-on: none\n`)
    sh(dir, 'add', '-A')
    sh(dir, 'commit', '-q', '-m', 'plans')
    sh(bare, 'init', '-q', '--bare', '-b', 'main')
    sh(dir, 'remote', 'add', 'origin', bare)
    sh(dir, 'push', '-q', '-u', 'origin', 'main')
    cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
    writeFileSync(join(dir, '.git', 'info', 'exclude'), 'scripts/\n.claude/\n')
    const state = (...a) => {
      const r = spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), ...a], { cwd: dir, encoding: 'utf8', timeout: 120000 })
      const line = String(r.stdout).split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
      assert.ok(line, `${a.join(' ')}: ${r.stdout}${r.stderr}`)
      return { ...JSON.parse(line.slice('ORCH_JSON '.length)), exit: r.status }
    }
    const init = state('init', '--run=mv')
    assert.equal(init.ok, true, JSON.stringify(init))
    const mf = init.mergeFolder
    // three plan branches on origin, one commit each
    const heads = {}
    for (const n of ['085', '086', '087']) {
      assert.equal(state('plan-info', '--run=mv', `--plan=${n}`).ok, true)
      sh(dir, 'switch', '-q', '-c', `feat/${n}-x`, 'origin/orch/mv')
      writeFileSync(join(dir, `${n}.txt`), `${n}\n`)
      sh(dir, 'add', `${n}.txt`)
      sh(dir, 'commit', '-q', '-m', `work ${n}`)
      sh(dir, 'push', '-q', 'origin', `feat/${n}-x`)
      heads[n] = sh(dir, 'rev-parse', 'HEAD')
      sh(dir, 'switch', '-q', 'main')
    }
    const merge = (n) => {
      sh(mf, 'fetch', '-q', 'origin')
      sh(mf, 'merge', '--no-ff', '--no-edit', '-m', `Merge feat/${n}-x into orch/mv (plan ${n})`, `origin/feat/${n}-x`)
      return sh(mf, 'rev-parse', 'HEAD')
    }
    // (a) the checked head is the merged one
    state('set', '--run=mv', '--plan=085', `--checked-head=${heads['085']}`)
    const m1 = merge('085')
    const ok = state('merge-verify', '--run=mv', '--plan=085')
    assert.deepEqual([ok.ok, ok.pinned, ok.sha, ok.merged], [true, true, m1, heads['085']], JSON.stringify(ok))
    sh(mf, 'push', '-q', 'origin', 'HEAD:refs/heads/orch/mv')
    // (b) the branch moved after its checks: refused, both shas, the merge folder back at HEAD^, origin untouched
    state('set', '--run=mv', '--plan=086', `--checked-head=${heads['086']}`)
    sh(dir, 'switch', '-q', 'feat/086-x')
    writeFileSync(join(dir, '086.txt'), 'moved\n')
    sh(dir, 'commit', '-qam', 'moved after the checks')
    sh(dir, 'push', '-q', 'origin', 'feat/086-x')
    const moved = sh(dir, 'rev-parse', 'HEAD')
    sh(dir, 'switch', '-q', 'main')
    const before = sh(mf, 'rev-parse', 'HEAD')
    merge('086')
    const no = state('merge-verify', '--run=mv', '--plan=086')
    assert.equal(no.ok, false)
    assert.equal(no.exit, 1)
    assert.equal(no.refused, true)
    assert.equal(no.error, `the branch moved after its checks: the merge took ${moved} but the checked head is ${heads['086']}`)
    assert.equal(sh(mf, 'rev-parse', 'HEAD'), before, 'the merge folder is reset to HEAD^')
    assert.equal(sh(mf, 'rev-parse', 'origin/orch/mv'), m1, 'origin never saw the refused merge')
    assert.equal(sh(mf, 'status', '--porcelain'), '')
    // (c) no checked head (an older status.json): merged unpinned, a run note says so
    merge('087')
    const unpinned = state('merge-verify', '--run=mv', '--plan=087')
    assert.deepEqual([unpinned.ok, unpinned.pinned], [true, false], JSON.stringify(unpinned))
    const st = JSON.parse(readFileSync(join(dir, '.claude', 'orchestrator-runs', 'mv', 'status.json'), 'utf8'))
    assert.ok(st.notes.some((n) => n.plan === '087' && /merge pin not checked/.test(n.text)), JSON.stringify(st.notes))
  } finally {
    rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    rmSync(bare, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('merge-ready: ready at the checked head; refused with no checked head and after the branch moved', () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'orch-mo-')))
  const bare = realpathSync(mkdtempSync(join(tmpdir(), 'orch-mo-bare-')))
  try {
    const dir = join(parent, 'main')
    mkdirSync(join(dir, 'plans'), { recursive: true })
    sh(dir, 'init', '-q', '-b', 'main')
    sh(dir, 'config', 'user.email', 't@t')
    sh(dir, 'config', 'user.name', 't')
    writeFileSync(join(dir, 'plans', '065-x.plan.md'), '# Plan 065 — X\n\nStatus: active\nDepends-on: none\n')
    sh(dir, 'add', '-A')
    sh(dir, 'commit', '-q', '-m', 'plan')
    sh(bare, 'init', '-q', '--bare', '-b', 'main')
    sh(dir, 'remote', 'add', 'origin', bare)
    sh(dir, 'push', '-q', '-u', 'origin', 'main')
    cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
    writeFileSync(join(dir, '.git', 'info', 'exclude'), 'scripts/\n.claude/\n')
    const state = (...a) => {
      const r = spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), ...a], { cwd: dir, encoding: 'utf8', timeout: 120000 })
      const line = String(r.stdout).split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
      assert.ok(line, `${a.join(' ')}: ${r.stdout}${r.stderr}`)
      return JSON.parse(line.slice('ORCH_JSON '.length))
    }
    const init = state('init', '--run=run-065')
    assert.equal(init.ok, true, JSON.stringify(init))
    const info = state('plan-info', '--run=run-065', '--plan=065')
    assert.equal(info.ok, true, JSON.stringify(info))
    // the plan branch on origin, one commit ahead
    sh(dir, 'switch', '-q', '-c', 'feat/065-x')
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    sh(dir, 'add', 'a.txt')
    sh(dir, 'commit', '-q', '-m', 'work')
    sh(dir, 'push', '-q', 'origin', 'feat/065-x')
    const head = sh(dir, 'rev-parse', 'HEAD')
    const none = state('merge-ready', '--run=run-065', '--plan=065')
    assert.equal(none.ready, false)
    assert.match(none.why, /^no checked head recorded for plan 065/)
    const set = state('set', '--run=run-065', '--plan=065', '--state=parked', `--checked-head=${head}`)
    assert.equal(set.ok, true, JSON.stringify(set))
    const ok = state('merge-ready', '--run=run-065', '--plan=065')
    assert.deepEqual([ok.ready, ok.branch, ok.head], [true, 'feat/065-x', head], JSON.stringify(ok))
    writeFileSync(join(dir, 'a.txt'), 'b\n')
    sh(dir, 'commit', '-qam', 'more')
    sh(dir, 'push', '-q', 'origin', 'feat/065-x')
    const moved = state('merge-ready', '--run=run-065', '--plan=065')
    assert.equal(moved.ready, false)
    assert.match(moved.why, /not the checked head/)
  } finally {
    rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    rmSync(bare, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
