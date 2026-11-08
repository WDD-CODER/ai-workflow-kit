// Plan 102: a conflict in the plan's own file never parks the plan (the run branch's copy wins), any other conflict still
// fails, the run branch is caught up before the builder starts, and a plan changed during the run is recorded by the
// script. A scratch project (tools/test/lib/run-plans-fixture.mjs) with the installed scripts.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeProject, toyPlan, toyFile } from './lib/run-plans-fixture.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const { mergePlan, appendExecutionNote } = await import(pathToFileURL(join(kit, 'scripts', 'lib', 'plan-merge.mjs')).href)

let p
before(() => {
  p = makeProject({ kit })
  p.addPlans({ 601: toyPlan(601), 602: toyPlan(602), 603: toyPlan(603), 604: toyPlan(604) })
})
after(() => p?.cleanup())

const sh = (cwd, ...a) => {
  const r = p.git(cwd, ...a)
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.out}`)
  return r.out.trim()
}

/** A run `run` with plan `nnn` on feat/<nnn>-toy-<nnn> (the builder ticked T1 and added src/<nnn>.txt) and the run branch's plan file edited. */
function scene(run, nnn, { runSubject = `plan(${nnn}): answer the open question about the schema`, otherFile = false } = {}) {
  const init = p.state('init', `--run=${run}`).json
  assert.equal(init.ok, true, JSON.stringify(init))
  const mf = init.mergeFolder
  const path = toyFile(nnn)
  assert.equal(p.state('plan-info', `--run=${run}`, `--plan=${nnn}`).json.ok, true)
  const startCommit = sh(p.proj, 'log', '-1', '--format=%H', `origin/orch/${run}`, '--', path)
  // the builder's branch, cut from the run branch
  const branch = `feat/${nnn}-toy-${nnn}`
  sh(p.proj, 'switch', '-q', '-c', branch, `origin/orch/${run}`)
  writeFileSync(join(p.proj, path), readFileSync(join(p.proj, path), 'utf8').replace('- [ ] T1', '- [x] T1'))
  mkdirSync(join(p.proj, 'src'), { recursive: true })
  writeFileSync(join(p.proj, 'src', `${nnn}.txt`), 'built\n')
  sh(p.proj, 'add', '-A', 'src', path)
  sh(p.proj, 'commit', '-q', '-m', `built ${nnn}`)
  if (otherFile) {
    // a second file both sides change
    writeFileSync(join(p.proj, 'shared.txt'), 'builder side\n')
    sh(p.proj, 'add', 'shared.txt')
    sh(p.proj, 'commit', '-q', '-m', 'builder shared')
  }
  sh(p.proj, 'push', '-q', 'origin', branch)
  const head = sh(p.proj, 'rev-parse', 'HEAD')
  sh(p.proj, 'switch', '-q', 'main')
  // the Planner answers a question on the run branch while the builder works
  sh(mf, 'fetch', '-q', 'origin')
  sh(mf, 'merge', '-q', '--ff-only', `origin/orch/${run}`)
  // the same line the builder ticked: a real conflict in the plan file
  writeFileSync(join(mf, path), readFileSync(join(mf, path), 'utf8').replace('anything open? A: no', 'anything open? A: no, decided on the run branch').replace('T1: write the toy file', 'T1: write the toy file as the Planner now says'))
  if (otherFile) writeFileSync(join(mf, 'shared.txt'), 'run side\n')
  sh(mf, 'add', '-A')
  sh(mf, 'commit', '-q', '-m', runSubject)
  sh(mf, 'push', '-q', 'origin', `HEAD:refs/heads/orch/${run}`)
  assert.equal(p.state('set', `--run=${run}`, `--plan=${nnn}`, `--checked-head=${head}`).json.ok, true)
  return { mf, path, branch, startCommit, head }
}
const merge = (run, nnn, s, extra = {}) => mergePlan({ root: p.proj, run, nnn, branch: s.branch, runBranch: `orch/${run}`, mergeFolder: s.mf, checks: [], plan: { path: s.path, startCommit: s.startCommit }, ...extra })

test('(a) a merge whose only conflicts are in plans/** is completed with the run branch\'s copy, and the file is named', async () => {
  const s = scene('pf-a', '601')
  const m = await merge('pf-a', '601', s)
  assert.equal(m.merged, true, m.why)
  assert.deepEqual(m.planFiles, [s.path])
  sh(p.proj, 'fetch', '-q', 'origin')
  const text = sh(p.proj, 'show', `origin/orch/pf-a:${s.path}`)
  assert.match(text, /decided on the run branch/, 'the run branch\'s text is kept')
  assert.match(text, /- \[ \] T1/, 'the builder\'s tick is not put back: the run branch\'s copy wins')
  assert.equal(sh(p.proj, 'show', 'origin/orch/pf-a:src/601.txt'), 'built', 'the builder\'s other files are merged as usual')
  assert.match(sh(p.proj, 'log', '--format=%s', '-3', 'origin/orch/pf-a'), /Merge feat\/601-toy-601 into orch\/pf-a \(plan 601\)/)
})

test('(b) a conflict in any other file still fails as today, and origin does not move', async () => {
  const s = scene('pf-b', '602', { otherFile: true })
  const before = sh(p.proj, 'ls-remote', 'origin', 'refs/heads/orch/pf-b')
  const m = await merge('pf-b', '602', s)
  assert.equal(m.merged, false)
  assert.match(m.why, /does not merge into orch\/pf-b: conflicts in .*shared\.txt/)
  assert.equal(sh(p.proj, 'ls-remote', 'origin', 'refs/heads/orch/pf-b'), before)
})

test('(c) before the builder starts, the run branch is merged into the plan branch and the builder reads the current plan', () => {
  const run = 'pf-c'
  const init = p.state('init', `--run=${run}`).json
  const mf = init.mergeFolder
  const path = toyFile('603')
  const branch = 'feat/603-toy-603'
  assert.equal(p.state('plan-info', `--run=${run}`, '--plan=603').json.ok, true, 'the run already knows the plan: a relaunch')
  // an earlier attempt left the branch with a tick; the run branch moved on with an edit of the plan
  sh(p.proj, 'switch', '-q', '-c', branch, `origin/orch/${run}`)
  writeFileSync(join(p.proj, path), readFileSync(join(p.proj, path), 'utf8').replace('- [ ] T1', '- [x] T1'))
  sh(p.proj, 'add', path)
  sh(p.proj, 'commit', '-q', '-m', 'tick T1')
  sh(p.proj, 'push', '-q', 'origin', branch)
  sh(p.proj, 'switch', '-q', 'main')
  writeFileSync(join(mf, path), readFileSync(join(mf, path), 'utf8').replace('anything open? A: no', 'anything open? A: no, the run branch says so'))
  sh(mf, 'add', '-A')
  sh(mf, 'commit', '-q', '-m', 'plan(603): add the answer to the question')
  sh(mf, 'push', '-q', 'origin', `HEAD:refs/heads/orch/${run}`)
  const info = p.state('plan-info', `--run=${run}`, '--plan=603', '--with-worktree=yes').json
  assert.equal(info.wt?.ok, true, JSON.stringify(info))
  const text = readFileSync(join(info.wt.path, path), 'utf8')
  assert.match(text, /the run branch says so/, 'the current plan text')
  assert.match(text, /- \[x\] T1/, 'the earlier attempt\'s tick is kept')
  assert.equal(sh(info.wt.path, 'merge-base', '--is-ancestor', `origin/orch/${run}`, 'HEAD') === '', true)
})

test('a plan changed during the run is recorded by the script: run note, report section, Execution Notes line; a commit with no reason is a warning', async () => {
  const run = 'pf-d'
  const s = scene(run, '604', { runSubject: 'plan(604): fix' })
  const m = await merge(run, '604', s)
  assert.equal(m.merged, true, m.why)
  const c = m.planChange.commits[0]
  assert.equal(c.subject, 'plan(604): fix')
  assert.equal(c.author, 'kit-rp')
  assert.match(m.planChange.diff, /\+.*decided on the run branch/)
  assert.ok(m.planChange.diff.split('\n').length <= 40)
  assert.equal(m.planChange.warnings.length, 1)
  assert.match(m.planChange.warnings[0], new RegExp(c.sha))
  // the line under the plan's Execution Notes, committed by the merge step on the run branch
  sh(p.proj, 'fetch', '-q', 'origin')
  const text = sh(p.proj, 'show', `origin/orch/${run}:${s.path}`)
  assert.match(text, new RegExp(`- \\d{4}-\\d{2}-\\d{2} changed during ${run} in ${c.sha}: plan\\(604\\): fix`))
  assert.ok(text.indexOf('changed during') > text.indexOf('## Execution Notes'))
  // run-plans hands the record to orch-state: note, warning, report section
  const rec = p.state('plan-changed', `--run=${run}`, '--plan=604', `--commit=${c.sha}`, `--author=${c.author}`, `--subject=${c.subject}`, `--diff-b64=${Buffer.from(m.planChange.diff).toString('base64')}`, `--warning-b64=${Buffer.from(m.planChange.warnings.join('\n')).toString('base64')}`)
  assert.equal(rec.json.ok, true, rec.out)
  const st = p.status(run)
  assert.ok(st.notes.some((n) => n.plan === '604' && n.text === `plan 604 changed during the run: ${c.sha} kit-rp — plan(604): fix`), JSON.stringify(st.notes))
  assert.ok(st.notes.some((n) => /^warning: plan-file commit /.test(n.text) && n.text.includes(c.sha)))
  const fin = p.state('finish', `--run=${run}`)
  const report = readFileSync(join(p.proj, '.claude', 'orchestrator-runs', `${run}.md`), 'utf8')
  assert.match(report, /## Plans changed during the run\n\n- plan 604: .* kit-rp — plan\(604\): fix/, fin.out)
})

test('an unchanged plan file leaves no record', async () => {
  const run = 'pf-e'
  const init = p.state('init', `--run=${run}`).json
  const path = toyFile('601')
  const startCommit = sh(p.proj, 'log', '-1', '--format=%H', `origin/orch/${run}`, '--', path)
  const { planChangeRecord } = await import(pathToFileURL(join(kit, 'scripts', 'lib', 'plan-merge.mjs')).href)
  sh(init.mergeFolder, 'fetch', '-q', 'origin')
  assert.equal(planChangeRecord(init.mergeFolder, { path, startCommit }), null)
})

test('appendExecutionNote: the line goes at the end of the Execution Notes section, or makes the section', () => {
  assert.equal(appendExecutionNote('# P\n\n## Execution Notes\n- a\n\n## Other\nx\n', '- b'), '# P\n\n## Execution Notes\n- a\n- b\n\n## Other\nx\n')
  assert.equal(appendExecutionNote('# P\n', '- b'), '# P\n\n## Execution Notes\n- b\n')
})
