// Plan 083 C1: a run printed "ask: 0" while its status.json held 16 decisions. Cause (reproduced here): the command's
// view kept only the current launch's decisions (`d.attempt === status.attempts`), so a relaunch hid every decision of
// the launch before it, graded or not. The view now keeps an earlier launch's decision until it has a grade row.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, cpSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath, pathToFileURL } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit
const { formatReport, decisionsInView, triageView } = await import(pathToFileURL(join(root, 'scripts', 'lib', 'orch-run.mjs')).href)

// 16 decisions over two plans, recorded by launch 1 (the shape of docs/orchestrator/runs/run-065/status.json), 5 asks.
const VERDICTS = ['ask', 'accept', 'follow-up', 'noise', 'accept', 'ask', 'accept', 'ask', 'noise', 'accept', 'ask', 'follow-up', 'accept', 'ask', 'accept', 'noise']
const decisionRows = () => VERDICTS.map((verdict, i) => ({
  plan: i < 8 ? '513' : '516', id: `D${i + 1}`, text: `behaviour: choice ${i + 1} the plan did not settle — reverse: undo choice ${i + 1}`,
  verdict, kind: 'naming', confidence: '80', rec: '', why: '',
}))
const ASKS = VERDICTS.filter((v) => v === 'ask').length

test('the report lists all 16 decisions and the view counts every ask, also on a relaunch; no decision prints "- none"', () => {
  const decisions = decisionRows().map((d) => ({ ...d, attempt: 1, type: 'behaviour', alsoFrom: [] }))
  const status = { run: 'run-x', plans: {}, notes: [], attempts: 2, mainShaAtStart: 'abc', decisions }
  const report = formatReport({ status, merged: [], mainShaNow: 'abc', finishedAt: 'now', runBranch: 'orch/run-x', mainBranch: 'main', decisions })
  const section = report.slice(report.indexOf('## Decisions'), report.indexOf('## Run notes'))
  assert.equal(section.match(/^- D\d+ · /gm)?.length, 16, section)
  assert.match(section, new RegExp(`ask: ${ASKS} ·`))
  // what the command prints on launch 2: launch 1's decisions have no grade yet, so all of them are in view
  const inView = decisionsInView(decisions, { attempt: 2, run: 'run-x', gradeRows: [] })
  assert.equal(inView.length, 16)
  assert.equal(triageView({ decisions: inView }).ask.length, ASKS)
  // graded ones (a grade row of this run) leave the view; another run's grade rows do not count
  const graded = decisions.slice(0, 10).map((d) => ({ run: 'run-x', id: d.id }))
  assert.equal(decisionsInView(decisions, { attempt: 2, run: 'run-x', gradeRows: [...graded, { run: 'run-y', id: 'D11' }] }).length, 6)
  // the current launch's decisions are always in view
  assert.equal(decisionsInView(decisions.map((d) => ({ ...d, attempt: 2 })), { attempt: 2, run: 'run-x', gradeRows: graded }).length, 16)
  const none = formatReport({ status: { ...status, decisions: [] }, merged: [], mainShaNow: 'abc', finishedAt: 'now', runBranch: 'orch/run-x', mainBranch: 'main', decisions: [] })
  assert.match(none, /## Decisions\n\n- none\n/)
})

// The real `finish` on a relaunched run: scratch repository with a bare origin, the installed orch-state.mjs.
const sh = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
test('finish on a relaunch: the command output counts the earlier launch\'s ungraded asks, and the report lists all 16', () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'orch-dec-')))
  const bare = realpathSync(mkdtempSync(join(tmpdir(), 'orch-dec-bare-')))
  try {
    const dir = join(parent, 'main')
    mkdirSync(join(dir, 'plans'), { recursive: true })
    sh(dir, 'init', '-q', '-b', 'main')
    sh(dir, 'config', 'user.email', 't@t')
    sh(dir, 'config', 'user.name', 't')
    writeFileSync(join(dir, 'plans', '513-x.plan.md'), '# Plan 513 — X\n\nStatus: active\n')
    writeFileSync(join(dir, 'plans', '516-y.plan.md'), '# Plan 516 — Y\n\nStatus: active\n')
    sh(dir, 'add', '-A')
    sh(dir, 'commit', '-q', '-m', 'plans')
    sh(bare, 'init', '-q', '--bare', '-b', 'main')
    sh(dir, 'remote', 'add', 'origin', bare)
    sh(dir, 'push', '-q', '-u', 'origin', 'main')
    cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
    writeFileSync(join(dir, '.git', 'info', 'exclude'), 'scripts/\n.claude/\n')
    const state = (...a) => {
      const r = spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), ...a], { cwd: dir, encoding: 'utf8', timeout: 120000 })
      const line = String(r.stdout).split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
      assert.ok(line, `${a.join(' ')}: ${r.stdout}${r.stderr}`)
      return JSON.parse(line.slice('ORCH_JSON '.length))
    }
    assert.equal(state('init', '--run=r').ok, true)
    const rec = state('decisions', '--run=r', `--b64=${Buffer.from(JSON.stringify(decisionRows())).toString('base64')}`)
    assert.equal(rec.decisions, 16, JSON.stringify(rec))
    // launch 1 stopped before its report; the Human relaunches the run
    assert.equal(state('init', '--run=r').attempt, 2)
    const fin = state('finish', '--run=r', '--final-gate=none')
    assert.equal(fin.triage.ask.length + fin.triage.askMore.length, ASKS, JSON.stringify(fin.triage))
    assert.match(fin.triage.line, new RegExp(`ask: ${ASKS} ·`))
    assert.equal(fin.earlierDecisions?.length, 16, 'the records the workflow hands the command')
    const report = readFileSync(fin.local, 'utf8')
    assert.equal(report.slice(report.indexOf('## Decisions'), report.indexOf('## Run notes')).match(/^- D\d+ · /gm)?.length, 16)
  } finally {
    rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    rmSync(bare, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
