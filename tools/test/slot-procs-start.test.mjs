// startServer (K10): a slow frontend that listens on its port is kept, even when the first process snapshot does
// not link the listener to the spawned process yet. Fake OS calls; no server starts and nothing is killed.
//   node --test tools/test/slot-procs-start.test.mjs
// Imports the installed copy (scripts/lib/slot-procs.mjs, after `node tools/sync.mjs --target . --apply`).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const project = process.env.SLOT_PROCS_ROOT ? resolve(process.env.SLOT_PROCS_ROOT) : kit
const { startServer } = await import(pathToFileURL(join(project, 'scripts', 'lib', 'slot-procs.mjs')).href)

const scratch = mkdtempSync(join(tmpdir(), 'kit-startserver-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

// PIDs no real process uses here: a kill of them can do no harm.
const SHELL = 900001
const SERVER = 900002
const PORT = 59873

/** A process table: Map pid -> { pid, ppid, name, cmd, t, children }. */
function table(rows) {
  const t = new Map(rows.map((r) => [r.pid, { t: 0, name: 'node.exe', children: [], ...r }]))
  for (const p of t.values()) if (t.has(p.ppid)) t.get(p.ppid).children.push(p.pid)
  return t
}

function run({ tables, cwd = scratch }) {
  const reads = [...tables]
  const killed = []
  const r = startServer(
    { label: 'fe', port: PORT, cwd, args: ['run', 'dev'], logPath: join(scratch, '.claude', 'fe.log'), timeoutMs: 1500, spawner: () => ({ pid: SHELL, unref() {} }) },
    { portOwner: () => null, wait: () => SERVER, readTable: () => reads.shift() || tables[tables.length - 1], kill: (pid) => killed.push(pid), pause: () => {} }
  )
  return { r, killed, readsLeft: reads.length }
}

test('listener not in the spawned tree on the first snapshot, in it on the second -> kept', () => {
  const first = table([{ pid: SHELL, ppid: 1, name: 'cmd.exe', cmd: 'cmd.exe /c npm run dev' }, { pid: SERVER, ppid: 4242, cmd: 'node vite.js' }])
  const second = table([{ pid: SHELL, ppid: 1, name: 'cmd.exe', cmd: 'cmd.exe /c npm run dev' }, { pid: SERVER, ppid: SHELL, cmd: 'node vite.js' }])
  const { r, killed } = run({ tables: [first, second] })
  assert.deepEqual(killed, [], 'nothing is stopped')
  assert.equal(r.ok, true, r.message)
  assert.equal(r.root, SHELL)
})

test('listener never linked (its shim exited) but runs from this start\'s folder -> kept, the server is recorded', () => {
  const rows = [{ pid: SERVER, ppid: 4242, cmd: `"C:\\Program Files\\nodejs\\node.exe" ${join(scratch, 'node_modules', 'vite', 'bin', 'vite.js')} --port ${PORT}` }]
  const { r, killed } = run({ tables: [table(rows), table(rows)] })
  assert.deepEqual(killed, [])
  assert.equal(r.ok, true, r.message)
  assert.equal(r.root, SERVER)
})

test('listener from another folder, never linked -> stopped as foreign', () => {
  const rows = [{ pid: SERVER, ppid: 4242, cmd: 'node C:\\elsewhere\\node_modules\\vite\\bin\\vite.js' }]
  const { r, killed } = run({ tables: [table(rows), table(rows)] })
  assert.equal(r.ok, false)
  assert.match(r.message, /was taken by PID 900002, not by this start/)
  assert.deepEqual(killed, [SHELL])
})
