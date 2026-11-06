/**
 * plan-park — the one teardown of a parked plan, safe to run any number of times:
 *
 *   node scripts/plan-park.mjs --plan <NNN> [--run <name>] (--reason "<why>" | --reason-b64 <base64>)
 *
 * In order, each step logged on its own line (`plan-park: <step>: <what happened>`):
 *   1. servers   the dev-server chains of the plan's folder (its wt-N slot, else its own <repo>-orch-<run>-<NNN> folder)
 *                are stopped from their root (lib/slot-procs.mjs: taskkill /T /F on Windows, kill on POSIX)
 *   2. save      the uncommitted work goes to park/<run>-<NNN> on origin (`orch-state.mjs park-save`, which also frees a slot)
 *   3. lock      the folder's .claude/.session-lock is deleted
 *   4. folder    a slot still claimed is released (`orch-state.mjs release`: never discards); a folder of its own is
 *                `git worktree remove --force`d — only after step 2 saved or found nothing to save
 *   5. branch    the local park/<run>-<NNN> branch is deleted once origin holds the same commit (the remote one stays)
 *   6. record    the park is written to .claude/orchestrator-runs/<run>/status.json once (`orch-state.mjs park-record`);
 *                a second run finds it recorded and changes nothing
 * The run is --run, else the builder marker in the folder's git dir, else the newest status.json that holds the plan.
 * A step that cannot run is logged and the next one runs; a step that could lose work (removing the folder after a
 * failed save) is skipped. Exit 0 always; the last line is `ORCH_JSON {"ok":true,…,"steps":[…]}`.
 */
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'fs'
import { spawnSync } from 'child_process'
import { basename, dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { findOpenPlan } from './lib/plan-paths.mjs'
import { listSlots } from './lib/slot.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const steps = []
const log = (step, what) => {
  steps.push({ step, what })
  console.log(`plan-park: ${step}: ${what}`)
}
const done = (extra = {}) => {
  console.log(`ORCH_JSON ${JSON.stringify({ ok: true, ...extra, steps })}`)
  process.exit(0)
}
const git = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' })
  return { status: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}
const posix = (p) => String(p).replace(/\\/g, '/')
// One orch-state command; its ORCH_JSON answer (or { ok: false, error }).
const orch = (...a) => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'orch-state.mjs'), ...a], { cwd: root, encoding: 'utf8', timeout: 300000 })
  const line = String(r.stdout ?? '').split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
  if (!line) return { ok: false, error: `orch-state ${a[0]}: no answer (exit ${r.status}) ${String(r.stderr ?? '').trim().split('\n').pop() ?? ''}` }
  try {
    return JSON.parse(line.slice('ORCH_JSON '.length))
  } catch (e) {
    return { ok: false, error: `orch-state ${a[0]}: ${e.message}` }
  }
}

// ---- arguments: --key value or --key=value -------------------------------------------------------------------------------
const args = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const m = /^--([\w-]+)(?:=(.*))?$/.exec(argv[i])
  if (!m) continue
  args[m[1]] = m[2] !== undefined ? m[2] : argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : ''
}
const nnn = /^\d{3}$/.test(String(args.plan ?? '')) ? String(args.plan) : /^\d{1,3}$/.test(String(args.plan ?? '')) ? String(args.plan).padStart(3, '0') : null
if (!nnn) {
  log('args', '--plan takes a plan number — nothing done')
  done({ plan: null })
}
let reason = String(args.reason ?? '').trim()
if (args['reason-b64']) reason = Buffer.from(String(args['reason-b64']), 'base64').toString('utf8').trim()
const planFile = (() => {
  try {
    return findOpenPlan(root, nnn)
  } catch {
    return null
  }
})()

// ---- the plan's folder and its run -------------------------------------------------------------------------------------------
let slot = null
try {
  slot = planFile ? listSlots().find((s) => s.plan === planFile) ?? null : null
} catch { /* no slots */ }
const markerRun = (folder) => {
  const gitDir = git(folder, 'rev-parse', '--absolute-git-dir').out
  try {
    const m = JSON.parse(readFileSync(join(gitDir, 'orch-builder.json'), 'utf8'))
    return m.plan === nnn && typeof m.run === 'string' ? m.run : null
  } catch {
    return null
  }
}
const statusRun = () => {
  const dir = join(root, '.claude', 'orchestrator-runs')
  let best = null
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    const p = join(dir, name, 'status.json')
    try {
      if (!JSON.parse(readFileSync(p, 'utf8')).plans?.[nnn]) continue
      const t = statSync(p).mtimeMs
      if (!best || t > best.t) best = { run: name, t }
    } catch { /* not a run folder */ }
  }
  return best?.run ?? null
}
const RUN_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
let run = RUN_RE.test(String(args.run ?? '')) ? String(args.run) : null
if (!run && slot) run = markerRun(slot.path)
if (!run) run = statusRun()
// A folder of its own: the worktree named <repo>-orch-<run>-<NNN>.
const ownFolder = (() => {
  if (!run) return null
  const list = git(root, 'worktree', 'list', '--porcelain').out.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length))
  return list.find((p) => basename(p).endsWith(`-orch-${run}-${nnn}`)) ?? null
})()
const folder = slot ? slot.path : ownFolder
log('plan', `${nnn}${planFile ? ` (${planFile})` : ' (no open plan file)'}, run ${run ?? '(none found)'}, folder ${folder ? posix(folder) : '(none)'}${slot ? ` = slot wt-${slot.slot}` : ''}`)

// ---- 1. servers ---------------------------------------------------------------------------------------------------------------
if (folder && existsSync(folder)) {
  try {
    const { stopSlotServers } = await import('./lib/slot-procs.mjs')
    const n = slot ? slot.slot : null
    const lines = stopSlotServers({ root: folder, slotPorts: n ? { fe: 4200 + n, be: 3000 + n } : null })
    log('servers', lines.length ? lines.join('; ') : 'none running')
  } catch (e) {
    log('servers', `not stopped: ${e.message}`)
  }
} else log('servers', 'no folder')

// ---- 2. save ------------------------------------------------------------------------------------------------------------------
let saveOk = false
if (!run) log('save', 'no run found — nothing saved (pass --run <name>)')
else if (!folder || !existsSync(folder)) {
  saveOk = true
  log('save', 'no folder — nothing to save')
} else {
  const s = orch('park-save', `--run=${run}`, `--plan=${nnn}`)
  saveOk = s.ok === true
  log('save', s.ok ? (s.saved ? `saved on ${s.branch} (${String(s.sha ?? '').slice(0, 7)}) and pushed${s.released ? ', slot released' : ''}` : `nothing to save (${s.why})`) : `failed — the folder is kept as it is: ${s.error}`)
}

// ---- 3. lock ------------------------------------------------------------------------------------------------------------------
if (folder) {
  const lock = join(folder, '.claude', '.session-lock')
  if (existsSync(lock)) {
    try {
      unlinkSync(lock)
      log('lock', `${posix(lock)} deleted`)
    } catch (e) {
      log('lock', `${posix(lock)} not deleted: ${e.message}`)
    }
  } else log('lock', 'none')
} else log('lock', 'no folder')

// ---- 4. folder ----------------------------------------------------------------------------------------------------------------
if (!folder || !existsSync(folder)) log('folder', 'none')
else if (!saveOk) log('folder', 'kept: the work was not saved')
else if (slot) {
  const still = listSlots().find((s) => s.slot === slot.slot)
  if (still && still.plan === planFile) {
    const r = orch('release', `--run=${run}`, `--plan=${nnn}`)
    log('folder', r.ok ? (r.released ? `slot wt-${slot.slot} released` : `slot wt-${slot.slot} kept — ${r.why}`) : `slot wt-${slot.slot} not released: ${r.error}`)
  } else log('folder', `slot wt-${slot.slot} already free`)
} else {
  const r = git(root, 'worktree', 'remove', '--force', folder)
  git(root, 'worktree', 'prune')
  log('folder', r.status === 0 ? `${posix(folder)} removed` : `${posix(folder)} not removed: ${r.err.split('\n').pop()}`)
}

// ---- 5. branch ----------------------------------------------------------------------------------------------------------------
if (run) {
  const branch = `park/${run}-${nnn}`
  const local = git(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).out
  if (!local) log('branch', `no local ${branch}`)
  else {
    const remote = git(root, 'ls-remote', 'origin', `refs/heads/${branch}`).out.split(/\s+/)[0] ?? ''
    if (remote !== local) log('branch', `local ${branch} kept: origin ${remote ? `is at ${remote.slice(0, 7)}` : 'does not have it'}`)
    else {
      const d = git(root, 'branch', '-D', branch)
      log('branch', d.status === 0 ? `local ${branch} deleted (origin keeps ${local.slice(0, 7)})` : `local ${branch} not deleted: ${d.err.split('\n').pop()}`)
    }
  }
} else log('branch', 'no run')

// ---- 6. record ----------------------------------------------------------------------------------------------------------------
let recorded = false
if (!run) log('record', 'no run — not recorded')
else {
  const r = orch('park-record', `--run=${run}`, `--plan=${nnn}`, ...(reason ? [`--reason-b64=${Buffer.from(reason, 'utf8').toString('base64')}`] : []))
  recorded = r.recorded === true
  log('record', r.ok ? (r.recorded ? 'park recorded' : `already recorded at ${r.park?.at}`) : `not recorded: ${r.error}`)
}
done({ plan: nnn, run, folder: folder ? posix(folder) : null, recorded })
