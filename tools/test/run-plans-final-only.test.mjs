// A relaunch whose plans are all merged but whose final gate was cut off (killed during it: phase still `running`, no
// finalGate) runs the final gate only and finishes; a run that finished with its final gate ok still has nothing to do.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeProject, toyPlan } from './lib/run-plans-fixture.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))

test('a relaunch after a final gate that was cut off runs the final gate only, then finishes', () => {
  const p = makeProject({ kit, name: 'final-only' })
  try {
    p.addPlans({ 451: toyPlan(451) })
    const first = p.runPlans(['--run', 'fo', '--plans', '451'])
    assert.equal(first.status, 0, first.out.split('\n').slice(-5).join('\n'))
    // A finished run with its final gate ok: a relaunch has nothing to do.
    const again = p.runPlans(['--run', 'fo', '--plans', '451'])
    assert.match(again.out, /nothing to build — every plan is already done/)
    // The cut-off final gate: the process died during it (no finalGate in status.json), and the death was recorded as a
    // stop, as the supervisor or /orchestrate step 3 does (orch-state.mjs stop).
    const file = join(p.proj, '.claude', 'orchestrator-runs', 'fo', 'status.json')
    const st = JSON.parse(readFileSync(file, 'utf8'))
    st.phase = 'running'
    delete st.finalGate
    writeFileSync(file, JSON.stringify(st, null, 2))
    assert.equal(p.state('stop', '--run', 'fo', '--reason', 'killed during the final gate').status, 0)
    const dry = p.runPlans(['--dry-run', '--run', 'fo', '--plans', '451'])
    assert.match(dry.out, /WOULD START: yes — the final gate only/)
    const r = p.runPlans(['--run', 'fo', '--plans', '451'])
    assert.match(r.out, /running the final gate only/)
    assert.match(r.out, /RUN_PLANS: final gate on orch\/fo/)
    assert.equal(r.calls.length, 0, 'no model call')
    assert.equal(r.status, 0, r.out.split('\n').slice(-5).join('\n'))
    const after = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(after.phase, 'finished')
    assert.equal(after.finalGate?.ok, true)
  } finally {
    p.cleanup()
  }
})
