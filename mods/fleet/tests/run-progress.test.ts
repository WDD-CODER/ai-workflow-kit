import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  configDirOf,
  durText,
  isLiveRun,
  journalNamesRun,
  openAgent,
  planLines,
  projectSlug,
  runPercent,
  stageWords,
  watchText,
} from '../hooks/run-progress'

type Loose = (event: string, hook: (...args: never[]) => unknown) => unknown

const NOW = Date.parse('2026-10-30T10:00:00Z')
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const MIN = 60_000

// -- pure ----------------------------------------------------------------------

test('% = (sum of stage weights) / plan count; merged and parked count as done', () => {
  expect(runPercent({ plans: {} })).toBe(0)
  expect(runPercent({ plans: { '1': { state: 'merged' }, '2': { state: 'parked' } } })).toBe(100)
  // building 0.25 + gate 0.5 + checking 0.75 + merging 0.9 = 2.4 / 4 = 60%
  expect(runPercent({ plans: { '1': { state: 'building' }, '2': { state: 'gate' }, '3': { state: 'checking' }, '4': { state: 'merging' } } })).toBe(60)
  expect(runPercent({ plans: { '1': { state: 'queued' }, '2': { state: 'merged' } } })).toBe(50)
  expect(runPercent({ plans: { '1': { state: 'something-new' } } })).toBe(0)
})

test('live: not finished or stopped, and its status.json changed within a day', () => {
  expect(isLiveRun({ phase: 'running' }, NOW - MIN, NOW)).toBe(true)
  expect(isLiveRun({ phase: 'finished' }, NOW - MIN, NOW)).toBe(false)
  expect(isLiveRun({ phase: 'stopped' }, NOW - MIN, NOW)).toBe(false)
  expect(isLiveRun({ phase: 'running' }, NOW - 25 * 60 * MIN, NOW)).toBe(false)
})

test('stage words are plain', () => {
  expect(stageWords({ state: 'building' })).toBe('building')
  expect(stageWords({ state: 'gate' })).toBe('checks')
  expect(stageWords({ state: 'checking' })).toBe('reviewers')
  expect(stageWords({ state: 'merging' })).toBe('merging')
  expect(stageWords({ state: 'merged' })).toBe('merged ✓')
  expect(stageWords({ state: 'parked', reason: 'build failed 3 times' })).toBe('parked: build failed 3 times')
  expect(stageWords({ state: 'fixing', round: 2 })).toBe('fixing (round 2)')
  expect(durText(30_000)).toBe('<1 min')
  expect(durText(3 * MIN)).toBe('3 min')
  expect(durText(65 * MIN)).toBe('1 h 05 min')
})

test('plan lines: number order, time in the current stage, agent detail on the plan its label names', () => {
  const status = {
    plans: {
      '13': { nnn: '13', state: 'building', history: [{ at: at(2 * MIN), state: 'building' }] },
      '12': { nnn: '12', state: 'gate', history: [{ at: at(9 * MIN), state: 'building' }, { at: at(3 * MIN), state: 'gate' }, { at: at(1 * MIN), state: 'gate' }] },
      '11': { nnn: '11', state: 'merged', history: [{ at: at(20 * MIN), state: 'merged' }] },
    },
  }
  const { lines, agentLine } = planLines(status, NOW, { label: 'gate 12', ageMs: 20_000 })
  expect(lines).toEqual(['11 · merged ✓', '12 · checks (gate 12 · 20 s ago) · 3 min', '13 · building · 2 min'])
  expect(agentLine).toBe(null)
  const other = planLines(status, NOW, { label: 'preflight', ageMs: null })
  expect(other.agentLine).toBe('now: preflight')
  expect(planLines(status, NOW, null).agentLine).toBe(null)
})

test('the open agent is the last one started with no result; junk lines are skipped', () => {
  const journal = [
    '{"type":"launched"}',
    '{"type":"started","key":"k1","agentId":"a1","label":"preflight"}',
    '{"type":"result","key":"k1","agentId":"a1","result":{}}',
    'not json',
    '{"type":"started","key":"k2","agentId":"a2","label":"builder 12 build first"}',
    '{"type":"started","key":"k3","agentId":"a3","label":"gate 13"}',
    '{"type":"result","key":"k3","agentId":"a3","result":{}}',
  ].join('\n')
  expect(openAgent(journal)).toEqual({ label: 'builder 12 build first', agentId: 'a2' })
  expect(openAgent('')).toBe(null)
  expect(openAgent('{"type":"started","key":"k","agentId":"a","label":"x"}\n{"type":"result","key":"k"}')).toBe(null)
})

test('a journal names a run only by its whole name', () => {
  const j = 'OUTPUT 1: node scripts/orch-state.mjs init --run=run-511-511\n'
  expect(journalNamesRun(j, 'run-511-511')).toBe(true)
  expect(journalNamesRun(j, 'run-511-51')).toBe(false)
  expect(journalNamesRun(j, 'run-5')).toBe(false)
})

test('the workflow folder is found from the plugin root and the checkout, never a fixed machine path', () => {
  expect(configDirOf('D:\\cfg\\plugins\\cache\\m\\fleet\\0.5.0')).toBe('D:/cfg')
  expect(configDirOf('/srv/cfg/plugins/cache/m/fleet/0.5.0')).toBe('/srv/cfg')
  expect(configDirOf('/work/app/mods/fleet')).toBe(null)
  expect(projectSlug('D:\\work dir\\my.app')).toBe('D--work-dir-my-app')
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

/** The engine beneath fleet: one checkout with the given runs; `watch` answers orch-state.mjs watch. */
const world = (on: On, runs: Record<string, object>, watch: { exitCode: number; stdout: string }, calls: Calls) => {
  const o = on as unknown as Loose
  const v = (value: unknown) => ({ value })
  const path = (a: unknown[]) => String((a[1] as { path?: string })?.path ?? '').replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  o('session.start', () => ({ cwd: '/work/app' }))
  o('turn.start', () => ({ turnId: 't1' }))
  o('turn.complete', () => ({ text: '' }))
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
    if (p !== RUNS) throw new Error('ENOENT')
    calls.lists += 1
    return v([...Object.keys(runs).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })), { name: 'old.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }])
  })
  o('fs.stat', (...a: unknown[]) => {
    if (!path(a).endsWith('/status.json')) throw new Error('ENOENT')
    return v({ kind: 'file', size: 10, mtimeMs: NOW - MIN, isLink: false })
  })
  o('fs.read', (...a: unknown[]) => {
    const m = path(a).match(/orchestrator-runs\/([^/]+)\/status\.json$/)
    if (m && runs[m[1]!]) return v(JSON.stringify(runs[m[1]!]))
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
  plans: {
    '12': { nnn: '12', state: 'gate', history: [{ at: at(3 * MIN), state: 'gate' }] },
    '13': { nnn: '13', state: 'merged', history: [{ at: at(MIN), state: 'merged' }] },
  },
}

test('a live run shows a chip with its %; pressing it opens one line per plan and the watch line', async ($, on) => {
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
  expect(await ui.find({ type: 'Text', text: /12 · checks · 3 min/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /13 · merged ✓/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'RUNNING' })).toBeDefined()
  await ui.press({ key: 'run-chip:run-12-13' })
  expect(await ui.find({ key: 'run-panel-frame' })).toBeUndefined()
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

test('a missing journal leaves the agent detail out and never throws', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const calls = { watch: 0, lists: 0 }
  world(on, { 'run-12-13': live }, { exitCode: 0, stdout: 'RUNNING' }, calls)
  await $.session.start(start)
  await clock.advance(10)
  const ui = await $.ui.mount({ plugin: 'fleet', surface: 'terminal', ...BAND } as never)
  await ui.press({ key: 'run-chip:run-12-13' })
  expect(await ui.find({ type: 'Text', text: /12 · checks · 3 min$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}now:/ })).toBeUndefined()
  await ui.unmount()
})

test('the timer runs only while a run is live', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const runs: Record<string, object> = { 'run-12-13': live }
  const calls = { watch: 0, lists: 0 }
  world(on, runs, { exitCode: 0, stdout: 'RUNNING' }, calls)
  await $.session.start(start)
  await clock.advance(10)
  const first = calls.watch
  expect(first).toBe(1)
  await clock.advance(30_000)
  expect(calls.watch).toBe(first + 1)
  // The run finishes: the next refresh sees no live run and stops the timer.
  runs['run-12-13'] = { ...live, phase: 'finished' }
  await clock.advance(30_000)
  const lists = calls.lists
  await clock.advance(5 * 60_000)
  expect(calls.lists).toBe(lists)
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
