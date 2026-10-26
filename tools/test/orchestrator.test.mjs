// Unit tests for the orchestrator's pure rules (scripts/lib/orch-run.mjs, installed) and the orchestrator.* config
// validation (tools/lib/kit.mjs). ORCH_ROOT = an installed project (default: this repo, the kit installed into itself).
// The end-to-end run is tools/orchestrator-e2e.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve, basename } from 'path'
import { spawnSync, spawn } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, utimesSync, readdirSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { pathToFileURL, fileURLToPath } from 'url'
import { orchestratorProblems, commandProblems } from '../lib/kit.mjs'
import { SILENT_PLAN, COVERED_PLAN, PARTLY_PLAN, STYLE_PLAN, BACKEND_PLAN, behaviourGaps } from '../fixtures/orchestrator/readiness.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit
const lib = await import(pathToFileURL(join(root, 'scripts', 'lib', 'orch-run.mjs')).href)

test('run names: lower-case words with dashes only', () => {
  assert.equal(lib.runNameProblem('batch-1'), null)
  for (const bad of ['', 'Batch', 'a b', '../x', 'x/y', '-x', 'a'.repeat(41)]) assert.match(lib.runNameProblem(bad), /run name/)
})

test('plan branch: feat/NNN- and the first four slug words', () => {
  assert.equal(lib.planBranch('plans/451-add-the-new-parser-and-tests.plan.md', '451'), 'feat/451-add-the-new-parser')
  assert.equal(lib.planBranch('plans\\design\\012-x.plan.md', '012'), 'feat/012-x')
})

test('start tier: judgment only when Architecture Impact names an invariant other than INV-none', () => {
  const plan = (lines) => `# Plan\n\n## Architecture Impact\n${lines}\n\n## Next\n`
  assert.deepEqual(lib.startTier(plan('- INV-none: preserves — nothing')), { tier: 'build', invariants: [] })
  assert.deepEqual(lib.startTier(plan('- INV-3: preserves — touches it\n- INV-none: preserves')), { tier: 'judgment', invariants: ['INV-3'] })
  assert.deepEqual(lib.startTier('# Plan with no section'), { tier: 'build', invariants: [] })
})

test('[human] items are read verbatim, [auto] ones are not', () => {
  const t = '- [auto] node x.mjs exits 0\n- [human] Open the page and see "Saved"\n  - [ ] [human] Second one\n'
  assert.deepEqual(lib.humanItems(t), ['Open the page and see "Saved"', 'Second one'])
})

test('free disk in GB from statfs', () => {
  assert.equal(lib.freeGb({ bavail: 2_500_000, bsize: 4096 }), 10.2)
})

test('the report: counts from git merges, main untouched, the Human items and the PowerShell lines', () => {
  const status = {
    run: 'r1', startedAt: 'T0', mainShaAtStart: 'aaaaaaa1',
    plans: {
      '001': { nnn: '001', title: 'One', state: 'merging', round: 1, tier: 'build', humanItems: ['Check the page'], models: { 'orch-builder': { model: 'sonnet', effort: 'medium' } } },
      '002': { nnn: '002', title: 'Two', state: 'parked', round: 2, reason: 'gate: npm run test (fix rounds used: 2 of 2)', models: {} },
      '003': { nnn: '003', title: 'Three', state: 'skipped', reason: 'not started' },
    },
    notes: [{ plan: '001', text: 'kept the old flag' }],
  }
  const r = lib.formatReport({ status, merged: [{ nnn: '001', branch: 'feat/001-one', sha: 'bbbbbbb2' }], mainShaNow: 'aaaaaaa1', finishedAt: 'T1', runBranch: 'orch/r1', mainBranch: 'main' })
  assert.match(r, /Result: 1 merged, 2 parked, skipped or left out, 3 in the run/)
  assert.match(r, /`main` untouched: yes/)
  assert.match(r, /\| 001 One \| merged \| 1 \| build \| bbbbbbb \|/)
  assert.match(r, /- 001: kept the old flag/)
  assert.ok(r.includes("### The plans' [human] items (no UI check ran)\n\n1. 001 One: Check the page"), r)
  assert.match(r, /- Decide on 002: gate: npm run test/)
  assert.match(r, /gh pr create --base main --head orch\/r1/)
  const moved = lib.formatReport({ status, merged: [], mainShaNow: 'ccccccc3', finishedAt: 'T1', runBranch: 'orch/r1', mainBranch: 'main' })
  assert.match(moved, /`main` untouched: NO/)
})

test('the report: one validation list grouped by page with the UI evidence, numbers running on', () => {
  const plans = [
    { nnn: '001', title: 'One', humanItems: ['Open the app'], uiCards: [
      { card: 'Save stores the name', status: 'pass', page: 'https://app.example/settings', screenshots: ['shots/1.png'], round: 0 },
      { card: 'Home shows the list', status: 'pass', page: 'https://app.example/', screenshots: [], round: 1 },
    ] },
    { nnn: '002', title: 'Two', humanItems: [], uiCards: [{ card: 'Delete asks first', status: 'pass', page: 'https://app.example/settings', screenshots: ['shots/2.png'], round: 0 }] },
  ]
  const out = lib.validationList(plans)
  const at = (l) => out.indexOf(l)
  assert.ok(at('### https://app.example/settings') === 0, out.join(' | '))
  assert.equal(out[2], '| # | Card | Verdict | Screenshot |')
  assert.equal(out[4], '| 1 | 001: Save stores the name | pass — browser, round 0 | [![Save stores the name](shots/1.png)](shots/1.png) |')
  assert.equal(out[5], '| 2 | 002: Delete asks first | pass — browser, round 0 | [![Delete asks first](shots/2.png)](shots/2.png) |')
  assert.equal(out[at('### https://app.example/') + 4], '| 3 | 001: Home shows the list | pass — browser, round 1 | no screenshot |')
  assert.equal(out[at("### Not checked by the run — the plans' [human] items") + 2], '4. 001 One: Open the app')
  assert.deepEqual(lib.validationList([{ nnn: '003', humanItems: [] }]), ['- nothing to validate', ''])
})

test('readiness: a plan with interactive behaviour and no "what happens when" gets a question per gap', () => {
  // The rule as the agent file states it ...
  const agent = readFileSync(join(root, '.claude', 'agents', 'orch-readiness.md'), 'utf8')
  assert.match(agent, /Product questions/)
  assert.match(agent, /on edit, on leave, on cancel and on error/)
  assert.match(agent, /Skip plans that\s+change only styling or only the backend/)
  // ... and the fixtures it is checked on.
  assert.deepEqual(behaviourGaps(SILENT_PLAN), ['edit', 'leave', 'cancel', 'error'], 'silent plan: a question for each case')
  assert.deepEqual(behaviourGaps(PARTLY_PLAN), ['leave', 'error'], 'partly covered plan: only the missing cases')
  assert.deepEqual(behaviourGaps(COVERED_PLAN), [], 'covered plan: no question')
  assert.deepEqual(behaviourGaps(STYLE_PLAN), [], 'styling-only plan is skipped')
  assert.deepEqual(behaviourGaps(BACKEND_PLAN), [], 'backend-only plan is skipped')
})

test('the builder and take-plan state the no-invented-behaviour rule and read agent-rules.md, never decision-log.md', () => {
  for (const f of ['.claude/agents/orch-builder.md', '.claude/commands/take-plan.md']) {
    const t = readFileSync(join(root, f), 'utf8')
    assert.match(t, /behaviour:/, `${f}: behaviour:`)
    assert.match(t, /docs\/brain\/agent-rules\.md/, `${f}: agent-rules.md`)
    assert.match(t, /never[^.]*decision-log\.md/, `${f}: never decision-log.md`)
  }
  assert.match(readFileSync(join(root, '.claude', 'agents', 'orch-report.md'), 'utf8'), /D1…Dn/)
})

// ---- the workflow itself, with stub agents: pilot, UI batches, the final gate and the numbered decisions -------------
// orchestrate.js (installed, rendered) runs here with a fake `agent`: the runner answers the state and preflight
// commands from canned ORCH_JSON, the role agents answer with fixed results. No git, no files.
const wfSource = readFileSync(join(root, '.claude', 'workflows', 'orchestrate.js'), 'utf8')
const PILOT = Number(/const PILOT_SIZE = (\d+)/.exec(wfSource)?.[1] ?? 0)

async function runFlow(args, hooks = {}) {
  const calls = []
  const commands = []
  const plansIn = args.plans.map(String)
  const words = (cmd) => [...cmd.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2])
  const task = (prompt) => Object.fromEntries(String(prompt).split('\n').map((l) => /^([A-Z_]+): (.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]))
  const out = (o) => ({ exitCode: 0, output: `ORCH_JSON ${JSON.stringify(o)}` })
  const state = (w) => {
    const cmd = w[2]
    const f = Object.fromEntries(w.slice(3).map((x) => /^--([\w-]+)=(.*)$/.exec(x)).filter(Boolean).map((m) => [m[1], m[2]]))
    if (cmd === 'init') return { ok: true, mergeFolder: '/merge' }
    if (cmd === 'order') {
      const todo = plansIn.filter((p) => !(hooks.merged ?? []).includes(p))
      return { ok: true, waves: hooks.waves ?? [todo], waveLocks: [], skipped: hooks.merged ?? [], plans: Object.fromEntries(plansIn.map((p) => [p, { path: `plans/${p}-x.plan.md` }])) }
    }
    if (cmd === 'plan-info') return { ok: true, path: `plans/${f.plan}-x.plan.md`, branch: `feat/${f.plan}-x`, startTier: 'build', invariants: [], npmScripts: [], uiItems: [] }
    if (cmd === 'worktree') return { ok: true, path: `/wt/${f.plan}` }
    if (cmd === 'finish') return { ok: true, merged: [], parked: [], report: 'r', local: 'l' }
    if (cmd === 'diff') return { ok: true, files: [], sensitive: false }
    return { ok: true }
  }
  async function agent(prompt, opts = {}) {
    const t = task(prompt)
    const type = opts.agentType
    calls.push({ type, label: opts.label, task: t })
    if (type === 'kit-runner') {
      const w = words(t.COMMAND)
      commands.push(t.COMMAND)
      return out(w[1] === 'scripts/orch-state.mjs' ? state(w) : { ok: true })
    }
    const base = { role: type, model: 'stub', effort: 'low' }
    const nnn = /plan (\d+)/.exec(prompt)?.[1]
    if (type === 'orch-builder') {
      const b = hooks.builder?.(nnn) ?? {}
      return { ...base, status: 'built', branch: t.BRANCH, headSha: 'abc1234', summary: 's', evidence: ['e'], ...b }
    }
    if (type === 'orch-gate') {
      const cmds = JSON.parse(t.COMMANDS)
      const failing = hooks.gateFails?.(t.FOLDER, cmds)
      return { ...base, results: cmds.map((c, i) => (failing && i === 0 ? { command: c, status: 'fail', tail: 'FAIL v2-types.spec: 2 required fields' } : { command: c, status: 'pass' })) }
    }
    if (['orch-check-plan', 'orch-check-bugs', 'orch-check-rules', 'orch-security'].includes(type)) return { ...base, problems: [] }
    if (type === 'orch-merge') return { ...base, merged: true, sha: 'def5678' }
    if (type === 'orch-ui') return { ...base, cards: JSON.parse(t.CARDS ?? '[]').map((c) => ({ card: c.card, page: c.page, status: 'pass', screenshots: [] })) }
    throw new Error(`stub: no agent for ${type} (${opts.label})`)
  }
  const parallel = (thunks) => Promise.all(thunks.map((th) => Promise.resolve().then(th)))
  const AsyncFunction = (async () => {}).constructor
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', 'require', 'process', wfSource.replace(/^export const meta\s*=/m, 'const meta ='))
  const result = await fn(agent, parallel, undefined, () => {}, () => {}, { mode: 'run', run: 'r1', root: '/main', startedAt: 'T0', ...args }, {}, undefined, undefined, undefined)
  return { result, calls, commands }
}
const cardsOf = (n) => Array.from({ length: n }, (_, i) => ({ card: `Card ${i + 1} shows text ${i + 1}`, page: 'https://app.example/p' }))

test('UI cards go to the browser agent in batches of 5: 12 cards -> 3 fresh agents, never more than 5 each', async () => {
  const { calls } = await runFlow({ plans: ['101'], ui: true }, { builder: () => ({ uiCards: cardsOf(12) }) })
  const ui = calls.filter((c) => c.type === 'orch-ui')
  assert.equal(ui.length, 3)
  assert.deepEqual(ui.map((c) => JSON.parse(c.task.CARDS).length), [5, 5, 2])
  assert.deepEqual(ui.map((c) => c.task.BATCH), ['1 of 3', '2 of 3', '3 of 3'])
  const all = ui.flatMap((c) => JSON.parse(c.task.CARDS).map((x) => x.card))
  assert.equal(new Set(all).size, 12, 'every card is checked exactly once')
  const five = await runFlow({ plans: ['101'], ui: true }, { builder: () => ({ uiCards: cardsOf(5) }) })
  assert.equal(five.calls.filter((c) => c.type === 'orch-ui').length, 1, '5 cards stay one agent')
})

test('decisions: numbered D1…Dn across the run, grouped by plan with behaviour: first, noted for the report', async () => {
  const decisions = { 101: ['seen: src/a.js:12 — NaN at 100 %', 'behaviour: no dialog on leave — reverse: add one'], 102: ['behaviour: saved on blur — reverse: remove the handler'] }
  const { result, commands } = await runFlow({ plans: ['101', '102'], pilot: false }, { builder: (nnn) => ({ decisions: decisions[nnn] }) })
  assert.deepEqual(result.decisions, [
    { id: 'D1', plan: '101', text: 'behaviour: no dialog on leave — reverse: add one' },
    { id: 'D2', plan: '101', text: 'seen: src/a.js:12 — NaN at 100 %' },
    { id: 'D3', plan: '102', text: 'behaviour: saved on blur — reverse: remove the handler' },
  ])
  const notes = commands.filter((c) => /orch-state\.mjs note/.test(c) && /--text="?D\d/.test(c))
  assert.equal(notes.length, 3, 'each decision is a run note, so it prints under "Decisions taken"')
  const second = await runFlow({ plans: ['103'], pilot: false, firstDecision: 4 }, { builder: () => ({ decisions: ['behaviour: x — reverse: y'] }) })
  assert.equal(second.result.decisions[0].id, 'D4', 'a continue run numbers on from the first launch')
})

test('final gate: the project checks run once on the run branch after the last merge; a failure is a finding and the run is not clean', async () => {
  const clean = await runFlow({ plans: ['101'], pilot: false })
  assert.deepEqual(clean.result.finalGate, { ok: true })
  assert.equal(clean.calls.filter((c) => c.type === 'orch-gate' && c.task.FOLDER === '/merge').length, 1)
  // A merge that breaks a test outside every plan: the plans' own gates pass, the run-branch gate fails.
  const broken = await runFlow({ plans: ['101'], pilot: false }, { gateFails: (folder) => folder === '/merge' })
  assert.equal(broken.result.finalGate.ok, false)
  assert.match(broken.result.finalGate.why, /^final gate failed: npm run \w+ — .*v2-types\.spec/)
  assert.match(broken.result.stopReason, /^final gate failed/)
  assert.ok(broken.commands.some((c) => /orch-state\.mjs stop/.test(c) && /final gate failed/.test(c)), 'the run is stopped with the reason (the report header shows it)')
  assert.ok(broken.commands.some((c) => /orch-state\.mjs note/.test(c) && /final gate failed/.test(c)))
})

test('pilot: more plans than pilotSize -> the first plans run, the run stops with the rest waiting; continue builds the rest', { skip: PILOT === 0 && 'pilotSize is 0 in this project' }, async () => {
  const plans = Array.from({ length: PILOT + 2 }, (_, i) => String(101 + i))
  const first = await runFlow({ plans })
  const built = first.calls.filter((c) => c.type === 'orch-builder').map((c) => /feat\/(\d+)-/.exec(c.task.BRANCH)[1])
  assert.deepEqual(built, plans.slice(0, PILOT))
  assert.deepEqual(first.result.pilot, { size: PILOT, waiting: plans.slice(PILOT) })
  assert.match(first.result.stopReason, new RegExp(`^pilot of ${PILOT} plans done`))
  assert.ok(first.commands.some((c) => /orch-state\.mjs stop/.test(c) && /pilot of/.test(c)))
  // continue: pilot false, the merged plans come back as already merged from git
  const rest = await runFlow({ plans, pilot: false }, { merged: plans.slice(0, PILOT) })
  assert.deepEqual(rest.calls.filter((c) => c.type === 'orch-builder').map((c) => /feat\/(\d+)-/.exec(c.task.BRANCH)[1]), plans.slice(PILOT))
  assert.equal(rest.result.pilot, null)
  // not more plans than the pilot size: no pilot
  const few = await runFlow({ plans: plans.slice(0, PILOT) })
  assert.equal(few.result.pilot, null)
  assert.equal(few.calls.filter((c) => c.type === 'orch-builder').length, PILOT)
})

test('orchestrator.* config: defaults pass, bad values name the key', () => {
  const ok = { 'orchestrator.runBranchPrefix': 'orch/', 'orchestrator.maxFixRounds': 2, 'orchestrator.minFreeDiskGb': 5, 'orchestrator.pilotSize': 3, 'git.mainBranch': 'main' }
  for (const v of [0, 1, 10]) assert.deepEqual(orchestratorProblems({ ...ok, 'orchestrator.pilotSize': v }), [])
  for (const v of [-1, 11, 1.5, '3', null]) assert.match(orchestratorProblems({ ...ok, 'orchestrator.pilotSize': v })[0], /^orchestrator\.pilotSize is .* — it must be a whole number from 0 to 10/)
  assert.deepEqual(orchestratorProblems(ok), [])
  assert.deepEqual(orchestratorProblems({ ...ok, 'orchestrator.runBranchPrefix': 'runs/batch/' }), [])
  const bad = (k, v) => orchestratorProblems({ ...ok, [k]: v })
  assert.match(bad('orchestrator.runBranchPrefix', 'orch')[0], /^orchestrator\.runBranchPrefix is "orch"/)
  assert.match(bad('orchestrator.runBranchPrefix', 'main/')[0], /not the main branch/)
  assert.match(bad('orchestrator.runBranchPrefix', 'a..b/')[0], /^orchestrator\.runBranchPrefix/)
  assert.match(bad('orchestrator.maxFixRounds', 6)[0], /^orchestrator\.maxFixRounds is 6/)
  assert.match(bad('orchestrator.maxFixRounds', 1.5)[0], /whole number/)
  assert.match(bad('orchestrator.minFreeDiskGb', '5')[0], /^orchestrator\.minFreeDiskGb is "5"/)
  // install and sync read the problems through commandProblems
  assert.ok(commandProblems({ ...ok, 'orchestrator.maxFixRounds': 0, 'models.mechanical': 'haiku', 'models.analysis': 'sonnet', 'models.judgment': 'inherit', 'models.build': 'sonnet' }).some((m) => m.startsWith('orchestrator.maxFixRounds is 0')))
})

test('plan branch: the slug is lower-case letters, digits and dashes only; any other branch is refused', () => {
  assert.equal(lib.planBranch('plans/451-Add_$(rm -rf x);The `parser`.plan.md', '451'), 'feat/451-add-rm-rf-x')
  assert.equal(lib.planBranch('plans/452-"; touch pwned #.plan.md', '452'), 'feat/452-touch-pwned')
  assert.equal(lib.planBranch('plans/453-$$$.plan.md', '453'), 'feat/453-plan')
  for (const b of ['feat/451-add-the-parser', 'feat/12-x']) assert.equal(lib.planBranchProblem(b), null)
  for (const b of ['feat/451-Add', 'feat/451-a;b', 'feat/451-a b', 'fix/451-a', 'feat/451-', 'feat/x-a', '--upload-pack=x', undefined]) assert.match(lib.planBranchProblem(b), /does not match/)
})

test('added-code check: a failed or cut-off git diff counts as sensitive (fail closed)', () => {
  const re = /auth/i
  const out = '+++ b/src/a.js\n+const auth = 1\n+++ b/src/b.js\n+const x = 1'
  assert.deepEqual(lib.addedCodeFiles({ status: 0, out }, re), { failed: false, files: ['src/a.js'] })
  assert.deepEqual(lib.addedCodeFiles({ status: 0, out }, re, ['src/a.js']), { failed: false, files: [] })
  assert.equal(lib.addedCodeFiles({ status: 128, out: '' }, re).failed, true)
  assert.equal(lib.addedCodeFiles({ status: 0, out, truncated: true }, re).failed, true)
  assert.equal(lib.addedCodeFiles(null, re).failed, true)
})

test('[ui] card values: page an http(s) URL, card not starting with "-", safe screenshot paths', () => {
  assert.equal(lib.uiCardProblem({ card: 'Save shows Saved', page: 'https://app.example/settings', shots: ['screens/1.png'] }), null)
  assert.equal(lib.uiCardProblem({ card: 'x', page: '' }), null)
  assert.match(lib.uiCardProblem({ card: '--state=merged' }), /^card/)
  assert.match(lib.uiCardProblem({ card: ' -x' }), /^card/)
  for (const page of ['file:///etc/passwd', 'javascript:alert(1)', 'https://a.example/$(id)', 'http://a b']) assert.match(lib.uiCardProblem({ card: 'x', page }), /^page/)
  for (const shot of ['-rf', '../x.png', 'a;b.png', 'a b.png', '$(id).png']) assert.match(lib.uiCardProblem({ card: 'x', shots: [shot] }), /^screenshot/)
})

test('orch-state.mjs: unknown flags (--root among them), a value that looks like a flag and unsafe card values are refused', () => {
  const run = (...a) => spawnSync(process.execPath, [join(root, 'scripts', 'orch-state.mjs'), ...a], { cwd: root, encoding: 'utf8' })
  const refused = (r, re) => {
    assert.notEqual(r.status, 0, `${r.stdout}${r.stderr}`)
    assert.match(r.stdout, re)
  }
  refused(run('disk', '--bogus=1'), /unknown flag --bogus/)
  refused(run('disk', '--root=C:/elsewhere'), /unknown flag --root/)
  refused(run('disk', '--root', '..'), /unknown flag --root/)
  refused(run('set', '--run', 'x', '--card', '--state=merged'), /--card needs a value/)
  refused(run('set', '--run', 'x', '--plan', '001', 'extra'), /unexpected argument "extra"/)
  refused(run('set', '--run=x', '--plan=001', '--card=-x', '--card-status=pass'), /card "-x"/)
  refused(run('set', '--run=x', '--plan=001', '--card=ok', '--card-status=pass', '--page=file:///etc/passwd'), /page "file:\/\/\/etc\/passwd"/)
  refused(run('set', '--run=x', '--plan=001', '--card=ok', '--card-status=pass', '--shots=a.png,-rf'), /screenshot "-rf"/)
  const ok = run('disk', '--min=0')
  assert.equal(ok.status, 0, `${ok.stdout}${ok.stderr}`)
  assert.match(ok.stdout, /^ORCH_JSON \{"ok":true/m)
})

test('orch-state lock: concurrent takers of a stale lock never both hold it (no note is lost)', async () => {
  // A scratch copy of the installed scripts and their packages (orch-state.mjs works in its own project folder).
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'orch-lock-')))
  try {
    cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
    const runs = join(dir, '.claude', 'orchestrator-runs')
    mkdirSync(join(runs, 'race'), { recursive: true })
    writeFileSync(join(runs, 'race', 'status.json'), `${JSON.stringify({ run: 'race', phase: 'running', plans: {}, notes: [] })}\n`)
    // A stale lock left by a process that died: older than the 30 s takeover limit.
    const lock = join(runs, 'race.lock')
    writeFileSync(lock, 'dead-owner')
    const old = new Date(Date.now() - 10 * 60 * 1000)
    utimesSync(lock, old, old)
    const N = 4
    const note = (i) => new Promise((done) => {
      const c = spawn(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), 'note', '--run=race', `--text=note ${i}`], { cwd: dir })
      let out = ''
      c.stdout.on('data', (d) => (out += d))
      c.on('close', (code) => done({ code, out }))
    })
    const results = await Promise.all(Array.from({ length: N }, (_, i) => note(i)))
    for (const r of results) assert.equal(r.code, 0, r.out)
    const status = JSON.parse(readFileSync(join(runs, 'race', 'status.json'), 'utf8'))
    assert.deepEqual(status.notes.map((n) => n.text).sort(), Array.from({ length: N }, (_, i) => `note ${i}`).sort(), 'every note is there: no two writers held the lock at once')
    assert.equal(existsSync(lock), false, 'the lock is released')
    assert.deepEqual(readdirSync(runs).filter((f) => /\.stale$/.test(f)), [], 'no moved stale lock is left behind')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
