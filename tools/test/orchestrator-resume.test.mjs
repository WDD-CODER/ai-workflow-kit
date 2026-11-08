// Plan 102: a relaunch continues a plan from its saved work when it stopped for a reason that was not its own code
// (a death, a time limit, the environment, a rate limit), and starts it over when it failed on its own code.
// A scratch project with the installed scripts and the fake claude (tools/test/lib/run-plans-fixture.mjs).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeProject, toyPlan } from './lib/run-plans-fixture.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const { resumeKind } = await import(pathToFileURL(join(kit, 'scripts', 'run-plans.mjs')).href)

let p
before(() => {
  p = makeProject({ kit })
  p.addPlans({ 611: toyPlan(611), 612: toyPlan(612), 613: toyPlan(613) })
})
after(() => p?.cleanup())

const sh = (cwd, ...a) => {
  const r = p.git(cwd, ...a)
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.out}`)
  return r.out.trim()
}
const builders = (calls, nnn) => calls.filter((c) => c.role === 'builder' && c.plan === nnn)
const show = (ref, path) => sh(p.proj, 'show', `${ref}:${path}`)

test('resumeKind: the stops that were not the plan\'s own code resume; its own code does not', () => {
  const parked = (reason) => ({ state: 'parked', reason })
  for (const r of ['stopped: rate-limit: hit', 'environment: disk', 'builder stopped: no file change for 20 min — the work is kept on park/x-1', 'the process died', 'timed out after 60 min']) {
    assert.equal(resumeKind({ prev: parked(r), hasPark: true, hasBuilt: false }), 'park', r)
  }
  for (const r of ['same reason twice: gate: npm run test', 'gate: x (fix rounds used: 2 of 2) — needs the Human', 'replan needed: the scope']) {
    assert.equal(resumeKind({ prev: parked(r), hasPark: true, hasBuilt: true }), null, r)
  }
  assert.equal(resumeKind({ prev: parked('environment: disk'), hasPark: false, hasBuilt: false }), null, 'nothing saved')
  assert.equal(resumeKind({ prev: { state: 'checking' }, hasPark: false, hasBuilt: true }), 'built')
  assert.equal(resumeKind({ prev: { state: 'building' }, hasPark: false, hasBuilt: true }), null, 'a builder that died mid-work is reused as today')
  assert.equal(resumeKind({ prev: { state: 'merged' }, hasPark: true, hasBuilt: true }), null)
  assert.equal(resumeKind({ prev: null, hasPark: true, hasBuilt: true }), null)
})

test('(d) a relaunch starts a plan that stopped for the rate limit from its park branch: round, tier and the hand-off continue', () => {
  const first = p.runPlans(['--run', 'rs-d', '--plans', '611'], { scenario: { 611: { builder: [{ rateLimit: true }, { rateLimit: true }] } } })
  assert.equal(first.status, 2, first.out)
  assert.match(p.status('rs-d').plans['611'].reason, /rate-limit/)
  // the park teardown saves the folder's work on park/<run>-<NNN> and renames the plan branch (the park step's own commands)
  const wt = p.state('worktree', '--run=rs-d', '--plan=611').json
  assert.equal(wt.ok, true, JSON.stringify(wt))
  mkdirSync(join(wt.path, 'src'), { recursive: true })
  writeFileSync(join(wt.path, 'src', '611.txt'), 'saved by the first attempt\n')
  const parked = p.state('park', '--run=rs-d', '--plan=611')
  assert.equal(parked.json.ok, true, parked.out)
  assert.ok(sh(p.proj, 'ls-remote', 'origin', 'refs/heads/park/rs-d-611'), 'the park branch is on origin')
  const second = p.runPlans(['--run', 'rs-d', '--plans', '611'])
  assert.equal(second.status, 0, second.out)
  const b = builders(second.calls, '611')
  assert.equal(b.length, 1)
  assert.equal(b[0].handoff, true, 'the builder\'s prompt carries the hand-off')
  assert.match(show('origin/orch/rs-d', 'src/611.txt'), /saved by the first attempt\nround \d+ /)
  const st = p.status('rs-d')
  assert.equal(st.plans['611'].state, 'merged')
  assert.ok(st.notes.some((n) => n.plan === '611' && /resumed from park\/rs-d-611/.test(n.text)), JSON.stringify(st.notes))
})

test('(e) a plan parked for its own code (same reason twice) is not resumed: it is rebuilt from the run branch, as today', () => {
  const first = p.runPlans(['--run', 'rs-e', '--plans', '612'], { scenario: { 612: { builder: [{ gate: 'fail' }, { gate: 'fail' }] } } })
  assert.equal(first.status, 2, first.out)
  assert.match(p.status('rs-e').plans['612'].reason, /^same reason twice/)
  sh(p.proj, 'fetch', '-q', 'origin')
  assert.ok(sh(p.proj, 'ls-remote', 'origin', 'refs/heads/park/rs-e-612'), 'its work is on the park branch')
  const second = p.runPlans(['--run', 'rs-e', '--plans', '612'])
  assert.equal(second.status, 0, second.out)
  const b = builders(second.calls, '612')
  assert.equal(b.length, 1)
  assert.equal(b[0].handoff, false)
  assert.equal(show('origin/orch/rs-e', 'src/612.txt').split('\n').length, 1, 'built once from the run branch, not on top of the parked attempt')
  assert.ok(!p.status('rs-e').notes.some((n) => /resumed from/.test(n.text)))
})

test('(f) a relaunch of a run that died after the build reuses feat/<NNN>: the next step is the gate, not a builder from round 0', () => {
  const first = p.runPlans(['--run', 'rs-f', '--plans', '613'], { scenario: { 613: { reviewer: [{ rateLimit: true }, { rateLimit: true }] } } })
  assert.equal(first.status, 2, first.out)
  assert.equal(builders(first.calls, '613').length, 1)
  const second = p.runPlans(['--run', 'rs-f', '--plans', '613'])
  assert.equal(second.status, 0, second.out)
  assert.equal(builders(second.calls, '613').length, 0, `no new builder: ${second.out}\n${JSON.stringify(p.status('rs-f').plans['613'])}`)
  assert.equal(second.calls.filter((c) => c.role === 'reviewer' && c.plan === '613').length, 1)
  const st = p.status('rs-f')
  assert.equal(st.plans['613'].state, 'merged')
  assert.ok(st.notes.some((n) => n.plan === '613' && /resumed from the built feat\/613/.test(n.text)), JSON.stringify(st.notes))
  assert.equal(show('origin/orch/rs-f', 'src/613.txt').split('\n').length, 1, 'the first build, once')
})
