/**
 * Kit brain — sends a run's facts to the kit's private document store, with no model call and no write access to the kit
 * (docs/agent/kit-brain.md). A machine that is offline or not set up loses nothing: documents wait in a local queue and go
 * out with the next send.
 *
 *   node scripts/brain.mjs digest   --run <name> [--dry-run]    the documents of a run, as JSON lines (nothing is sent)
 *   node scripts/brain.mjs send     --run <name> [--final-gate <text>]       runs, plans and events of a run
 *   node scripts/brain.mjs send     --grades --run <name>        the run's rows of docs/brain/decision-grades.jsonl
 *   node scripts/brain.mjs send     --toil --run <name>          .claude/sessions/toil-<run>.json (the Planner's by-hand lines)
 *   node scripts/brain.mjs send     --lesson-file <file>         one lesson { role, title, text, why } for the kit (lessonsIn)
 *   node scripts/brain.mjs backfill [--dry-run]                  every past status.json of this project, once (idempotent)
 *   node scripts/brain.mjs setup    [--dry-run]                  installs the driver into <home>/.kit-brain (no project folder is touched)
 *   node scripts/brain.mjs check                                 connects with KIT_BRAIN_URI: insert allowed, read denied
 *   node scripts/brain.mjs queue                                 lists the documents still waiting to be sent
 *
 * Environment: KIT_BRAIN_URI (the insert-only connection string); KIT_BRAIN_HOME (default: the user's home — the queue and the
 * driver live in <home>/.kit-brain), KIT_BRAIN_DRIVER (a stub module, tests only), KIT_BRAIN_TIMEOUT_MS (default 10000),
 * KIT_BRAIN_TRANSCRIPTS_HOME (where ~/.claude/projects is, tests only).
 * Flags: --root <folder> (default: the folder above scripts/), --home, --driver <module.mjs> (tests: the stub driver).
 * `send` always exits 0 (a failure queues the documents); exit 2 = bad arguments, 1 = `check`, `setup` or `digest` could not finish.
 * Node built-ins only; the driver is loaded from <home>/.kit-brain/node_modules only when a send is attempted.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { COLLECTIONS, SCHEMA, digestRun, gradeDocs, toilDocs, lessonDoc, machineId, projectInfo, tokensForRun, brainHome, loadDriver } from './lib/brain-doc.mjs'

const DB_NAME = 'kitbrain'
const BOOLEAN = new Set(['dry-run', 'grades', 'toil'])

function parse(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      out._.push(a)
      continue
    }
    const eq = a.indexOf('=')
    const key = eq > 0 ? a.slice(2, eq) : a.slice(2)
    if (BOOLEAN.has(key)) out[key] = true
    else if (eq > 0) out[key] = a.slice(eq + 1)
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[key] = argv[++i]
    else throw new Error(`--${key} needs a value`)
  }
  return out
}

const firstLine = (e) => String(e?.message ?? e ?? 'failed').split('\n')[0].trim().slice(0, 140)
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const readJsonl = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((l) => {
  try {
    return [JSON.parse(l)]
  } catch {
    return []
  }
}) : [])

/** Where a run's status.json is: the main folder's run state, else the copy committed on a run branch checkout. */
export function statusPath(root, run) {
  return [join(root, '.claude', 'orchestrator-runs', run, 'status.json'), join(root, 'docs', 'orchestrator', 'runs', run, 'status.json')].find((f) => existsSync(f)) ?? null
}

/** The names of every run that has a status.json in this project. */
export function pastRuns(root) {
  const names = new Set()
  for (const dir of [join(root, '.claude', 'orchestrator-runs'), join(root, 'docs', 'orchestrator', 'runs')]) {
    if (!existsSync(dir)) continue
    for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && existsSync(join(dir, e.name, 'status.json'))) names.add(e.name)
  }
  return [...names].sort()
}

/** The items { collection, doc } of one run: runs, plans, events (with the tokens of its workflow transcripts, if found). */
export function runItems(root, run, { finalGate = null } = {}) {
  const file = statusPath(root, run)
  const status = file ? readJson(file) : null
  if (!status || typeof status !== 'object' || !status.plans) return null
  const t = status.startedAt && status.finishedAt ? tokensForRun({ root, startedAt: status.startedAt, finishedAt: status.finishedAt, home: process.env.KIT_BRAIN_TRANSCRIPTS_HOME || undefined }) : { tokens: null, note: 'tokens: the run has not finished' }
  const { docs } = digestRun(status, { root, run, finalGate, tokens: t.tokens, tokensNote: t.note })
  return COLLECTIONS.flatMap((c) => (docs[c] ?? []).map((doc) => ({ collection: c, doc })))
}

const gradeItems = (root, run) => gradeDocs(readJsonl(join(root, 'docs', 'brain', 'decision-grades.jsonl')), { root, run }).map((doc) => ({ collection: 'grades', doc }))

// ---------------------------------------------------------------------------------------------------- the queue

const queueDir = (home) => join(brainHome(home), 'queue')
const fileName = (id) => `${String(id).replace(/[^\w.-]+/g, '_').slice(0, 180)}.json`

/** The queued files, oldest first. */
export function queued(home) {
  const dir = queueDir(home)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ f, path: join(dir, f), t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => a.t - b.t || (a.f < b.f ? -1 : 1))
}

// A write error that names which documents failed (so the others can be told apart), or a duplicate key.
const isWriteError = (e) => e?.code === 11000 || Array.isArray(e?.writeErrors) || e?.name === 'MongoBulkWriteError' || e?.name === 'MongoServerError'
const isDuplicate = (e) => e?.code === 11000 || /E11000/.test(String(e?.message ?? ''))

/**
 * Writes the items to the queue first (so a crash loses nothing), then tries to send the whole queue, oldest first.
 * Returns { sent, drained, queued, reason }: new documents sent, older queued ones sent, new documents still queued.
 */
export async function deliver(items, { home, driverPath, uri, timeoutMs }) {
  const dir = queueDir(home)
  mkdirSync(dir, { recursive: true })
  const fresh = new Set()
  for (const it of items) {
    const name = fileName(it.doc._id)
    writeFileSync(join(dir, name), JSON.stringify(it))
    fresh.add(name)
  }
  const result = { sent: 0, drained: 0, queued: fresh.size, reason: null }
  if (!uri) {
    result.reason = 'KIT_BRAIN_URI not set'
    return result
  }
  const done = new Set()
  const markSent = (name) => {
    if (done.has(name)) return
    done.add(name)
    rmSync(join(dir, name), { force: true })
    if (fresh.has(name)) {
      result.sent++
      result.queued--
    } else result.drained++
  }
  const work = async () => {
    const MongoClient = await loadDriver({ driverPath, home })
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: timeoutMs })
    try {
      await client.connect()
      const db = client.db(DB_NAME)
      const groups = new Map()
      for (const q of queued(home)) {
        const it = readJson(q.path)
        if (!it || !COLLECTIONS.includes(it.collection) || !it.doc?._id) continue
        if (!groups.has(it.collection)) groups.set(it.collection, [])
        groups.get(it.collection).push({ name: q.f, doc: it.doc })
      }
      for (const [collection, list] of groups) {
        const coll = db.collection(collection)
        try {
          await coll.insertMany(list.map((x) => x.doc), { ordered: false })
          for (const x of list) markSent(x.name)
        } catch (e) {
          if (!isWriteError(e)) throw e
          // Some documents may be there already (E11000 = sent before): tell them apart one by one.
          for (const x of list) {
            try {
              await coll.insertOne(x.doc)
              markSent(x.name)
            } catch (e2) {
              if (isDuplicate(e2)) markSent(x.name)
              else result.reason ??= firstLine(e2)
            }
          }
        }
      }
    } finally {
      await Promise.resolve(client.close?.()).catch(() => {})
    }
  }
  let timer
  try {
    await Promise.race([work(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`no answer within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs) })])
  } catch (e) {
    result.reason = firstLine(e)
  } finally {
    clearTimeout(timer)
  }
  if (result.queued > 0) result.reason ??= 'not all documents were accepted'
  return result
}

const line = (r) => (r.queued === 0 && !r.reason ? `BRAIN: sent ${r.sent}, queue drained ${r.drained}` : `BRAIN: queued ${r.queued} (${r.reason})${r.sent ? `; sent ${r.sent}` : ''}`)

// ---------------------------------------------------------------------------------------------------- commands

async function main(argv) {
  let flags
  try {
    flags = parse(argv)
  } catch (e) {
    return finish(`BRAIN: ${e.message}`, 2)
  }
  const cmd = flags._[0]
  const root = resolve(flags.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
  const home = flags.home ?? process.env.KIT_BRAIN_HOME ?? undefined
  const driverPath = flags.driver ?? process.env.KIT_BRAIN_DRIVER ?? undefined
  const uri = process.env.KIT_BRAIN_URI || ''
  const timeoutMs = Number(process.env.KIT_BRAIN_TIMEOUT_MS) > 0 ? Number(process.env.KIT_BRAIN_TIMEOUT_MS) : 10000
  const bad = (msg) => finish(`BRAIN: ${msg}`, 2)
  const run = typeof flags.run === 'string' ? flags.run : null

  if (cmd === 'digest') {
    if (!run) return bad('digest needs --run <name>')
    const items = runItems(root, run)
    if (!items) return finish(`BRAIN: no status.json for run "${run}"`, 1)
    return finish(items.map((i) => JSON.stringify(i)).join('\n'), 0)
  }

  // A test run (`node --test` sets NODE_TEST_CONTEXT for its children) that did not name its own KIT_BRAIN_HOME or stub
  // driver must not fill a developer's real queue or reach a real store with fixture data.
  const testRun = process.env.NODE_TEST_CONTEXT && !home && !driverPath
  if ((cmd === 'send' || cmd === 'backfill') && testRun) return finish('BRAIN: off (under node --test without KIT_BRAIN_HOME or a stub driver)', 0)

  if (cmd === 'send') {
    if (!projectInfo(root).enabled) return finish('BRAIN: off (brain.enabled is false)', 0)
    let items
    if (typeof flags['lesson-file'] === 'string') {
      const lesson = readJson(resolve(flags['lesson-file']))
      if (!lesson || typeof lesson.text !== 'string' || typeof lesson.title !== 'string') return bad('--lesson-file must be a JSON file with { role, title, text, why }')
      items = [{ collection: 'lessonsIn', doc: lessonDoc(lesson, { root }) }]
    } else {
      if (!run) return bad('send needs --run <name> (or --lesson-file <file>)')
      if (flags.grades) items = gradeItems(root, run)
      else if (flags.toil) {
        const lines = readJson(join(root, '.claude', 'sessions', `toil-${run}.json`))
        if (!Array.isArray(lines) || !lines.length) return finish('BRAIN: nothing to send (no toil lines)', 0)
        items = toilDocs(lines, { root, run }).map((doc) => ({ collection: 'toil', doc }))
      } else {
        items = runItems(root, run, { finalGate: typeof flags['final-gate'] === 'string' ? flags['final-gate'] : null })
        if (!items) return finish(`BRAIN: no status.json for run "${run}"`, 0)
      }
    }
    if (flags['dry-run']) return finish(`BRAIN: dry run — ${items.length} document(s), nothing sent`, 0)
    return finish(line(await deliver(items, { home, driverPath, uri, timeoutMs })), 0)
  }

  if (cmd === 'backfill') {
    const runs = pastRuns(root)
    if (flags['dry-run']) return finish([`BRAIN: backfill dry run — ${runs.length} run(s)`, ...runs.map((r) => `  ${r}`)].join('\n'), 0)
    const items = runs.flatMap((r) => runItems(root, r) ?? [])
    items.push(...gradeItems(root, null))
    return finish(line(await deliver(items, { home, driverPath, uri, timeoutMs })), 0)
  }

  if (cmd === 'queue') {
    const list = queued(home)
    return finish([`BRAIN: ${list.length} queued in ${queueDir(home)}`, ...list.map((q) => `  ${q.f}`)].join('\n'), 0)
  }

  if (cmd === 'setup') {
    const prefix = brainHome(home)
    const npm = ['install', '--prefix', prefix, 'mongodb@6', '--no-audit', '--no-fund']
    const text = `BRAIN: setup — npm ${npm.join(' ')}`
    if (flags['dry-run']) return finish(`${text}\nBRAIN: dry run — nothing installed`, 0)
    process.stdout.write(`${text}\n`)
    mkdirSync(prefix, { recursive: true })
    // npm's own script next to node when it is there (no shell, no escaping question); else the npm on the PATH.
    const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    const r = existsSync(cli) ? spawnSync(process.execPath, [cli, ...npm], { stdio: 'inherit' }) : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', npm, { stdio: 'inherit', shell: process.platform === 'win32' })
    return finish(r.status === 0 ? `BRAIN: driver installed in ${prefix}/node_modules` : 'BRAIN: setup failed — npm did not finish', r.status === 0 ? 0 : 1)
  }

  if (cmd === 'check') {
    if (!uri) return finish('BRAIN: not set up — KIT_BRAIN_URI is not set (docs/agent/kit-brain.md "Setup")', 1)
    let client
    try {
      const MongoClient = await loadDriver({ driverPath, home })
      client = new MongoClient(uri, { serverSelectionTimeoutMS: timeoutMs })
      await client.connect()
      const events = client.db(DB_NAME).collection('events')
      const stamp = new Date().toISOString()
      await events.insertOne({ _id: `setup-check:${machineId()}:${stamp}`, schema: SCHEMA, kind: 'setup-check', machine: machineId(), at: stamp })
      let canRead = true
      try {
        await events.find({}).limit(1).toArray()
      } catch {
        canRead = false
      }
      return finish(canRead ? 'BRAIN: WARN — this user can read; the writer should only insert (least privilege: docs/agent/kit-brain.md "Setup")' : 'BRAIN: ok — reachable, insert allowed, read denied', 0)
    } catch (e) {
      return finish(`BRAIN: FAIL — ${firstLine(e)}`, 1)
    } finally {
      await Promise.resolve(client?.close?.()).catch(() => {})
    }
  }

  return bad(`usage: node scripts/brain.mjs <digest|send|backfill|setup|check|queue> — see the header of this file`)
}

// Exit as soon as the line is written: a hung driver may leave sockets that would keep the process open.
function finish(text, code) {
  process.stdout.write(`${text}\n`, () => process.exit(code))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => finish(`BRAIN: queued 0 (${firstLine(e)})`, 0))
}
