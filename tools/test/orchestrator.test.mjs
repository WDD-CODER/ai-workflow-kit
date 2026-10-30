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
import { DECISIONS as RUN_499_502, PASS_1_LAST, DUPLICATES as REAL_DUPLICATES, SYNTHETIC_REPEAT } from '../fixtures/orchestrator/decisions-499-502.mjs'
import { SILENT_PLAN, COVERED_PLAN, PARTLY_PLAN, STYLE_PLAN, BACKEND_PLAN, behaviourGaps, FALSE_COUNT_PLAN, FALSE_COUNT_FILES, EVERY_PLAN, EVERY_FILES, claimGaps } from '../fixtures/orchestrator/readiness.mjs'

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

test('start tier: judgment for a changed, deviated or unreadable invariant; "preserves" lines start on build', () => {
  const plan = (lines) => `# Plan\n\n## Architecture Impact\n${lines}\n\n## Next\n`
  assert.deepEqual(lib.startTier(plan('- INV-none: preserves — nothing')), { tier: 'build', invariants: [] })
  // A plan with only "preserves" lines (most plans): build. Two runs started on the main session's model for these.
  assert.deepEqual(lib.startTier(plan('- INV-3: preserves — touches it\n- INV-7: preserves — reads it\n- INV-none: preserves')), { tier: 'build', invariants: [] })
  assert.deepEqual(lib.startTier(plan('- INV-3: changes — ADR docs/brain/decisions/0009-x.md\n- INV-4: preserves')), { tier: 'judgment', invariants: ['INV-3'] })
  assert.deepEqual(lib.startTier(plan('- INV-5: deviation until the follow-up — why')), { tier: 'judgment', invariants: ['INV-5'] })
  assert.deepEqual(lib.startTier(plan('- INV-6: touches it, kind not said')), { tier: 'judgment', invariants: ['INV-6'] })
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

test('readiness: the claims rule is stated by the agent file and the fixture plans give one count question and one widen-scope question', () => {
  const agent = readFileSync(join(root, '.claude', 'agents', 'orch-readiness.md'), 'utf8')
  assert.match(agent, /Claims/)
  assert.match(agent, /at most 8/)
  assert.match(agent, /leave them as\s+follow-ups/)
  const count = claimGaps(FALSE_COUNT_PLAN, FALSE_COUNT_FILES)
  assert.equal(count.length, 1)
  assert.match(count[0], /3 row-delete handlers — found: 1 \(src\/app\/draft\/draft-editor\.ts:2\)/)
  assert.match(count[0], /Default if unanswered: build for what the code has/)
  const every = claimGaps(EVERY_PLAN, EVERY_FILES)
  assert.equal(every.length, 1)
  assert.match(every[0], /found: 1 outside scope \(src\/app\/b\/event-deposit\.html:1\) — widen scope to these files, or leave them as follow-ups\? Default if unanswered: leave them as follow-ups/)
  assert.deepEqual(claimGaps(COVERED_PLAN, {}), [], 'a plan with no count and no every-X goal has no claim')
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
const FALLBACK = /const FALLBACK_MODEL = "([^"]+)"/.exec(wfSource)?.[1] ?? ''
const MAX_NOTES = Number(/const MAX_NOTES = (\d+)/.exec(wfSource)?.[1] ?? 0)

// hooks: builder(nnn) → extra builder fields; gateFails(folder, cmds) → true: the first command fails (gateTail(n) its
// tail, n = that folder's gate count); gateDrop(n) → results for the first command only on gate call n; nullOnce(type)
// → the first call of that agent type returns null (a dead agent); source(src) → the workflow source to run (limits);
// runner(command, attempt, output) → a string that replaces the runner's output for that call (plan 033: a bad copy).
async function runFlow(args, hooks = {}) {
  const calls = []
  const commands = []
  const runnerSeen = {}
  const plansIn = args.plans.map(String)
  const words = (cmd) => [...cmd.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2])
  const task = (prompt) => Object.fromEntries(String(prompt).split('\n').map((l) => /^([A-Z_]+): (.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]))
  const out = (o) => ({ exitCode: 0, output: `ORCH_JSON ${JSON.stringify(o)}` })
  const state = (w) => {
    const cmd = w[2]
    const f = Object.fromEntries(w.slice(3).map((x) => /^--([\w-]+)=(.*)$/.exec(x)).filter(Boolean).map((m) => [m[1], m[2]]))
    if (cmd === 'init') return { ok: true, mergeFolder: '/merge', startedAt: '2026-01-01T00:00:00.000Z', ...(hooks.init ?? {}) }
    if (cmd === 'order') {
      const todo = plansIn.filter((p) => !(hooks.merged ?? []).includes(p))
      return { ok: true, waves: hooks.waves ?? [todo], waveLocks: [], skipped: hooks.merged ?? [], plans: Object.fromEntries(plansIn.map((p) => [p, { path: `plans/${p}-x.plan.md` }])) }
    }
    if (cmd === 'plan-info') return { ok: true, path: `plans/${f.plan}-x.plan.md`, branch: `feat/${f.plan}-x`, startTier: 'build', invariants: [], npmScripts: [], uiItems: [] }
    if (cmd === 'worktree') return { ok: true, path: `/wt/${f.plan}` }
    if (cmd === 'check-files') return { ok: true, nnn: f.plan, missing: (hooks.missingFiles?.(f.files.split(',')) ?? []) }
    if (cmd === 'scripts') return { ok: true, scripts: hooks.scripts ?? {} }
    if (cmd === 'main-tries') return { ok: true, passed: hooks.passed ?? {} }
    if (cmd === 'finish') return { ok: true, merged: [], parked: [], report: 'r', local: 'l', reportCommitted: true }
    if (cmd === 'diff') return { ok: true, files: [], sensitive: false }
    return { ok: true }
  }
  const gateCount = {}
  const nulled = new Set()
  async function agent(prompt, opts = {}) {
    const t = task(prompt)
    // A judgment-tier builder on "inherit" has no agentType: the role file is named in the prompt.
    const type = opts.agentType ?? (/orch-builder\.md/.test(prompt) ? 'orch-builder' : undefined)
    calls.push({ type, label: opts.label, task: t, model: opts.model ?? null, effort: opts.effort ?? null, plan: opts.plan })
    if (hooks.nullOnce && type === hooks.nullOnce && !nulled.has(type)) {
      nulled.add(type)
      return null
    }
    if (type === 'kit-runner') {
      const w = words(t.COMMAND)
      commands.push(t.COMMAND)
      const r = out(w[1] === 'scripts/orch-state.mjs' ? state(w) : { ok: true })
      const n = (runnerSeen[t.COMMAND] = (runnerSeen[t.COMMAND] ?? 0) + 1)
      const replaced = hooks.runner?.(t.COMMAND, n, r.output)
      return replaced === undefined ? r : { exitCode: 0, output: replaced }
    }
    const base = { role: type, model: 'stub', effort: 'low' }
    const nnn = /plan (\d+)/.exec(prompt)?.[1]
    if (type === 'orch-builder') {
      const b = hooks.builder?.(nnn) ?? {}
      return { ...base, status: 'built', branch: t.BRANCH, headSha: 'abc1234', summary: 's', evidence: ['e'], ...b }
    }
    if (type === 'orch-gate') {
      const cmds = JSON.parse(t.COMMANDS)
      const n = (gateCount[t.FOLDER] = (gateCount[t.FOLDER] ?? 0) + 1)
      if (hooks.gateDrop?.(n)) return { ...base, results: cmds.slice(0, 1).map((c) => ({ command: c, status: 'pass' })) }
      const failing = hooks.gateFails?.(t.FOLDER, cmds)
      const tail = hooks.gateTail?.(n) ?? 'FAIL v2-types.spec: 2 required fields'
      return { ...base, results: cmds.map((c, i) => (failing && i === 0 ? { command: c, status: 'fail', tail } : { command: c, status: 'pass' })) }
    }
    if (['orch-check-plan', 'orch-check-bugs', 'orch-check-rules', 'orch-security'].includes(type)) return { ...base, problems: [] }
    if (type === 'orch-merge') {
      if (hooks.mergeEnvOnce && !nulled.has('merge-env')) {
        nulled.add('merge-env')
        return { ...base, merged: false, envFailure: true, reason: "'ng' is not recognized" }
      }
      return { ...base, merged: true, sha: 'def5678' }
    }
    if (type === 'orch-triage') {
      // hooks.triage(decisions, task) → items (a list), null (a dead agent), a non-list value (an unusable result), or
      // undefined (no items: every decision stays untriaged).
      const r = hooks.triage?.(JSON.parse(t.DECISIONS), t)
      if (r === null) return null
      return { ...base, items: r === undefined ? [] : r }
    }
    if (type === 'orch-ui') return { ...base, cards: JSON.parse(t.CARDS ?? '[]').map((c) => ({ card: c.card, page: c.page, status: 'pass', screenshots: [] })) }
    if (type === 'orch-readiness') {
      const plan = /plans\/(\d+)-/.exec(t.PLAN ?? '')?.[1]
      return { ...base, plans: [{ plan: t.PLAN, state: 'ready', questions: [], envNeeds: [], commands: [], ...(hooks.readiness?.(plan) ?? {}) }] }
    }
    throw new Error(`stub: no agent for ${type} (${opts.label})`)
  }
  const parallel = (thunks) => Promise.all(thunks.map((th) => Promise.resolve().then(th)))
  const AsyncFunction = (async () => {}).constructor
  const src = (hooks.source ?? ((s) => s))(wfSource.replace(/^export const meta\s*=/m, 'const meta ='))
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', 'require', 'process', src)
  const result = await fn(agent, parallel, undefined, () => {}, () => {}, { mode: 'run', run: 'r1', root: '/main', ...args }, {}, undefined, undefined, undefined)
  const notes = commands.filter((c) => /orch-state\.mjs note /.test(c))
  return { result, calls, commands, notes }
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
  assert.deepEqual(result.decisions.map(({ id, plan, text }) => ({ id, plan, text })), [
    { id: 'D1', plan: '101', text: 'behaviour: no dialog on leave — reverse: add one' },
    { id: 'D2', plan: '101', text: 'seen: src/a.js:12 — NaN at 100 %' },
    { id: 'D3', plan: '102', text: 'behaviour: saved on blur — reverse: remove the handler' },
  ])
  const records = commands.filter((c) => /orch-state\.mjs decision /.test(c) && /--id=D\d/.test(c))
  assert.equal(records.length, 3, 'each decision is one decision record (not a note), so it prints under "Decisions"')
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

// ---- a plan's check commands: the kit's own scripts with side effects are never a check ---------------------------
test('checkProblem: kit scripts that push or change state are refused, project checks still pass', () => {
  const src = /const DENY = [\s\S]*?\n}\n(?=\/\/ The plan branch shape)/.exec(wfSource)?.[0]
  assert.ok(src, 'the checkProblem block is found in orchestrate.js')
  const checkProblem = new Function(`${src}\nreturn checkProblem`)()
  for (const c of ['node scripts/kit-feedback.mjs --title x', 'node scripts/orch-state.mjs set', 'node scripts/decision-log.mjs add', 'node scripts/take-plan.mjs 1', 'node scripts/slot-serve.mjs', 'node tools/sync.mjs --apply', 'node scripts/Kit-Feedback.mjs --title x']) {
    assert.match(checkProblem(c, null) ?? '', /not a check/, c)
  }
  for (const c of ['node scripts/scope-check.mjs --arch', 'node tools/leak-check.mjs', 'node scripts/my-project-check.mjs', 'node --test tests/a.test.mjs', 'npm run build', 'node scripts/kit-owned.mjs', 'node scripts/kit-owned.mjs --check']) {
    assert.equal(checkProblem(c, null), null, c)
  }
  // A project script run with a flag that makes it write is not a check (a run passed kit-owned.mjs --write as a gate).
  assert.match(checkProblem('node scripts/kit-owned.mjs --write', null), /--write writes files, it is not a check/)
  for (const c of ['node scripts/lint.mjs --fix', 'node tools/gen.mjs --update=all', 'node scripts/x.mjs --quick --apply']) assert.match(checkProblem(c, null) ?? '', /writes files/, c)
})

// ---- plan 029: a dead agent is retried once on the fallback model; the loop limits; a report every time ---------------
test('fallback: an agent that returns null is called once more on orchestrator.fallbackModel, with a run note; never a third time', { skip: FALLBACK === 'inherit' && 'fallbackModel is inherit in this project' }, async () => {
  const { calls, notes, result } = await runFlow({ plans: ['101'], pilot: false }, { nullOnce: 'orch-check-rules' })
  const rules = calls.filter((c) => c.type === 'orch-check-rules')
  assert.equal(rules.length, 2, 'the dead finder is called twice')
  assert.equal(rules[0].model, null)
  assert.equal(rules[1].model, FALLBACK, 'the retry names the fallback model')
  assert.ok(notes.some((c) => c.includes('--plan=101') && new RegExp(`model fallback: check-rules 101 agent default → ${FALLBACK}`).test(c)), notes.join(' | '))
  assert.equal(result.merged !== undefined && result.ok, true)
  // the builder of a judgment-tier plan already on the fallback model is not retried: covered by the opts.model check
  assert.equal(calls.filter((c) => c.type === 'orch-builder').length, 1)
})

test('lost gate results: 1 of N back → only the missing commands run again, no builder round; still missing → environment, no fix round', async () => {
  const once = await runFlow({ plans: ['101'], pilot: false }, { gateDrop: (n) => n === 1 })
  const gates = once.calls.filter((c) => c.type === 'orch-gate' && c.task.FOLDER === '/wt/101')
  assert.equal(gates.length, 2, 'the gate runs twice for the plan')
  const all = JSON.parse(gates[0].task.COMMANDS)
  assert.deepEqual(JSON.parse(gates[1].task.COMMANDS), all.slice(1), 'the rerun gets only the missing commands')
  assert.equal(once.calls.filter((c) => c.type === 'orch-builder').length, 1, 'no fix round')
  assert.ok(once.notes.some((c) => new RegExp(`gate rerun for ${all.length - 1} missing result`).test(c)), once.notes.join(' | '))
  assert.deepEqual(once.result.outcomes.map((o) => o.state), ['merged'])
  const always = await runFlow({ plans: ['101'], pilot: false }, { gateDrop: () => true })
  const o = always.result.outcomes[0]
  assert.equal(o.state, 'parked')
  assert.match(o.reason, /^environment, again after one retry: gate returned no result, twice, for: /)
  assert.equal(always.calls.filter((c) => c.type === 'orch-builder').length, 2, 'first + env-retry, never a fix round')
  assert.ok(always.commands.some((c) => c.includes('orch-preflight.mjs --env-only --run r1')), 'the env check names the run (merge folder packages)')
})

test('same reason twice: an identical gate failure in two rounds parks the plan at once; a different tail goes on to the fix rounds', async () => {
  const same = await runFlow({ plans: ['101'], pilot: false }, { gateFails: (folder) => folder === '/wt/101' })
  const o = same.result.outcomes[0]
  assert.equal(o.state, 'parked')
  assert.match(o.reason, /^same reason twice: gate: npm run \w+/)
  assert.equal(same.calls.filter((c) => c.type === 'orch-builder').length, 2, 'first + one fix round, then parked')
  assert.match(same.result.stuck ?? '', /^STUCK: /, 'the result carries the STUCK line for the command')
  assert.ok(same.commands.some((c) => /orch-state\.mjs finish/.test(c)) && same.result.local === 'l', 'the report is written although every plan parked')
  const differs = await runFlow({ plans: ['101'], pilot: false }, { gateFails: (folder) => folder === '/wt/101', gateTail: (n) => `FAIL spec ${n}` })
  assert.match(differs.result.outcomes[0].reason, /fix rounds used: 2 of 2/, 'a new reason each round reaches maxFixRounds')
})

test('an environment failure at the merge retries the merge only: one builder, one gate, two merge calls, merged', async () => {
  const { result, calls, notes, commands } = await runFlow({ plans: ['101'], pilot: false }, { mergeEnvOnce: true })
  const of = (type) => calls.filter((c) => c.type === type && /101/.test(c.label ?? '')).length
  assert.equal(of('orch-builder'), 1, 'no builder again')
  assert.equal(of('orch-gate'), 1, 'no gate again')
  assert.equal(of('orch-check-plan'), 1, 'no checkers again')
  assert.equal(of('orch-merge'), 2, 'the merge is called once more')
  assert.deepEqual(result.outcomes.map((o) => `${o.nnn}:${o.state}:${o.round}`), ['101:merged:0'], 'merged in round 0')
  assert.ok(commands.some((c) => c.includes('orch-preflight.mjs --env-only --run r1')), 'the environment check ran, naming the run')
  assert.ok(notes.some((c) => /environment failure \(merge: .*ng.*\).*the merge is retried on its own/.test(c)), notes.join(' | '))
})

test('notes cap: a plan writes at most maxNotesPerPlan run notes; the last says so; later ones cost no agent call', async () => {
  // Every card whose test command is not allowed is one note ("[ui] card test dropped").
  const uiCards = Array.from({ length: MAX_NOTES + 5 }, (_, i) => ({ card: `Card ${i + 1} shows text`, page: 'https://app.example/p', test: 'curl http://x' }))
  const { notes } = await runFlow({ plans: ['101'], pilot: false }, { builder: () => ({ uiCards }) })
  const mine = notes.filter((c) => c.includes('--plan=101'))
  assert.equal(mine.length, MAX_NOTES, `${MAX_NOTES} note agent calls for the plan, not ${MAX_NOTES + 5}`)
  assert.match(mine.at(-1), /notes capped: \d+ notes written for plan 101/)
})

test('decisions are records, never cut by maxNotesPerPlan: more decisions than the cap are all kept', async () => {
  const decisions = Array.from({ length: MAX_NOTES + 5 }, (_, i) => `seen: a${i}.js:${i + 1} — item number ${i + 1} is a different defect of its own kind ${'xyz'.repeat(i % 3)}${i}`)
  const { result, commands } = await runFlow({ plans: ['101'], pilot: false }, { builder: () => ({ decisions }) })
  assert.equal(result.decisions.length, MAX_NOTES + 5)
  assert.equal(commands.filter((c) => /orch-state\.mjs decision /.test(c) && /--id=D\d/.test(c)).length, MAX_NOTES + 5)
  assert.ok(!commands.some((c) => /notes capped/.test(c)))
})

test('agent-call limit: a plan over maxAgentCallsPerPlan is parked before its next stage', async () => {
  const { result, calls } = await runFlow({ plans: ['101'], pilot: false }, { source: (s) => s.replace(/const MAX_CALLS = \d+/, 'const MAX_CALLS = 6') })
  const o = result.outcomes[0]
  assert.equal(o.state, 'parked')
  assert.match(o.reason, /^agent-call limit: \d+ of 6 agent calls used/)
  assert.equal(calls.filter((c) => c.type === 'orch-check-plan').length, 0, 'no checker ran after the limit')
  assert.ok(result.agentCalls['101'] >= 6)
})

test('a report every time: a stage that throws stops the run with the error and still writes the report', async () => {
  const { result, commands } = await runFlow({ plans: ['101'], pilot: false }, { source: (s) => s.replace('async function checkers(ctx) {', 'async function checkers(ctx) { throw new Error("boom in checkers")\n') })
  assert.ok(commands.some((c) => /orch-state\.mjs finish/.test(c)), 'finish ran')
  assert.equal(result.outcomes[0].state, 'parked')
  assert.ok(commands.some((c) => /orch-state\.mjs stop/.test(c)))
  assert.equal(result.startedAt, '2026-01-01T00:00:00.000Z', 'the start time comes from init, not from args')
  assert.ok(!commands.some((c) => /orch-state\.mjs init .*--started/.test(c)), 'init gets no --started')
})

test('watchLine: RUNNING, FINISHED, STOPPED, STUCK on no progress, STUCK on the same note twice', () => {
  const now = Date.parse('2026-01-01T12:00:00.000Z')
  const min = (n) => new Date(now - n * 60000).toISOString()
  const running = { phase: 'running', updatedAt: min(2), plans: { '001': { nnn: '001', state: 'gate', history: [{ at: min(3) }] }, '002': { nnn: '002', state: 'merged' } }, notes: [{ plan: '001', text: 'escalated' }] }
  assert.deepEqual(lib.watchLine(running, { nowMs: now, staleMin: 10 }), { line: 'RUNNING', stuck: false })
  const stale = { ...running, updatedAt: min(25) }
  assert.deepEqual(lib.watchLine(stale, { nowMs: now, staleMin: 10 }), { line: 'STUCK: plan 001 · gate · no progress for 25 min · last: escalated', stuck: true })
  assert.equal(lib.watchLine(stale, { nowMs: now, staleMin: 30 }).stuck, false, 'a longer stale limit')
  assert.deepEqual(lib.watchLine({ phase: 'finished', plans: {} }, { nowMs: now, staleMin: 10 }), { line: 'FINISHED', stuck: false })
  assert.deepEqual(lib.watchLine({ phase: 'stopped', stopReason: 'wave 1 parked 002', plans: {} }, { nowMs: now, staleMin: 10 }), { line: 'STOPPED: wave 1 parked 002', stuck: false })
  const twice = { ...running, notes: [{ plan: '001', text: 'merge: not clean' }, { text: 'a run note' }, { plan: '001', text: 'merge: not clean' }] }
  assert.deepEqual(lib.watchLine(twice, { nowMs: now, staleMin: 10 }), { line: 'STUCK: plan 001 · gate · same reason twice: merge: not clean', stuck: true })
  const other = { ...running, notes: [{ plan: '001', text: 'x' }, { plan: '002', text: 'x' }] }
  assert.equal(lib.watchLine(other, { nowMs: now, staleMin: 10 }).stuck, false, 'the same text on two plans is not a loop')
})

test('orch-state.mjs watch: reads status.json only, STUCK exits 1, the rest 0', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'orch-watch-')))
  try {
    cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
    const runs = join(dir, '.claude', 'orchestrator-runs', 'w')
    mkdirSync(runs, { recursive: true })
    const write = (s) => writeFileSync(join(runs, 'status.json'), `${JSON.stringify(s)}\n`)
    const watch = (...a) => spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), 'watch', '--run=w', ...a], { cwd: dir, encoding: 'utf8' })
    write({ run: 'w', phase: 'running', updatedAt: new Date().toISOString(), plans: { '001': { nnn: '001', state: 'building' } }, notes: [] })
    let r = watch()
    assert.equal(r.status, 0, r.stdout)
    assert.match(r.stdout, /^RUNNING$/m)
    write({ run: 'w', phase: 'running', updatedAt: new Date(Date.now() - 45 * 60000).toISOString(), plans: { '001': { nnn: '001', state: 'merging' } }, notes: [{ plan: '001', text: 'last thing' }] })
    r = watch()
    assert.equal(r.status, 1, r.stdout)
    assert.match(r.stdout, /^STUCK: plan 001 · merging · no progress for 4[45] min · last: last thing$/m)
    assert.match(r.stdout, /^ORCH_JSON \{"ok":false,"stuck":true/m)
    assert.equal(watch('--stale-min=60').status, 0, 'a longer limit')
    write({ run: 'w', phase: 'stopped', stopReason: 'done for today', plans: {} })
    r = watch()
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^STOPPED: done for today$/m)
    assert.equal(existsSync(join(dir, '.claude', 'orchestrator-runs', 'w.lock')), false, 'watch takes no lock')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('orchestrator.* config: fallbackModel, staleMin, maxNotesPerPlan and maxAgentCallsPerPlan are validated', () => {
  for (const v of ['inherit', 'sonnet', 'opus', 'fable', 'claude-opus-5-5']) assert.deepEqual(orchestratorProblems({ 'orchestrator.fallbackModel': v }), [], v)
  for (const v of ['haiku', 'claude-haiku-5-5', 'gpt', '', 3]) assert.match(orchestratorProblems({ 'orchestrator.fallbackModel': v }).join(), /^orchestrator\.fallbackModel is /, String(v))
  assert.match(orchestratorProblems({ 'orchestrator.fallbackModel': 'haiku' }).join(), /non-Haiku/)
  assert.deepEqual(orchestratorProblems({ 'orchestrator.staleMin': 10, 'orchestrator.maxNotesPerPlan': 12, 'orchestrator.maxAgentCallsPerPlan': 60 }), [])
  for (const v of [0, 241, 1.5, '10']) assert.match(orchestratorProblems({ 'orchestrator.staleMin': v }).join(), /staleMin is .* whole number of minutes from 1 to 240/)
  for (const v of [0, 101, '12']) assert.match(orchestratorProblems({ 'orchestrator.maxNotesPerPlan': v }).join(), /maxNotesPerPlan is .* from 1 to 100/)
  for (const v of [9, 501, 2.5]) assert.match(orchestratorProblems({ 'orchestrator.maxAgentCallsPerPlan': v }).join(), /maxAgentCallsPerPlan is .* from 10 to 500/)
  assert.ok(commandProblems({ 'orchestrator.fallbackModel': 'haiku', 'models.mechanical': 'haiku', 'models.analysis': 'sonnet', 'models.judgment': 'inherit', 'models.build': 'sonnet', 'models.review': 'sonnet' }).some((m) => m.startsWith('orchestrator.fallbackModel is "haiku"')), 'install and sync read it through commandProblems')
})

// ---- plan 032: a light merge step, main-folder checks, decisions only, no pause when there is nothing to ask ------
const BUILD_SCRIPT = /const BUILD_SCRIPT = "([^"]*)"/.exec(wfSource)?.[1] ?? ''
const PM_RUN = /const PM = (?:'|")?(pnpm|npm)/.exec(wfSource)?.[1] ?? 'npm'
const BUILD_CHECK = `${PM_RUN} run ${BUILD_SCRIPT}`

test('merge step: mergeChecks "build" hands orch-merge the build plus the plan\'s scope check only; "full" hands it the whole list; the final gate keeps everything', { skip: !BUILD_SCRIPT && 'no commands.build in this project' }, async () => {
  const scope = 'node scripts/scope-check.mjs --plan=plans/101-x.plan.md'
  const { calls } = await runFlow({ plans: ['101'], pilot: false, checks: { 101: [scope, 'node --test tests/a.test.mjs'] } })
  const merge = calls.find((c) => c.type === 'orch-merge')
  assert.deepEqual(JSON.parse(merge.task.CHECKS), [BUILD_CHECK, scope], 'the merge runs the build and the scope check, not lint or tests')
  const gate = calls.find((c) => c.type === 'orch-gate' && c.task.FOLDER === '/wt/101')
  assert.ok(JSON.parse(gate.task.COMMANDS).includes('node --test tests/a.test.mjs'), 'the plan gate still runs the whole list')
  const final = calls.find((c) => c.type === 'orch-gate' && c.task.FOLDER === '/merge')
  assert.ok(JSON.parse(final.task.COMMANDS).length >= 2 && JSON.parse(final.task.COMMANDS)[0] === BUILD_CHECK, 'the final gate runs the project checks')
  // "full": the old behaviour, one config word away.
  const full = await runFlow({ plans: ['101'], pilot: false, checks: { 101: [scope] } }, { source: (s) => s.replace('const MERGE_CHECKS_MODE = "build"', 'const MERGE_CHECKS_MODE = "full"') })
  const fm = full.calls.find((c) => c.type === 'orch-merge')
  assert.deepEqual(JSON.parse(fm.task.CHECKS), JSON.parse(full.calls.find((c) => c.type === 'orch-gate' && c.task.FOLDER === '/wt/101').task.COMMANDS))
  // The merge-only retry after an environment failure uses the same short list.
  const retry = await runFlow({ plans: ['101'], pilot: false }, { mergeEnvOnce: true })
  assert.ok(retry.calls.filter((c) => c.type === 'orch-merge').every((c) => JSON.stringify(JSON.parse(c.task.CHECKS)) === JSON.stringify([BUILD_CHECK])))
})

test('main-folder checks: [auto:main] commands run in a second gate from the main folder after the worktree gate; never at the merge or the final gate; scripts only', async () => {
  const main = 'node scripts/log-query.mjs --since=15m'
  const { calls, notes, result } = await runFlow({ plans: ['101'], pilot: false, mainChecks: { 101: [main, 'npm run build', 'node --test tests/a.test.mjs', 'node scripts/kit-owned.mjs --write'] }, mainApproved: true })
  const gates = calls.filter((c) => c.type === 'orch-gate')
  assert.deepEqual(gates.map((c) => [c.label, c.task.FOLDER]), [['gate 101', '/wt/101'], ['gate 101 main', '/main'], ['gate final', '/merge']])
  assert.deepEqual(JSON.parse(gates[1].task.COMMANDS), [main])
  assert.equal(result.agentCalls['101'] >= 3, true, 'the main gate counts against the plan')
  assert.ok(!JSON.parse(calls.find((c) => c.type === 'orch-merge').task.CHECKS).includes(main), 'not at the merge')
  assert.ok(!JSON.parse(gates[2].task.COMMANDS).includes(main), 'not at the final gate')
  const dropped = notes.filter((n) => /main-folder check dropped/.test(n))
  assert.equal(dropped.length, 3)
  assert.ok(dropped.some((n) => /npm run build: only node scripts\/… or node tools\/… run from the main folder/.test(n)))
  assert.ok(dropped.some((n) => /node --test tests\/a\.test\.mjs: only node scripts/.test(n)))
  assert.ok(dropped.some((n) => /--write writes files/.test(n)))
  assert.equal(result.outcomes[0].state, 'merged')
  // No main checks → no second gate.
  const none = await runFlow({ plans: ['101'], pilot: false })
  assert.equal(none.calls.filter((c) => c.type === 'orch-gate' && c.task.FOLDER === '/main').length, 0)
})

test('main-folder checks: a failing main check is a real failure named "gate (main folder)", with a builder fix round like any gate failure', async () => {
  const main = 'node scripts/log-query.mjs --since=15m'
  const { calls, result } = await runFlow({ plans: ['101'], pilot: false, mainChecks: { 101: [main] }, mainApproved: true }, { gateFails: (folder) => folder === '/main' })
  assert.equal(calls.filter((c) => c.type === 'orch-builder').length, 2, 'one fix round, then the same reason twice parks it')
  assert.equal(calls.filter((c) => c.type === 'orch-merge').length, 0)
  assert.match(result.outcomes[0].reason, /^same reason twice: gate \(main folder\): node scripts\/log-query\.mjs --since=15m/)
  const fix = calls.filter((c) => c.type === 'orch-builder')[1]
  assert.match(fix.task.FINDINGS, /log-query\.mjs --since=15m/, 'the builder gets the failing main check as a finding')
})

// ---- plan 040: slot-only checks, app errors in the report, the manifest check at the final gate, main untouched ----

test('main-folder checks: a check that reads the slot plan-start stamp is dropped at launch with a note and never runs', async () => {
  const slotOnly = 'node scripts/log-query.mjs --since=plan-start --level=error'
  const { calls, notes, result } = await runFlow({ plans: ['101'], pilot: false, mainChecks: { 101: [slotOnly] }, mainApproved: true })
  assert.equal(calls.filter((c) => c.type === 'orch-gate' && c.task.FOLDER === '/main').length, 0, 'no main-folder gate')
  assert.equal(calls.filter((c) => c.type === 'orch-builder').length, 1, 'no fix round')
  assert.ok(notes.some((n) => /main-folder check dropped, not run: node scripts\/log-query\.mjs --since=plan-start --level=error: --since=plan-start needs a slot's plan-start stamp/.test(n)), notes.join('\n'))
  assert.equal(result.outcomes[0].state, 'merged')
  // A plain time window still runs from the main folder.
  const kept = await runFlow({ plans: ['101'], pilot: false, mainChecks: { 101: ['node scripts/log-query.mjs --since=15m'] }, mainApproved: true })
  assert.equal(kept.calls.filter((c) => c.type === 'orch-gate' && c.task.FOLDER === '/main').length, 1)
})

test('final gate: runs the kit manifest check when init reports a manifest, and not otherwise', async () => {
  const finalOf = (calls) => JSON.parse(calls.find((c) => c.type === 'orch-gate' && c.label === 'gate final').task.COMMANDS)
  const withManifest = await runFlow({ plans: ['101'], pilot: false }, { init: { kitManifest: true } })
  assert.ok(finalOf(withManifest.calls).includes('node scripts/kit-manifest-check.mjs'))
  const without = await runFlow({ plans: ['101'], pilot: false })
  assert.ok(!finalOf(without.calls).includes('node scripts/kit-manifest-check.mjs'))
  // Never in a plan's own gate or the merge step.
  const planGate = JSON.parse(withManifest.calls.find((c) => c.type === 'orch-gate' && c.label === 'gate 101').task.COMMANDS)
  assert.ok(!planGate.includes('node scripts/kit-manifest-check.mjs'))
})

test('the report: main stays untouched when only plan files and the todo list changed there', () => {
  const status = { run: 'r1', startedAt: 'T0', mainShaAtStart: 'aaaaaaa1', plans: {}, notes: [] }
  const at = (files) => lib.formatReport({ status, merged: [], mainShaNow: 'ccccccc3', finishedAt: 'T1', runBranch: 'orch/r1', mainBranch: 'main', mainChangedFiles: files })
  assert.match(at(['plans/500-x.plan.md', '.claude/todo.md']), /`main` untouched: yes \(2 plan\/todo file\(s\) changed on main\) — origin\/main is ccccccc/)
  assert.match(at(['plans/500-x.plan.md', 'src/app.ts']), /`main` untouched: NO — origin\/main is ccccccc/)
  assert.match(at(null), /`main` untouched: NO/, 'unknown changed files keep the old answer')
  assert.deepEqual(lib.mainUntouched('a', 'a', null), { untouched: true, adminFiles: 0 })
})

test('the report: app errors since the run started — the log query with plan-start replaced, shown as is', () => {
  assert.equal(lib.logQueryArgs('', 'T0'), null)
  assert.deepEqual(lib.logQueryArgs('node scripts/log-query.mjs --since=plan-start --level=error', '2026-10-29T22:02:00.000Z'), {
    args: ['scripts/log-query.mjs', '--since=2026-10-29T22:02:00.000Z', '--level=error'],
    command: 'node scripts/log-query.mjs --since=2026-10-29T22:02:00.000Z --level=error',
  })
  assert.match(lib.logQueryArgs('npx something', 'T0').error, /not node scripts/)
  assert.match(lib.logQueryArgs('node ../x.mjs', 'T0').error, /not node scripts/)
  const status = { run: 'r1', startedAt: 'T0', mainShaAtStart: 'a', plans: {}, notes: [] }
  const r = lib.formatReport({ status, merged: [], mainShaNow: 'a', finishedAt: 'T1', runBranch: 'orch/r1', mainBranch: 'main', appErrors: { command: 'node scripts/log-query.mjs --since=T0', exit: 0, lines: ['no entries'], more: 0 } })
  assert.ok(r.includes('## App errors since the run started\n\nCommand (from the main folder): `node scripts/log-query.mjs --since=T0`\nExit code: 0\n\n```text\nno entries\n```'), r)
  const failed = lib.formatReport({ status, merged: [], mainShaNow: 'a', finishedAt: 'T1', runBranch: 'orch/r1', mainBranch: 'main', appErrors: { command: 'npx x', error: 'commands.logQuery is not node scripts/… or node tools/…, not run' } })
  assert.match(failed, /Could not run: commands\.logQuery is not node scripts/)
  assert.ok(!lib.formatReport({ status, merged: [], mainShaNow: 'a', finishedAt: 'T1', runBranch: 'orch/r1', mainBranch: 'main' }).includes('App errors'), 'unset → no section')
})

test('decisions: only behaviour: and seen: entries are kept; confirmations are dropped and counted, with no run note', async () => {
  const decisions = ['Ran the six commands one by one, all exit 0', 'behaviour: no dialog on leave — reverse: add one', 'Verified by rerun: 4 of 4 passed', 'seen: src/a.js:12 — NaN at 100 %', '  SEEN: src/b.js:3 — dup  ']
  const { result, commands } = await runFlow({ plans: ['101'], pilot: false }, { builder: () => ({ decisions }) })
  assert.deepEqual(result.decisions.map((d) => d.text), ['behaviour: no dialog on leave — reverse: add one', 'seen: src/a.js:12 — NaN at 100 %', 'SEEN: src/b.js:3 — dup'])
  assert.deepEqual(result.decisionsDropped, { 101: 2 })
  assert.equal(commands.filter((c) => /orch-state\.mjs decision /.test(c) && /--id=D\d/.test(c)).length, 3, 'one record per kept decision, none for a dropped line')
  assert.ok(!commands.some((n) => /Ran the six commands|Verified by rerun/.test(n)))
  const clean = await runFlow({ plans: ['101'], pilot: false })
  assert.deepEqual(clean.result.decisionsDropped, {})
})

test('readiness: a check whose file is missing (and not created by the plan) is dropped with the reason and makes askHuman true', async () => {
  const readiness = () => ({ commands: ['node tools/leak-check.mjs', 'node --test tests/a.test.mjs tests/new.test.mjs', 'npm run build'], mainCommands: ['node scripts/log-query.mjs --since=15m'] })
  const r = await runFlow({ mode: 'readiness', plans: ['101'] }, { readiness, missingFiles: (files) => files.filter((f) => f === 'tools/leak-check.mjs' || f === 'tests/new.test.mjs') })
  const p = r.result.plans[0]
  assert.deepEqual(p.commands, ['node --test tests/a.test.mjs tests/new.test.mjs'].slice(1).concat(['npm run build']), 'only npm run build is left')
  assert.ok(!p.commands.includes('node tools/leak-check.mjs') && !p.commands.some((c) => /new\.test/.test(c)), 'the missing files are not run')
  assert.deepEqual(p.mainCommands, ['node scripts/log-query.mjs --since=15m'], 'a command whose file exists stays')
  assert.ok(p.deniedWhy.includes('node tools/leak-check.mjs: tools/leak-check.mjs does not exist in the project and the plan does not create it'))
  assert.deepEqual(p.missingFiles.sort(), ['tests/new.test.mjs', 'tools/leak-check.mjs'])
  assert.equal(r.result.askHuman, true)
  const asked = r.commands.find((c) => /orch-state\.mjs check-files/.test(c))
  assert.match(asked, /--files=tools\/leak-check\.mjs,tests\/a\.test\.mjs,tests\/new\.test\.mjs,scripts\/log-query\.mjs/)
  // No file named by any command (npm scripts only) → no check-files call at all.
  const none = await runFlow({ mode: 'readiness', plans: ['101'] }, { readiness: () => ({ commands: ['npm run build'] }) })
  assert.ok(!none.commands.some((c) => /check-files/.test(c)))
})

test('readiness: askHuman is false only when every plan is ready with no question, no environment need and no main-folder command; mainCommands are filtered to project scripts', async () => {
  const main = 'node scripts/log-query.mjs --since=15m'
  const quiet = await runFlow({ mode: 'readiness', plans: ['101', '102'] }, { readiness: (p) => (p === '101' ? { commands: ['node --test t.mjs', 'git reset --hard HEAD'] } : {}) })
  assert.equal(quiet.result.askHuman, false)
  assert.deepEqual(quiet.result.mainApproval, [])
  assert.deepEqual(quiet.result.plans.find((p) => p.nnn === '101').denied, ['git reset --hard HEAD'])
  // Plan 034: a main-folder command runs in the live environment — it is listed for the Human and waits for go.
  const withMain = await runFlow({ mode: 'readiness', plans: ['101', '102'] }, { readiness: (p) => (p === '101' ? { commands: ['node --test t.mjs', 'git reset --hard HEAD'], mainCommands: [main, 'npm run build'] } : {}) })
  assert.equal(withMain.result.askHuman, true, 'a main-folder command is something to ask')
  assert.deepEqual(withMain.result.mainApproval, [`101: ${main}`])
  const p101 = withMain.result.plans.find((p) => p.nnn === '101')
  assert.deepEqual(p101.mainCommands, [main])
  assert.deepEqual(p101.commands, ['node --test t.mjs'])
  assert.deepEqual(p101.denied, ['git reset --hard HEAD', 'npm run build'])
  assert.match(p101.deniedWhy[1], /only node scripts\/… or node tools\/… run from the main folder/)
  assert.deepEqual(withMain.result.plans.find((p) => p.nnn === '102').mainCommands, [])
  for (const [why, hook] of [['a question', { questions: ['what on cancel?'] }], ['an environment need', { envNeeds: ['a database'] }], ['a blocked plan', { state: 'blocked' }]]) {
    const r = await runFlow({ mode: 'readiness', plans: ['101'] }, { readiness: () => hook })
    assert.equal(r.result.askHuman, true, why)
  }
})

// ---- plan 043: claims, npx checks, delegated main-folder answers ------------------------------------------------------
const PM_NAME = /const PM = "(\w+)"/.exec(wfSource)?.[1] === 'pnpm' ? 'pnpm' : 'npm'
const claim = (n, extra = {}) => ({ claim: `the editor has ${n} handlers`, found: `1 (src/a.ts:${n})`, question: '', default: '', ...extra })

test('readiness: a claim with a question becomes a plan question with its default and makes askHuman true', async () => {
  const hook = { claims: [claim(3, { question: 'build for what the code has, or fix the plan?', default: 'build for what the code has' }), claim(1)] }
  const r = await runFlow({ mode: 'readiness', plans: ['101'] }, { readiness: () => hook })
  const p = r.result.plans[0]
  assert.deepEqual(p.questions, ['101 claim: the editor has 3 handlers — found: 1 (src/a.ts:3) — build for what the code has, or fix the plan? Default if unanswered: build for what the code has'])
  assert.equal(p.state, 'questions', 'a ready plan with a claim question is no longer ready')
  assert.equal(p.claims.length, 2)
  assert.equal(r.result.askHuman, true)
  // A held claim (no question) asks nothing.
  const held = await runFlow({ mode: 'readiness', plans: ['101'] }, { readiness: () => ({ claims: [claim(1)] }) })
  assert.equal(held.result.askHuman, false)
  assert.equal(held.result.plans[0].state, 'ready')
  // No default given → the Human answers.
  const nodef = await runFlow({ mode: 'readiness', plans: ['101'] }, { readiness: () => ({ claims: [claim(2, { question: 'fix the plan?' })] }) })
  assert.match(nodef.result.plans[0].questions[0], /Default if unanswered: none given — the Human answers$/)
})

test('readiness: more than 8 claims keep 8 and report the rest as claimsOver; a claim without found is an unreadable-claim question', async () => {
  const ten = await runFlow({ mode: 'readiness', plans: ['101'] }, { readiness: () => ({ claims: Array.from({ length: 10 }, (_, i) => claim(i + 1)) }) })
  assert.equal(ten.result.plans[0].claims.length, 8)
  assert.equal(ten.result.plans[0].claimsOver, 2)
  assert.equal(ten.result.askHuman, false, 'held claims over the cap ask nothing')
  const bad = await runFlow({ mode: 'readiness', plans: ['101'] }, { readiness: () => ({ claims: [claim(1), { claim: 'x has 2 y', question: 'q?' }, { found: 'z' }] }) })
  const p = bad.result.plans[0]
  assert.equal(p.claimsBad, 2)
  assert.equal(p.claims.length, 1)
  assert.deepEqual(p.questions, ["101: readiness returned 2 unreadable claim(s) — check the plan's counts and every-X goals by hand"])
  assert.equal(bad.result.askHuman, true)
})

test('readiness: an npx check maps to the package.json script that runs it; an unmapped one is denied and shown, never asked', async () => {
  const mapped = await runFlow({ mode: 'readiness', plans: ['101'] }, { readiness: () => ({ commands: ['npx  ng build', 'npm run lint'] }), scripts: { build: 'ng build', lint: 'eslint .' } })
  const p = mapped.result.plans[0]
  assert.deepEqual(p.commands, [`${PM_NAME} run build`, 'npm run lint'])
  assert.deepEqual(p.mapped, [`npx ng build → ${PM_NAME} run build`])
  assert.deepEqual(p.denied, [])
  assert.equal(mapped.commands.filter((c) => /orch-state\.mjs scripts$/.test(c)).length, 1, 'one scripts call')
  const lost = await runFlow({ mode: 'readiness', plans: ['101', '102'] }, { readiness: () => ({ commands: ['npx ng test', 'npm run build'] }), scripts: { build: 'ng build' } })
  for (const q of lost.result.plans) {
    assert.deepEqual(q.denied, ['npx ng test'])
    assert.deepEqual(q.commands, ['npm run build'])
    assert.match(q.npxDropped[0], new RegExp(`^npx ng test: no package.json script runs "ng test" — add one and write the check as ${PM_NAME} run <script>$`))
  }
  assert.equal(lost.result.askHuman, false, 'an unmapped npx check is shown, not asked')
  assert.equal(lost.commands.filter((c) => /orch-state\.mjs scripts$/.test(c)).length, 1, 'scripts is asked once for the whole readiness')
  // No npx check → no scripts call.
  const plain = await runFlow({ mode: 'readiness', plans: ['101'] }, { readiness: () => ({ commands: ['npm run build'] }) })
  assert.ok(!plain.commands.some((c) => /orch-state\.mjs scripts/.test(c)))
  // mainCommands keep refusing npx.
  const main = await runFlow({ mode: 'readiness', plans: ['101'] }, { readiness: () => ({ mainCommands: ['npx ng build'] }) })
  assert.deepEqual(main.result.plans[0].mainCommands, [])
})

test('run: a delegated answer keeps only the main-folder commands main-try saw pass; the rest are dropped with a note and no question', async () => {
  const a = 'node scripts/log-query.mjs --since=15m'
  const b = 'node scripts/other-check.mjs'
  const { calls, notes, commands, result } = await runFlow({ plans: ['101'], pilot: false, mainChecks: { 101: [a, b] }, mainApproved: true, mainDelegated: true }, { passed: { 101: [a] } })
  const main = calls.filter((c) => c.type === 'orch-gate' && c.label === 'gate 101 main')
  assert.equal(main.length, 1)
  assert.deepEqual(JSON.parse(main[0].task.COMMANDS), [a])
  assert.ok(notes.some((n) => n.includes(`main-folder check dropped: not seen passing from the main folder — ${b}`)), notes.join('\n'))
  assert.ok(!notes.some((n) => n.includes(`not seen passing from the main folder — ${a}`)))
  assert.equal(commands.filter((c) => /orch-state\.mjs main-tries --run=r1/.test(c)).length, 1)
  assert.equal(result.outcomes[0].state, 'merged')
  // Nothing passed → no main gate at all.
  const none = await runFlow({ plans: ['101'], pilot: false, mainChecks: { 101: [a] }, mainApproved: true, mainDelegated: true })
  assert.equal(none.calls.filter((c) => c.label === 'gate 101 main').length, 0)
  // Without mainDelegated nothing changes and main-tries is never called.
  const plain = await runFlow({ plans: ['101'], pilot: false, mainChecks: { 101: [a, b] }, mainApproved: true })
  assert.equal(JSON.parse(plain.calls.find((c) => c.label === 'gate 101 main').task.COMMANDS).length, 2)
  assert.ok(!plain.commands.some((c) => /main-tries/.test(c)))
  // A delegated run without mainApproved still stops on main-approval.
  const refused = await runFlow({ plans: ['101'], pilot: false, mainChecks: { 101: [a] }, mainDelegated: true })
  assert.equal(refused.result.stopped, 'main-approval')
})

// main-try copies mainCheckProblem's rules by design (orch-state.mjs cannot import the workflow): this fails the day a
// name is added to one list and not the other, or one side stops refusing a slot-only check.
test('main-try and the workflow hold the same NOT_A_CHECK names and both refuse --since=plan-start', async () => {
  const names = (src, constName) => {
    const m = new RegExp(`const ${constName} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(src)
    assert.ok(m, `${constName} not found`)
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
  }
  const stateSrc = readFileSync(join(root, 'scripts', 'orch-state.mjs'), 'utf8')
  const inState = names(stateSrc, 'MAIN_TRY_NOT_A_CHECK')
  const inWorkflow = names(wfSource, 'NOT_A_CHECK')
  assert.ok(inWorkflow.length > 10)
  assert.deepEqual(inState, inWorkflow)
  // The workflow side: a slot-only main command is dropped with the plan-start reason, never kept.
  const slotOnly = 'node scripts/log-query.mjs --since=plan-start --level=error'
  const flow = await runFlow({ mode: 'readiness', plans: ['101'] }, { readiness: () => ({ mainCommands: [slotOnly] }) })
  assert.deepEqual(flow.result.plans[0].mainCommands, [])
  assert.match(flow.result.plans[0].deniedWhy[0], /--since=plan-start needs a slot's plan-start stamp/)
  // The main-try side: refused before anything runs or is written.
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'orch-state.mjs'), 'main-try', '--run=same-rules', '--plan=001', `--cmd=${slotOnly}`], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.match(r.stdout, /main-try: node scripts\/log-query\.mjs --since=plan-start --level=error: needs a slot plan-start stamp/)
  assert.ok(!existsSync(join(root, '.claude', 'orchestrator-runs', 'same-rules')), 'a refused command leaves no run state')
})

test('run: a main-folder command the run would drop (slot-only) never stops it on main-approval', async () => {
  const slotOnly = 'node scripts/log-query.mjs --since=plan-start --level=error'
  const r = await runFlow({ plans: ['101'], pilot: false, mainChecks: { 101: [slotOnly] } })
  assert.notEqual(r.result.stopped, 'main-approval')
  assert.equal(r.result.outcomes[0].state, 'merged')
  assert.ok(r.notes.some((n) => /main-folder check dropped, not run/.test(n)), r.notes.join('\n'))
  // A command that can run still needs the approval, next to the slot-only one.
  const mixed = await runFlow({ plans: ['101'], pilot: false, mainChecks: { 101: [slotOnly, 'node scripts/log-query.mjs --since=15m'] } })
  assert.equal(mixed.result.stopped, 'main-approval')
  assert.equal(mixed.result.problems.length, 1)
})

// Plan 034: the run refuses main-folder checks the Human did not approve — before init, with no runner call.
test('run: mainChecks without mainApproved stop the run before init; with it, and without any mainChecks, the run starts as before', async () => {
  const main = 'node scripts/log-query.mjs --since=15m'
  const refused = await runFlow({ plans: ['101'], pilot: false, mainChecks: { 101: [main] } })
  assert.equal(refused.result.ok, false)
  assert.equal(refused.result.stopped, 'main-approval')
  assert.deepEqual(refused.result.problems, [`plan 101 runs ${main} from the main folder — readiness lists it and the Human says go; the command then passes "mainApproved": true`])
  assert.equal(refused.commands.filter((c) => /orch-state\.mjs/.test(c)).length, 0, 'no state command, no init')
  const approved = await runFlow({ plans: ['101'], pilot: false, mainChecks: { 101: [main] }, mainApproved: true })
  assert.equal(approved.result.outcomes[0].state, 'merged')
  assert.ok(approved.calls.some((c) => c.type === 'orch-gate' && c.label === 'gate 101 main'))
  const plain = await runFlow({ plans: ['101'], pilot: false })
  assert.equal(plain.result.outcomes[0].state, 'merged')
  const empty = await runFlow({ plans: ['101'], pilot: false, mainChecks: { 101: [] } })
  assert.equal(empty.result.outcomes[0].state, 'merged', 'an empty list needs no approval')
})

// Plan 033: a runner's copy of a state line that does not parse is asked for once more (effort medium, a run note with
// the first error); a second bad copy parks the plan with the parser's message and the raw line; note and finish are
// never run twice; what a copy may add (\r, backticks, trailing text) parses without a retry.
test('runner: a bad copy of ORCH_JSON is retried once at medium with a note, twice parks with the raw line, note/finish never retry', async () => {
  const bad = 'ORCH_JSON {“ok":true,"path":"/wt/101"}'
  // Anchored: a reason or note text quotes the failed command, and such a `set` or `note` is not a worktree call.
  const isWt = (cmd) => /^node scripts\/orch-state\.mjs worktree /.test(cmd)
  const once = await runFlow({ plans: ['101'], pilot: false }, { runner: (cmd, n) => (isWt(cmd) && n === 1 ? bad : undefined) })
  const wt = once.calls.filter((c) => c.type === 'kit-runner' && /^worktree 101/.test(c.label))
  assert.deepEqual(wt.map((c) => [c.label, c.effort]), [['worktree 101', 'low'], ['worktree 101 retry', 'medium']])
  assert.equal(once.result.outcomes[0].state, 'merged')
  assert.ok(once.notes.some((n) => /runner retry: worktree 101 — first attempt: unreadable ORCH_JSON from: node scripts\/orch-state\.mjs worktree /.test(n)), once.notes.join('\n'))
  const twice = await runFlow({ plans: ['101'], pilot: false }, { runner: (cmd) => (isWt(cmd) ? bad : undefined) })
  assert.equal(twice.commands.filter(isWt).length, 2, 'one retry, not more')
  assert.match(twice.result.outcomes[0].reason, /^worktree: unreadable ORCH_JSON from: node scripts\/orch-state\.mjs worktree --run=r1 --plan=101 after 2 attempts — .* — raw: "ORCH_JSON \{“ok\\"/)
  assert.match(twice.result.outcomes[0].reason, / — non-ASCII U\+201C at 11 — raw: /, 'the hint comes before the raw line (a reason is cut at 400 characters)')
  const none = await runFlow({ plans: ['101'], pilot: false }, { runner: (cmd) => (isWt(cmd) ? 'RUN 1: node scripts/orch-state.mjs worktree → exit 0\nclaimed slot wt-2\n' : undefined) })
  assert.equal(none.commands.filter(isWt).length, 2)
  assert.match(none.result.outcomes[0].reason, /^worktree: no ORCH_JSON line from: node scripts\/orch-state\.mjs worktree --run=r1 --plan=101 \(exit 0\) after 2 attempts — last lines: "RUN 1: node scripts\/orch-state\.mjs worktree → exit 0 \| claimed slot wt-2"$/)
  // A triage with no usable result makes the run write a note; that note and the final `finish` both come back unreadable.
  const nf = await runFlow({ plans: ['101'], pilot: false }, { builder: () => ({ decisions: ['behaviour: kept the flag — reverse: drop it'] }), triage: () => 'junk', runner: (cmd) => (/^node scripts\/orch-state\.mjs (note|finish) /.test(cmd) ? 'garbage' : undefined) })
  assert.equal(nf.commands.filter((c) => /^node scripts\/orch-state\.mjs finish /.test(c)).length, 1, 'finish is never run twice')
  const noteCmds = nf.commands.filter((c) => /^node scripts\/orch-state\.mjs note /.test(c))
  assert.ok(noteCmds.length > 0)
  assert.equal(new Set(noteCmds).size, noteCmds.length, 'no note is written twice')
  for (const [why, wrap] of [['a trailing \\r', (o) => `${o}\r`], ['backticks around the line', (o) => `\`${o}\``], ['text after the closing brace', (o) => `${o} (copied verbatim)`], ['an OUTPUT block before it', (o) => `RUN 1: x → exit 0\nOUTPUT 1: x\nclaimed slot\n${o}\n`]]) {
    const r = await runFlow({ plans: ['101'], pilot: false }, { runner: (cmd, n, output) => (isWt(cmd) ? wrap(output) : undefined) })
    assert.equal(r.commands.filter(isWt).length, 1, `${why}: no retry`)
    assert.equal(r.result.outcomes[0].state, 'merged', why)
  }
})

// ---- plan 041: decision triage — duplicates, the triage call, the hard rules, what the Human is shown ---------------
const decisionCalls = (commands) => commands.filter((c) => /orch-state\.mjs decision /.test(c))
const arg = (cmd, key) => {
  const m = new RegExp(`--${key}=(?:"([^"]*)"|(\\S*))`).exec(cmd)
  return m ? (m[1] ?? m[2]) : undefined
}
const accepting = (ds) => ds.map((d) => ({ id: d.id, verdict: 'accept', kind: 'k', recommendation: 'fine', why: 'reversible', confidence: 90 }))

test('triage: one orch-triage call per run for every new decision; none when triage is off or nothing was decided', async () => {
  const dec = { 101: ['behaviour: show a spinner while saving — reverse: remove it', 'seen: src/a.js:3 — stale import'], 102: ['behaviour: keep the old tab order — reverse: reorder'] }
  const r = await runFlow({ plans: ['101', '102'], pilot: false }, { builder: (n) => ({ decisions: dec[n] }), triage: accepting })
  const calls = r.calls.filter((c) => c.type === 'orch-triage')
  assert.equal(calls.length, 1)
  assert.equal(JSON.parse(calls[0].task.DECISIONS).length, 3)
  assert.deepEqual(Object.keys(JSON.parse(calls[0].task.PLANS)).sort(), ['101', '102'])
  assert.equal(calls[0].task.FOLDER, '/merge', 'it reads the merge folder')
  assert.equal(r.result.mergeFolder, '/merge')
  const off = await runFlow({ plans: ['101', '102'], pilot: false }, { builder: (n) => ({ decisions: dec[n] }), triage: accepting, source: (s) => s.replace('const TRIAGE = "shadow"', 'const TRIAGE = "off"') })
  assert.equal(off.calls.filter((c) => c.type === 'orch-triage').length, 0)
  assert.ok(off.result.decisions.every((d) => d.verdict === 'none'), 'off: every decision stays untriaged')
  const quiet = await runFlow({ plans: ['101'], pilot: false }, { triage: accepting })
  assert.equal(quiet.calls.filter((c) => c.type === 'orch-triage').length, 0, 'nothing decided, no call')
})

test('triage: a dead, non-list or missing result gives today\'s full list and a note, and the report is still written', async () => {
  const dec = ['behaviour: show a spinner while saving — reverse: remove it', 'seen: src/a.js:3 — stale import']
  for (const [why, hook] of [['null', () => null], ['not a list', () => 'junk']]) {
    const r = await runFlow({ plans: ['101'], pilot: false }, { builder: () => ({ decisions: dec }), triage: hook })
    assert.equal(r.result.ok, true, why)
    assert.ok(r.result.decisions.length === 2 && r.result.decisions.every((d) => d.verdict === 'none'), why)
    assert.ok(r.notes.some((n) => n.includes('triage: no usable result')), `${why}: ${r.notes.join(' | ')}`)
    assert.equal(r.result.triage.note, 'triage: no usable result — full list')
    assert.ok(r.commands.some((c) => /orch-state\.mjs finish /.test(c)), `${why}: the report step ran`)
  }
})

test('triage: an unknown id is ignored, a listed id with no item is untriaged, a duplicateOf makes noise', async () => {
  const dec = ['behaviour: show a spinner while saving — reverse: remove it', 'behaviour: keep the old tab order — reverse: reorder', 'behaviour: truncate long names — reverse: wrap them']
  const r = await runFlow({ plans: ['101'], pilot: false }, {
    builder: () => ({ decisions: dec }),
    triage: () => [{ id: 'D1', verdict: 'accept', confidence: 90 }, { id: 'D2', verdict: 'accept', confidence: 90, duplicateOf: 'D1' }, { id: 'D99', verdict: 'ask' }],
  })
  const by = Object.fromEntries(r.result.decisions.map((d) => [d.id, d]))
  assert.equal(by.D1.verdict, 'accept')
  assert.deepEqual([by.D2.verdict, by.D2.why], ['noise', 'duplicate of D1'])
  assert.equal(by.D3.verdict, 'none')
  assert.equal(r.result.decisions.length, 3)
})

test('triage: the hard rules are applied in code — the workflow and lib agree on every case', async () => {
  const rows = [
    ['behaviour: show a spinner while saving — reverse: remove it', 'accept', 90],
    ['behaviour: a choice nobody asked about — reverse: undo it', 'accept', 60],
    ['behaviour: another unsure choice here — reverse: undo that', 'accept', undefined],
    ['seen: src/a.js:3 — a stale import', 'accept', 95],
    ['behaviour: the login button is hidden for guests — reverse: show it', 'accept', 95],
    ['behaviour: the price shows two decimals — reverse: round it', 'accept', 95],
    ['behaviour: the author name is kept as typed — reverse: trim it', 'accept', 95],
    ['behaviour: an ask stays an ask — reverse: nothing', 'ask', 99],
    ['behaviour: a follow up stays one — reverse: nothing', 'follow-up', 40],
  ]
  const r = await runFlow({ plans: ['101'], pilot: false }, {
    builder: () => ({ decisions: rows.map((x) => x[0]) }),
    triage: (ds) => ds.map((d) => { const row = rows.find((x) => x[0] === d.text); return { id: d.id, verdict: row[1], confidence: row[2], kind: 'k', recommendation: 'r', why: 'w' } }),
  })
  for (const [text, verdict, confidence] of rows) {
    const d = r.result.decisions.find((x) => x.text === text)
    const want = lib.triageForce({ text, verdict, confidence })
    assert.deepEqual([d.verdict, d.forced ?? null], [want.verdict, want.forced], text)
    const rec = decisionCalls(r.commands).find((c) => c.includes(`--id=${d.id}`))
    assert.equal(arg(rec, 'verdict'), want.verdict, 'the recorded verdict is the forced one')
  }
  const forced = Object.fromEntries(rows.map(([t]) => [t, r.result.decisions.find((x) => x.text === t)]))
  assert.equal(forced[rows[1][0]].forced, 'confidence')
  assert.equal(forced[rows[2][0]].forced, 'confidence', 'no confidence at all is below 70')
  assert.equal(forced[rows[3][0]].verdict, 'follow-up')
  assert.equal(forced[rows[4][0]].forced, 'keyword')
  assert.equal(forced[rows[5][0]].forced, 'keyword', 'price matches')
  assert.equal(forced[rows[6][0]].verdict, 'accept', 'author does not match auth')
})

test('triageForce: type, keyword, seen and confidence rules; none and ask are left alone', () => {
  const f = (o) => lib.triageForce(o)
  assert.deepEqual(f({ text: 'behaviour: x', verdict: 'accept', confidence: 70 }), { verdict: 'accept', forced: null })
  assert.deepEqual(f({ text: 'behaviour: x', verdict: 'accept', confidence: 69 }), { verdict: 'ask', forced: 'confidence' })
  assert.deepEqual(f({ text: 'seen: a.js:1 — x', verdict: 'accept', confidence: 99 }), { verdict: 'follow-up', forced: 'seen' })
  assert.deepEqual(f({ text: 'removes: the old route — reverse: add it', verdict: 'accept', confidence: 99 }), { verdict: 'ask', forced: 'type' })
  assert.deepEqual(f({ text: 'removes: the old route', verdict: 'noise' }), { verdict: 'ask', forced: 'type' })
  assert.deepEqual(f({ text: 'behaviour: the author is kept', verdict: 'accept', confidence: 99 }), { verdict: 'accept', forced: null }, 'author is not auth')
  for (const w of ['price', 'prices', 'login', 'password', 'permission', 'token', 'schema', 'migration', 'column', 'refund', 'security', 'pay']) {
    assert.deepEqual(f({ text: `behaviour: the ${w} changes`, verdict: 'accept', confidence: 99 }), { verdict: 'ask', forced: 'keyword' }, w)
  }
  assert.deepEqual(f({ text: 'behaviour: auth stays', verdict: 'follow-up' }), { verdict: 'ask', forced: 'keyword' })
  assert.deepEqual(f({ text: 'behaviour: x', verdict: 'none' }), { verdict: 'none', forced: null })
  assert.deepEqual(f({ text: 'behaviour: x', verdict: 'ask' }), { verdict: 'ask', forced: null })
  assert.deepEqual(f({ text: 'behaviour: x', verdict: 'bogus' }), { verdict: 'none', forced: null })
  assert.deepEqual(f({ type: 'removes', text: 'x', verdict: 'accept', confidence: 99 }), { verdict: 'ask', forced: 'type' })
})

test('decisions: a repeat in other words is one decision with an alsoFrom line; a relaunch numbers on and files repeats of earlier ones', async () => {
  const same = { 101: ['behaviour: the hold repeats while the stepper is pressed — reverse: remove it', 'behaviour: hold repeats while pressed on the stepper — reverse: drop it', 'seen: src/a.js:5 — NaN shows at 100 %', 'seen: src/a.js:5 — something else about that line', 'seen: src/b.js:9 — NaN shows at 100 %'] }
  const r = await runFlow({ plans: ['101'], pilot: false }, { builder: (n) => ({ decisions: same[n] }) })
  assert.equal(r.result.decisions.length, 3, 'the hold (twice), a.js:5 (twice) and b.js:9 — b.js:9 is another line, so another decision')
  const hold = r.result.decisions.find((d) => /hold repeats/.test(d.text))
  assert.deepEqual(hold.alsoFrom.map((a) => [a.role, a.round]), [['orch-builder', 0]])
  assert.equal(decisionCalls(r.commands).filter((c) => arg(c, 'dup-of')).length, 2, 'one call per duplicate')
  // behaviour: lines only merge inside one plan, seen: lines run-wide.
  const two = { 101: ['behaviour: the hold repeats while pressed — reverse: x', 'seen: server log shows CORS errors on the main server'], 102: ['behaviour: the hold repeats while pressed — reverse: x', 'seen: the server log shows CORS errors on main server'] }
  const t = await runFlow({ plans: ['101', '102'], pilot: false }, { builder: (n) => ({ decisions: two[n] }) })
  assert.equal(t.result.decisions.filter((d) => d.text.startsWith('behaviour:')).length, 2, 'two plans, two behaviour decisions')
  assert.equal(t.result.decisions.filter((d) => d.text.startsWith('seen:')).length, 1, 'one defect across plans')
  // A relaunch: the earlier launch's decisions come from init, no firstDecision is passed.
  const prior = [
    { id: 'D7', plan: '101', text: 'behaviour: saved on blur — reverse: remove the handler', alsoFrom: [] },
    { id: 'D9', plan: '101', text: 'seen: src/a.js:12 — NaN at 100 %', alsoFrom: [] },
  ]
  const n = await runFlow({ plans: ['101'], pilot: false }, { init: { priorDecisions: prior }, builder: () => ({ decisions: ['behaviour: a brand new choice — reverse: undo it', 'seen: src/a.js:12 — a NaN shows at 100 % here too'] }) })
  assert.deepEqual(n.result.decisions.map((d) => d.id), ['D10'], 'numbers on from the highest earlier id')
  assert.deepEqual(decisionCalls(n.commands).filter((c) => arg(c, 'dup-of')).map((c) => arg(c, 'dup-of')), ['D9'])
  assert.ok(!decisionCalls(n.commands).some((c) => arg(c, 'id') === 'D11'), 'the repeat of D9 is not a new decision')
})

// Plan 041 (the Human's decision, 2026-10-30): code merges only near-identical wordings; the same decision in other words
// is the triage's duplicateOf. The real run 499-502 shows why: the five pairs the Human found by hand score 0.19-0.32 on
// the word rule and the closest pair that is not a duplicate (D7/D8) scores 0.48.
test('run 499-502 fixture: code merges no real pair but an exact repeat across launches; the triage marks the five hand-found duplicates as noise and the Human still sees all 38', async () => {
  const byLegacy = (id) => RUN_499_502.find((d) => d.id === id)
  const plansOf = (from, to) => {
    const out = {}
    for (const d of RUN_499_502.filter((x) => +x.id.slice(1) >= from && +x.id.slice(1) <= to)) (out[d.plan] ??= []).push(d.text)
    return out
  }
  const one = plansOf(1, PASS_1_LAST)
  const first = await runFlow({ plans: Object.keys(one), pilot: false }, { builder: (nnn) => ({ decisions: one[nnn] }), triage: (ds) => ds.map((d) => ({ id: d.id, verdict: 'ask', kind: 'k', confidence: 80 })) })
  assert.equal(first.result.decisions.length, 19, 'pass 1: 19 lines, 19 decisions — D7/D8 (0.48) are two items')
  for (const d of first.result.decisions) assert.equal(d.text, byLegacy(d.id).text, `pass 1 numbers ${d.id} like the real run`)
  // Pass 2, the relaunch: the real lines plus one SYNTHETIC exact repeat of D11 (marked in the fixture).
  const two = plansOf(PASS_1_LAST + 1, 38)
  two[SYNTHETIC_REPEAT.plan] = [...two[SYNTHETIC_REPEAT.plan], SYNTHETIC_REPEAT.text]
  const textToLegacy = new Map(RUN_499_502.map((d) => [d.text, d.id]))
  const second = await runFlow({ plans: Object.keys(two), pilot: false }, {
    init: { priorDecisions: first.result.decisions },
    builder: (nnn) => ({ decisions: two[nnn] }),
    // A stub triage that returns the hand-found pairs as duplicateOf (the target may be an earlier launch's decision).
    triage: (ds, t) => {
      assert.equal(JSON.parse(t.PRIOR).length, 19, 'the triage is told about the decisions of the earlier launch')
      return ds.map((d) => {
        const dupOf = REAL_DUPLICATES[textToLegacy.get(d.text)]
        return { id: d.id, verdict: 'accept', kind: 'k', confidence: 90, ...(dupOf ? { duplicateOf: dupOf } : {}) }
      })
    },
  })
  assert.equal(second.result.decisions.length, 19, 'the synthetic exact repeat of D11 is merged by code (not a 20th decision), the 19 real lines are not')
  assert.ok(!second.result.decisions.some((d) => d.text === SYNTHETIC_REPEAT.text), 'the repeat is not numbered')
  assert.equal(decisionCalls(second.commands).filter((c) => arg(c, 'dup-of')).length, 0, 'an identical line files nothing under the kept one')
  const all = [...first.result.decisions, ...second.result.decisions]
  assert.equal(all.length, 38, 'all 38 real decisions stay')
  for (const [dup, kept] of Object.entries(REAL_DUPLICATES)) {
    const d = second.result.decisions.find((x) => x.text === byLegacy(dup).text)
    assert.deepEqual([d.verdict, d.why], ['noise', `duplicate of ${kept}`], `${dup} is noise, a duplicate of ${kept}`)
  }
  assert.equal(second.result.decisions.filter((d) => d.verdict === 'noise').length, 5, 'only the five')
  // Shadow mode: the report lists every one of the 38, the five under Noise with their reason.
  const stats = { kinds: {}, all: { last: 50, graded: 0, agreement: null } }
  const report = lib.formatReport({ status: { run: 'r', plans: {}, notes: [], mainShaAtStart: 'a' }, decisions: all, merged: [], mainShaNow: 'a', finishedAt: 'T', runBranch: 'orch/r', mainBranch: 'main', triage: { mode: 'shadow', stats, minAgreement: 0.9, minGraded: 20 } })
  for (const d of all) assert.ok(report.includes(d.text), `${d.id} is in the shadow report in full`)
  const noise = report.slice(report.indexOf('### Noise'))
  for (const dup of Object.keys(REAL_DUPLICATES)) assert.ok(noise.includes(byLegacy(dup).text), `${dup} sits under Noise`)
  assert.ok(noise.includes('duplicate of D19'))
})

test('dedupe by code: D7/D8 (0.48) and every pair that is not an exact or near-identical repeat stay separate', async () => {
  const lines = RUN_499_502.map((d) => d.text)
  const r = await runFlow({ plans: ['500'], pilot: false }, { builder: () => ({ decisions: RUN_499_502.filter((d) => d.plan === '500').map((d) => d.text) }) })
  assert.equal(r.result.decisions.length, RUN_499_502.filter((d) => d.plan === '500').length, 'plan 500: every real line is its own decision')
  const seen = await runFlow({ plans: ['499'], pilot: false }, { builder: () => ({ decisions: lines.slice(0, 10) }) })
  assert.equal(seen.result.decisions.length, 10, 'plan 499: D7/D8 are two items')
})

test('orch-state decision: upserts by id, applies the hard rules again, files duplicates under the kept decision', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'orch-decision-')))
  try {
    cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
    const runs = join(dir, '.claude', 'orchestrator-runs', 'd')
    mkdirSync(runs, { recursive: true })
    writeFileSync(join(runs, 'status.json'), `${JSON.stringify({ run: 'd', phase: 'running', plans: {}, notes: [], attempts: 1 })}\n`)
    const run = (...a) => spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), 'decision', '--run=d', ...a], { cwd: dir, encoding: 'utf8' })
    const status = () => JSON.parse(readFileSync(join(runs, 'status.json'), 'utf8'))
    let r = run('--plan=101', '--id=D1', '--text=behaviour: the login page is hidden — reverse: show it', '--verdict=accept', '--kind=hidden-page', '--confidence=95', '--rec=Keep it hidden', '--why=reversible')
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /"verdict":"ask","forced":"keyword"/, 'a runner that passes accept still gets the hard rule')
    r = run('--plan=101', '--id=D1', '--text=behaviour: the login page is hidden — reverse: show it', '--verdict=accept', '--confidence=95')
    assert.equal(status().decisions.length, 1, 'a retry upserts')
    assert.equal(run('--plan=101', '--dup-of=D1', '--text=behaviour: login page hidden for guests', '--role=orch-check-bugs', '--round=1').status, 0)
    assert.equal(run('--plan=101', '--dup-of=D1', '--text=behaviour: login page hidden for guests', '--role=orch-check-bugs', '--round=1').status, 0)
    assert.deepEqual(status().decisions[0].alsoFrom, [{ text: 'behaviour: login page hidden for guests', role: 'orch-check-bugs', round: 1 }], 'the same duplicate is filed once')
    assert.notEqual(run('--plan=101', '--dup-of=D5', '--text=x').status, 0, 'no such decision')
    assert.notEqual(run('--plan=101', '--id=7', '--text=x').status, 0, 'an id is D<n>')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('triageView: the ask order, the cut at ten, and filter collapsing only a calibrated kind', () => {
  const ds = [
    { id: 'D1', verdict: 'ask', forced: 'confidence', confidence: 50, kind: 'a' },
    { id: 'D2', verdict: 'ask', forced: null, confidence: 60, kind: 'a' },
    { id: 'D3', verdict: 'ask', forced: null, confidence: 95, kind: 'a' },
    { id: 'D4', verdict: 'ask', forced: 'keyword', confidence: 90, kind: 'a' },
    { id: 'D5', verdict: 'ask', forced: 'type', kind: 'a' },
    { id: 'D6', verdict: 'accept', kind: 'k1' },
    { id: 'D7', verdict: 'follow-up', kind: 'k1' },
    { id: 'D8', verdict: 'noise', kind: '-' },
    { id: 'D9', verdict: 'none' },
    { id: 'D10', verdict: 'accept', kind: 'k2' },
  ]
  const stats = { kinds: { k1: { graded: 25, agreement: 0.95 }, k2: { graded: 10, agreement: 1 } }, all: { last: 50, graded: 35, agreement: 0.93 } }
  const ids = (l) => l.map((d) => d.id)
  const shadow = lib.triageView({ decisions: ds, mode: 'shadow', stats })
  assert.deepEqual(ids(shadow.ask), ['D5', 'D4', 'D3', 'D2', 'D1'], 'forced type, forced keyword, agent asks high confidence first, forced confidence')
  assert.deepEqual([ids(shadow.accepted), ids(shadow.followUps), ids(shadow.noise), ids(shadow.none), shadow.collapsed.length], [['D6', 'D10'], ['D7'], ['D8'], ['D9'], 0])
  assert.equal(shadow.line, 'triage: shadow · agreement (last 50): 93% · collapsed: 0 · ask: 5 · follow-ups: 1')
  const cut = lib.triageView({ decisions: ds, mode: 'shadow', stats, maxAsk: 3 })
  assert.deepEqual([ids(cut.ask), ids(cut.askMore)], [['D5', 'D4', 'D3'], ['D2', 'D1']])
  const filter = lib.triageView({ decisions: ds, mode: 'filter', stats, minAgreement: 0.9, minGraded: 20 })
  assert.deepEqual(ids(filter.collapsed), ['D6', 'D7'], 'k1 has 25 graded at 95 %; k2 has too few; an ask is never collapsed')
  assert.deepEqual(ids(filter.accepted), ['D10'])
  assert.match(filter.line, /collapsed: 2 · ask: 5 · follow-ups: 1$/)
  assert.deepEqual(ids(lib.triageView({ decisions: ds, mode: 'filter', stats, minAgreement: 0.96, minGraded: 20 }).collapsed), [], 'agreement below the bar')
  const first = lib.triageView({ decisions: ds, mode: 'shadow', stats: { kinds: {}, all: { last: 50, graded: 0, agreement: null } } })
  assert.match(first.line, /agreement \(last 50\): n\/a \(first run\)/)
  const off = lib.triageView({ decisions: ds, mode: 'off', stats })
  assert.ok(ids(off.none).length === 10 && off.ask.length === 0, 'off: everything is untriaged')
})

test('the report: shadow lists every decision in full, filter collapses only a calibrated kind, duplicates show as also', () => {
  const decisions = [
    { id: 'D1', plan: '101', verdict: 'ask', forced: 'keyword', kind: 'k', text: 'behaviour: the login page is hidden — reverse: show it', rec: 'Keep it', why: 'reversible', alsoFrom: [{ text: 'behaviour: login hidden', role: 'orch-check-bugs', round: 1 }] },
    { id: 'D2', plan: '101', verdict: 'accept', kind: 'k1', text: 'behaviour: a long accepted choice about the spinner that goes on and on and on for more than a hundred characters in all', alsoFrom: [] },
    { id: 'D3', plan: '102', verdict: 'follow-up', kind: 'k1', text: 'seen: src/a.js:3 — stale import', alsoFrom: [] },
    { id: 'D4', plan: '102', verdict: 'none', text: 'behaviour: not triaged — reverse: x', alsoFrom: [] },
  ]
  const stats = { kinds: { k1: { graded: 30, agreement: 0.95 } }, all: { last: 50, graded: 30, agreement: 0.95 } }
  const status = { run: 'r', plans: {}, notes: [{ plan: '101', text: 'a run note' }], mainShaAtStart: 'a', decisions }
  const report = (mode) => lib.formatReport({ status, merged: [], mainShaNow: 'a', finishedAt: 'T', runBranch: 'orch/r', mainBranch: 'main', triage: { mode, stats, minAgreement: 0.9, minGraded: 20 } })
  const shadow = report('shadow')
  for (const h of ['## Decisions', '### To grade', '### Accepted by triage', '### Follow-ups', '### Not triaged', '## Run notes']) assert.ok(shadow.includes(h), h)
  assert.ok(!shadow.includes('## Decisions taken'))
  for (const d of decisions) assert.ok(shadow.includes(d.text), `${d.id} in full`)
  assert.ok(shadow.includes('also: behaviour: login hidden (orch-check-bugs, round 1)'))
  assert.ok(shadow.includes('recommend: Keep it — why: reversible'))
  assert.ok(!shadow.includes('(collapsed'))
  const filter = report('filter')
  assert.ok(filter.includes('(collapsed') && !filter.includes(decisions[1].text), 'a calibrated kind is one short line')
  assert.ok(filter.includes(decisions[0].text) && filter.includes(decisions[3].text), 'an ask and an untriaged item stay in full')
  assert.ok(lib.formatReport({ status: { ...status, decisions: [] }, merged: [], mainShaNow: 'a', finishedAt: 'T', runBranch: 'orch/r', mainBranch: 'main' }).includes('## Decisions\n\n- none'))
})
