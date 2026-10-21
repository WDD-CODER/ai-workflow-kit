import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { hotspotsFromKitConfig } from '../hooks/register'

type Loose = (event: string, hook: (...args: never[]) => unknown) => unknown

const PLAN = `# Plan — Toggle chips (341)

## Read-Write Scope

\`\`\`scope
src/app/pages/filters/**
src/app/shared/toggle-chip/**
\`\`\`

## Atomic Sub-tasks

- [ ] A1: thing
`

type World = { files: Map<string, string>; branch: string; cwd: string; written: Map<string, string>; similar?: string }

const world = (on: On, w: World) => {
  const o = on as unknown as Loose
  const v = (value: unknown) => ({ value })
  // Windows: the engine resolves '/work/...' to 'C:\work\...' before the mock sees it.
  const path = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  o('session.start', () => ({ cwd: w.cwd }))
  o('tool.call', () => ({ result: 'ran', text: 'ran' }))
  o('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }] }))
  o('command.run', () => ({ text: '' }))
  o('session.cwd', () => v(w.cwd))
  o('command.register', (...a: unknown[]) => v({ command: (a[1] as { name: string }).name }))
  o('process.run', (...a: unknown[]) => {
    const argv = (a[1] as { argv: string[] }).argv
    if (argv[0] === 'git') return v({ exitCode: 0, stdout: w.branch, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
    if (argv[1]?.includes('plan-name-similarity')) return v({ exitCode: 0, stdout: w.similar ?? 'PLAN_SIMILARITY: no similar plans', stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
    return v({ exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  })
  o('fs.exists', (...a: unknown[]) => v(w.files.has(path((a[1] as { path: string }).path))))
  o('fs.read', (...a: unknown[]) => v(w.files.get(path((a[1] as { path: string }).path)) ?? ''))
  o('fs.stat', (...a: unknown[]) => v({ kind: 'file', size: 1, mtimeMs: w.files.has(path((a[1] as { path: string }).path)) ? 1 : 0, isLink: false }))
  o('fs.write', (...a: unknown[]) => {
    const { path: p, text } = a[1] as { path: string; text: string }
    w.written.set(path(p), text)
    w.files.set(path(p), text)
    return v(undefined)
  })
  o('ui.status', () => v(undefined))
  o('ui.toast', () => v(undefined))
}

const slot = (): World => {
  const cwd = '/work/app-wt-1'
  const files = new Map<string, string>([
    [`${cwd}/.worktree-port`, '4201'],
    [`${cwd}/.worktree-plan`, 'plans/341-toggle-chips.plan.md\n'],
    [`${cwd}/plans/341-toggle-chips.plan.md`, PLAN],
    [`${cwd}/docs/workflow-kit/kit-owned.json`, JSON.stringify({ files: ['.claude/commands/ship.md', 'scripts/scope-guard.sh'] })],
    [`${cwd}/docs/session-state-feat-341-toggle-chips.md`, '# state\n\n## Session Summary\n- did A1\n\n## Next Steps\n- A2\n\n## Other\nignored'],
    // The project's hotspots come from its kit.config.json (the hotspots option is empty by default).
    [`${cwd}/kit.config.json`, JSON.stringify({ paths: { hotspots: ['src/styles.scss'] }, project: { i18nFile: 'public/i18n/' } })],
  ])
  return { files, branch: 'feat/341-toggle-chips', cwd, written: new Map() }
}

const planner = (): World => {
  const cwd = '/work/app'
  const files = new Map<string, string>([[`${cwd}/docs/workflow-kit/kit-owned.json`, JSON.stringify({ files: ['.claude/commands/ship.md'] })]])
  return { files, branch: 'main', cwd, written: new Map() }
}

const start = (cwd: string) => ({ cwd, surface: null, isInteractive: true }) as never
const edit = (file_path: string, tool = 'Edit') => ({ tool, file_path, old_string: 'a', new_string: 'b', tool_use_id: 'x' }) as never
const run = (command: string, args = '', origin: { kind: string; name?: string } = { kind: 'composer' }) =>
  ({ command, args, origin, presentation: { isFullscreen: false, columns: 120 } }) as never

test('worker: in-scope edit passes, out-of-scope edit is denied with the approved: protocol', async ($, on) => {
  const w = slot()
  mock.clock(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  const ok = await $.tool.call(edit(`${w.cwd}/src/app/pages/filters/panel.ts`))
  expect(ok.deny).toBeUndefined()
  const out = await $.tool.call(edit('src/app/core/services/kitchen.ts'))
  expect(String(out.deny)).toMatch(/outside plan plans\/341-toggle-chips.plan.md/)
  expect(String(out.deny)).toMatch(/approved: src\/app\/core\/services\/kitchen.ts/)
  // Always-allowed paths need no scope entry.
  const hot = await $.tool.call(edit('src/styles.scss'))
  expect(hot.deny).toBeUndefined()
  const state = await $.tool.call(edit('docs/session-state-feat-341-toggle-chips.md'))
  expect(state.deny).toBeUndefined()
})

test('/approve appends the path to the scope block and the edit then passes', async ($, on) => {
  const w = slot()
  mock.clock(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  expect((await $.tool.call(edit('src/app/core/services/kitchen.ts'))).deny).toBeDefined()
  const { text } = await $.command.run(run('approve', 'src/app/core/services/kitchen.ts'))
  expect(text).toMatch(/approved/)
  const plan = w.written.get(`${w.cwd}/plans/341-toggle-chips.plan.md`) ?? ''
  expect(plan).toMatch(/src\/app\/shared\/toggle-chip\/\*\*\nsrc\/app\/core\/services\/kitchen.ts\n```/)
  const again = await $.tool.call(edit('src/app/core/services/kitchen.ts'))
  expect(again.deny).toBeUndefined()
})

test('/approve refuses a plugin origin', async ($, on) => {
  const w = slot()
  mock.clock(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  const { text } = await $.command.run(run('approve', 'x.ts', { kind: 'plugin', name: 'p' }))
  expect(text).toMatch(/for the Human/)
})

test('planner on main: plans and todo pass, code is denied, kit-owned is denied', async ($, on) => {
  const w = planner()
  mock.clock(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  expect((await $.tool.call(edit('plans/400-new.plan.md', 'Write'))).deny).toBeUndefined()
  expect((await $.tool.call(edit('.claude/todo.md'))).deny).toBeUndefined()
  expect(String((await $.tool.call(edit('src/app/x.ts'))).deny)).toMatch(/Planner folder stays on main/)
  expect(String((await $.tool.call(edit('.claude/commands/ship.md'))).deny)).toMatch(/Planner folder stays on main/)
})

test('kit-owned file is denied off main outside a worker slot, allowed when a plan scope lists it', async ($, on) => {
  const w = planner()
  w.branch = 'chore/kit-patch'
  mock.clock(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  expect(String((await $.tool.call(edit('.claude/commands/ship.md'))).deny)).toMatch(/KIT_OWNED/)
  expect((await $.tool.call(edit('src/app/x.ts'))).deny).toBeUndefined()
})

test('git push --no-verify is denied; other pushes pass', async ($, on) => {
  const w = slot()
  mock.clock(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  const denied = await $.tool.call({ tool: 'Bash', command: 'git push --no-verify origin main', tool_use_id: 'b1' } as never)
  expect(String(denied.deny)).toMatch(/human-only/)
  const ok = await $.tool.call({ tool: 'Bash', command: 'git push -u origin feat/341-toggle-chips', tool_use_id: 'b2' } as never)
  expect(ok.deny).toBeUndefined()
})

test('a new plan file with a similar existing plan is held until approved', async ($, on) => {
  const w = planner()
  w.files.set(`${w.cwd}/scripts/plan-name-similarity.mjs`, '// present')
  w.similar = 'PLAN_SIMILARITY: 1 similar plan(s) for "toggle" - confirm with Human before write.\n- plans/341-toggle-chips.plan.md'
  mock.clock(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  const held = await $.tool.call(edit('plans/402-toggle-again.plan.md', 'Write'))
  expect(String(held.deny)).toMatch(/PLAN_WRITE_GUARD/)
  w.similar = 'PLAN_SIMILARITY: no similar plans for "x" - safe to save as new.'
  const fresh = await $.tool.call(edit('plans/403-something-else.plan.md', 'Write'))
  expect(fresh.deny).toBeUndefined()
})

test('prompt.compose adds the role and the session-state excerpt as a session section', async ($, on) => {
  const w = slot()
  mock.clock(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  const { sections } = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: { name: 'default', isKeepingCodingInstructions: true }, traits: [], sections: [] } as never)
  const mine = sections.find(s => s.id === 'guards:role')
  expect(mine?.scope).toBe('session')
  expect(mine?.text).toMatch(/WORKER: slot with active plan plans\/341-toggle-chips.plan.md/)
  expect(mine?.text).toMatch(/did A1/)
  expect(mine?.text).not.toMatch(/ignored/)
})

test('a plan edit cannot widen the scope, and .worktree-plan is not editable', async ($, on) => {
  const w = slot()
  mock.clock(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  const widen = await $.tool.call({ tool: 'Edit', file_path: 'plans/341-toggle-chips.plan.md', old_string: 'src/app/shared/toggle-chip/**', new_string: 'src/app/shared/toggle-chip/**\n**', tool_use_id: 'w1' } as never)
  expect(String(widen.deny)).toMatch(/changes only through the Human/)
  // Even if the file changed on disk behind the guard, the pinned globs stand.
  w.files.set(`${w.cwd}/plans/341-toggle-chips.plan.md`, PLAN.replace('src/app/shared/toggle-chip/**', 'src/app/shared/toggle-chip/**\n**') + '\n')
  const stillOut = await $.tool.call(edit('src/app/core/services/kitchen.ts'))
  expect(String(stillOut.deny)).toMatch(/outside plan/)
  const slotState = await $.tool.call({ tool: 'Write', file_path: '.worktree-plan', content: 'plans/999-wide.plan.md', tool_use_id: 'w2' } as never)
  expect(String(slotState.deny)).toMatch(/slot state/)
  // A plain edit to the plan body (ticking a sub-task) still passes.
  const tick = await $.tool.call({ tool: 'Edit', file_path: 'plans/341-toggle-chips.plan.md', old_string: '- [ ] A1: thing', new_string: '- [x] A1: thing', tool_use_id: 'w3' } as never)
  expect(tick.deny).toBeUndefined()
})

test('".." traversal cannot dress an outside path as in-scope; absolute outside paths are left to their own folder', async ($, on) => {
  const w = slot()
  mock.clock(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  const climb = await $.tool.call(edit('src/app/pages/filters/../../../../../other-checkout/.env'))
  expect(String(climb.deny)).toMatch(/climbs above/)
  const dressed = await $.tool.call(edit(`${w.cwd}/src/app/pages/filters/../../core/services/kitchen.ts`))
  expect(String(dressed.deny)).toMatch(/outside plan/)
  const outside = await $.tool.call(edit('/work/other-checkout/src/x.ts'))
  expect(outside.deny).toBeUndefined()
})

test('push bypasses are denied in every spelling, including the GitHub API write tools', async ($, on) => {
  const w = slot()
  mock.clock(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  const flag = '--no-' + 'verify'
  for (const command of [`git push \\\n  ${flag} origin main`, `git push --no-verif origin main`, `git -c core.hooksPath=/dev/null push origin main`, `git push ${flag}`]) {
    const denied = await $.tool.call({ tool: 'Bash', command, tool_use_id: 'b' } as never)
    expect(String(denied.deny)).toMatch(/human-only/)
  }
  const api = await $.tool.call({ tool: 'mcp__github__push_files', owner: 'o', repo: 'r', branch: 'main', files: [], message: 'm', tool_use_id: 'g1' } as never)
  expect(String(api.deny)).toMatch(/bypasses the pre-push hook/)
  const apiBranch = await $.tool.call({ tool: 'mcp__github__push_files', owner: 'o', repo: 'r', branch: 'feat/x', files: [], message: 'm', tool_use_id: 'g2' } as never)
  expect(apiBranch.deny).toBeUndefined()
})

test('/approve rejects globs by button but accepts them typed, and rejects multi-line or absolute input', async ($, on) => {
  const w = slot()
  mock.clock(on)
  world(on, w)
  await $.session.start(start(w.cwd))
  expect((await $.command.run(run('approve', 'src/x.ts\nsrc/**'))).text).toMatch(/one line/)
  expect((await $.command.run(run('approve', '/etc/passwd'))).text).toMatch(/repo-relative/)
  expect((await $.command.run(run('approve', '../other/x.ts'))).text).toMatch(/repo-relative/)
  expect((await $.command.run(run('approve', 'src/app/core/**'))).text).toMatch(/approved/)
})

// -- mods dock ------------------------------------------------------------------

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const

test('the dock shows the plan calmly, then expands with Approve after an out-of-scope edit', async ($, on) => {
  const w = slot()
  mock.clock(on)
  world(on, w)
  const o = on as unknown as Loose
  o('ui.render', (...a: unknown[]) => {
    const $$ = a[0] as { ui: { resolve: (e: unknown) => { Text: unknown } } }
    return h($$.ui.resolve(a[1]).Text as never, {}, 'engine line')
  })
  await $.session.start(start(w.cwd))
  let ui = await $.ui.mount({ plugin: 'guards', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ key: 'mods-dock:guards:calm' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /plan 341 · feat\/341-toggle-chips/ })).toBeDefined()
  await ui.unmount()
  await $.tool.call(edit('src/app/core/services/kitchen.ts'))
  ui = await $.ui.mount({ plugin: 'guards', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ key: 'mods-dock:guards:alert' })).toBeDefined()
  expect((await ui.find({ key: 'mods-dock' }))?.props.borderColor).toBe('warning')
  expect(await ui.find({ type: 'Button', text: /Approve src\/app\/core\/services\/kitchen.ts/ })).toBeDefined()
  await ui.press({ key: 'guards-dismiss' })
  expect(await ui.find({ key: 'mods-dock:guards:calm' })).toBeDefined()
  await ui.unmount()
})

test('hotspots come from kit.config.json: paths.hotspots plus project.i18nFile, a folder covers what is under it', () => {
  expect(hotspotsFromKitConfig(JSON.stringify({ paths: { hotspots: ['src/styles.scss'] }, project: { i18nFile: 'public/i18n/, src/app/app.routes.ts' } })))
    .toEqual(['src/styles.scss', 'public/i18n/**', 'src/app/app.routes.ts'])
  expect(hotspotsFromKitConfig(null)).toEqual([])
  expect(hotspotsFromKitConfig('{ broken')).toEqual([])
  expect(hotspotsFromKitConfig(JSON.stringify({ project: { name: 'x' } }))).toEqual([])
})
