// K11: merging main into a run branch clashed in docs/brain/run-log.md about ten times in two days, because every run
// appends its row at the same place. The installed .gitattributes (core/.gitattributes) marks the run log `merge=union`,
// and the reader folds what a union leaves behind (a row both sides rewrote, two `Earlier` lines) back into one row per run.
// A scratch repository: a full 20-row log, two branches each log one run with the kit's own writer, then a merge.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { pathToFileURL, fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit
const lib = await import(pathToFileURL(join(root, 'scripts', 'lib', 'orch-run.mjs')).href)

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' })
const sh = (cwd, ...a) => {
  const r = git(cwd, ...a)
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stdout}${r.stderr}`)
  return r.stdout.trim()
}
const LOG = 'docs/brain/run-log.md'
const status = (run, nnn) => ({ run, plans: { [nnn]: { nnn, state: 'merged', round: 1 } } })

test('two runs logged on two branches merge without a clash, one row per run', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'run-log-merge-')))
  try {
    sh(dir, 'init', '-q', '-b', 'main')
    sh(dir, 'config', 'user.email', 't@t')
    sh(dir, 'config', 'user.name', 't')
    sh(dir, 'config', 'core.autocrlf', 'false')
    cpSync(join(kit, 'core', '.gitattributes'), join(dir, '.gitattributes'))
    mkdirSync(join(dir, 'docs', 'brain'), { recursive: true })
    // Base: 20 runs logged (the table is full), the newest with its ✗ columns still `-`.
    let text = ''
    for (let i = 1; i <= 20; i++) {
      const date = `2026-10-${String(i).padStart(2, '0')}`
      text = lib.updateRunLog(text, lib.runLogRow({ status: status(`old-${i}`, String(100 + i)), merged: [{ nnn: String(100 + i) }], finalGate: 'ok', date }), [])
    }
    writeFileSync(join(dir, LOG), text)
    sh(dir, 'add', '-A')
    sh(dir, 'commit', '-q', '-m', 'base')
    sh(dir, 'branch', 'run/b')

    // Each side logs its own run: the oldest row rolls into the Earlier line and the previous newest row gets its
    // grades, from a different decision log on each side (main has one ✗ for plan 120, the run branch none).
    const log = (branch, run, nnn, decisions) => {
      sh(dir, 'switch', '-q', branch)
      const row = lib.runLogRow({ status: status(run, nnn), merged: [{ nnn }], finalGate: 'ok', date: '2026-11-13' })
      writeFileSync(join(dir, LOG), lib.updateRunLog(readFileSync(join(dir, LOG), 'utf8'), row, decisions))
      sh(dir, 'commit', '-q', '-am', run)
    }
    log('main', 'run-a', '201', [{ date: '2026-10-21', plan: '120', miss: 'missed something' }])
    log('run/b', 'run-b', '202', [])

    const m = git(dir, 'merge', '--no-edit', 'main')
    assert.equal(m.status, 0, `merge clashed in ${LOG}:\n${m.stdout}${m.stderr}`)
    const merged = readFileSync(join(dir, LOG), 'utf8')
    assert.doesNotMatch(merged, /^(<<<<<<<|=======|>>>>>>>)/m)
    assert.equal(merged.match(/^\| 2026-10-20 \| old-20 \|/gm).length, 2, 'the union kept both graded copies of the row')

    const { rows, earlier } = lib.parseRunLog(merged)
    const runs = rows.map((r) => r.run)
    assert.deepEqual(runs.filter((r, i) => runs.indexOf(r) !== i), [], `one row per run: ${runs.join(',')}`)
    assert.ok(runs.includes('run-a') && runs.includes('run-b'), `both new rows kept: ${runs.join(',')}`)
    assert.ok(!runs.includes('old-1'), 'the rolled row stays rolled')
    assert.match(earlier, /^Earlier \(1 runs\):/)

    // The next run writes a clean log again: 20 rows, one Earlier line, and the grades of the row both sides rewrote
    // recomputed from the merged decision log.
    const after = lib.updateRunLog(merged, lib.runLogRow({ status: status('run-c', '203'), merged: [{ nnn: '203' }], finalGate: 'ok', date: '2026-11-14' }), [{ date: '2026-10-21', plan: '120', miss: 'missed something' }])
    assert.equal(lib.parseRunLog(after).rows.find((r) => r.run === 'old-20').x, '1')
    assert.equal(lib.parseRunLog(after).rows.length, lib.RUN_LOG_KEEP)
    assert.equal(after.match(/^Earlier \(/gm).length, 1)
    assert.match(after, /^Earlier \(3 runs\):/m)
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
