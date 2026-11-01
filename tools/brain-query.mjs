#!/usr/bin/env node
/**
 * Kit brain — read side (kit repo only, never rendered into a project): what runs in every project taught the kit.
 *
 *   node tools/brain-query.mjs runs   [--last <n>] [--project <p>]       runs, newest first, with minutes per phase per plan
 *   node tools/brain-query.mjs events [--signature <s> | --kind <k>] [--since YYYY-MM-DD]   problems, counted by signature
 *   node tools/brain-query.mjs trend  --by kitVersion|project            one row per kit version (or project)
 *
 * Reads with KIT_BRAIN_READER_URI (the read-only user; it exists only on machines that run kit sessions) through the driver
 * `scripts/brain.mjs setup` installed in <home>/.kit-brain. `--driver <module.mjs>` loads a stub instead (tests).
 * Exit 0 = ok, 1 = no reader string or the read failed, 2 = bad arguments. Node built-ins only.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDriver } from '../core/scripts/lib/brain-doc.mjs'

const DB_NAME = 'kitbrain'

const avg = (sum, n) => (n > 0 ? Math.round((sum / n) * 10) / 10 : null)
const cell = (v) => (v === null || v === undefined ? '-' : String(v))
const tokenTotal = (t) => (t?.total ? t.total.input + t.total.output + t.total.cacheRead + t.total.cacheCreation : null)

/**
 * One row per `by` value (kitVersion or project) from the run documents and the grade documents: runs, plans, parked per
 * run, fix rounds per plan, minutes per plan, decisions to grade per plan, ✗ per plan, flakes per run, tokens per plan
 * (input + output + cache read + cache creation; `null` = "-" when no run of the group had its transcripts).
 */
export function trendRows(runs, grades, by) {
  const groups = new Map()
  const g = (key) => {
    if (!groups.has(key)) groups.set(key, { key, runs: 0, plans: 0, parked: 0, fixRounds: 0, minutes: 0, minutesPlans: 0, decisions: 0, wrong: 0, flakes: 0, tokens: 0, tokenPlans: 0 })
    return groups.get(key)
  }
  for (const r of runs) {
    const x = g(String(r[by] ?? 'unknown'))
    const c = r.counts ?? {}
    x.runs++
    x.plans += c.plans ?? 0
    x.parked += c.parked ?? 0
    x.fixRounds += c.fixRounds ?? 0
    x.flakes += c.flakes ?? 0
    x.decisions += c.decisions ?? 0
    if (Number.isFinite(r.minutes)) {
      x.minutes += r.minutes
      x.minutesPlans += c.plans ?? 0
    }
    const t = tokenTotal(r.tokens)
    if (t !== null) {
      x.tokens += t
      x.tokenPlans += c.plans ?? 0
    }
  }
  for (const gr of grades) if (gr.humanVerdict === '✗') g(String(gr[by] ?? 'unknown')).wrong++
  return [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map((x) => ({
    [by]: x.key, runs: x.runs, plans: x.plans, parkedPerRun: avg(x.parked, x.runs), fixRoundsPerPlan: avg(x.fixRounds, x.plans), minutesPerPlan: avg(x.minutes, x.minutesPlans),
    decisionsPerPlan: avg(x.decisions, x.plans), wrongPerPlan: avg(x.wrong, x.plans), flakesPerRun: avg(x.flakes, x.runs), tokensPerPlan: x.tokenPlans ? Math.round(x.tokens / x.tokenPlans) : null,
  }))
}

export function trendTable(rows, by) {
  const head = [by, 'runs', 'plans', 'parked/run', 'fix rounds/plan', 'min/plan', 'decisions/plan', '✗/plan', 'flakes/run', 'tokens/plan']
  const body = rows.map((r) => [r[by], r.runs, r.plans, r.parkedPerRun, r.fixRoundsPerPlan, r.minutesPerPlan, r.decisionsPerPlan, r.wrongPerPlan, r.flakesPerRun, r.tokensPerPlan].map(cell))
  return [head, ...body].map((row) => `| ${row.join(' | ')} |`).join('\n').replace(/^(.*)\n/, `$1\n| ${head.map(() => '---').join(' | ')} |\n`)
}

/** Events grouped by signature: count, kind, projects that hit it, runs. Most frequent first. */
export function eventGroups(events) {
  const m = new Map()
  for (const e of events) {
    const k = `${e.kind}|${e.signature}`
    const x = m.get(k) ?? { kind: e.kind, signature: e.signature, count: 0, projects: new Set(), runs: new Set() }
    x.count++
    x.projects.add(e.project)
    x.runs.add(`${e.project}:${e.run}`)
    m.set(k, x)
  }
  return [...m.values()].sort((a, b) => b.count - a.count || (a.signature < b.signature ? -1 : 1))
}

function runLines(runDocs, plans) {
  const out = []
  for (const r of runDocs) {
    const c = r.counts ?? {}
    out.push(`${r.run} (${r.project}, kit ${r.kitVersion}, ${String(r.startedAt ?? '').slice(0, 16)}) ${cell(r.minutes)} min · ${c.plans ?? 0} plans · ${c.parked ?? 0} parked · ${c.fixRounds ?? 0} fix rounds`)
    for (const p of plans.filter((x) => x.project === r.project && x.run === r.run).sort((a, b) => (a.nnn < b.nnn ? -1 : 1))) {
      const m = p.minutes ?? {}
      out.push(`  ${p.nnn} ${p.state} — readiness ${cell(m.readiness)} · building ${cell(m.building)} · gate ${cell(m.gate)} · checks ${cell(m.checks)} · ui ${cell(m.ui)} · merge ${cell(m.merge)}`)
    }
  }
  return out
}

function parse(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) out._.push(a)
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i]
    else throw new Error(`${a} needs a value`)
  }
  return out
}

async function main(argv) {
  let f
  try {
    f = parse(argv)
  } catch (e) {
    process.stderr.write(`BRAIN_QUERY: ${e.message}\n`)
    return 2
  }
  const cmd = f._[0]
  if (!['runs', 'events', 'trend'].includes(cmd)) {
    process.stderr.write('BRAIN_QUERY: usage: node tools/brain-query.mjs <runs|events|trend> — see the header of this file\n')
    return 2
  }
  if (cmd === 'trend' && !['kitVersion', 'project'].includes(f.by)) {
    process.stderr.write('BRAIN_QUERY: trend needs --by kitVersion or --by project\n')
    return 2
  }
  const uri = process.env.KIT_BRAIN_READER_URI
  if (!uri) {
    process.stderr.write('BRAIN_QUERY: KIT_BRAIN_READER_URI is not set (docs/agent/kit-brain.md "Setup")\n')
    return 1
  }
  let client
  try {
    const MongoClient = await loadDriver({ driverPath: f.driver ?? process.env.KIT_BRAIN_DRIVER })
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 })
    await client.connect()
    const all = (c) => client.db(DB_NAME).collection(c).find({}).toArray()
    if (cmd === 'trend') {
      const [runs, grades] = await Promise.all([all('runs'), all('grades')])
      process.stdout.write(`${trendTable(trendRows(runs, grades, f.by), f.by)}\n`)
    } else if (cmd === 'runs') {
      let runs = (await all('runs')).filter((r) => !f.project || r.project === f.project).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      if (f.last) runs = runs.slice(0, Math.max(1, Number(f.last) || 1))
      const plans = await all('plans')
      process.stdout.write(`${runLines(runs, plans).join('\n') || 'no runs'}\n`)
    } else {
      const since = f.since ? Date.parse(f.since) : null
      const events = (await all('events')).filter((e) => e.kind !== 'setup-check' && (!f.kind || e.kind === f.kind) && (!f.signature || e.signature === f.signature) && (since === null || (e.at && Date.parse(e.at) >= since)))
      const lines = eventGroups(events).map((g) => `${g.count}× ${g.kind} — ${g.signature} (${[...g.projects].join(', ')}; ${g.runs.size} run(s))`)
      process.stdout.write(`${lines.join('\n') || 'no events'}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`BRAIN_QUERY: read failed — ${String(e?.message ?? e).split('\n')[0]}\n`)
    return 1
  } finally {
    await Promise.resolve(client?.close?.()).catch(() => {})
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.stdout.write('', () => process.exit(code)))
}
