import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  STARTS_RUN_RE,
  clockText,
  isLiveRun,
  parseCalls,
  planSteps,
  planView,
  runLines,
  runPercent,
  stageWords,
  stepBar,
  tokenText,
  watchText,
} from '../hooks/run-progress'

type Loose = (event: string, hook: (...args: never[]) => unknown) => unknown

const NOW = Date.parse('2026-10-30T10:00:00Z')
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const MIN = 60_000
const SEC = 1000

// -- pure ----------------------------------------------------------------------

test('% = (sum of stage weights) / plan count; merged and parked count as done; a gate counts its checks', () => {
  expect(runPercent({ plans: {} })).toBe(0)
  expect(runPercent({ plans: { '1': { state: 'merged' }, '2': { state: 'parked' } } })).toBe(100)
  // building 0.25 + gate 0.5 + checking 0.75 + merging 0.9 = 2.4 / 4 = 60%
  expect(runPercent({ plans: { '1': { state: 'building' }, '2': { state: 'gate' }, '3': { state: 'checking' }, '4': { state: 'merging' } } })).toBe(60)
  expect(runPercent({ plans: { '1': { state: 'queued' }, '2': { state: 'merged' } } })).toBe(50)
  expect(runPercent({ plans: { '1': { state: 'something-new' } } })).toBe(0)
  // Gate check 9 of 16: 0.5 + 0.25 * 8/16 = 0.625 → 63%
  expect(runPercent({ plans: { '1': { nnn: '1', state: 'gate' } } }, { '1': { gate: { index: 9, total: 16 } } })).toBe(63)
})

test('live: not finished or stopped, and its status.json changed within a day', () => {
  expect(isLiveRun({ phase: 'running' }, NOW - MIN, NOW)).toBe(true)
  expect(isLiveRun({ phase: 'finished' }, NOW - MIN, NOW)).toBe(false)
  expect(isLiveRun({ phase: 'stopped' }, NOW - MIN, NOW)).toBe(false)
  expect(isLiveRun({ phase: 'running' }, NOW - 25 * 60 * MIN, NOW)).toBe(false)
})

test('stage words, clocks and token counts are plain', () => {
  expect(stageWords({ state: 'gate' })).toBe('checks')
  expect(stageWords({ state: 'checking' })).toBe('reviewers')
  expect(stageWords({ state: 'merged' })).toBe('merged ✓')
  expect(stageWords({ state: 'parked', reason: 'build failed 3 times' })).toBe('parked: build failed 3 times')
  expect(stageWords({ state: 'fixing', round: 2 })).toBe('fixing (round 2)')
  expect(clockText(42 * SEC)).toBe('0:42')
  expect(clockText(12 * MIN + 5 * SEC)).toBe('12:05')
  expect(clockText(62 * MIN + 3 * SEC)).toBe('1:02:03')
  expect(tokenText(950)).toBe('950')
  expect(tokenText(210_400)).toBe('210k')
  expect(tokenText(1_140_000)).toBe('1.1M')
  expect(tokenText(2_000_000)).toBe('2M')
})

test('calls.csv rows are read, quoted commands included; the header and junk are skipped', () => {
  const csv = [
    'plan,stage,model,seconds,input_tokens,output_tokens,exit',
    '529,builder,sonnet,158.8,666633,11193,0',
    '529,"gate: node ""C:/x/kit-manifest-check.mjs"" --root .",-,0.3,0,0,0',
    'junk',
    '529,reviewer,sonnet,7.5,31879,513,0',
  ].join('\n')
  const rows = parseCalls(csv)
  expect(rows.length).toBe(3)
  expect(rows[1]!.stage).toBe('gate: node "C:/x/kit-manifest-check.mjs" --root .')
  expect(rows[0]!.input + rows[0]!.output + rows[2]!.input + rows[2]!.output).toBe(710_218)
})

test('the step bar: closed steps show their time, the running one a clock from when it started', () => {
  const merged = { state: 'merged', history: [
    { at: at(10 * MIN), state: 'building' }, { at: at(7 * MIN), state: 'gate' }, { at: at(3 * MIN), state: 'checking' },
    { at: at(2 * MIN), state: 'merging' }, { at: at(MIN), state: 'merged' },
  ] }
  expect(stepBar(planSteps(merged, NOW), NOW)).toBe('build 3:00 · gate 4:00 · review 1:00 · merge 1:00')
  // A fix round: build ran 2 min, the gate 1 min, now fixing for 30 s — the build clock carries on from 2:00.
  const fixing = { state: 'fixing', round: 1, history: [
    { at: at(3.5 * MIN), state: 'building' }, { at: at(1.5 * MIN), state: 'gate' }, { at: at(30 * SEC), state: 'fixing' },
  ] }
  const steps = planSteps(fixing, NOW)
  expect(stepBar(steps, NOW)).toBe('build ▶2:30 · gate 1:00 · review · merge')
  expect(stepBar(steps, NOW + 5 * SEC)).toBe('build ▶2:35 · gate 1:00 · review · merge')
})

test('panel lines: the run line, a plan line with its bar and facts, the gate and builder lines', () => {
  const calls = parseCalls('h\n531,builder,sonnet,60,100000,5000,0\n529,builder,sonnet,158.8,666633,11193,0\n529,reviewer,sonnet,7.5,31879,513,0')
  const p529 = planView('529', { nnn: '529', state: 'merged', history: [{ at: at(8 * MIN), state: 'building' }, { at: at(5 * MIN), state: 'gate' }, { at: at(MIN), state: 'checking' }, { at: at(50 * SEC), state: 'merging' }, { at: at(10 * SEC), state: 'merged' }] }, NOW, calls, null)
  const p531 = planView('531', { nnn: '531', state: 'building', round: 0, models: { builder: { model: 'sonnet' } }, history: [{ at: at(72 * SEC), state: 'building' }] }, NOW, calls,
    { step: 'building', builder: { tools: 23, lastTool: 'Edit', lastTarget: 'server/mcp/mongo.ts', tokensIn: 200_000, tokensOut: 10_000, at: at(3 * SEC) } })
  const p532 = planView('532', { nnn: '532', state: 'gate', history: [{ at: at(2 * MIN), state: 'gate' }] }, NOW, [], { step: 'gate', gate: { index: 4, total: 16, command: 'pnpm run test:ci', startedAt: at(42 * SEC) } })
  const p533 = planView('533', { nnn: '533', state: 'queued' }, NOW, [], null)
  const run = { name: 'run-519', percent: 63, stuck: false, startedAt: NOW - (14 * MIN + 2 * SEC), tokens: 1_140_000, plans: [p529, p531, p532, p533], finalGate: null, watch: 'RUNNING' }
  expect(runLines(run, NOW).map(l => l.text)).toEqual([
    'run run-519 · 63% · 14:02 · 1.1M tokens',
    '  529 ✓ merged ✓   build 3:00 · gate 4:00 · review 0:10 · merge 0:40   710k tokens',
    '  531 ▶ building   build ▶1:12 · gate · review · merge   sonnet · round 0 · 315k tokens',
    '      now: Edit server/mcp/mongo.ts · 23 tools · 210k tokens · 3 s ago',
    '  532 ▶ checks   build · gate ▶2:00 · review · merge   round 0',
    '      gate 4/16: pnpm run test:ci · 0:42',
    '  533 · waiting',
  ])
  // A builder line only while building; a gate line only at the gate.
  expect(planView('531', { nnn: '531', state: 'gate' }, NOW, [], { builder: { tools: 1 } }).builder).toBe(null)
})

test('a command that starts a run is recognised; others are not', () => {
  expect(STARTS_RUN_RE.test('node scripts/run-supervisor.mjs --run run-519 --plans 529,531')).toBe(true)
  expect(STARTS_RUN_RE.test('node scripts/run-plans.mjs --dry-run --run x --plans 1')).toBe(true)
  expect(STARTS_RUN_RE.test('node scripts/orch-state.mjs watch --run x')).toBe(false)
  expect(STARTS_RUN_RE.test('git status')).toBe(false)
})

test('watch line: the printed line, else ORCH_JSON line', () => {
  expect(watchText('RUNNING\nORCH_JSON {"ok":true,"line":"RUNNING"}\n')).toBe('RUNNING')
  expect(watchText('ORCH_JSON {"ok":false,"line":"STUCK: plan 12 · gate"}')).toBe('STUCK: plan 12 · gate')
  expect(watchText('')).toBe('')
})

// -- in the dock -------------------------------------------------------------------

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const
const RUNS = '/work/app/.claude/orchestrator-runs'

type Calls = { watch: number; lists: number }
type Side = Record<string, Record<string, string>>

/** The engine beneath fleet: one checkout with the given runs (and each run's side files); `watch` answers orch-state.mjs watch. */
const world = (on: On, runs: Record<string, object>, watch: { exitCode: number; stdout: string }, calls: Calls, side: Side = {}) => {
  const o = on as unknown as Loose
  const v = (value: unknown) => ({ value })
  const path = (a: unknown[]) => String((a[1] as { path?: string })?.path ?? '').replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  o('session.start', () => ({ cwd: '/work/app' }))
  o('turn.start', () => ({ turnId: 't1' }))
  o('turn.complete', () => ({ text: '' }))
  o('tool.call', () => ({ result: 'ran', text: 'ran' }))
  o('session.cwd', () => v('/work/app'))
  o('session.id', () => v('s1'))
  o('session.usage', () => v({ startedAt: 0, context: { window: 200000, percent: 12, tokens: 24000 }, rateLimits: [], cost: { usd: 0 } }))
  o('command.register', (...a: unknown[]) => v({ command: (a[1] as { name: string }).name }))
  o('process.run', (...a: unknown[]) => {
    const argv = (a[1] as { argv: readonly string[] }).argv
    const isWatch = argv[1] === 'scripts/orch-state.mjs' && argv[2] === 'watch'
    if (isWatch) calls.watch += 1
    return v({ stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...(isWatch ? watch : { exitCode: 0, stdout: '' }) })
  })
  o('fs.exists', (...a: unknown[]) => v(path(a) === '/work/app/scripts/orch-state.mjs' || path(a) === '/work/app/.claude'))
  o('fs.list', (...a: unknown[]) => {
    const p = path(a)
    if (p === RUNS) {
      calls.lists += 1
      return v([...Object.keys(runs).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })), { name: 'old.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }])
    }
    const m = p.match(/orchestrator-runs\/([^/]+)$/)
    if (m && runs[m[1]!]) return v(Object.entries(side[m[1]!] ?? {}).map(([name, text]) => ({ name, kind: 'file', size: text.length, mtimeMs: 0, isLink: false })))
    throw new Error('ENOENT')
  })
  o('fs.stat', (...a: unknown[]) => {
    if (!path(a).endsWith('/status.json')) throw new Error('ENOENT')
    return v({ kind: 'file', size: 10, mtimeMs: NOW - MIN, isLink: false })
  })
  o('fs.read', (...a: unknown[]) => {
    const m = path(a).match(/orchestrator-runs\/([^/]+)\/([^/]+)$/)
    if (m && m[2] === 'status.json' && runs[m[1]!]) return v(JSON.stringify(runs[m[1]!]))
    if (m && side[m[1]!]?.[m[2]!] !== undefined) return v(side[m[1]!]![m[2]!])
    throw new Error('ENOENT')
  })
  o('fs.write', () => v(undefined))
  o('ui.status', () => v(undefined))
  o('ui.toast', () => v(undefined))
  o('ui.notify', () => v({ isSent: false, reason: 'no-surface' }))
  o('ui.render', (...a: unknown[]) => {
    const $$ = a[0] as { ui: { resolve: (e: unknown) => { Text: unknown } } }
    return h($$.ui.resolve(a[1]).Text as never, {}, 'engine line')
  })
}

const start = { cwd: '/work/app', surface: null, isInteractive: true } as never

const live = {
  run: 'run-12-13',
  phase: 'running',
  startedAt: at(10 * MIN),
  plans: {
    '12': { nnn: '12', state: 'gate', history: [{ at: at(3 * MIN), state: 'gate' }] },
    '13': { nnn: '13', state: 'merged', history: [{ at: at(MIN), state: 'merged' }] },
  },
}

test('a live run shows a chip with its %; pressing it opens a line per plan and the watch line', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const calls = { watch: 0, lists: 0 }
  world(on, { 'run-12-13': live, 'run-400-400': { ...live, phase: 'finished' } }, { exitCode: 0, stdout: 'RUNNING\nORCH_JSON {"ok":true}' }, calls)
  await $.session.start(start)
  await clock.advance(10)
  const ui = await $.ui.mount({ plugin: 'fleet', surface: 'terminal', ...BAND } as never)
  // gate 0.5 + merged 1 = 1.5 / 2 = 75%; the finished run gets no chip.
  expect(await ui.find({ type: 'Button', text: /run run-12-13 75%/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /run-400-400/ })).toBeUndefined()
  expect(await ui.find({ key: 'run-panel-frame' })).toBeUndefined()
  await ui.press({ key: 'run-chip:run-12-13' })
  expect(await ui.find({ key: 'run-panel-frame' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /run run-12-13 · 75% · 10:00/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /12 ▶ checks {3}build · gate ▶3:00 · review · merge/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /13 ✓ merged ✓/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'RUNNING' })).toBeDefined()
  await ui.press({ key: 'run-chip:run-12-13' })
  expect(await ui.find({ key: 'run-panel-frame' })).toBeUndefined()
  await ui.unmount()
})

test('the open panel shows the gate check and the builder from the live files, and its clocks tick every second', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const calls = { watch: 0, lists: 0 }
  const run = { ...live, plans: { ...live.plans, '14': { nnn: '14', state: 'building', models: { builder: { model: 'sonnet' } }, history: [{ at: at(MIN), state: 'building' }] } } }
  const side = { 'run-12-13': {
    'calls.csv': 'plan,stage,model,seconds,input_tokens,output_tokens,exit\n13,builder,sonnet,60,90000,1000,0\n',
    'live-12.json': JSON.stringify({ step: 'gate', gate: { index: 4, total: 16, command: 'npm run test', startedAt: at(42 * SEC) } }),
    'live-14.json': JSON.stringify({ step: 'building', builder: { tools: 7, lastTool: 'Edit', lastTarget: 'src/app.ts', tokensIn: 40000, tokensOut: 2000, at: at(2 * SEC) } }),
  } }
  world(on, { 'run-12-13': run }, { exitCode: 0, stdout: 'RUNNING' }, calls, side)
  await $.session.start(start)
  await clock.advance(10)
  const ui = await $.ui.mount({ plugin: 'fleet', surface: 'terminal', ...BAND } as never)
  await ui.press({ key: 'run-chip:run-12-13' })
  expect(await ui.find({ type: 'Text', text: /gate 4\/16: npm run test · 0:42/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /now: Edit src\/app.ts · 7 tools · 42k tokens/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /14 ▶ building {3}build ▶1:00 .* sonnet · round 0 · 42k tokens/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /run run-12-13 · \d+% · 10:00 · 133k tokens/ })).toBeDefined()
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /gate 4\/16: npm run test · 0:43/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /build ▶1:01/ })).toBeDefined()
  await ui.unmount()
})

test('a half-written live file is skipped: the plan keeps its plain line and nothing throws', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const calls = { watch: 0, lists: 0 }
  world(on, { 'run-12-13': live }, { exitCode: 0, stdout: 'RUNNING' }, calls, { 'run-12-13': { 'live-12.json': '{"step":"gate","gate":{"ind' } })
  await $.session.start(start)
  await clock.advance(10)
  const ui = await $.ui.mount({ plugin: 'fleet', surface: 'terminal', ...BAND } as never)
  await ui.press({ key: 'run-chip:run-12-13' })
  expect(await ui.find({ type: 'Text', text: /12 ▶ checks/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {6}gate / })).toBeUndefined()
  await ui.unmount()
})

test('a STUCK watch line (exit 1) turns the chip and the panel to the warning colour', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const calls = { watch: 0, lists: 0 }
  world(on, { 'run-12-13': live }, { exitCode: 1, stdout: 'STUCK: plan 12 · gate · no progress for 40 min\nORCH_JSON {"ok":false}' }, calls)
  await $.session.start(start)
  await clock.advance(10)
  const ui = await $.ui.mount({ plugin: 'fleet', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /⚠ stuck/ })).toBeDefined()
  await ui.press({ key: 'run-chip:run-12-13' })
  expect((await ui.find({ key: 'run-panel-frame' }))?.props.borderColor).toBe('warning')
  expect(await ui.find({ type: 'Text', text: /^STUCK: plan 12/ })).toBeDefined()
  await ui.unmount()
})

test('the timer runs only while a run is live; the watch command runs at most every 30 s', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const runs: Record<string, object> = { 'run-12-13': live }
  const calls = { watch: 0, lists: 0 }
  world(on, runs, { exitCode: 0, stdout: 'RUNNING' }, calls)
  await $.session.start(start)
  await clock.advance(10)
  const first = calls.watch
  expect(first).toBe(1)
  const lists0 = calls.lists
  await clock.advance(30_000)
  expect(calls.lists).toBeGreaterThan(lists0 + 3)
  expect(calls.watch).toBe(first + 1)
  // The run finishes: the next refresh sees no live run and stops the timer.
  runs['run-12-13'] = { ...live, phase: 'finished' }
  await clock.advance(10_000)
  const lists = calls.lists
  await clock.advance(5 * 60_000)
  expect(calls.lists).toBe(lists)
})

test('the Bash call that starts the supervisor starts the watch; a plain Bash call does not', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const runs: Record<string, object> = {}
  const calls = { watch: 0, lists: 0 }
  world(on, runs, { exitCode: 0, stdout: 'RUNNING' }, calls)
  await $.session.start(start)
  await clock.advance(10)
  await $.tool.call({ tool: 'Bash', command: 'git status', tool_use_id: 'b1' } as never)
  const before = calls.lists
  await clock.advance(60_000)
  expect(calls.lists).toBe(before)
  await $.tool.call({ tool: 'Bash', command: 'node scripts/run-supervisor.mjs --run run-12-13 --plans 12,13', tool_use_id: 'b2' } as never)
  // The run's status.json appears a moment later: the watch finds it without a new message.
  runs['run-12-13'] = live
  await clock.advance(6_000)
  const ui = await $.ui.mount({ plugin: 'fleet', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Button', text: /run run-12-13 75%/ })).toBeDefined()
  await ui.unmount()
})

test('no run directory: no chip, no timer', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const calls = { watch: 0, lists: 0 }
  world(on, {}, { exitCode: 0, stdout: '' }, calls)
  await $.session.start(start)
  await clock.advance(10)
  const ui = await $.ui.mount({ plugin: 'fleet', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Button', text: /^run / })).toBeUndefined()
  await ui.unmount()
  const lists = calls.lists
  await clock.advance(5 * 60_000)
  expect(calls.lists).toBe(lists)
  expect(calls.watch).toBe(0)
})
