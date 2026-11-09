// Shared parts of the validation cases (tools/validate-orchestrator.mjs): the sandbox, the dummy plan text, waiting on
// the run's own files, and reading evidence from them. A verdict is decided only from these files, never by a model.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { makeProject } from '../../test/lib/run-plans-fixture.mjs'

/** A dummy plan: a real task (a real builder can do it), its scope, and one exact [auto] check of the change. */
export function planText({ nnn, title, task, scope, check, subtasks = null, deps = 'none' }) {
  return [
    `# Plan ${nnn} — ${title}`,
    '',
    'Status: draft',
    `Depends-on: ${deps}`,
    '',
    '## Goals & Success Criteria',
    task,
    '',
    `- [auto] \`${check}\` exits 0`,
    '',
    '## Read-Write Scope',
    '',
    '```scope',
    ...scope,
    '```',
    '',
    '## Architecture Impact',
    '- none',
    '',
    '## Atomic Sub-tasks',
    '',
    ...(subtasks ?? [`- [ ] T1: ${task.replace(/\s+/g, ' ').slice(0, 200)}`]),
    '',
    '## Critical Questions',
    '- Q: anything open? A: no',
    '',
    '## Execution Notes',
    '',
  ].join('\n')
}
export const planFile = (nnn, title) => `plans/${nnn}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.plan.md`

/** A check script that exits 0 only when every [file, exact text] pair holds. */
export const exactCheck = (pairs) => [
  "import { readFileSync, existsSync } from 'node:fs'",
  `const want = ${JSON.stringify(pairs)}`,
  'let bad = 0',
  "for (const [f, text] of want) { const got = existsSync(f) ? readFileSync(f, 'utf8').replace(/\\r\\n/g, '\\n') : null; if (got !== text) { bad++; console.log(`CHECK: ${f} is ${JSON.stringify(got)}, want ${JSON.stringify(text)}`) } }",
  'process.exit(bad ? 1 : 0)',
  '',
].join('\n')

/** A fresh sandbox for one case: fake builder or real `claude` (Sonnet on both tiers), removed by the runner. */
export function sandbox(ctx, opts = {}) {
  const real = ctx.mode === 'real'
  const p = makeProject({
    kit: ctx.kit, kitRef: ctx.kitRef, name: opts.name ?? 'val-app', ...opts,
    env: { npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', ...(real ? { RUN_PLANS_CLAUDE: null } : {}), ...(opts.env ?? {}) },
    models: real ? { build: 'sonnet', judgment: 'sonnet' } : { judgment: 'opus' },
  })
  ctx.sandbox(p)
  return p
}

/** run-plans.mjs in the background, its process registered so the runner can stop it. */
export function start(ctx, p, run, plans, scenario = {}) {
  const s = p.startPlans(['--run', run, '--plans', plans.join(',')], { scenario })
  ctx.track(s.child.pid)
  let out = ''
  s.child.stdout.on('data', (d) => { out += d })
  s.child.stderr.on('data', (d) => { out += d })
  s.output = () => out
  s.ended = () => s.child.exitCode !== null || s.child.signalCode !== null
  return s
}

/** The run's last output lines and exit code, for a case's evidence. */
export function runTail(r, n = 8) {
  const all = r.output().trim().split(/\r?\n/)
  const lines = all.filter((l) => l && !l.startsWith('RUN_PLANS_JSON'))
  const out = [`run-plans.mjs exit ${r.child.exitCode ?? r.child.signalCode ?? 'running'}; its last lines:`, ...lines.slice(-n).map((l) => `  ${l.slice(0, 300)}`)]
  // A refusal names each plan's problems only in its RUN_PLANS_JSON line.
  const json = all.reverse().find((l) => l.startsWith('RUN_PLANS_JSON '))
  try {
    const j = json ? JSON.parse(json.slice('RUN_PLANS_JSON '.length)) : null
    if (j?.refused) for (const [nnn, problems] of Object.entries(j.plans ?? {})) out.push(`  refused plan ${nnn}: ${[].concat(problems).join('; ').slice(0, 400)}`)
  } catch { /* not JSON */ }
  return out
}

export const runDir = (p, run) => join(p.proj, '.claude', 'orchestrator-runs', run)
export function statusOf(p, run) {
  try {
    return JSON.parse(readFileSync(join(runDir(p, run), 'status.json'), 'utf8'))
  } catch {
    return null
  }
}
export const planState = (st, nnn) => st?.plans?.[nnn]?.state ?? null
export const notesOf = (st, nnn = null) => (st?.notes ?? []).filter((n) => nnn === null || String(n.plan ?? '') === String(nnn)).map((n) => String(n.text ?? ''))

/** Polls `pred()` every `everyMs` until it returns a truthy value; throws on the case's time limit or the token cap. */
export async function waitFor(ctx, pred, { what, everyMs = 500 } = {}) {
  for (;;) {
    if (ctx.signal.aborted) throw new Error(`stopped while waiting for ${what}`)
    const over = ctx.overCap()
    if (over) throw new Error(over)
    const v = pred()
    if (v) return v
    await new Promise((r) => setTimeout(r, everyMs))
  }
}

/** Kills a process and its children (Windows: taskkill /T /F; elsewhere its process group, then the process). */
export function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { encoding: 'utf8' })
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch { /* gone */ }
  }
}
export function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

/** The input tokens calls.csv of one run holds (real mode's token cap; 0 when there is no file). */
export function inputTokens(p, run) {
  const f = join(runDir(p, run), 'calls.csv')
  if (!existsSync(f)) return 0
  const [head, ...rows] = readFileSync(f, 'utf8').trim().split('\n')
  const i = head.split(',').indexOf('input_tokens')
  return i < 0 ? 0 : rows.reduce((a, r) => a + (Number(r.split(',')[i]) || 0), 0)
}

/** The run branch's merge subjects (`git log --first-parent` of origin/orch/<run>). */
export function mergeLog(p, run) {
  p.git(p.proj, 'fetch', '-q', 'origin')
  return p.git(p.proj, 'log', '--first-parent', '--format=%h %s', `origin/orch/${run}`).out.trim().split('\n').filter((l) => /\(plan \d+\)$/.test(l))
}

/** The evidence a finished run leaves, quoted: each plan's state and reason, the stops, the notes. */
export function runEvidence(p, run, plans) {
  const st = statusOf(p, run)
  if (!st) return [`status.json: none in ${runDir(p, run)}`]
  const lines = [`status.json phase: ${st.phase}${st.stopReason ? ` · stopReason: ${st.stopReason}` : ''}`]
  for (const n of plans) lines.push(`status.json plans.${n}: ${planState(st, n)}${st.plans?.[n]?.reason ? ` — ${String(st.plans[n].reason).slice(0, 200)}` : ''}`)
  for (const s of st.stops ?? []) lines.push(`status.json stops[]: ${s.reason}`)
  for (const n of plans) for (const t of notesOf(st, n)) lines.push(`run note (plan ${n}): ${t.slice(0, 240)}`)
  for (const l of mergeLog(p, run)) lines.push(`git log origin/orch/${run}: ${l}`)
  const csv = join(runDir(p, run), 'calls.csv')
  if (existsSync(csv)) lines.push(`calls.csv: ${readFileSync(csv, 'utf8').trim().split('\n').length - 1} rows, ${inputTokens(p, run)} input tokens`)
  return lines
}

/** The files a failing case's log folder keeps. */
export function runFiles(p, run) {
  const dir = runDir(p, run)
  const out = [join(p.proj, '.claude', 'orchestrator-runs', `${run}.console.log`), join(p.proj, '.claude', 'orchestrator-runs', `${run}.md`)]
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (/\.(json|csv|md)$/.test(f)) out.push(join(dir, f))
  return out.filter((f) => existsSync(f))
}

/** A plain toy task for one plan: the file src/<NNN>.txt holds exactly `hello <NNN>`. */
export function toyTask(nnn, title, extra = {}) {
  const want = `hello ${nnn}\n`
  return {
    title,
    text: planText({
      nnn, title,
      task: `Create the file \`src/${nnn}.txt\` whose whole content is the single line \`hello ${nnn}\` (with a newline at the end). Change no other file.`,
      scope: [`src/${nnn}.txt`, `gate/${nnn}.txt`],
      check: `node scripts/check-${nnn}.mjs`,
      ...extra,
    }),
    check: [`scripts/check-${nnn}.mjs`, exactCheck([[`src/${nnn}.txt`, want]])],
    fakeEdit: { [`src/${nnn}.txt`]: want },
  }
}
