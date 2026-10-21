import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import { clockText, portsFromKitConfig, resetLong, resetShort, shipBadge, untilText } from '../hooks/register'

type Loose = (event: string, hook: (...args: never[]) => unknown) => unknown

/** The usage windows session.usage() reports; a test sets it, world() serves it. */
let limits: { kind: string; percentUsed: number; resetsAt?: string }[] = []
const statuses: string[] = []

/** The world beneath the plugin: every $ call fleet makes, answered from memory. */
type Ran = { exitCode: number; stdout?: string; stderr?: string }
const world = (on: On, cwd: string, runner?: (argv: readonly string[]) => Ran, toasts?: string[], logs?: string[], files: Record<string, string> = {}) => {
  const o = on as unknown as Loose
  const v = (value: unknown) => ({ value })
  // Engine-raised events answer their own result shape.
  o('session.start', () => ({ cwd }))
  o('session.end', () => ({ sessionId: 'test-session' }))
  o('tool.check', () => ({ decision: 'allow' }))
  o('turn.start', () => ({ turnId: 't1' }))
  o('turn.complete', () => ({ text: '' }))
  o('command.run', () => ({ text: '' }))
  // Calls the plugin makes on $ answer { value }.
  o('session.cwd', () => v(cwd))
  o('session.id', () => v('test-session'))
  o('session.usage', () => v({ startedAt: 0, context: { window: 200000, percent: 12, tokens: 24000 }, rateLimits: limits, cost: { usd: 0.5 } }))
  o('command.register', (...a: unknown[]) => v({ command: (a[1] as { name: string }).name }))
  o('process.run', (...a: unknown[]) => {
    const r = runner ? runner((a[1] as { argv: readonly string[] }).argv) : { exitCode: 0 }
    return v({ stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...r })
  })
  const file = (a: unknown[]) => String((a[1] as { path?: string })?.path ?? '').replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  o('fs.exists', (...a: unknown[]) => v(file(a) in files))
  o('fs.read', (...a: unknown[]) => v(files[file(a)] ?? ''))
  o('fs.write', () => v(undefined))
  o('ui.status', (...a: unknown[]) => {
    statuses.push(String((a[1] as { text?: string })?.text ?? a[1] ?? ''))
    return v(undefined)
  })
  o('ui.toast', (...a: unknown[]) => {
    toasts?.push(JSON.stringify(a[1]))
    return v(undefined)
  })
  o('ui.log', (...a: unknown[]) => {
    logs?.push(String((a[1] as { text?: string })?.text ?? ''))
    return v(undefined)
  })
  o('ui.notify', () => v({ isSent: false, reason: 'no-surface' }))
}

const run = (command: string, origin: { kind: 'composer' } | { kind: 'plugin'; name: string } = { kind: 'composer' }) =>
  ({ command, args: '', origin, presentation: { isFullscreen: false, columns: 120 } }) as never

const start = (cwd: string) => ({ cwd, surface: null, isInteractive: true }) as never

const other = {
  id: 'other',
  cwd: '/work/app-wt-1',
  slot: 1,
  fe: 4201,
  be: 3001,
  branch: 'feat/341-x',
  plan: 'plans/341-x.plan.md',
  dirty: 0,
  unpushed: 0,
  startedAt: 4_900_000,
  lastSeen: 4_990_000,
  title: 'wt-1 slot 341',
}

test('registers its own session on start and lists it under /fleet', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  world(on, '/work/app-wt-2', undefined, undefined, undefined, { '/work/app-wt-2/kit.config.json': JSON.stringify({ slots: { fePorts: 4200, bePorts: 3000 } }) })
  await $.session.start(start('/work/app-wt-2'))
  const { text } = await $.command.run(run('fleet'))
  expect(text).toMatch(/wt-2 /)
  expect(text).toMatch(/4202\/3002/)
  expect(text).toMatch(/\(this\)/)
  expect(text).toMatch(/claude --resume/)
})

test('slot lock denies a branch switch while another live session holds the same checkout', async ($, on) => {
  const clock = mock.clock(on, { now: 5_000_000 })
  mock.store(on, { 'fleet:session:other': other })
  world(on, '/work/app-wt-1')
  await $.session.start(start('/work/app-wt-1'))
  const denied = await $.tool.check({ tool: 'Bash', input: { command: 'git checkout main' } })
  expect(denied.decision).toBe('deny')
  const allowed = await $.tool.check({ tool: 'Bash', input: { command: 'git status' } })
  expect(allowed.decision).not.toBe('deny')
  const janitor = await $.tool.check({ tool: 'Bash', input: { command: 'node scripts/free-merged-slots.mjs' } })
  expect(janitor.decision).not.toBe('deny')
  await clock.advance(3 * 60_000)
  const later = await $.tool.check({ tool: 'Bash', input: { command: 'git switch -c feat/x' } })
  expect(later.decision).not.toBe('deny')
})

test('slot lock ignores a session in another checkout', async ($, on) => {
  mock.clock(on, { now: 5_000_000 })
  mock.store(on, { 'fleet:session:other': other })
  world(on, '/work/app-wt-3')
  await $.session.start(start('/work/app-wt-3'))
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git checkout main' } })
  expect(verdict.decision).not.toBe('deny')
})

test('/health answers the cache state and advice', async ($, on) => {
  mock.clock(on, { now: 10_000 })
  mock.store(on)
  world(on, '/work/app')
  await $.session.start(start('/work/app'))
  const { text } = await $.command.run(run('health'))
  expect(text).toMatch(/cache: not started/)
  expect(text).toMatch(/context: \d+%/)
  expect(text).toMatch(/Fine to keep going/)
})

test('/handoff refuses a plugin origin', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  world(on, '/work/app')
  await $.session.start(start('/work/app'))
  const { text } = await $.command.run(run('handoff', { kind: 'plugin', name: 'someone' }))
  expect(text).toMatch(/for the person to run/)
})

test('session.compact gains the focus instruction', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  world(on, '/work/app')
  let seen = ''
  on('session.compact', (_$, e) => {
    seen = e.instructions ?? ''
    return { messages: e.messages }
  })
  await $.session.start(start('/work/app'))
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hello', toolUses: [] }] as never, instructions: 'focus on the toggle-chip plan' })
  expect(seen).toMatch(/focus on the toggle-chip plan/)
  expect(seen).toMatch(/current plan number and branch/)
})

test('the record is removed when the session ends', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  world(on, '/work/app')
  await $.session.start(start('/work/app'))
  expect((await $.command.run(run('fleet'))).text).toMatch(/\(this\)/)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's', resume: { id: 's' } } as never)
  expect((await $.command.run(run('fleet'))).text).not.toMatch(/\(this\)/)
})

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const

test('the health band appears when context is high and Keep going hides it for the turn', async ($, on) => {
  mock.clock(on, { now: 10_000 })
  mock.store(on)
  const o = on as unknown as Loose
  o('session.end', () => ({ sessionId: 'test-session' }))
  o('tool.check', () => ({ decision: 'allow' }))
  o('turn.start', () => ({ turnId: 't1' }))
  o('turn.complete', () => ({ text: '' }))
  o('command.run', () => ({ text: '' }))
  o('session.start', () => ({ cwd: '/work/app' }))
  o('session.cwd', () => ({ value: '/work/app' }))
  o('session.id', () => ({ value: 'test-session' }))
  o('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 88, tokens: 176000 }, rateLimits: [{ kind: 'seven_day', percentUsed: 81 }], cost: { usd: 4.2 } } }))
  o('command.register', (...a: unknown[]) => ({ value: { command: (a[1] as { name: string }).name } }))
  o('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  o('fs.exists', () => ({ value: false }))
  o('fs.read', () => ({ value: '' }))
  o('fs.write', () => ({ value: undefined }))
  o('ui.status', () => ({ value: undefined }))
  o('ui.toast', () => ({ value: undefined }))
  o('ui.notify', () => ({ value: { isSent: false, reason: 'no-surface' } }))
  o('ui.render', (...a: unknown[]) => {
    const $$ = a[0] as { ui: { resolve: (e: unknown) => { Text: unknown } } }
    const { Text } = $$.ui.resolve(a[1])
    return h(Text as never, { dimColor: true }, '')
  })
  await $.session.start(start('/work/app'))
  await $.turn.start({ turnId: 't1' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'fleet', surface, ...BAND } as never)
    expect(await ui.find({ type: 'Text', text: /context 88%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /week 81%/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /Handoff & restart/ })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'fleet', surface: 'terminal', ...BAND } as never)
  await ui.press({ key: 'dismiss' })
  expect(await ui.find({ type: 'Text', text: /context 88%/ })).toBeUndefined()
  await ui.unmount()
})

test('a future-dated or ancient registry row is pruned instead of locking the slot', async ($, on) => {
  mock.clock(on, { now: 100_000_000 }) // 'old' is then ~27 h stale, 'future' is dated ahead of the clock
  mock.store(on, { 'fleet:session:future': { ...other, id: 'future', lastSeen: 200_000_000 }, 'fleet:session:old': { ...other, id: 'old', lastSeen: 1 } })
  world(on, '/work/app-wt-1')
  await $.session.start(start('/work/app-wt-1'))
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git checkout main' } })
  expect(verdict.decision).not.toBe('deny')
  const { text } = await $.command.run(run('fleet'))
  expect(text).not.toMatch(/future|\bold\b/)
})

test('/fleet forget drops a row for the person only', async ($, on) => {
  mock.clock(on, { now: 5_000_000 })
  mock.store(on, { 'fleet:session:other': other })
  world(on, '/work/app-wt-1')
  await $.session.start(start('/work/app-wt-1'))
  const refused = await $.command.run({ command: 'fleet', args: 'forget other', origin: { kind: 'plugin', name: 'p' }, presentation: { isFullscreen: false, columns: 120 } } as never)
  expect(refused.text).toMatch(/for the person/)
  const ok = await $.command.run({ command: 'fleet', args: 'forget other', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never)
  expect(ok.text).toMatch(/forgot 1/)
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git checkout main' } })
  expect(verdict.decision).not.toBe('deny')
})

// -- mods dock ------------------------------------------------------------------

type Ui = { Box: unknown; Text: unknown }
const below = (draw: (ui: Ui) => unknown) => (...a: unknown[]) => {
  const $$ = a[0] as { ui: { resolve: (e: unknown) => Ui } }
  return draw($$.ui.resolve(a[1]))
}

test('calm: one collapsed frame holds the fleet chip; the engine line stays below it', async ($, on) => {
  mock.clock(on, { now: 10_000 })
  mock.store(on)
  world(on, '/work/app')
  const o = on as unknown as Loose
  o('ui.render', below(ui => h(ui.Text as never, {}, 'engine line')))
  await $.session.start(start('/work/app'))
  const ui = await $.ui.mount({ plugin: 'fleet', surface: 'terminal', ...BAND } as never)
  const frames = await ui.findAll({ key: 'mods-dock' })
  expect(frames).toHaveLength(1)
  expect(frames[0]?.props.flexDirection).toBe('row')
  expect(await ui.find({ type: 'Text', text: '◆ fleet' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ctx 12%/ })).toBeDefined()
  expect((await ui.find({ key: 'mods-dock-row:fleet' }))?.props.display).toBe('none')
  expect(await ui.find({ type: 'Text', text: 'engine line' })).toBeDefined()
  await ui.unmount()
})

test("another mod's frame below is merged into one, ordered, and its alert expands the dock", async ($, on) => {
  mock.clock(on, { now: 10_000 })
  mock.store(on)
  world(on, '/work/app')
  const o = on as unknown as Loose
  // What guards would hand up from beneath: its own wrap + frame with an alert entry, then the engine line.
  o('ui.render', below(ui => {
    const B = ui.Box as never
    const T = ui.Text as never
    const entry = h(B, { key: 'mods-dock:guards:alert', flexDirection: 'column' }, h(B, { key: 'mods-dock-chip:guards' }, h(T, {}, 'blocked x.ts')), h(B, { key: 'mods-dock-row:guards' }, h(T, {}, 'blocked x.ts — outside scope')))
    const frame = h(B, { key: 'mods-dock', borderStyle: 'round' }, h(T, {}, 'stale chrome'), entry)
    return h(B, { key: 'mods-dock-wrap', flexDirection: 'column' }, frame, h(T, {}, 'engine line'))
  }))
  await $.session.start(start('/work/app'))
  const ui = await $.ui.mount({ plugin: 'fleet', surface: 'terminal', ...BAND } as never)
  const frames = await ui.findAll({ key: 'mods-dock' })
  expect(frames).toHaveLength(1)
  expect(frames[0]?.props.flexDirection).toBe('column')
  expect(frames[0]?.props.borderColor).toBe('warning')
  const keys = (await ui.findAll({ type: 'Box' })).map(b => b.key ?? '').filter(k => k.startsWith('mods-dock:'))
  expect(keys).toEqual(['mods-dock:fleet:calm', 'mods-dock:guards:alert'])
  expect((await ui.find({ key: 'mods-dock-row:guards' }))?.props.display).toBe('flex')
  expect((await ui.find({ key: 'mods-dock-chip:fleet' }))?.props.display).toBe('none')
  expect(await ui.find({ type: 'Text', text: 'stale chrome' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine line' })).toBeDefined()
  await ui.unmount()
})

test('shipBadge: clean, or how much still needs /ship', () => {
  expect(shipBadge(0, 0)).toBe('✓ clean')
  expect(shipBadge(1, 0)).toBe('● 1 file → /ship')
  expect(shipBadge(5, 2)).toBe('● 5 files · 2 unpushed → /ship')
  expect(shipBadge(0, 3)).toBe('● 3 unpushed → /ship')
})

/** A fake git: answers by argv, records every call. */
const fakeGit = (branch: string, opts: { mergeFails?: boolean; conflict?: boolean } = {}) => {
  const calls: string[] = []
  let head = 'aaa'
  const runner = (argv: readonly string[]): Ran => {
    const cmd = argv.join(' ')
    calls.push(cmd)
    if (cmd === 'git branch --show-current') return { exitCode: 0, stdout: branch }
    if (cmd === 'git rev-parse HEAD') return { exitCode: 0, stdout: head }
    if (cmd.startsWith('git log --no-merges')) return { exitCode: 0, stdout: ['c1 feat: one', 'c2 fix: two', 'c3 docs: three'].join(String.fromCharCode(10)) }
    if (cmd.startsWith('git diff --shortstat')) return { exitCode: 0, stdout: ' 4 files changed, 10 insertions(+)' }
    if (cmd.startsWith('git log -1')) return { exitCode: 0, stdout: 'mmm plan: note' }
    if (cmd === 'git rev-parse -q --verify MERGE_HEAD') return opts.conflict ? { exitCode: 0, stdout: 'mmm' } : { exitCode: 1 }
    if (cmd === 'git merge --no-edit origin/main' && opts.mergeFails) return { exitCode: 1, stdout: 'CONFLICT (content)' }
    if (cmd === 'git pull --ff-only origin main' || cmd === 'git merge --no-edit origin/main') head = 'bbb'
    return { exitCode: 0 }
  }
  return { calls, runner }
}

/** Mounts the band, presses Pull main, and returns the git calls made and the toast shown. */
const pressPull = async ($: Parameters<TestBody>[0], on: On, cwd: string, g: ReturnType<typeof fakeGit>) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const toasts: string[] = []
  const logs: string[] = []
  const o = on as unknown as Loose
  world(on, cwd, g.runner, toasts, logs)
  o('ui.render', (...a: unknown[]) => {
    const $$ = a[0] as { ui: { resolve: (e: unknown) => { Text: unknown } } }
    const { Text } = $$.ui.resolve(a[1])
    return h(Text as never, { dimColor: true }, '')
  })
  await $.session.start(start(cwd))
  const ui = await $.ui.mount({ plugin: 'fleet', surface: 'terminal', ...BAND } as never)
  await ui.press({ key: 'pull-main' })
  for (let i = 0; i < 2000 && logs.length === 0; i++) await Promise.resolve()
  await ui.unmount()
  return { text: logs.join('\n'), toasts: toasts.join('\n') }
}

test('pull main on main fast-forwards from origin', async ($, on) => {
  const g = fakeGit('main')
  const { text, toasts } = await pressPull($, on, '/work/app', g)
  expect(g.calls).toContain('git pull --ff-only origin main')
  expect(g.calls).not.toContain('git merge --no-edit origin/main')
  expect(text).toBe('✓ Pulled main into main: 3 new commits, 4 files changed.\n   c1 feat: one\n   c2 fix: two\n   c3 docs: three')
  expect(toasts).toMatch(/pulling main/)
})

test('pull main in a slot fetches and merges origin/main into the branch', async ($, on) => {
  const g = fakeGit('feat/412-x')
  const { text } = await pressPull($, on, '/work/app-wt-2', g)
  expect(g.calls).toContain('git fetch origin main')
  expect(g.calls).toContain('git merge --no-edit origin/main')
  expect(text).toMatch(/✓ Pulled main into feat\/412-x: 3 new commits/)
})

test('pull main aborts a conflicted merge and says so', async ($, on) => {
  const g = fakeGit('feat/412-x', { mergeFails: true, conflict: true })
  const { text } = await pressPull($, on, '/work/app-wt-2', g)
  expect(g.calls).toContain('git merge --abort')
  expect(text).toMatch(/✗ Pull main: main conflicts with feat\/412-x\. Merge aborted, nothing changed/)
})

test('pull main refuses on a detached HEAD', async ($, on) => {
  const g = fakeGit('')
  const { text } = await pressPull($, on, '/work/app-wt-2', g)
  expect(text).toMatch(/detached HEAD/)
  expect(g.calls.some(c => c.includes('merge') || c.includes('pull'))).toBe(false)
})

// -- 5-hour window reset time and refresh notice ----------------------------------

const NOW = Date.parse('2026-10-21T10:00:00Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()
const H = 60 * 60_000

test('reset texts: countdown, local clock time, nothing when unknown or passed', () => {
  expect(untilText(at(2 * H + 10 * 60_000), NOW)).toBe('2h10m')
  expect(untilText(at(45 * 60_000), NOW)).toBe('45m')
  expect(untilText(at(-1), NOW)).toBe(null)
  const iso = at(2 * H + 10 * 60_000)
  const d = new Date(iso)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  expect(clockText(iso, NOW)).toContain(hm)
  expect(resetShort(iso, NOW)).toBe(` ↻${clockText(iso, NOW)} (2h10m)`)
  expect(resetLong(iso, NOW)).toBe(` (resets ${clockText(iso, NOW)}, in 2h10m)`)
  expect(resetShort(null, NOW)).toBe('')
  expect(resetLong(at(-60_000), NOW)).toBe('')
  expect(clockText(at(3 * 24 * H), NOW)).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d$/)
})

test('port bases come from kit.config.json slots; anything else is 0', () => {
  expect(portsFromKitConfig(JSON.stringify({ slots: { fePorts: 4300, bePorts: 3100 } }))).toEqual({ fe: 4300, be: 3100 })
  expect(portsFromKitConfig(JSON.stringify({ slots: { fePorts: null } }))).toEqual({ fe: 0, be: 0 })
  expect(portsFromKitConfig(null)).toEqual({ fe: 0, be: 0 })
  expect(portsFromKitConfig('{ not json')).toEqual({ fe: 0, be: 0 })
})

test('/ports says how to set the port bases when none are known', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  world(on, '/work/app')
  await $.session.start(start('/work/app'))
  const { text } = await $.command.run(run('ports'))
  expect(text).toMatch(/slots\.fePorts/)
})

test('status line shows the 5h reset time only once the session knows it', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  limits = []
  statuses.length = 0
  world(on, '/work/app')
  await $.session.start(start('/work/app'))
  expect(statuses.join('\n')).not.toMatch(/↻/)
  limits = [{ kind: 'five_hour', percentUsed: 62, resetsAt: at(2 * H + 10 * 60_000) }]
  await $.command.run(run('health'))
  await $.turn.complete({ text: '' } as never)
  expect(statuses.at(-1)).toMatch(/5h 62% ↻\S+ \(2h10m\)/)
  const { text } = await $.command.run(run('health'))
  expect(text).toMatch(/limits: 5h 62% \(resets \S+, in 2h10m\)/)
})

test('refresh notice: once per window in this session, re-scheduled when resetsAt changes, 95% re-armed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const toasts: string[] = []
  limits = [{ kind: 'five_hour', percentUsed: 96, resetsAt: at(H) }]
  world(on, '/work/app', undefined, toasts)
  await $.session.start(start('/work/app'))
  expect(toasts.filter(t => t.includes('95%')).length).toBe(1)
  expect(toasts.join()).toMatch(/95% \(resets /)
  // The window moves later (a new reply reports another resetsAt): the old timer must not fire.
  limits = [{ kind: 'five_hour', percentUsed: 96, resetsAt: at(2 * H) }]
  await $.turn.complete({ text: '' } as never)
  await clock.advance(H + 60_000)
  expect(toasts.filter(t => t.includes('refreshed')).length).toBe(0)
  await clock.advance(H)
  expect(toasts.filter(t => t.includes('refreshed')).length).toBe(1)
  // Next window: a new resetsAt and 96% again → the 95% notice fires again, and one more refresh later.
  limits = [{ kind: 'five_hour', percentUsed: 96, resetsAt: at(7 * H) }]
  await $.turn.complete({ text: '' } as never)
  expect(toasts.filter(t => t.includes('95%')).length).toBe(2)
  await clock.advance(6 * H)
  expect(toasts.filter(t => t.includes('refreshed')).length).toBe(2)
  await clock.advance(H)
  expect(toasts.filter(t => t.includes('refreshed')).length).toBe(2)
})
