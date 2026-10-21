// The [ui] validation tier (plan 018): the Done-when tag lint (scripts/lib/done-when.mjs and
// `scope-check.mjs --tags`, the save-plan shape lint), the UI environment rules and `orch-preflight.mjs --ui`, and the
// run report's screenshot grid with plan drift apart. UI_TIER_ROOT = an installed project (default: this repo, the kit
// installed into itself). The whole pipeline (scripted card → browser agent → report) is tools/orchestrator-e2e.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import net from 'net'
import { join, resolve } from 'path'
import { pathToFileURL, fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.UI_TIER_ROOT ? resolve(process.env.UI_TIER_ROOT) : kit
const tags = await import(pathToFileURL(join(root, 'scripts', 'lib', 'done-when.mjs')).href)
const run = await import(pathToFileURL(join(root, 'scripts', 'lib', 'orch-run.mjs')).href)

const plan = (items) => `# Plan 900 — Toy\n\nStatus: draft\n\n## Goals & Success Criteria\n**Primary:** a toy.\n\n${items.join('\n')}\n\n## Atomic Sub-tasks\n- [ ] A1: not a Done-when item\n`

test('tag lint: [auto], [ui] and [human] items pass, boxes and continuation lines are fine', () => {
  const t = plan(['- [auto] `node x.mjs` exits 0', '- [ui] On /settings, Save shows "Saved"', '  continued on the next line', '- [ ] [human] The colours match', '- [x] [ui] Done already', '- [X] [ui] Done with a capital box'])
  assert.deepEqual(tags.doneWhenTagProblems(t), [])
  assert.deepEqual(tags.uiItems(t), ['On /settings, Save shows "Saved"', 'Done already', 'Done with a capital box'])
})

test('tag lint: [ui (unclosed) and [UI] (wrong case) are rejected, and an untagged item still is', () => {
  const unclosed = tags.doneWhenTagProblems(plan(['- [ui On /settings, Save shows "Saved"']))
  assert.equal(unclosed.length, 1)
  assert.match(unclosed[0], /tag \[ui is not closed/)
  const upper = tags.doneWhenTagProblems(plan(['- [UI] On /settings, Save shows "Saved"']))
  assert.equal(upper.length, 1)
  assert.match(upper[0], /tag \[UI\] is not one of \[auto\], \[ui\], \[human\]/)
  const none = tags.doneWhenTagProblems(plan(['- Save shows "Saved"']))
  assert.equal(none.length, 1)
  assert.match(none[0], /^line \d+: no tag/)
  // Only the Done-when section counts: the untagged Atomic Sub-task above is not an item.
  assert.deepEqual(tags.doneWhenTagProblems('## Done when\n- [auto] ok\n\n## Atomic Sub-tasks\n- [ ] A1: x\n'), [])
})

test('scope-check --tags: DONE_WHEN_TAGS ok / bad with exit codes (the save-plan shape lint command)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-ui-tier-'))
  try {
    const good = join(dir, 'good.plan.md')
    const bad = join(dir, 'bad.plan.md')
    writeFileSync(good, plan(['- [auto] a', '- [ui] b', '- [human] c']))
    writeFileSync(bad, plan(['- [auto] a', '- [UI] b', '- [ui c', '- d']))
    const cli = (p) => spawnSync(process.execPath, [join(root, 'scripts', 'scope-check.mjs'), '--tags', `--plan=${p}`], { cwd: root, encoding: 'utf8' })
    const ok = cli(good)
    assert.equal(ok.status, 0, ok.stdout + ok.stderr)
    assert.match(ok.stdout, /^DONE_WHEN_TAGS: ok/m)
    const no = cli(bad)
    assert.equal(no.status, 1, no.stdout + no.stderr)
    assert.match(no.stdout, /^DONE_WHEN_TAGS: bad/m)
    assert.equal(no.stdout.split('\n').filter((l) => /line \d+:/.test(l)).length, 3, no.stdout)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('UI environment rules: server, login, cross-origin backend', () => {
  assert.equal(run.serverProblem('http://127.0.0.1:5173/a', { status: 200 }), null)
  assert.equal(run.serverProblem('http://127.0.0.1:5173/a', { status: 404 }), null)
  assert.match(run.serverProblem('http://127.0.0.1:5173/a', { error: 'ECONNREFUSED' }), /dev server http:\/\/127\.0\.0\.1:5173 does not answer \(ECONNREFUSED\)/)
  assert.match(run.serverProblem('http://127.0.0.1:5173/a', { status: 502 }), /answered 502/)
  assert.match(run.serverProblem('not a url', null), /is not a URL/)
  assert.equal(run.loginProblem('http://x/login', { status: 302 }), null)
  assert.match(run.loginProblem('http://x/login', { status: 401 }), /answered 401/)
  assert.match(run.loginProblem('http://x/login', { error: 'TimeoutError' }), /does not answer/)
  const page = 'http://localhost:5173/settings'
  assert.equal(run.crossOriginProblem(page, 'http://localhost:5173/api', { status: 200, allowOrigin: '' }), null, 'same origin needs no header')
  assert.equal(run.crossOriginProblem(page, 'http://localhost:3000/api', { status: 200, allowOrigin: 'http://localhost:5173' }), null)
  assert.equal(run.crossOriginProblem(page, 'http://localhost:3000/api', { status: 200, allowOrigin: '*' }), null)
  assert.match(run.crossOriginProblem(page, 'http://localhost:3000/api', { status: 200, allowOrigin: '' }), /cross-origin unreachable from http:\/\/localhost:5173 \(Access-Control-Allow-Origin: missing\)/)
  assert.match(run.crossOriginProblem(page, 'http://localhost:3000/api', { error: 'ECONNREFUSED' }), /backend http:\/\/localhost:3000 does not answer/)
})

const deadPort = () => new Promise((done) => {
  const s = net.createServer()
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address()
    s.close(() => done(port))
  })
})

test('orch-preflight --ui: nothing to check passes; a page server that does not answer blocks, with the reason', async () => {
  const pre = (...a) => spawnSync(process.execPath, [join(root, 'scripts', 'orch-preflight.mjs'), '--ui', ...a], { cwd: root, encoding: 'utf8', env: { ...process.env, ORCH_UI_LOGIN_URL: '', ORCH_UI_API_URL: '' } })
  const json = (r) => JSON.parse(r.stdout.split('\n').reverse().find((l) => l.startsWith('ORCH_JSON ')).slice('ORCH_JSON '.length))
  const none = pre()
  assert.equal(none.status, 0, none.stdout + none.stderr)
  assert.deepEqual(json(none), { ok: true, problems: [] })
  assert.match(none.stdout, /^SKIP ui server/m)
  const port = await deadPort()
  const down = pre('--pages', `http://127.0.0.1:${port}/settings`)
  assert.equal(down.status, 1, down.stdout + down.stderr)
  const j = json(down)
  assert.equal(j.ok, false)
  assert.equal(j.uiBlocked, true)
  assert.match(j.problems[0], new RegExp(`^ui server: dev server http://127\\.0\\.0\\.1:${port} does not answer`))
  assert.doesNotMatch(down.stdout, /^(?:OK|FAIL) (?:disk|packages|git identity)/m, '--ui runs only the UI checks')
})

test('the report: a screenshot grid per page, plan drift in its own section with no severity, unchecked cards for the Human', () => {
  const out = run.validationList([
    { nnn: '001', title: 'One', humanItems: ['The colours match'], uiCards: [
      { card: 'Save shows Saved', status: 'pass', via: 'script', page: 'http://app/settings', screenshots: ['screens/001-1.png'], round: 0 },
      { card: 'Error shows Error', status: 'plan-drift', via: 'browser', page: 'http://app/settings', screenshots: ['screens/001-2.png'], round: 0 },
      { card: 'Theme | looks right', status: 'unchecked', via: 'none', page: 'http://app/', screenshots: [], round: 0 },
    ] },
  ]).join('\n')
  assert.ok(out.startsWith('### http://app/settings\n\n| # | Card | Verdict | Screenshot |\n| --- | --- | --- | --- |\n| 1 | 001: Save shows Saved | pass — script, round 0 | [![Save shows Saved](screens/001-1.png)](screens/001-1.png) |'), out)
  const drift = out.split('### Plan drift')[1].split('\n### ')[0]
  assert.match(drift, /2\. 001: Error shows Error — on http:\/\/app\/settings; evidence: `screens\/001-2\.png`/)
  assert.doesNotMatch(drift, /\b(?:blocker|major|minor|nit)\b/)
  assert.ok(!out.split('### Plan drift')[0].includes('Error shows Error'), 'drift is not in the grid')
  assert.match(out, /3\. 001: Theme \| looks right — a \[ui\] card no script could check/)
  assert.match(out, /4\. 001 One: The colours match/)
})

test('the [ui] tag is defined where plans are written, linted, shipped and closed (kit sources)', { skip: !existsSync(join(kit, 'core')) }, () => {
  for (const f of ['core/docs/agent/job-validation.md', 'core/.claude/skills/save-plan/SKILL.md', 'core/.claude/references/prd-template.md', 'core/.claude/commands/ship.md']) {
    assert.match(readFileSync(join(kit, f), 'utf8'), /\[ui\]/, f)
  }
})
