/**
 * Orchestrator end to end — installs the kit into a scratch project and runs the installed `scripts/run-plans.mjs`
 * (plan 088: the orchestrator loop as one script) with a fake `claude` that answers as the builder and the reviewer
 * (tools/test/fixtures/fake-claude.mjs). Run from the kit root:
 *
 *   node tools/orchestrator-e2e.mjs [--deps-from <scripts/node_modules folder>] [--keep]
 *
 * The scratch project (tools/test/lib/run-plans-fixture.mjs) has a local bare origin; the fake builder commits and
 * pushes real commits, the script merges into the run branch with git. Nothing reaches GitHub and no model is called.
 *
 * Asserts: a dirty main folder refuses the run at the preflight, before anything is created; a diamond of plans
 * (A; B and C need A; D needs B and C) merges in wave order with the anchored merge subjects, each merge commit's second
 * parent its checked head; a gate failure is fixed in one round; a plan whose gate fails twice is parked by plan-park
 * (park record, its folder removed) and only its dependent is skipped, the rest of the run goes on; a builder that writes
 * outside its scope is caught by the gate's scope check (no hook runs in a headless call); origin/main never moves; the
 * merge folder ends clean; the report and status.json are on the run branch, every plan listed; calls.csv holds every
 * model call (at most 3 for a plan that merged) and every gate command; `orch-state.mjs watch` reads FINISHED; a relaunch
 * leaves the merged plans out (from git), builds only the parked plan and its dependent, and ends with every plan merged.
 * Exit 0 = every case passed, 1 = failures (one line per case).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeProject, toyPlan } from './test/lib/run-plans-fixture.mjs'

const kit = resolve(fileURLToPath(new URL('..', import.meta.url)))
const argv = process.argv.slice(2)
const keep = argv.includes('--keep')
const depsFrom = argv.includes('--deps-from') ? argv[argv.indexOf('--deps-from') + 1] : null
const results = []
let failed = 0
const check = (name, ok, evidence = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${String(evidence).slice(0, 400)}`}`)
  if (!ok) failed++
  return ok
}
const tail = (s) => String(s).trim().split(/\r?\n/).slice(-4).join(' | ')

let p = null
try {
  p = makeProject({ kit, name: 'orch-app', depsFrom })
  check('install the kit into a scratch project with a bare origin', true)
  const plan = (nnn, title, deps = 'none') => ({ text: toyPlan(nnn, { deps, title }), title })
  p.addPlans({
    201: plan(201, 'Diamond A'),
    202: plan(202, 'Diamond B', '201'),
    203: plan(203, 'Diamond C', '201'),
    204: plan(204, 'Diamond D', '202, 203'),
    205: plan(205, 'Flaky E'),
    206: plan(206, 'After E', '205'),
    207: plan(207, 'Stray F'),
  })
  // Plan titles become the branch names: feat/201-diamond-a, …
  for (const [n, t] of [[201, 'diamond-a'], [202, 'diamond-b'], [203, 'diamond-c'], [204, 'diamond-d'], [205, 'flaky-e'], [206, 'after-e'], [207, 'stray-f']]) {
    const f = join(p.proj, 'plans', `${n}-${t}.plan.md`)
    if (!existsSync(f)) check(`toy plan ${n} saved`, false, f)
  }
  const mainSha = p.git(p.proj, 'rev-parse', 'origin/main').out.trim()
  const all = '201,202,203,204,205,206,207'

  // ---- a dirty main folder: refused at the preflight, nothing created ----
  const pkg = join(p.proj, 'package.json')
  const pkgText = readFileSync(pkg, 'utf8')
  writeFileSync(pkg, `${pkgText}\n`)
  const dirty = p.runPlans(['--run', 'diamond', '--plans', all])
  writeFileSync(pkg, pkgText)
  check('a dirty main folder refuses the run before the start (exit 1, preflight FAIL main folder, no model call, no run branch)',
    dirty.status === 1 && /PREFLIGHT FAIL +main folder/.test(dirty.out) && dirty.calls.length === 0 && p.git(p.proj, 'ls-remote', 'origin', 'orch/diamond').out.trim() === '', tail(dirty.out))

  // ---- the run ----
  const scenario = {
    202: { builder: [{ gate: 'fail', text: 'diamond B broke' }, { gate: 'pass' }] },
    205: { builder: [{ gate: 'fail', text: 'E keeps failing' }, { gate: 'fail', text: 'E keeps failing' }] },
    207: { builder: [{ extraFile: 'stray.txt' }, { extraFile: 'stray.txt' }] },
  }
  const r = p.runPlans(['--run', 'diamond', '--plans', all], { scenario })
  const j = r.json ?? {}
  check('the run ends with exit 2 (some plans parked) and a RUN_PLANS_JSON line', r.status === 2 && r.json !== null, tail(r.out))
  check('merged: the diamond 201, 202, 203, 204', JSON.stringify([...(j.merged ?? [])].sort()) === JSON.stringify(['201', '202', '203', '204']), JSON.stringify(j))
  check('parked: 205 (gate failed twice) and 207 (outside its scope); skipped: 206 (depends on 205)',
    JSON.stringify([...(j.parked ?? [])].sort()) === JSON.stringify(['205', '207']) && JSON.stringify(j.skipped) === JSON.stringify(['206']), JSON.stringify(j))
  const subjects = p.git(p.proj, 'log', '--first-parent', '--reverse', '--format=%H %P|%s', 'origin/orch/diamond').out.split('\n').filter((l) => / \(plan \d+\)$/.test(l))
  const order = subjects.map((l) => /\(plan (\d+)\)$/.exec(l)[1])
  check('merges in wave order: 201 first, 204 last', order[0] === '201' && order.at(-1) === '204' && order.length === 4, order.join(', '))
  check('anchored merge subjects', subjects.every((l) => /\|Merge feat\/\d+-[a-z0-9-]+ into orch\/diamond \(plan \d+\)$/.test(l)), subjects.join('\n'))
  const st = p.status('diamond')
  check('every merge commit\'s second parent is the plan\'s checked head', subjects.every((l) => {
    const nnn = /\(plan (\d+)\)$/.exec(l)[1]
    return l.split('|')[0].split(' ')[2] === st.plans[nnn]?.checkedHead
  }), JSON.stringify(Object.fromEntries(Object.values(st.plans).map((x) => [x.nnn, x.checkedHead]))))
  const stages = (n) => (st.plans[n]?.calls ?? []).map((c) => c.stage).join(',')
  check('a gate failure is fixed in one round: 202 builder, builder fix, reviewer', stages('202') === 'builder,builder fix,reviewer', stages('202'))
  check('205 parked by plan-park: same reason twice, the park recorded, its folder removed',
    /^same reason twice: gate: npm run test/.test(st.plans['205']?.reason ?? '') && Boolean(st.plans['205']?.park?.at) && !existsSync(join(p.root, 'orch-app-orch-diamond-205')), JSON.stringify(st.plans['205']))
  check('206 skipped with the reason "depends on parked 205"', st.plans['206']?.state === 'skipped' && st.plans['206']?.reason === 'depends on parked 205', JSON.stringify(st.plans['206']))
  check('207 wrote stray.txt outside its scope: the gate\'s scope check (the kit\'s copy) caught it',
    /^same reason twice: gate: scope-check \(kit copy\)/.test(st.plans['207']?.reason ?? ''), st.plans['207']?.reason)
  check('origin/main never moved', p.git(p.proj, 'rev-parse', 'origin/main').out.trim() === mainSha)
  check('the main folder is clean', p.git(p.proj, 'status', '--porcelain').out.trim() === '', p.git(p.proj, 'status', '--porcelain').out)
  const mf = join(p.root, 'orch-app-orch-merge-diamond')
  check('the merge folder ends clean', existsSync(mf) && p.git(mf, 'status', '--porcelain').out.trim() === '', p.git(mf, 'status', '--porcelain').out)
  const onBranch = p.git(p.proj, 'show', 'origin/orch/diamond:docs/orchestrator/runs/diamond/status.json')
  let branchStatus = null
  try { branchStatus = JSON.parse(onBranch.out) } catch { /* checked below */ }
  check('status.json on the run branch lists every plan with its state', branchStatus && ['201', '202', '203', '204', '205', '206', '207'].every((n) => branchStatus.plans[n]?.state), onBranch.out.slice(0, 200))
  check('the report is on the run branch and in the main folder', p.git(p.proj, 'show', 'origin/orch/diamond:docs/orchestrator/runs/diamond/report.md').status === 0 && existsSync(join(p.proj, '.claude', 'orchestrator-runs', 'diamond.md')))
  const csvFile = join(p.proj, '.claude', 'orchestrator-runs', 'diamond', 'calls.csv')
  const rows = existsSync(csvFile) ? readFileSync(csvFile, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')) : []
  const modelRows = rows.filter((x) => ['builder', 'builder fix', 'judgment builder', 'reviewer'].includes(x[1]))
  check('calls.csv: one row per model call (the fake logged the same number)', modelRows.length === r.calls.length && r.calls.length > 0, `${modelRows.length} rows, ${r.calls.length} calls`)
  check('calls.csv: at most 3 model calls for every merged plan', ['201', '202', '203', '204'].every((n) => modelRows.filter((x) => x[0] === n).length <= 3), JSON.stringify(modelRows.map((x) => x.slice(0, 2))))
  check('calls.csv: every gate command has a row', rows.some((x) => x[0] === '201' && x[1] === 'gate: npm run test') && rows.some((x) => x[0] === 'final' && /^final gate: /.test(x[1])))
  const w = p.state('watch', '--run=diamond')
  check('orch-state watch reads the run the script wrote: FINISHED', w.json?.line === 'FINISHED', w.out)

  // ---- a relaunch: merged plans come from git and are never rebuilt ----
  // (207 stays out: its branch on origin still carries stray.txt — the Human fixes that one by hand.)
  const again = p.runPlans(['--run', 'diamond', '--plans', '201,202,203,204,205,206'], { scenario: { 205: { builder: [{}, {}, { gate: 'pass' }] } } })
  const rebuilt = again.calls.filter((c) => ['201', '202', '203', '204'].includes(c.plan))
  check('the relaunch leaves the merged plans out and builds nothing of them', /DONE already \(left out\): 201, 202, 203, 204/.test(again.out) && rebuilt.length === 0, tail(again.out))
  check('the relaunch merges 205 and its dependent 206 and exits 0', again.status === 0 && JSON.stringify([...(again.json?.merged ?? [])].sort()) === JSON.stringify(['205', '206']), tail(again.out))
} catch (e) {
  check('the end-to-end run completed without an error', false, e?.stack ?? e)
} finally {
  if (p && !keep) p.cleanup()
  else if (p) results.push(`kept ${p.root}`)
}

for (const line of results) console.log(line)
const cases = results.filter((l) => /^(PASS|FAIL)/.test(l)).length
console.log(failed ? `ORCHESTRATOR_E2E: FAIL — ${failed} of ${cases} cases failed` : `ORCHESTRATOR_E2E: ok — ${cases} cases passed`)
process.exit(failed ? 1 : 0)
