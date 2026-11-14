// K8 (FoodVibe batch-3, 2026-11-13): an `approved:` answer must not park its plan, and must not leave the merge folder
// unable to fast-forward. The run owns the scope line: a line origin already holds gets no commit of the run; a push that
// loses a race tries again on the new origin; a merge folder whose only own commits are scope lines origin already holds
// is moved to origin (init and extendScope) instead of refusing. Scratch repositories with a bare origin.
//   node --test tools/test/approved-scope-resumes.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit
const runPlans = await import(pathToFileURL(join(root, 'scripts', 'run-plans.mjs')).href)

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const run = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8', env: ENV })
const sh = (cwd, ...a) => {
  const r = run(cwd, ...a)
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'orch-k8-')))
const drop = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })

const PLAN = 'plans/554-toy.plan.md'
const planText = (extra = []) => ['# Plan 554 — Toy', '', 'Status: active', 'Depends-on: none', '', '## Read-Write Scope', '', '```scope', 'src/554.txt', ...extra, '```', '', '## Atomic Sub-tasks', '', '- [ ] T1: build it', ''].join('\n')
const SUBJECT = 'plan(554): scope + src/554-extra.txt — the answer to ask 554-1 of run batch-3'

/** A project with a bare origin and the installed scripts; `state(...)` runs orch-state.mjs in it. */
function setup() {
  const parent = tmp()
  const dir = join(parent, 'main')
  mkdirSync(join(dir, 'plans'), { recursive: true })
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(dir, PLAN), planText())
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'plan')
  const bare = join(parent, 'origin.git')
  sh(parent, 'init', '-q', '--bare', '-b', 'main', bare)
  sh(dir, 'remote', 'add', 'origin', bare)
  sh(dir, 'push', '-q', '-u', 'origin', 'main')
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
  const statePath = join(dir, 'scripts', 'orch-state.mjs')
  writeFileSync(statePath, readFileSync(statePath, 'utf8').replace(/const USE_SLOTS = (true|false) !== false/, 'const USE_SLOTS = false !== false'))
  writeFileSync(join(dir, '.git', 'info', 'exclude'), 'scripts/\n.claude/\n.worktree-*\n')
  const state = (...a) => {
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), ...a], { cwd: dir, encoding: 'utf8', env: ENV, timeout: 120000 })
    const line = String(r.stdout).split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
    assert.ok(line, `${a.join(' ')}: ${r.stdout}${r.stderr}`)
    return JSON.parse(line.slice('ORCH_JSON '.length))
  }
  // A second clone: the Planner, who pushes to the run branch on its own.
  const planner = join(parent, 'planner')
  const pushFromPlanner = (branch, text, msg) => {
    if (run(parent, 'clone', '-q', bare, planner).status !== 0) sh(planner, 'fetch', '-q', 'origin')
    sh(planner, 'checkout', '-q', '-B', branch, `origin/${branch}`)
    writeFileSync(join(planner, PLAN), text)
    sh(planner, 'commit', '-q', '-am', msg)
    sh(planner, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`)
  }
  return { parent, dir, bare, state, pushFromPlanner }
}

/** The merge folder holds an unpushed scope-answer commit; the Planner pushed the same line (and a merge of main). */
function divergedMergeFolder(t, { localExtra = 'src/554-extra.txt', subject = SUBJECT } = {}) {
  const init = t.state('init', '--run=batch-3')
  assert.equal(init.ok, true, JSON.stringify(init))
  const mf = init.mergeFolder
  t.pushFromPlanner('orch/batch-3', planText(['src/554-extra.txt']), 'plan(554): the Planner adds src/554-extra.txt')
  writeFileSync(join(mf, PLAN), planText([localExtra]))
  sh(mf, 'commit', '-q', '-am', subject)
  sh(mf, 'fetch', '-q', 'origin')
  assert.notEqual(run(mf, 'merge', '--ff-only', 'origin/orch/batch-3').status, 0, 'the merge folder has diverged')
  return mf
}

test('init: a merge folder whose only own commit is a scope line origin already holds is moved to origin, not refused', () => {
  const t = setup()
  try {
    const mf = divergedMergeFolder(t)
    const again = t.state('init', '--run=batch-3')
    assert.equal(again.ok, true, JSON.stringify(again))
    assert.equal(sh(mf, 'rev-parse', 'HEAD'), sh(t.dir, 'rev-parse', 'origin/orch/batch-3'))
    assert.equal(sh(mf, 'status', '--porcelain'), '')
  } finally {
    drop(t.parent)
  }
})

test('init still refuses a merge folder with a scope line origin does not hold, or a commit that is not a scope answer', () => {
  for (const opts of [{ localExtra: 'src/554-other.txt', subject: SUBJECT.replace('554-extra', '554-other') }, { subject: 'merge: something else' }]) {
    const t = setup()
    try {
      const mf = divergedMergeFolder(t, opts)
      const head = sh(mf, 'rev-parse', 'HEAD')
      const again = t.state('init', '--run=batch-3')
      assert.equal(again.ok, false, JSON.stringify(again))
      assert.match(again.error, /cannot fast-forward to origin\/orch\/batch-3/)
      assert.equal(sh(mf, 'rev-parse', 'HEAD'), head, 'the folder is left as it was')
    } finally {
      drop(t.parent)
    }
  }
})

// extendScope runs git in this process: give it the test's git identity (CI has none of its own).
const extend = (mf) => {
  const keys = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  Object.assign(process.env, Object.fromEntries(keys.map((k) => [k, ENV[k]])))
  try {
    return runPlans.extendScope({ mergeFolder: mf, runBranch: 'orch/batch-3', planPath: PLAN, paths: ['src/554-extra.txt'], id: '554-1', run: 'batch-3', nnn: '554' })
  } finally {
    for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]
  }
}

test('extendScope: a leftover local scope commit whose line origin holds is dropped; the run adds no commit of its own', () => {
  const t = setup()
  try {
    const mf = divergedMergeFolder(t)
    const s = extend(mf)
    assert.deepEqual(s, { ok: true, added: [] })
    assert.equal(sh(mf, 'rev-parse', 'HEAD'), sh(mf, 'rev-parse', 'origin/orch/batch-3'))
    const scope = sh(t.bare, 'show', `orch/batch-3:${PLAN}`).split('\n').filter((l) => l === 'src/554-extra.txt')
    assert.equal(scope.length, 1, 'the line is on the run branch once')
  } finally {
    drop(t.parent)
  }
})

test('extendScope: a push that loses a race tries again on the new origin and lands the line (the plan resumes, not parks)', () => {
  const t = setup()
  try {
    const init = t.state('init', '--run=batch-3')
    assert.equal(init.ok, true, JSON.stringify(init))
    // The origin refuses the first push of a scope answer, as when the Planner pushed a merge of main a moment before.
    writeFileSync(join(t.bare, 'hooks', 'pre-receive'), '#!/bin/sh\nif [ ! -f lost-once ]; then touch lost-once; echo "rejected: fetch first" >&2; exit 1; fi\nexit 0\n', { mode: 0o755 })
    const s = extend(init.mergeFolder)
    assert.deepEqual(s, { ok: true, added: ['src/554-extra.txt'] })
    assert.equal(sh(init.mergeFolder, 'rev-parse', 'HEAD'), sh(t.bare, 'rev-parse', 'orch/batch-3'), 'the merge folder is not left ahead of origin')
    assert.match(sh(t.bare, 'log', '-1', '--format=%s', 'orch/batch-3'), /the answer to ask 554-1/)
  } finally {
    drop(t.parent)
  }
})
