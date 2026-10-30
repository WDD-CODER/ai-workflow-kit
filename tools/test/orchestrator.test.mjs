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
import { orchestratorProblems, commandProblems, ciCommandProblem } from '../lib/kit.mjs'
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
      // passTail(folder, n): the tail the gate puts on its first command when it passed (orch-gate.md: "rerun after env-fail: …").
      const passTail = hooks.passTail?.(t.FOLDER, n)
      return { ...base, results: cmds.map((c, i) => (failing && i === 0 ? { command: c, status: 'fail', tail } : { command: c, status: 'pass', ...(passTail && i === 0 ? { tail: passTail } : {}) })) }
    }
    if (['orch-check-plan', 'orch-check-bugs', 'orch-check-rules', 'orch-security'].includes(type)) return { ...base, problems: [] }
    if (type === 'orch-merge') {
      if (hooks.mergeEnvOnce && !nulled.has('merge-env')) {
        nulled.add('merge-env')
        return { ...base, merged: false, envFailure: true, reason: "'ng' is not recognized" }
      }
      return { ...base, merged: true, sha: 'def5678' }
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
  const decisions = Array.from({ length: MAX_NOTES + 5 }, (_, i) => `seen: a.js:${i + 1} — item ${i + 1}`)
  const { notes } = await runFlow({ plans: ['101'], pilot: false }, { builder: () => ({ decisions }) })
  const mine = notes.filter((c) => c.includes('--plan=101'))
  assert.equal(mine.length, MAX_NOTES, `${MAX_NOTES} note agent calls for the plan, not ${MAX_NOTES + 5}`)
  assert.match(mine.at(-1), /notes capped: \d+ notes written for plan 101/)
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
  const { result, notes } = await runFlow({ plans: ['101'], pilot: false }, { builder: () => ({ decisions }) })
  assert.deepEqual(result.decisions.map((d) => d.text), ['behaviour: no dialog on leave — reverse: add one', 'seen: src/a.js:12 — NaN at 100 %', 'SEEN: src/b.js:3 — dup'])
  assert.deepEqual(result.decisionsDropped, { 101: 2 })
  assert.equal(notes.filter((n) => /--text="?D\d/.test(n)).length, 3, 'one note per kept decision, none for a dropped line')
  assert.ok(!notes.some((n) => /Ran the six commands|Verified by rerun/.test(n)))
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

// main-try and ciCommandProblem (tools/lib/kit.mjs) copy mainCheckProblem's rules by design (orch-state.mjs cannot import the workflow): this fails the day a
// name is added to one list and not the other, or one side stops refusing a slot-only check.
test('main-try, the workflow and the CI-mirror check hold the same NOT_A_CHECK names; main-try and the workflow both refuse --since=plan-start', async () => {
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
  // The CI-mirror list in tools/lib/kit.mjs (install and sync refuse a bad ciMirror item) is the third copy.
  const kitSrc = readFileSync(join(root, 'tools', 'lib', 'kit.mjs'), 'utf8')
  assert.deepEqual(names(kitSrc, 'CI_NOT_A_CHECK'), inWorkflow)
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
  // A builder decision makes the run write a note; that note and the final `finish` both come back unreadable.
  const nf = await runFlow({ plans: ['101'], pilot: false }, { builder: () => ({ decisions: ['behaviour: kept the flag — reverse: drop it'] }), runner: (cmd) => (/^node scripts\/orch-state\.mjs (note|finish) /.test(cmd) ? 'garbage' : undefined) })
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

// ---- plan 044: the final gate runs the CI mirror, a check that passed only on a rerun is a recorded flake -----------
const withMirror = (list) => (s) => {
  assert.match(s, /const CI_MIRROR = \[[^\]]*\]/, 'orchestrate.js renders orchestrator.ciMirror as CI_MIRROR')
  return s.replace(/const CI_MIRROR = \[[^\]]*\]/, 'const CI_MIRROR = ' + JSON.stringify(list))
}
const finalCommands = (calls) => JSON.parse(calls.find((c) => c.type === 'orch-gate' && c.label === 'gate final').task.COMMANDS)
const flakeCommands = (commands) => commands.filter((c) => /orch-state\.mjs flake /.test(c))

test('final gate: PROJECT_CHECKS, then the manifest check, then orchestrator.ciMirror (deduplicated, bad shapes dropped with a note)', async () => {
  const base = finalCommands((await runFlow({ plans: ['101'], pilot: false }, { init: { kitManifest: true } })).calls)
  assert.ok(base.includes('node scripts/kit-manifest-check.mjs'))
  const scripts = base.map((c) => /^(?:npm|pnpm) run ([\w:-]+)$/.exec(c)?.[1]).filter(Boolean)
  const mirror = ['node tools/ci-extra.mjs', base[0], 'node tools/ci-extra.mjs', 'git push origin main', 'node tools/x.mjs --apply', PM_RUN + ' run no-such-script']
  const r = await runFlow({ plans: ['101'], pilot: false }, { init: { kitManifest: true, npmScripts: scripts }, source: withMirror(mirror) })
  assert.deepEqual(finalCommands(r.calls), [...base, 'node tools/ci-extra.mjs'], 'project checks, manifest check, then the mirror, no duplicate')
  const dropped = r.notes.filter((n) => /ci-mirror check dropped, not run/.test(n))
  assert.equal(dropped.length, 3, dropped.join('\n'))
  assert.ok(dropped.some((n) => /git push origin main: not an allowed check/.test(n)))
  assert.ok(dropped.some((n) => /node tools\/x\.mjs --apply: --apply writes files/.test(n)))
  assert.ok(dropped.some((n) => /no script no-such-script in package\.json/.test(n)))
  // Never in a plan's own gate or the merge step.
  assert.ok(!JSON.parse(r.calls.find((c) => c.type === 'orch-gate' && c.label === 'gate 101').task.COMMANDS).includes('node tools/ci-extra.mjs'))
  // An empty mirror changes nothing.
  assert.deepEqual(finalCommands((await runFlow({ plans: ['101'], pilot: false }, { init: { kitManifest: true } })).calls), base)
})

test('ciMirror: the workflow checkProblem and the config check ciCommandProblem refuse the same samples', () => {
  const from = wfSource.indexOf('const DENY =')
  const to = wfSource.indexOf('// The project files a check command names')
  assert.ok(from > 0 && to > from, 'the workflow source has the check rules')
  const checkProblem = new Function('PM', wfSource.slice(from, to) + '\nreturn checkProblem')('npm')
  for (const c of ['npm run lint', 'pnpm run test:ci', 'node scripts/a.mjs', 'node tools/b.mjs --flag', 'node scripts/take-plan.mjs', 'node scripts/sync.mjs', 'node tools/Install.mjs',
    'node tools/x.mjs --apply', 'node tools/x.mjs --fix=1', 'node tools/x.mjs --write', 'node ../x.mjs', 'node scripts/../x.mjs', 'rm -rf x', 'git push --force', 'npx foo', 'npm run bad name', 'node tools/a.mjs $(x)']) {
    assert.equal(ciCommandProblem(c) === null, checkProblem(c, null) === null, c)
  }
})

test('config: orchestrator.ciMirror must be a list of allowed check commands', () => {
  assert.deepEqual(orchestratorProblems({}), [])
  assert.deepEqual(orchestratorProblems({ 'orchestrator.ciMirror': [] }), [])
  assert.deepEqual(orchestratorProblems({ 'orchestrator.ciMirror': ['npm run lint', 'node scripts/kit-manifest-check.mjs', 'node tools/leak-check.mjs --root packs'] }), [])
  assert.match(orchestratorProblems({ 'orchestrator.ciMirror': 'npm run lint' })[0], /^orchestrator\.ciMirror is "npm run lint" — it must be a list of check commands/)
  assert.match(orchestratorProblems({ 'orchestrator.ciMirror': ['npm run lint', 'git push', 'node tools/x.mjs --apply', 3] }).join('\n'), /orchestrator\.ciMirror item "git push" — git push: not an allowed check[\s\S]*item "node tools\/x\.mjs --apply" — .*--apply writes files[\s\S]*item 3 — 3 is not a string/)
  assert.equal(orchestratorProblems({ 'orchestrator.ciMirror': ['node scripts/take-plan.mjs'] }).length, 1)
})

test('flakes: a gate pass whose tail starts "rerun after env-fail:" is recorded, per plan and for the final gate', async () => {
  const tail = (folder) => (folder === '/wt/101' || folder === '/merge' ? 'rerun after env-fail: EBUSY mongodb-memory-server lock' : undefined)
  const r = await runFlow({ plans: ['101'], pilot: false }, { passTail: tail })
  assert.equal(r.result.outcomes[0].state, 'merged', 'a flake never stops the run')
  assert.deepEqual(r.result.finalGate, { ok: true })
  const flakes = flakeCommands(r.commands)
  assert.equal(flakes.length, 2, flakes.join('\n'))
  const plan = flakes.find((c) => /--plan=101/.test(c))
  assert.ok(/--via=rerun/.test(plan) && /--where=gate/.test(plan) && /--round=0/.test(plan), plan)
  const final = flakes.find((c) => !/--plan=/.test(c))
  assert.ok(/--via=rerun/.test(final) && /--where=final/.test(final) && !/--round=/.test(final), final)
  assert.equal(flakeCommands((await runFlow({ plans: ['101'], pilot: false })).commands).length, 0, 'no rerun tail, no flake')
  // A tail that only mentions the words is not a rerun record.
  assert.equal(flakeCommands((await runFlow({ plans: ['101'], pilot: false }, { passTail: () => 'note: rerun after env-fail: no' })).commands).length, 0)
})

test('flakes: a gate fail followed by a passing gate on the same headSha is a flake; a new headSha is a fix, not a flake', async () => {
  let gates = 0
  const failOnce = (folder) => folder === '/wt/101' && ++gates === 1
  const same = await runFlow({ plans: ['101'], pilot: false }, { gateFails: failOnce })
  assert.equal(same.result.outcomes[0].state, 'merged')
  const flakes = flakeCommands(same.commands)
  assert.equal(flakes.length, 1, flakes.join('\n'))
  assert.ok(/--plan=101/.test(flakes[0]) && /--via=same-commit/.test(flakes[0]) && /--where=gate/.test(flakes[0]) && /--round=0/.test(flakes[0]) && /--sha=abc1234/.test(flakes[0]), flakes[0])
  gates = 0
  let builds = 0
  const fixed = await runFlow({ plans: ['101'], pilot: false }, { gateFails: failOnce, builder: () => ({ headSha: 'sha' + ++builds + 'xxxx' }) })
  assert.equal(fixed.result.outcomes[0].state, 'merged')
  assert.equal(flakeCommands(fixed.commands).length, 0, 'the builder committed: a real fix round')
  // A checker failure between the two gates clears the memory: the next gate is not a plain rerun of the failed one.
  assert.match(wfSource, /ctx\.lastGateFail = null/)
})

test('the report: ## Flaky checks only when status.json has flakes', () => {
  const status = { run: 'r1', startedAt: 'T0', mainShaAtStart: 'a', plans: { '101': { nnn: '101', title: 'One', state: 'merged', round: 1, models: {}, flakes: [
    { command: 'npm run test', round: 0, via: 'rerun', where: 'gate', at: 'T', text: 'flake: npm run test (plan 101, round 0)' },
    { command: 'npm run lint', round: 1, via: 'same-commit', where: 'gate', sha: 'abc1234def', at: 'T', text: 'x' }] } }, notes: [], flakes: [{ command: 'npm run build', via: 'rerun', where: 'final', at: 'T', text: 'flake: npm run build (final gate)' }] }
  const report = (s) => lib.formatReport({ status: s, merged: [], mainShaNow: 'a', finishedAt: 'T1', runBranch: 'orch/r1', mainBranch: 'main' })
  const r = report(status)
  assert.ok(r.includes('## Flaky checks\n\n- 101: `npm run test` — round 0, passed on the gate\'s rerun after env-fail\n- 101: `npm run lint` — round 1, passed on the next gate with no new commit (abc1234)\n- final gate: `npm run build` — passed on the gate\'s rerun after env-fail\n'), r)
  assert.ok(r.indexOf('## Flaky checks') > r.indexOf('## Plans') && r.indexOf('## Flaky checks') < r.indexOf('## Decisions taken'))
  assert.ok(!report({ ...status, plans: { '101': { ...status.plans['101'], flakes: [] } }, flakes: [] }).includes('Flaky checks'), 'no flakes, no section')
})

test('orch-state flake: records into plans[NNN].flakes[] and the run-level flakes[]; the same command and round is one entry', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'orch-flake-')))
  try {
    cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true })
    const sh = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
    sh('init', '-q', '-b', 'main')
    const run = (...a) => spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), ...a], { cwd: dir, encoding: 'utf8' })
    const statusDir = join(dir, '.claude', 'orchestrator-runs', 'r1')
    mkdirSync(statusDir, { recursive: true })
    writeFileSync(join(statusDir, 'status.json'), JSON.stringify({ run: 'r1', phase: 'running', plans: { '101': { nnn: '101', round: 0, models: {}, state: 'gate' } }, notes: [] }))
    const a = run('flake', '--run=r1', '--plan=101', '--command=npm run test', '--round=1', '--via=rerun', '--where=gate', '--sha=abc1234')
    assert.equal(a.status, 0, a.stdout + a.stderr)
    assert.match(a.stdout, /flake: npm run test \(plan 101, round 1\)/)
    assert.equal(run('flake', '--run=r1', '--plan=101', '--command=npm run test', '--round=1', '--via=rerun', '--where=gate').status, 0)
    assert.equal(run('flake', '--run=r1', '--command=npm run build', '--via=rerun', '--where=final').status, 0)
    assert.match(run('flake', '--run=r1', '--command=npm run build', '--via=sometimes', '--where=final').stdout + '', /allowed: rerun, same-commit/)
    assert.notEqual(run('flake', '--run=r1', '--plan=101', '--command=npm run test', '--via=rerun', '--where=gate').status, 0, '--round is needed with --plan')
    const st = JSON.parse(readFileSync(join(statusDir, 'status.json'), 'utf8'))
    assert.equal(st.plans['101'].flakes.length, 1, 'same command and round: one entry')
    assert.equal(st.plans['101'].flakes[0].text, 'flake: npm run test (plan 101, round 1)')
    assert.equal(st.plans['101'].flakes[0].sha, 'abc1234')
    assert.equal(st.flakes.length, 1)
    assert.equal(st.flakes[0].text, 'flake: npm run build (final gate)')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
