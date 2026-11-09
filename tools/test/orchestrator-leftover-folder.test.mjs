// A builder folder an earlier run left half-deleted (Windows: `git worktree remove` fails on node_modules with
// "Directory not empty" and leaves a folder that is no longer a worktree) is removed and made fresh, not reused:
// the plan merges instead of parking on "is on (no branch)". removeFolder renames a folder aside when it cannot delete it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeProject, toyPlan } from './lib/run-plans-fixture.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const folders = await import(pathToFileURL(join(kit, 'core', 'scripts', 'lib', 'orch-folders.mjs')).href)

test('a leftover builder folder that is no longer a worktree is removed and made fresh; the plan merges', () => {
  const p = makeProject({ kit, name: 'left-app' })
  try {
    p.addPlans({ 451: toyPlan(451) })
    const left = join(p.root, 'left-app-orch-lo-451')
    mkdirSync(join(left, 'node_modules', '.pnpm'), { recursive: true })
    writeFileSync(join(left, 'node_modules', '.pnpm', 'half.txt'), 'an interrupted delete\n')
    assert.equal(folders.isWorktree(p.proj, left), false)
    const r = p.runPlans(['--run', 'lo', '--plans', '451'])
    assert.equal(r.status, 0, r.out.split('\n').slice(-6).join('\n'))
    assert.doesNotMatch(r.out, /is on \(no branch\)/)
    assert.equal(p.status('lo').plans['451'].state, 'merged')
  } finally {
    p.cleanup()
  }
})

test('removeFolder deletes a folder git does not track, and isWorktree tells a worktree from a plain folder', () => {
  const d = mkdtempSync(join(tmpdir(), 'kit-rf-'))
  try {
    const f = join(d, 'stale')
    mkdirSync(join(f, 'node_modules', 'x'), { recursive: true })
    writeFileSync(join(f, 'node_modules', 'x', 'a.js'), '1')
    assert.deepEqual(folders.removeFolder(f), { ok: true })
    assert.equal(existsSync(f), false)
    assert.equal(folders.isWorktree(kit, kit), true)
    assert.equal(folders.isWorktree(kit, d), false)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})
