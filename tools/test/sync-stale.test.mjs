// The rendered run script bakes orchestrator.prepare and orchestrator.ciMirror in at install/sync time: when the config
// changes them later, sync's dry run and drift-check say scripts/run-plans.mjs is stale.
//   node --test tools/test/sync-stale.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const CFG = { project: { name: 'core-only' }, stack: { packs: [] }, commands: { build: 'build', lint: 'lint', test: 'test' }, hooks: { shellPath: 'bash' } }
const node = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd })
const LINE = 'STALE_RENDER: scripts/run-plans.mjs — run sync --apply'

test('a changed orchestrator.prepare or ciMirror makes sync (dry run) and drift-check print STALE_RENDER; matching config prints nothing', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sync-stale-')))
  try {
    const cfg = (orchestrator) => writeFileSync(join(dir, 'kit.config.json'), JSON.stringify({ ...CFG, ...(orchestrator ? { orchestrator } : {}) }, null, 2))
    cfg(null)
    const inst = node(join(kit, 'tools', 'install.mjs'), ['--target', dir, '--allow-unfilled'])
    assert.equal(inst.status, 0, inst.stdout + inst.stderr)
    const sync = () => node(join(kit, 'tools', 'sync.mjs'), ['--target', dir, '--source', kit], dir)
    const drift = () => node(join(kit, 'tools', 'drift-check.mjs'), ['--target', dir, '--source', kit], dir)
    // fresh install: nothing stale
    assert.doesNotMatch(sync().stdout, /STALE_RENDER/)
    assert.doesNotMatch(drift().stdout, /STALE_RENDER/)
    for (const orchestrator of [{ prepare: [{ missing: 'src/gen', script: 'gen' }] }, { ciMirror: ['npm run lint'] }]) {
      cfg(orchestrator)
      const s = sync()
      assert.ok(s.stdout.split('\n').includes(LINE), `sync dry run: ${JSON.stringify(orchestrator)}\n${s.stdout}${s.stderr}`)
      const d = drift()
      assert.ok(d.stdout.split('\n').includes(LINE), `drift-check: ${JSON.stringify(orchestrator)}\n${d.stdout}${d.stderr}`)
      // after an apply the rendered file matches the config again
      const a = node(join(kit, 'tools', 'sync.mjs'), ['--target', dir, '--source', kit, '--apply'], dir)
      assert.equal(a.status, 0, a.stdout + a.stderr)
      assert.doesNotMatch(sync().stdout, /STALE_RENDER/)
      assert.doesNotMatch(drift().stdout, /STALE_RENDER/)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
