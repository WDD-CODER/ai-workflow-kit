/**
 * Slot serve — starts this slot's dev servers on demand. Servers are off unless a step needs the
 * running app (a browser check, a validation click-list, /remote, preflight) or the Human says "start servers".
 * take-plan.mjs claims a slot without starting them; the merge, free-merged-slots.mjs and the SessionEnd hook
 * stop them again (scripts/slot-stop.mjs).
 *
 * Usage:
 *   node scripts/slot-serve.mjs            # start what is not running, keep what is
 *   node scripts/slot-serve.mjs --restart  # stop this slot's servers first, then start both
 *   node scripts/slot-serve.mjs --ref <branch>  # idle slot only: check out origin/<branch> detached, mark it validating, then serve
 *   node scripts/slot-serve.mjs --main [--servers fe,be] [--db local|remote]
 *       main folder only (the orchestrator preflight): the frontend `<pm> run <commands.dev>` on slots.fePorts with no
 *       port arguments, the backend `<pm> run <commands.devLocal | commands.devRemote>` in server/ on slots.bePorts with
 *       the environment unchanged. No install, no environment.slot, no prepare step. A server that answers is kept, a
 *       held port is refused with its holder named (never killed). Started chains go to .claude/.main-serve-pids
 *       (node scripts/slot-stop.mjs --main stops only those). Prints SLOT_SERVE: main be=<port> started|kept, fe=…
 *
 * Steps: npm install when a lockfile changed or a folder's packages are missing (running servers are restarted on the new dependencies), then
 * each server is kept when this slot already runs it (a watcher that is restarting its app counts), refused
 * when its port is held by anything else (a second start would leave an idle watcher behind), or started.
 * environment.slot.ts and the optional prepare step run only before a start, so a kept server is never
 * poked into a reload. A start that does not come up is stopped from its root.
 * Prints: SLOT_SERVE: be=<port> started|kept, fe=<port> started|kept. Exit 1 + log tail on failure.
 */
import { readFileSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { isSlot, slotNumber, ports, activePlanPath, startValidating } from './lib/slot.mjs'
import {
  repoRoot, portState, processTable, listeners, devChains, killTree, readSlotPids, writeSlotPids,
  stopSlotServers, waitForPort, waitForPortFree, startServer, npmInstallIfChanged, generateEnvironmentSlot,
  hasFrontend as projectHasFrontend, frontendArgs, isFrontendCmd, installDirs, installReason,
  mainPorts, spawnPm, projectPm, BE_LOCAL_SCRIPT, BE_REMOTE_SCRIPT, MAIN_PIDS, FE_SCRIPT_NAME, subtree, isRecordedChain
} from './lib/slot-procs.mjs'

const isWin = process.platform === 'win32'
// Optional npm script run before the backend starts (e.g. code generation the backend imports). Empty = skip.
const SLOT_PREPARE = '{{commands.slotPrepare}}'
const START_TIMEOUT_MS = { be: 90000, fe: 180000 }

function fail(message) {
  console.error(`SLOT_SERVE: ${message}`)
  process.exit(1)
}

// --- --main: the main folder's servers, for the orchestrator preflight -------------------------------------------
const argValue = (name) => {
  const at = process.argv.findIndex((a) => a === name || a.startsWith(`${name}=`))
  if (at === -1) return null
  const given = process.argv[at]
  return given.includes('=') ? given.slice(given.indexOf('=') + 1) : process.argv[at + 1] ?? ''
}
if (process.argv.includes('--main')) {
  if (isSlot()) fail('--main is for the main folder; in a slot run node scripts/slot-serve.mjs')
  const wanted = (argValue('--servers') ?? 'fe,be').split(',').map((s) => s.trim()).filter(Boolean)
  if (!wanted.length || wanted.some((s) => !['fe', 'be'].includes(s))) fail(`--servers takes fe, be or fe,be (got "${wanted.join(',')}")`)
  const db = argValue('--db') ?? 'local'
  if (!['local', 'remote'].includes(db)) fail(`--db takes local or remote (got "${db}")`)
  const pm = projectPm()
  const mp = mainPorts()
  const present = { fe: projectHasFrontend(), be: existsSync(join(repoRoot, 'server', 'package.json')) }
  const result = []
  const errors = []
  const table = processTable()
  const lst = listeners()
  const chains = devChains(repoRoot, table, lst)
  // The chains this script started earlier (same process by creation time): a port held inside one of them is ours.
  const recordedEntries = readSlotPids(repoRoot, MAIN_PIDS).filter((e) => isRecordedChain(e, table.get(e.pid)))
  const recorded = recordedEntries.map((e) => e.pid)
  const inRecorded = (pid) => recorded.some((r) => subtree(table, r).includes(pid))
  const started = []
  for (const label of ['be', 'fe'].filter((l) => wanted.includes(l))) {
    if (!present[label]) {
      result.push(`${label}=none`)
      continue
    }
    const port = mp[label]
    if (!port) {
      errors.push(`${label} not started: slots.${label}Ports is not set in the kit config, so the main folder's ${label === 'fe' ? 'frontend' : 'backend'} port is unknown`)
      continue
    }
    const st = portState(port, { table, lst })
    if (st.ours || (st.pid && inRecorded(st.pid))) {
      result.push(`${label}=${port} kept`)
      continue
    }
    if (st.pid) {
      errors.push(`${label} not started: port ${port} is held by PID ${st.pid} (${(st.cmd || '').slice(0, 80)}), which is not this folder's dev server. Free the port, then re-run — the kit never stops another program.`)
      continue
    }
    // A dev server of this folder that is still booting (or restarting its app): wait for it rather than start a second one.
    const chain = chains.find((c) => {
      const cmds = c.pids.map((pid) => (table.get(pid) || {}).cmd || '')
      return label === 'be' ? cmds.some((cmd) => cmd.includes(BE_LOCAL_SCRIPT) || cmd.includes(BE_REMOTE_SCRIPT)) : cmds.some(isFrontendCmd)
    })
    if (chain && !chain.orphan) {
      if (waitForPort(port, 30000)) {
        result.push(`${label}=${port} kept`)
        continue
      }
      errors.push(`${label} not started: a ${label === 'fe' ? 'frontend' : 'backend'} of this folder is running (PID ${chain.root}) but does not listen on port ${port} after 30 s. Stop it (node scripts/slot-stop.mjs --main stops only what this script started), then re-run.`)
      continue
    }
    const script = label === 'fe' ? FE_SCRIPT_NAME : db === 'remote' ? BE_REMOTE_SCRIPT : BE_LOCAL_SCRIPT
    const cwd = label === 'fe' ? repoRoot : join(repoRoot, 'server')
    const logPath = join(repoRoot, '.claude', `${label}.log`)
    const r = startServer({ label, port, cwd, args: ['run', script], logPath, timeoutMs: START_TIMEOUT_MS[label], spawner: spawnPm })
    if (!r.ok) {
      errors.push(`${r.message}\nThe command was: ${pm} run ${script} (in ${cwd}); its log is ${logPath}.`)
      continue
    }
    started.push(r.root)
    result.push(`${label}=${port} started${label === 'be' ? ` (${db} database)` : ''}`)
  }
  if (started.length) writeSlotPids([...recorded, ...started], repoRoot, processTable(), MAIN_PIDS)
  if (result.length) console.log(`SLOT_SERVE: main ${result.join(', ')}`)
  if (errors.length) fail(errors.join('\n'))
  process.exit(0)
}

if (!isSlot()) fail('not a slot - run node scripts/slot-serve.mjs --main for the main folder\'s servers')

const n = slotNumber()
// --ref <branch>: serve a branch (a run branch, a plan branch) for the Human's validation in this idle slot. The slot
// is checked out detached at origin/<branch> and marked .worktree-validating, so every status view says "validating"
// and no run or take-plan claims it; node scripts/slot-stop.mjs ends it.
const refAt = process.argv.findIndex((a) => a === '--ref' || a.startsWith('--ref='))
if (refAt !== -1) {
  const given = process.argv[refAt]
  const ref = given.includes('=') ? given.slice(given.indexOf('=') + 1) : process.argv[refAt + 1]
  if (!ref) fail('--ref needs a branch (--ref <branch>)')
  const v = startValidating({ path: repoRoot, branch: ref })
  if (!v.ok) fail(v.error)
  console.log(`SLOT_SERVE: wt-${n} validating ${ref} @ ${v.sha.slice(0, 7)}`)
}
const { fe: fePort, be: bePort } = ports()
const hasServer = existsSync(join(repoRoot, 'server', 'package.json'))
// The frontend comes from kit.config.json: commands.dev + slots.fe* (lib/slot-procs.mjs; a stack pack fills them).
const hasFrontend = projectHasFrontend()
const halves = [['be', bePort, hasServer], ['fe', fePort, hasFrontend]].filter(([, , present]) => present)
if (!halves.length) fail('this project has no dev servers to start (no server/package.json, and kit.config.json commands.dev names no package.json script)')

const stopAll = (why) => {
  for (const l of stopSlotServers()) console.log(`SLOT_SERVE: ${why} - ${l}`)
  for (const [, port] of halves) waitForPortFree(port, 10000)
}

if (process.argv.includes('--restart')) stopAll('restart')

// --- dependencies -----------------------------------------------------------------------------
let installed = false
for (const [dir, hashFile, label] of installDirs(repoRoot)) {
  try {
    // The workflow scripts' own dependencies are not loaded by the servers: no restart for them.
    const ran = npmInstallIfChanged(dir, hashFile)
    if (ran) console.log(`SLOT_SERVE: npm install ran in ${label} (${installReason(ran)})`)
    if (ran && label !== 'scripts') installed = true
  } catch (e) {
    fail(`npm install failed in ${label} - servers not started.\n${String(e.message).split('\n')[0]}`)
  }
}
// Running servers loaded the old dependencies.
if (installed) stopAll('dependencies changed')

// --- keep or refuse each server, from one process snapshot (each OS query costs about a second on Windows)
const table = processTable()
const lst = listeners()
const chains = devChains(repoRoot, table, lst)
const chainFor = (label) => chains.find((c) => {
  const cmds = c.pids.map((pid) => (table.get(pid) || {}).cmd || '')
  return label === 'be' ? c.watcher : cmds.some(isFrontendCmd)
})

const roots = readSlotPids().map((e) => e.pid)
const result = []
const errors = []
const toStart = []
for (const [label, port] of halves) {
  const st = portState(port, { table, lst })
  if (st.ours) {
    roots.push(st.root)
    result.push(`${label}=${port} kept`)
    continue
  }
  if (st.pid) {
    errors.push(`${label} not started: port ${port} is held by PID ${st.pid} (${(st.cmd || '').slice(0, 80)}), which is not this slot's server. ${st.foreign ? 'Free the port' : 'Run node scripts/slot-stop.mjs'}, then re-run.`)
    continue
  }
  const chain = chainFor(label)
  if (chain && chain.orphan) {
    killTree(chain.root) // an idle watcher (its app died): replace it
  } else if (chain) {
    // Its port is free only for the moment: a watcher restarting its app, or a server still booting.
    if (waitForPort(port, 30000)) {
      roots.push(chain.root)
      result.push(`${label}=${port} kept`)
      continue
    }
    killTree(chain.root)
  }
  toStart.push([label, port])
}

// --- start what is missing ------------------------------------------------------------------------
if (toStart.length) generateEnvironmentSlot(bePort)
if (SLOT_PREPARE && toStart.some(([label]) => label === 'be')) {
  try {
    execFileSync(isWin ? 'npm.cmd' : 'npm', ['run', SLOT_PREPARE], { cwd: repoRoot, stdio: 'pipe', shell: isWin, encoding: 'utf8' })
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.replace(/\r\n/g, '\n').trimEnd().split('\n').slice(-20).join('\n')
    fail(`prepare step "npm run ${SLOT_PREPARE}" failed - servers not started.\n${out}`)
  }
}

const plan = activePlanPath()
const planText = plan && existsSync(join(repoRoot, plan)) ? readFileSync(join(repoRoot, plan), 'utf8') : ''
const isolatedDb = /^Isolated DB:\s*yes/mi.test(planText)
const withDbName = (uri, dbName) => uri.replace(/\/([^/?]+)(\?|$)/, `/${dbName}$2`)

for (const [label, port] of toStart) {
  const logPath = join(repoRoot, '.claude', `${label}.log`)
  let spec
  if (label === 'be') {
    const env = { ...process.env, PORT: String(bePort), ALLOWED_ORIGIN: `http://localhost:${fePort}` }
    if (isolatedDb && process.env.MONGO_LOCAL_URI) env.MONGO_LOCAL_URI = withDbName(process.env.MONGO_LOCAL_URI, `{{slots.dbNameFormat}}`)
    spec = { cwd: join(repoRoot, 'server'), args: ['run', BE_LOCAL_SCRIPT], env }
  } else {
    spec = { cwd: repoRoot, args: frontendArgs(fePort) }
  }
  const r = startServer({ label, port, logPath, timeoutMs: START_TIMEOUT_MS[label], ...spec })
  if (!r.ok) {
    errors.push(r.message)
    continue
  }
  roots.push(r.root)
  result.push(`${label}=${port} started`)
}
writeSlotPids(roots, repoRoot, processTable())

if (result.length) console.log(`SLOT_SERVE: ${result.join(', ')}`)
if (errors.length) fail(`${errors.join('\n')}\nOnly the steps that need the running app are blocked - carry on with the rest.`)
console.log(`SLOT_SERVE: ok - wt-${n} app on http://localhost:${fePort} (stop with node scripts/slot-stop.mjs)`)
