// Plan 100: scripts/run-supervisor.mjs (installed) — a run survives its session. A fake run-plans child writes
// status.json the way `orch-state.mjs init` / `stop` / `finish` do; the supervisor's sleep, clock and free memory are
// injected, so the waits take no time. ORCH_ROOT = an installed project (default: this repo, the kit installed into itself).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { pathToFileURL, fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit
const sup = await import(pathToFileURL(join(root, 'scripts', 'run-supervisor.mjs')).href)

// The fake run-plans.mjs: launch n plays FAKE_SCENARIO's n-th word (die | finish | stop | rate | rate-reset | refuse).
const FAKE = `
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs'
import { join } from 'path'
const argv = process.argv.slice(2)
const run = argv[argv.indexOf('--run') + 1]
const dir = join(process.cwd(), '.claude', 'orchestrator-runs', run)
const p = join(dir, 'status.json')
mkdirSync(dir, { recursive: true })
appendFileSync(join(process.cwd(), 'argv.log'), JSON.stringify(argv) + '\\n')
let s = null
try { s = JSON.parse(readFileSync(p, 'utf8')) } catch {}
const plays = String(process.env.FAKE_SCENARIO).split(',')
const n = (s?.attempts ?? 0) + 1
const play = plays[Math.min(n, plays.length) - 1]
if (play === 'refuse') { console.log('RUN_PLANS_JSON {"ok":false,"refused":"lint"}'); process.exit(1) }
s = { run, plans: { '001': { nnn: '001', state: 'merged' } }, notes: [], ...(s ?? {}), attempts: n, phase: 'running', updatedAt: new Date().toISOString() }
delete s.stopReason
writeFileSync(p, JSON.stringify(s))
console.log('RUN_PLANS: fake launch ' + n + ' log=' + (process.env.RUN_SUPERVISOR_LOG ?? ''))
if (n > 1) console.log('RUN_PLANS: DONE already (left out): 001')
const hold = Number(process.env.FAKE_HOLD_MS ?? 0)
setTimeout(() => {
  if (play === 'die') process.exit(7)
  const stop = (reason) => { s.phase = 'stopped'; s.stopReason = reason; s.stops = [...(s.stops ?? []), { at: new Date().toISOString(), reason, attempt: n }] }
  if (play === 'finish') s.phase = 'finished'
  if (play === 'stop') stop('wave 1 parked 001')
  if (play === 'rate') stop('rate-limit: 429 Too Many Requests')
  if (play === 'rate-reset') stop('rate-limit: Claude AI usage limit reached|' + process.env.FAKE_RESET)
  writeFileSync(p, JSON.stringify(s))
  console.log('RUN_PLANS_JSON {"ok":true}')
  process.exit(play === 'finish' ? 0 : 2)
}, hold)
`

function project() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'run-sup-')))
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  writeFileSync(join(dir, 'fake-run-plans.mjs'), FAKE)
  return {
    dir,
    fake: join(dir, 'fake-run-plans.mjs'),
    status: (run = 'r1') => JSON.parse(readFileSync(join(dir, '.claude', 'orchestrator-runs', run, 'status.json'), 'utf8')),
    argvs: () => readFileSync(join(dir, 'argv.log'), 'utf8').trim().split('\n'),
    log: (run = 'r1') => readFileSync(join(dir, '.claude', 'orchestrator-runs', `${run}.console.log`), 'utf8'),
    done: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
  }
}

async function superviseFake(p, scenario, opts = {}) {
  process.env.FAKE_SCENARIO = scenario
  const sleeps = []
  const lines = []
  const r = await sup.supervise({
    root: p.dir, runArgs: ['--run', 'r1', '--plans', '001'], runPlans: p.fake, sweep: false,
    freeMem: () => 16, sleep: async (ms) => { sleeps.push(ms) }, log: (l) => lines.push(l),
    lim: { maxRelaunches: 3, minFreeMemGb: 4 }, rateLimitWaitMin: 30, ...opts,
  })
  return { r, sleeps, lines }
}

test('(a) a child that exits while status.json says running is a stop "process died (exit 7)", relaunched with the same command and run name', async () => {
  const p = project()
  try {
    const { r } = await superviseFake(p, 'die,finish')
    assert.equal(r.outcome, 'done')
    assert.equal(r.launches, 2)
    assert.equal(r.relaunches, 1)
    const s = p.status()
    assert.equal(s.phase, 'finished')
    assert.deepEqual(s.stops.map((x) => x.reason), ['process died (exit 7)'])
    assert.equal(s.stops[0].attempt, 1)
    const argvs = p.argvs()
    assert.equal(argvs.length, 2)
    assert.equal(argvs[0], argvs[1], 'the same command and run name')
    assert.match(p.log(), /DONE already \(left out\): 001/)
    // One writer of the console log: run-plans is told the supervisor writes it.
    assert.match(p.log(), /fake launch 1 log=1/)
    const sj = JSON.parse(readFileSync(join(p.dir, '.claude', 'orchestrator-runs', 'r1', 'supervisor.json'), 'utf8'))
    assert.equal(sj.launches.length, 2)
    assert.equal(sj.launches[0].kind, 'died')
    assert.equal(sj.phase, 'done')
  } finally {
    p.done()
  }
})

test('(b) at most MAX_RELAUNCHES (3) relaunches after a death; the next death stops the run "supervisor gave up after 3 relaunches: <cause>"', async () => {
  assert.equal(sup.MAX_RELAUNCHES, 3)
  const p = project()
  try {
    const { r } = await superviseFake(p, 'die,die,die,die,finish')
    assert.equal(r.outcome, 'gave-up')
    assert.equal(r.launches, 4)
    const s = p.status()
    assert.equal(s.phase, 'stopped')
    assert.equal(s.stopReason, 'supervisor gave up after 3 relaunches: process died (exit 7)')
    assert.equal(s.stops.length, 4, 'three deaths and the give-up, none written over')
  } finally {
    p.done()
  }
})

test('(c) free memory below MIN_FREE_MEM_GB (4) waits, re-checked every 2 minutes, up to 60 minutes, then "low memory: <n> GB free"', async () => {
  assert.equal(sup.MIN_FREE_MEM_GB, 4)
  const p = project()
  try {
    const { r, sleeps } = await superviseFake(p, 'die,finish', { freeMem: () => 1.5 })
    assert.equal(r.outcome, 'gave-up')
    assert.equal(r.launches, 1, 'never relaunched')
    assert.equal(sleeps.length, 30)
    assert.ok(sleeps.every((ms) => ms === 2 * 60_000))
    assert.equal(p.status().stopReason, 'low memory: 1.5 GB free')
    // Memory that comes back within the hour: relaunched after the wait.
    rmSync(join(p.dir, '.claude'), { recursive: true, force: true })
    let calls = 0
    const back = await superviseFake(p, 'die,finish', { freeMem: () => (++calls > 2 ? 8 : 2) })
    assert.equal(back.r.outcome, 'done')
    assert.equal(back.r.launches, 2)
    assert.equal(back.sleeps.length, 2)
  } finally {
    p.done()
  }
})

test('(d) a rate-limit stop is relaunched after the reset the error names, else after rateLimitWaitMin; not counted against the cap; waits capped at 6 hours', async () => {
  const T = Date.parse('2026-11-08T10:00:00Z')
  const p = project()
  try {
    process.env.FAKE_RESET = String(T / 1000 + 3600)
    const reset = await superviseFake(p, 'rate-reset,finish', { now: () => T })
    assert.equal(reset.r.outcome, 'done')
    assert.deepEqual(reset.sleeps, [61 * 60_000], 'the named reset plus one minute')
    rmSync(join(p.dir, '.claude'), { recursive: true, force: true })
    const plain = await superviseFake(p, 'rate,finish', { now: () => T })
    assert.deepEqual(plain.sleeps, [30 * 60_000], 'rateLimitWaitMin when no reset is named')
    // Three deaths and three rate limits: the rate-limit relaunches do not count against the 3.
    rmSync(join(p.dir, '.claude'), { recursive: true, force: true })
    const mixed = await superviseFake(p, 'rate,die,rate,die,rate,die,finish', { now: () => T })
    assert.equal(mixed.r.outcome, 'done')
    assert.equal(mixed.r.launches, 7)
    assert.equal(mixed.r.relaunches, 3)
    // 120-minute waits: three fit in 6 hours, the fourth gives up.
    rmSync(join(p.dir, '.claude'), { recursive: true, force: true })
    const cap = await superviseFake(p, 'rate', { now: () => T, rateLimitWaitMin: 120 })
    assert.equal(cap.r.outcome, 'gave-up')
    assert.equal(cap.r.launches, 4)
    assert.equal(cap.r.rateWaitMin, 360)
    assert.match(p.status().stopReason, /^supervisor gave up: the rate-limit waits would pass 6 hours/)
  } finally {
    p.done()
  }
})

test('(e) finished, stopped with another reason, or refused before the start: never relaunched', async () => {
  for (const [scenario, kind] of [['finish', 'finished'], ['stop', 'stopped'], ['refuse', 'refused']]) {
    const p = project()
    try {
      const { r, sleeps } = await superviseFake(p, `${scenario},finish`)
      assert.equal(r.outcome, 'done', scenario)
      assert.equal(r.launches, 1, scenario)
      assert.equal(sleeps.length, 0)
      assert.match(r.reason, new RegExp(`^${kind}:`))
    } finally {
      p.done()
    }
  }
})

test('the reset time of a rate-limit message: epoch seconds, ISO, a clock time; none or a past one is null', () => {
  const now = Date.parse('2026-11-08T10:00:00Z')
  assert.equal(sup.rateLimitResetMs(`usage limit reached|${now / 1000 + 600}`, now), now + 600_000)
  assert.equal(sup.rateLimitResetMs('limit; resets at 2026-11-08T12:30:00Z', now), Date.parse('2026-11-08T12:30:00Z'))
  const clock = sup.rateLimitResetMs('5-hour limit reached ∙ resets 3pm', now)
  assert.ok(clock > now && clock - now <= 24 * 3600_000 && new Date(clock).getHours() === 15)
  assert.equal(sup.rateLimitResetMs('429 Too Many Requests', now), null)
  assert.equal(sup.rateLimitResetMs(`limit|${now / 1000 - 60}`, now), null)
})

test('the limits are fixed in code with test-only overrides, and the scaffold has no new orchestrator key', () => {
  const keep = { ...process.env }
  try {
    delete process.env.RUN_SUPERVISOR_MAX_RELAUNCHES
    delete process.env.RUN_SUPERVISOR_MIN_FREE_MEM_GB
    assert.deepEqual(sup.limits(), { maxRelaunches: 3, minFreeMemGb: 4 })
    process.env.RUN_SUPERVISOR_MAX_RELAUNCHES = '1'
    process.env.RUN_SUPERVISOR_MIN_FREE_MEM_GB = '0'
    assert.deepEqual(sup.limits(), { maxRelaunches: 1, minFreeMemGb: 0 })
  } finally {
    process.env.RUN_SUPERVISOR_MAX_RELAUNCHES = keep.RUN_SUPERVISOR_MAX_RELAUNCHES ?? ''
    process.env.RUN_SUPERVISOR_MIN_FREE_MEM_GB = keep.RUN_SUPERVISOR_MIN_FREE_MEM_GB ?? ''
  }
  const src = readFileSync(join(root, 'scripts', 'run-supervisor.mjs'), 'utf8')
  assert.match(src, /^export const MAX_RELAUNCHES = 3$/m)
  assert.match(src, /^export const MIN_FREE_MEM_GB = 4$/m)
  const orch = JSON.parse(readFileSync(join(kit, 'kit.config.json'), 'utf8')).orchestrator ?? {}
  assert.equal('maxRelaunches' in orch, false)
  assert.equal('minFreeMemGb' in orch, false)
})

test('the supervisor starts detached (own process group, windowsHide, stdio appended to <run>.console.log); the launcher exits while it runs on', async () => {
  assert.deepEqual(sup.detachedOptions(9, { cwd: 'x', env: { A: '1' } }), { cwd: 'x', env: { A: '1' }, detached: true, windowsHide: true, stdio: ['ignore', 9, 9] })
  const p = project()
  try {
    mkdirSync(join(p.dir, '.claude', 'orchestrator-runs'), { recursive: true })
    writeFileSync(join(p.dir, '.claude', 'orchestrator-runs', 'r9.console.log'), 'EARLIER LINE\n')
    const env = { ...process.env, RUN_SUPERVISOR_RUN_PLANS: p.fake, FAKE_SCENARIO: 'finish', FAKE_HOLD_MS: '2500' }
    const l = spawnSync(process.execPath, [join(p.dir, 'scripts', 'run-supervisor.mjs'), '--run', 'r9', '--plans', '001'], { cwd: p.dir, env, encoding: 'utf8', timeout: 30_000 })
    assert.equal(l.status, 0, l.stdout + l.stderr)
    const m = /^SUPERVISOR_STARTED (\d+)$/m.exec(l.stdout)
    assert.ok(m, l.stdout)
    const pid = Number(m[1])
    // The launcher has exited; the supervisor is still alive (the fake holds 2.5 s).
    let alive = true
    try { process.kill(pid, 0) } catch { alive = false }
    assert.ok(alive, 'the supervisor outlives its launcher')
    const sj = join(p.dir, '.claude', 'orchestrator-runs', 'r9', 'supervisor.json')
    const until = Date.now() + 60_000
    while (Date.now() < until) {
      if (existsSync(sj) && JSON.parse(readFileSync(sj, 'utf8')).phase === 'done') break
      await new Promise((r) => setTimeout(r, 200))
    }
    assert.equal(JSON.parse(readFileSync(sj, 'utf8')).phase, 'done')
    assert.equal(JSON.parse(readFileSync(sj, 'utf8')).pid, pid)
    const log = p.log('r9')
    assert.match(log, /^EARLIER LINE$/m, 'appended, never truncated')
    assert.match(log, /SUPERVISOR: launch 1/)
    assert.match(log, /RUN_PLANS: fake launch 1/)
    assert.match(log, /SUPERVISOR: done — finished/)
    await new Promise((r) => setTimeout(r, 500))
  } finally {
    p.done()
  }
})

test('/orchestrate (installed) starts the supervisor line and returns; no run_in_background, no relaunch step of its own', () => {
  const cmd = readFileSync(join(root, '.claude', 'commands', 'orchestrate.md'), 'utf8')
  assert.ok(cmd.includes('node scripts/run-supervisor.mjs --run <run> --plans <NNN,NNN>'), 'the supervisor line')
  assert.ok(cmd.includes('SUPERVISOR_STARTED <pid>'))
  assert.ok(!cmd.includes('run_in_background'), 'no run_in_background step')
  assert.ok(!/orch-state\.mjs stop/.test(cmd), 'no stop-and-relaunch step')
  assert.ok(!/^##.*kill/im.test(cmd) && !/relaunch (the same line|it) once/i.test(cmd), 'no relaunch step')
  assert.ok(cmd.split('\n').length < 60)
})

test('the leftover sweep: a merged dead builder folder is removed; park/…, a hand-off folder, a live run, unmerged work and a non-worktree are kept, each with a line', () => {
  const repo = /^const REPO = '([^']*)'$/m.exec(readFileSync(join(root, 'scripts', 'run-supervisor.mjs'), 'utf8'))[1]
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'run-sup-sweep-')))
  const name = repo || 'proj'
  const main = join(parent, name)
  const g = (cwd, ...a) => {
    const r = spawnSync('git', a, { cwd, encoding: 'utf8' })
    assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  try {
    mkdirSync(main)
    g(main, 'init', '-q', '-b', 'main')
    g(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base')
    g(main, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    const f = (run, nnn) => join(parent, `${name}-orch-${run}-${nnn}`)
    g(main, 'worktree', 'add', '-q', '-b', 'feat/001-a', f('old', '001'))
    g(main, 'worktree', 'add', '-q', '-b', 'park/old-002', f('old', '002'))
    g(main, 'worktree', 'add', '-q', '-b', 'feat/003-c', f('old', '003'))
    g(f('old', '003'), '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'work')
    mkdirSync(f('old', '004'))
    g(main, 'worktree', 'add', '-q', '-b', 'feat/005-e', f('old', '005'))
    g(main, 'worktree', 'add', '-q', '-b', 'feat/006-f', f('live', '006'))
    mkdirSync(join(main, '.claude', 'sessions', 'orch-old'), { recursive: true })
    writeFileSync(join(main, '.claude', 'sessions', 'orch-old', 'handoff-005.md'), `# Hand-off 005\nFolder: ${f('old', '005').replace(/\\/g, '/')}\n`)
    mkdirSync(join(main, '.claude', 'orchestrator-runs', 'live'), { recursive: true })
    writeFileSync(join(main, '.claude', 'orchestrator-runs', 'live', 'status.json'), JSON.stringify({ phase: 'running', updatedAt: new Date().toISOString() }))
    const lines = sup.sweepLeftovers({ root: main })
    const line = (nnn) => lines.find((l) => l.includes(`-orch-`) && l.includes(`-${nnn}:`)) ?? `(no line for ${nnn}: ${lines.join(' | ')})`
    assert.match(line('001'), /: removed — feat\/001-a is merged into origin\/main/)
    assert.equal(existsSync(f('old', '001')), false)
    assert.match(line('002'), /kept — it is on park\/old-002/)
    assert.match(line('003'), /kept — feat\/003-c is not merged/)
    assert.match(line('004'), /kept — git does not list it as a worktree/)
    assert.match(line('005'), /kept — a parked plan's hand-off names it/)
    assert.match(line('006'), /kept — run live is live/)
    for (const n of ['002', '003', '004', '005', '006']) assert.ok(existsSync(f(n === '006' ? 'live' : 'old', n)), `${n} kept`)
  } finally {
    rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
