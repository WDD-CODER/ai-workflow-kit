// The live view of a run (plan 112): while a gate check runs, live-<NNN>.json names it; the builder's streamed call
// lands in builder-<NNN>.events.jsonl and its live line counts what the stream did; the plan still merges.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeProject, toyPlan } from './lib/run-plans-fixture.mjs'
import { builderAfter } from '../../core/scripts/lib/run-live.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))

// The project's test script also copies every live file of the main folder's runs into .git/live-snap.jsonl, so the
// test sees what the live file held while that gate check ran (the gate runs in the plan's own worktree).
const SNAP = [
  "import { execFileSync } from 'node:child_process'",
  "import { readdirSync, readFileSync, appendFileSync, existsSync } from 'node:fs'",
  "import { join, dirname } from 'node:path'",
  "const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim()",
  "const runs = join(dirname(common), '.claude', 'orchestrator-runs')",
  'for (const r of existsSync(runs) ? readdirSync(runs) : []) {',
  '  let names = []',
  '  try { names = readdirSync(join(runs, r)) } catch { continue }',
  "  for (const f of names.filter((n) => /^live-.*\\.json$/.test(n))) appendFileSync(join(common, 'live-snap.jsonl'), `${JSON.stringify({ file: f, live: JSON.parse(readFileSync(join(runs, r, f), 'utf8')) })}\\n`)",
  '}',
  '',
].join('\n')

test('a run writes the gate check running now, the builder stream and its counts, and still merges', () => {
  const p = makeProject({ kit, name: 'live-app', files: { 'snap-live.mjs': SNAP }, scripts: { test: 'node gate-check.mjs && node snap-live.mjs' } })
  try {
    p.addPlans({ 461: toyPlan(461) })
    const r = p.runPlans(['--run', 'lv', '--plans', '461'])
    assert.equal(r.status, 0, r.out.split('\n').slice(-8).join('\n'))
    assert.equal(p.status('lv').plans['461'].state, 'merged')
    // The builder was asked for a stream.
    const builder = r.calls.find((c) => c.role === 'builder')
    assert.ok(builder.argv.includes('stream-json') && builder.argv.includes('--verbose'), builder.argv.join(' '))
    const reviewer = r.calls.find((c) => c.role === 'reviewer')
    assert.ok(reviewer.argv.includes('json') && !reviewer.argv.includes('stream-json'), 'the reviewer keeps the JSON mode')
    // While the plan's gate ran its test check, live-461.json named that check.
    const snaps = readFileSync(join(p.proj, '.git', 'live-snap.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    const atGate = snaps.find((s) => s.file === 'live-461.json' && s.live.step === 'gate')
    assert.ok(atGate, JSON.stringify(snaps))
    assert.match(atGate.live.gate.command, /test/)
    assert.ok(atGate.live.gate.index >= 1 && atGate.live.gate.index <= atGate.live.gate.total)
    assert.ok(!Number.isNaN(Date.parse(atGate.live.gate.startedAt)))
    // The final gate has its own live file.
    assert.ok(snaps.some((s) => s.file === 'live-final.json' && s.live.step === 'final-gate' && /test/.test(s.live.gate?.command ?? '')))
    // The builder's stream is kept, and replaying it gives the fake's counts (two tools, 70 in and 10 out each).
    const runDir = join(p.proj, '.claude', 'orchestrator-runs', 'lv')
    const events = readFileSync(join(runDir, 'builder-461.events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    assert.deepEqual(events.map((e) => e.type), ['system', 'assistant', 'rate_limit_event', 'assistant', 'result', 'system'])
    let b = null
    const usage = new Map()
    for (const e of events) b = builderAfter(b, e, usage)
    assert.deepEqual({ tools: b.tools, lastTool: b.lastTool, lastTarget: b.lastTarget, tokensIn: b.tokensIn, tokensOut: b.tokensOut }, { tools: 2, lastTool: 'Bash', lastTarget: 'git commit -q -m toy', tokensIn: 140, tokensOut: 20 })
    // At the end the live file holds the last step only.
    const last = JSON.parse(readFileSync(join(runDir, 'live-461.json'), 'utf8'))
    assert.equal(last.step, 'merged')
    assert.equal(last.builder, undefined)
    assert.ok(existsSync(join(runDir, 'calls.csv')))
  } finally {
    p.cleanup()
  }
})
