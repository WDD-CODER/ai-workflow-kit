/**
 * Slot serve — starts this slot's dev servers on demand. Servers are off unless a step needs the
 * running app (a browser check, a validation click-list, /remote, preflight) or the Human says "start servers".
 * take-plan.mjs claims a slot without starting them; the merge, free-merged-slots.mjs and the SessionEnd hook
 * stop them again (scripts/slot-stop.mjs).
 *
 * Usage:
 *   node scripts/slot-serve.mjs            # start what is not running, keep what is
 *   node scripts/slot-serve.mjs --restart  # stop this slot's servers first, then start both
 *
 * Steps: npm install when a lockfile changed (running servers are restarted on the new dependencies), then
 * each server is kept when this slot already runs it (a watcher that is restarting its app counts), refused
 * when its port is held by anything else (a second start would leave an idle watcher behind), or started.
 * environment.slot.ts and the optional prepare step run only before a start, so a kept server is never
 * poked into a reload. A start that does not come up is stopped from its root.
 * Prints: SLOT_SERVE: be=<port> started|kept, fe=<port> started|kept. Exit 1 + log tail on failure.
 */
import { readFileSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { isSlot, slotNumber, ports, activePlanPath } from './lib/slot.mjs'
import {
  repoRoot, portState, processTable, listeners, devChains, killTree, readSlotPids, writeSlotPids,
  stopSlotServers, waitForPort, waitForPortFree, startServer, npmInstallIfChanged, generateEnvironmentSlot,
  hasFrontend as projectHasFrontend, frontendArgs, isFrontendCmd, installDirs
} from './lib/slot-procs.mjs'

const isWin = process.platform === 'win32'
// Optional npm script run before the backend starts (e.g. code generation the backend imports). Empty = skip.
const SLOT_PREPARE = '{{commands.slotPrepare}}'
const START_TIMEOUT_MS = { be: 90000, fe: 180000 }

function fail(message) {
  console.error(`SLOT_SERVE: ${message}`)
  process.exit(1)
}

if (!isSlot()) fail('not a slot - the main folder\'s dev servers are the Human\'s; start them by hand')

const n = slotNumber()
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
    if (npmInstallIfChanged(dir, hashFile) && label !== 'scripts') installed = true
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
    spec = { cwd: join(repoRoot, 'server'), args: ['run', 'dev:local'], env }
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
