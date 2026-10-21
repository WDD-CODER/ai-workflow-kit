import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { afterChain, bar, fmtDur, nowIndex, parseChecks, parsePlan, stepWindow, tickStep, titleOf, waitingFrom } from '../hooks/register'

type Loose = (event: string, hook: (...args: never[]) => unknown) => unknown

const PLAN = `# Plan — Toggle chips (341)

## Read-Write Scope

\`\`\`scope
src/app/pages/filters/**
\`\`\`

## Functional Requirements

### Must Have (P0)
- [x] Chips render
- [ ] Chips toggle

## Done when

- [auto] \`npm run build\` → exit 0
- [human] Filter panel shows chips on mobile

## Atomic Sub-tasks

- [x] A1: Chip component — \`toggle-chip/**\`
- [ ] A2: Wire filter panel — \`filters/**\`
- [ ] A3: Specs
`

const PR_JSON = (checks: { name: string; conclusion?: string; status?: string }[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    number: 367,
    url: 'https://github.com/x/y/pull/367',
    title: 'Toggle chips',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: '',
    statusCheckRollup: checks.map(c => ({ name: c.name, status: c.status ?? 'COMPLETED', conclusion: c.conclusion ?? 'SUCCESS' })),
    headRefName: 'feat/341-toggle-chips',
    ...extra,
  })

type World = { cwd: string; files: Map<string, string>; branch: string; prJson: string; submitted: string[]; written: Map<string, string>; toasts: string[] }

const world = (on: On, w: World) => {
  const o = on as unknown as Loose
  const v = (value: unknown) => ({ value })
  const P = (a: unknown[]) => (a[1] as { path: string }).path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  o('session.start', () => ({ cwd: w.cwd }))
  o('session.end', () => ({ sessionId: 's' }))
  o('tool.call', () => ({ result: 'ran', text: 'ran' }))
  o('turn.start', () => ({ turnId: 't1' }))
  o('turn.complete', () => ({ text: '' }))
  o('command.run', () => ({ text: '' }))
  o('session.cwd', () => v(w.cwd))
  o('command.register', (...a: unknown[]) => v({ command: (a[1] as { name: string }).name }))
  o('process.run', (...a: unknown[]) => {
    const argv = (a[1] as { argv: string[] }).argv
    const ok = (stdout: string) => v({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
    if (argv[0] === 'git' && argv[1] === 'branch') return ok(w.branch)
    if (argv[0] === 'git' && argv[1] === 'rev-list') return ok('2')
    if (argv[0] === 'gh') return w.prJson ? ok(w.prJson) : v({ exitCode: 1, stdout: '', stderr: 'no pull requests found', isStdoutTruncated: false, isStderrTruncated: false })
    return ok('')
  })
  o('fs.exists', (...a: unknown[]) => v(w.files.has(P(a))))
  o('fs.list', (...a: unknown[]) => {
    const dir = P(a).replace(/\/$/, '')
    const names = [...w.files.keys()].filter(k => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/')).map(k => k.slice(dir.length + 1))
    return v(names.map(name => ({ name, kind: 'file' })))
  })
  o('fs.read', (...a: unknown[]) => v(w.files.get(P(a)) ?? ''))
  o('fs.stat', (...a: unknown[]) => v({ kind: 'file', size: 1, mtimeMs: (w.files.get(P(a)) ?? '').length, isLink: false }))
  o('fs.write', (...a: unknown[]) => {
    const { text } = a[1] as { path: string; text: string }
    w.files.set(P(a), text)
    w.written.set(P(a), text)
    return v(undefined)
  })
  o('prompt.submit', (...a: unknown[]) => {
    const { text } = a[1] as { text: string }
    w.submitted.push(text)
    return { text }
  })
  o('ui.render', (...a: unknown[]) => {
    const $$ = a[0] as { ui: { resolve: (e: unknown) => { Text: unknown } } }
    const { Text } = $$.ui.resolve(a[1])
    return h(Text as never, { dimColor: true }, '')
  })
  o('ui.toast', (...a: unknown[]) => {
    w.toasts.push((a[1] as { text: string }).text)
    return v(undefined)
  })
  o('ui.notify', () => v({ isSent: false, reason: 'no-surface' }))
}

const slot = (prJson = PR_JSON([{ name: 'ci' }, { name: 'security' }])): World => {
  const cwd = '/work/app-wt-1'
  return {
    cwd,
    branch: 'feat/341-toggle-chips',
    prJson,
    submitted: [],
    written: new Map(),
    toasts: [],
    files: new Map([
      [`${cwd}/.worktree-port`, '4201'],
      [`${cwd}/.worktree-plan`, 'plans/341-toggle-chips.plan.md\n'],
      [`${cwd}/plans/341-toggle-chips.plan.md`, PLAN],
    ]),
  }
}

const start = (cwd: string) => ({ cwd, surface: null, isInteractive: true }) as never
const run = (command: string, args = '', origin: { kind: string; name?: string } = { kind: 'composer' }) =>
  ({ command, args, origin, presentation: { isFullscreen: false, columns: 120 } }) as never

test('parsePlan: Atomic Sub-tasks are the steps (requirement boxes are not), tagged Done-when items', () => {
  const p = parsePlan('plans/341-toggle-chips.plan.md', PLAN)
  expect(p.planNo).toBe('341')
  expect(p.steps.map(s => `${s.id}:${s.done ? 1 : 0}`)).toEqual(['A1:1', 'A2:0', 'A3:0'])
  expect(p.doneWhen).toEqual([
    { tag: 'auto', text: '`npm run build` → exit 0' },
    { tag: 'human', text: 'Filter panel shows chips on mobile' },
  ])
  expect(p.current).toBe('A2 Wire filter panel')
  const reqsOnly = parsePlan('plans/9-x.plan.md', ['## Functional Requirements', '### Must Have', '- [x] One', '- [ ] Two'].join(String.fromCharCode(10)))
  expect(reqsOnly.steps.map(s => s.id)).toEqual(['1', '2'])
  expect(bar(2, 5, 10)).toBe('████░░░░░░')
})

test('tickStep ticks by id or by the Nth open step and leaves others alone', () => {
  const byId = tickStep(PLAN, 'A2')
  expect(byId.ticked).toMatch(/^A2: Wire filter panel/)
  expect(byId.text).toMatch(/- \[x\] A2: Wire filter panel/)
  expect(byId.text).toMatch(/- \[ \] A3: Specs/)
  const byN = tickStep(PLAN, '1')
  expect(byN.ticked).toMatch(/^Chips toggle/)
  expect(tickStep(PLAN, 'Z9').ticked).toBeNull()
})

test('parseChecks maps GitHub rollup states', () => {
  const checks = parseChecks([
    { name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'lint', status: 'IN_PROGRESS', conclusion: '' },
    { name: 'sec', status: 'COMPLETED', conclusion: 'FAILURE' },
    { context: 'legacy', state: 'SUCCESS' },
  ])
  expect(checks.map(c => c.state)).toEqual(['pass', 'pending', 'fail', 'pass'])
})

test('/pr reports the PR and /merge sends the literal reply when green', async ($, on) => {
  const w = slot()
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  const { text } = await $.command.run(run('pr'))
  expect(text).toMatch(/#367 · 2\/2 checks ✓ · mergeable · 2 behind main/)
  expect(text).toMatch(/merge: ready/)
  const merged = await $.command.run(run('merge'))
  expect(merged.text).toMatch(/sent "merge"/)
  await clock.advance(10)
  expect(w.submitted).toEqual(['merge'])
})

test('/merge refuses while a check is failing or running, and refuses a plugin origin', async ($, on) => {
  const w = slot(PR_JSON([{ name: 'ci', conclusion: 'FAILURE' }, { name: 'lint', status: 'IN_PROGRESS', conclusion: '' }]))
  mock.clock(on, { now: 1000 })
  mock.store(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  const { text } = await $.command.run(run('merge'))
  expect(text).toMatch(/not merging — 1 check\(s\) failing, 1 check\(s\) still running/)
  expect(w.submitted).toEqual([])
  const plugin = await $.command.run(run('merge', '', { kind: 'plugin', name: 'p' }))
  expect(plugin.text).toMatch(/for the Human/)
})

test('/progress shows the bar and /check ticks the plan file in a slot', async ($, on) => {
  const w = slot('')
  mock.clock(on, { now: 1000 })
  mock.store(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  const before = await $.command.run(run('progress'))
  expect(before.text).toMatch(/341 · ███░░░░░░░ 33% · 1\/3/)
  const ticked = await $.command.run(run('check', 'A2'))
  expect(ticked.text).toMatch(/ticked \[x\] A2/)
  expect(ticked.text).toMatch(/67% · 2\/3/)
  expect(w.written.get(`${w.cwd}/plans/341-toggle-chips.plan.md`)).toMatch(/- \[x\] A2: Wire filter panel/)
  const refused = await $.command.run(run('check', 'A3', { kind: 'plugin', name: 'p' }))
  expect(refused.text).toMatch(/for the Human/)
})

test('a checks transition is announced once and queued for the phone', async ($, on) => {
  const w = slot(PR_JSON([{ name: 'ci', status: 'IN_PROGRESS', conclusion: '' }]))
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  w.prJson = PR_JSON([{ name: 'ci' }])
  await clock.advance(60_000)
  await $.command.run(run('pr'))
  expect(w.toasts.some(t => t.endsWith('#367: all 1 checks green'))).toBe(true)
  expect(w.toasts.filter(t => t.includes('all 1 checks green')).length).toBe(1)
})

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const

test('the band draws the PR line and its merge button sends the reply, on terminal and desktop', async ($, on) => {
  const w = slot()
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ship-pilot', surface, ...BAND } as never)
    expect(await ui.find({ type: 'Text', text: /#367/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / 341 · / })).toBeDefined()
    await ui.press({ key: 'merge' })
    await clock.advance(10)
    await ui.unmount()
  }
  expect(w.submitted).toEqual(['merge', 'merge'])
})

test('the dock keeps ship-pilot collapsed while checks run', async ($, on) => {
  const w = slot(PR_JSON([{ name: 'ci', status: 'IN_PROGRESS', conclusion: '' }]))
  mock.clock(on, { now: 1000 })
  mock.store(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  const ui = await $.ui.mount({ plugin: 'ship-pilot', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ key: 'mods-dock:ship-pilot:calm' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /PR #367 · checks 0\/1 running/ })).toBeDefined()
  expect((await ui.find({ key: 'mods-dock' }))?.props.flexDirection).toBe('row')
  await ui.unmount()
})

test('the dock expands with merge once checks finish', async ($, on) => {
  const w = slot()
  mock.clock(on, { now: 1000 })
  mock.store(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  const ui = await $.ui.mount({ plugin: 'ship-pilot', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ key: 'mods-dock:ship-pilot:alert' })).toBeDefined()
  expect((await ui.find({ key: 'mods-dock-row:ship-pilot' }))?.props.display).toBe('flex')
  expect((await ui.find({ key: 'mods-dock' }))?.props.flexDirection).toBe('column')
  await ui.unmount()
})

// -- K7: plan panel ---------------------------------------------------------------

const TALL = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 40, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const

test('plan panel helpers: now/next, the window around now, waiting signals, after chain, durations', () => {
  const p = parsePlan('plans/341-toggle-chips.plan.md', PLAN)
  expect(p.steps[nowIndex(p)]!.id).toBe('A2') // first open Atomic Sub-task
  expect(nowIndex({ ...p, current: 'A3 Specs' })).toBe(p.steps.findIndex(s => s.id === 'A3'))
  expect(stepWindow(5, 2)).toEqual([0, 5])
  expect(stepWindow(30, 20, 12)).toEqual([14, 26])
  expect(stepWindow(30, 1, 12)).toEqual([0, 12])
  expect(stepWindow(30, 29, 12)).toEqual([18, 30])
  expect(waitingFrom('Out of scope. Reply `approved: src/x.ts` to go on.')).toBe('an approved: <path> reply')
  expect(waitingFrom('Checks are green. Reply merge to merge.')).toBe('your merge reply')
  expect(waitingFrom('Here is the tag v0.5.0 — waiting for your go.')).toBe('your go / answer')
  expect(waitingFrom('Done: build passes, 12 tests green.')).toBe(null)
  const plans = [
    { no: '390', text: 'nothing' },
    { no: '391', text: 'This plan must run after plan 390 has merged.' },
    { no: '392', text: 'This plan must run after plan 391.' },
    { no: '393', text: 'this plan must run after plan 390 (wait)' },
    { no: '400', text: 'unrelated' },
  ]
  expect(afterChain('390', plans)).toEqual(['391', '393', '392'])
  expect(afterChain('400', plans)).toEqual([])
  expect(fmtDur(25 * 60000)).toBe('25m')
  expect(fmtDur(100 * 60000)).toBe('1h 40m')
})

test('pressing the plan chip opens the panel under the dock and pressing again closes it', async ($, on) => {
  const w = slot(PR_JSON([{ name: 'ci', status: 'IN_PROGRESS', conclusion: '' }]))
  w.files.set(`${w.cwd}/plans/342-next.plan.md`, ['# Plan 342', 'Status: draft', 'This plan must run after plan 341.'].join(String.fromCharCode(10)))
  w.files.set(`${w.cwd}/plans/341-toggle-chips.plan.md`, PLAN)
  mock.clock(on, { now: 1000 })
  mock.store(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  const ui = await $.ui.mount({ plugin: 'ship-pilot', surface: 'terminal', ...TALL } as never)
  expect(await ui.find({ key: 'plan-panel-frame' })).toBeUndefined()
  await ui.press({ key: 'plan-panel' })
  expect(await ui.find({ key: 'plan-panel-frame' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^▶ $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /A2 Wire filter panel/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Your checks at the end: 1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /After this: plan 342/ })).toBeDefined()
  await ui.press({ key: 'plan-panel' })
  expect(await ui.find({ key: 'plan-panel-frame' })).toBeUndefined()
  await ui.unmount()
})

test('the panel shows Waiting on you after an answer that asks for approved:, and clears on the next plain answer', async ($, on) => {
  const w = slot(PR_JSON([{ name: 'ci', status: 'IN_PROGRESS', conclusion: '' }]))
  mock.clock(on, { now: 1000 })
  mock.store(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  const ui = await $.ui.mount({ plugin: 'ship-pilot', surface: 'terminal', ...TALL } as never)
  await ui.press({ key: 'plan-panel' })
  const end = (answer: string) => $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await end('That file is outside scope. Reply `approved: src/app/x.ts`.')
  expect(await ui.find({ type: 'Text', text: /Waiting on you: an approved: <path> reply/ })).toBeDefined()
  await end('Done, build passes.')
  expect(await ui.find({ type: 'Text', text: /Waiting on you/ })).toBeUndefined()
  await ui.unmount()
})

test('titleOf: the plain title before " — "; raw actions in an older plan are cleaned up', () => {
  expect(titleOf('Let the installer pull the kit from a GitHub release — --source/--ref — tools/install.mjs')).toBe('Let the installer pull the kit from a GitHub release')
  expect(titleOf('Fetch-to-cache helper (`tools/lib/source.mjs`) + `--source/--ref` in install, sync — `tools/**`')).toBe('Fetch-to-cache helper')
  expect(titleOf('`install.json` source/ref/commit; sync defaults + `--ref` upgrade — `tools/**`')).toBe('source/ref/commit')
  expect(titleOf('Step 0 reality check — `docs/workflow-kit/manifest.md`')).toBe('Step 0 reality check')
  expect(titleOf('Ship the `merge` button')).toBe('Ship the merge button')
})
