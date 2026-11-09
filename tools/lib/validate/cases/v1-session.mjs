// V1 — a run survives its session (plan 100). A stand-in "session" process starts the run with
// scripts/run-supervisor.mjs, as /orchestrate does, and is killed with its whole process tree while the plan builds.
// PASS only when the run still finishes on its own: status.json `finished`, the plan merged, the report written, and
// no `process died` stop.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { sandbox, statusOf, planState, waitFor, killTree, alive, runEvidence, runFiles, inputTokens, toyTask, runDir } from '../common.mjs'

const N = '901'
const RUN = 'val-v1'

// The session: starts the supervisor launcher, prints what it printed, then stays alive like a Claude Code session.
const SESSION = [
  "const { spawnSync } = require('node:child_process')",
  'const r = spawnSync(process.execPath, process.argv.slice(1), { encoding: "utf8" })',
  'process.stdout.write(String(r.stdout ?? "") + String(r.stderr ?? ""))',
  'process.stdout.write(`SESSION_LAUNCHER_EXIT ${r.status}\\n`)',
  'setInterval(() => {}, 60000)',
].join('\n')

export default {
  id: 'V1',
  title: 'a run survives its session',
  plan: '100',
  calls: [`plan ${N}: builder, reviewer`],
  async run(ctx) {
    const t = toyTask(N, 'Survives session')
    const p = sandbox(ctx, { files: { [t.check[0]]: t.check[1] } })
    ctx.keepFiles(() => runFiles(p, RUN))
    ctx.tokens(() => inputTokens(p, RUN))
    p.addPlans({ [N]: { title: t.title, text: t.text } })
    const sup = join(p.proj, 'scripts', 'run-supervisor.mjs')
    if (!existsSync(sup)) return { verdict: 'FAIL', why: 'no scripts/run-supervisor.mjs in the installed kit: nothing keeps a run alive after its session', evidence: [`ls scripts/run-supervisor.mjs: missing in ${p.proj}`] }
    // The builder works ~20 s, long enough to kill the session in the middle of it.
    writeFileSync(join(p.root, 'scenario.json'), JSON.stringify({ [N]: { builder: [{ sleepMs: 20_000, editFiles: t.fakeEdit }] } }))
    const session = spawn(process.execPath, ['-e', SESSION, sup, '--run', RUN, '--plans', N], { cwd: p.proj, env: p.env, detached: process.platform !== 'win32', windowsHide: true })
    ctx.track(session.pid)
    let said = ''
    session.stdout.on('data', (d) => { said += d })
    session.stderr.on('data', (d) => { said += d })
    const supPid = Number((await waitFor(ctx, () => /SUPERVISOR_STARTED (\d+)/.exec(said) ?? (/SESSION_LAUNCHER_EXIT/.test(said) ? ['', '0'] : null), { what: 'SUPERVISOR_STARTED' }))[1])
    const evidence = [`session pid ${session.pid}: ${said.trim().split('\n').join(' | ')}`]
    if (!supPid) return { verdict: 'FAIL', why: 'the supervisor launcher printed no SUPERVISOR_STARTED <pid>', evidence }
    ctx.track(supPid)
    const consoleLog = join(p.proj, '.claude', 'orchestrator-runs', `${RUN}.console.log`)
    const logTail = () => (existsSync(consoleLog) ? readFileSync(consoleLog, 'utf8').trim().split(/\r?\n/).slice(-8).map((l) => `console.log: ${l.slice(0, 300)}`) : ['console.log: none'])
    // The plan builds — or the supervisor already ended (a run that never started is a FAIL, not a wait to the limit).
    await waitFor(ctx, () => ['building', 'gate', 'checking', 'merging', 'merged'].includes(planState(statusOf(p, RUN), N)) || !alive(supPid), { what: `plan ${N} to build` })
    const at = planState(statusOf(p, RUN), N)
    if (!at) return { verdict: 'FAIL', why: 'the supervisor ended before the run started: the run never built the plan', evidence: [...evidence, ...logTail()] }
    killTree(session.pid)
    await waitFor(ctx, () => !alive(session.pid), { what: 'the session to die' })
    evidence.push(`killed the session's process tree (${process.platform === 'win32' ? `taskkill /T /F /PID ${session.pid}` : `kill -9 -${session.pid}`}) while plan ${N} was ${at}; session alive after: ${alive(session.pid)}`)
    const st = await waitFor(ctx, () => {
      const s = statusOf(p, RUN)
      return s && ['finished', 'stopped'].includes(s.phase) && !alive(supPid) ? s : null
    }, { what: 'the run to end', everyMs: 1000 })
    evidence.push(...runEvidence(p, RUN, [N]), ...logTail())
    const supFile = join(runDir(p, RUN), 'supervisor.json')
    if (existsSync(supFile)) {
      const s = JSON.parse(readFileSync(supFile, 'utf8'))
      evidence.push(`supervisor.json: pid ${s.pid}, ${s.launches?.length ?? 0} launch(es), ${s.relaunches ?? 0} relaunch(es), phase ${s.phase} — ${s.reason ?? ''}`)
    }
    const report = join(p.proj, '.claude', 'orchestrator-runs', `${RUN}.md`)
    evidence.push(`report ${report.replace(/\\/g, '/').split('/').slice(-3).join('/')}: ${existsSync(report) ? 'exists' : 'missing'}`)
    const died = (st.stops ?? []).filter((s) => /process died/.test(String(s.reason)))
    if (st.phase !== 'finished') return { verdict: 'FAIL', why: `the run ended ${st.phase}: ${st.stopReason ?? ''}`, evidence }
    if (planState(st, N) !== 'merged') return { verdict: 'FAIL', why: `plan ${N} is ${planState(st, N)}, not merged`, evidence }
    if (!existsSync(report)) return { verdict: 'FAIL', why: 'the run wrote no report', evidence }
    if (died.length) return { verdict: 'FAIL', why: `the run died with its session: ${died[0].reason}`, evidence }
    return { verdict: 'PASS', why: `the session was killed while plan ${N} was ${at}; the run finished on its own and merged it`, evidence }
  },
}
