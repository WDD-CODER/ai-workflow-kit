#!/usr/bin/env node
/**
 * /kit-learn — the kit's problem ledger (plan 046; kit repository only, never rendered into a project).
 *
 *   node tools/kit-learn.mjs collect  [--top 5] [--dry-run]    new evidence -> ledger -> the ranked table and the CARDS line
 *                                                                (collect also records each card as shown: unanswered for 14 days = expired,
 *                                                                and links a planned issue to the plan that carries its `Source: brain issue` line)
 *   node tools/kit-learn.mjs apply    --reply "I1 plan · I2 lesson builder · I3 dismiss why · I4 later" [--dry-run]
 *   node tools/kit-learn.mjs plan-check plans/NNN-*.plan.md     exit 1: a plan from a brain issue has no regression test
 *   node tools/kit-learn.mjs lessons                            exposures and recurrences per kit lesson
 *   node tools/kit-learn.mjs trend    [--line]                  does the kit get better, per kit version
 *   node tools/kit-learn.mjs triage-prior [--dry-run]           per decision kind, agreement over every project's grades
 *
 * Reads the brain with KIT_BRAIN_READER_URI through the driver `scripts/brain.mjs setup` installed; the four kit-owned
 * collections (issues, proposals, autonomy, cursor) are written with the same user once the Human granted it INSERT/UPDATE.
 * `--driver <module.mjs>` loads a stub (tests). Flags for tests: --now <iso>, --kit-repo <folder> (git history of the kit),
 * --main-ref <ref> (default origin/main), --plans-dir, --lessons-dir, --state-dir (default .kit-learn), --cards <file>.
 * Exit 0 = ok, 1 = failed or refused, 2 = bad arguments. Node built-ins only.
 */
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { openStore, EVIDENCE } from './lib/kit-learn/store.mjs'
import { collectLedger, rank, rankedTable } from './lib/kit-learn/ledger.mjs'
import { isAncestor, fixCommitFor } from './lib/kit-learn/git.mjs'
import { parseReply, ALLOWED } from './lib/kit-learn/reply.mjs'
import { applyDecisions, pendingRows } from './lib/kit-learn/apply.mjs'
import { planCheck, MISSING } from './lib/kit-learn/plan-check.mjs'
import { readAll } from './lib/kit-learn/lessons.mjs'
import { lessonUpkeep, upkeepLine } from './lib/kit-learn/upkeep.mjs'
import { kitTrendRows, kitTrendTable, kitTrendLine } from './lib/kit-learn/trend.mjs'
import { agreementStats } from '../core/scripts/decision-log.mjs'

const kitRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const COMMANDS = ['collect', 'apply', 'plan-check', 'lessons', 'trend', 'triage-prior']
const BOOLEAN = ['dry-run', 'line']

function parse(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) out._.push(a)
    else if (BOOLEAN.includes(a.slice(2))) out[a.slice(2)] = true
    else if (argv[i + 1] !== undefined) out[a.slice(2)] = argv[++i]
    else throw new Error(`${a} needs a value`)
  }
  return out
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** plans/<NNN>-*.plan.md under `dir` (any depth): its text, or null. */
function readPlanFile(dir, nnn) {
  const walk = (d) => {
    if (!existsSync(d)) return null
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) {
        const r = walk(p)
        if (r) return r
      } else if (e.startsWith(`${String(nnn).padStart(3, '0')}-`) && e.endsWith('.plan.md')) return p
    }
    return null
  }
  const f = walk(dir)
  return f ? readFileSync(f, 'utf8') : null
}

/** The plan (any depth under `dir`) whose `Source: brain issue <id>` line names the issue: { nnn, fixture } or null. */
function planForIssue(dir, id) {
  const walk = (d) => {
    if (!existsSync(d)) return null
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) {
        const r = walk(p)
        if (r) return r
      } else if (/^\d{3}-.*\.plan\.md$/.test(e)) {
        const pc = planCheck(readFileSync(p, 'utf8'))
        if (pc.issue === id && pc.ok) return { nnn: e.slice(0, 3), fixture: pc.tests[0] ?? null }
      }
    }
    return null
  }
  return walk(dir)
}

const pct = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)}%`)

/** The triage prior file: per decision kind the agreement over every project's graded rows. */
export function triagePriorText(grades) {
  const stats = agreementStats(grades)
  const kinds = Object.entries(stats.kinds).sort((a, b) => b[1].graded - a[1].graded || (a[0] < b[0] ? -1 : 1))
  return [
    '# Kit triage prior', '',
    'Written by `node tools/kit-learn.mjs triage-prior` from the graded decisions of every project. The orchestrator\'s triage reads it for a kind the project has graded fewer than `orchestrator.triageMinGraded` times; never edit it by hand.', '',
    '| Kind | Graded | Agreement |', '| --- | --- | --- |',
    ...kinds.map(([k, v]) => `| ${k} | ${v.graded} | ${pct(v.agreement)} |`), '',
  ].join('\n')
}

export async function main(argv, { out = (s) => process.stdout.write(`${s}\n`), err = (s) => process.stderr.write(`${s}\n`) } = {}) {
  let f
  try {
    f = parse(argv)
  } catch (e) {
    err(`KIT_LEARN: ${e.message}`)
    return 2
  }
  const cmd = f._[0]
  if (!COMMANDS.includes(cmd)) {
    err(`KIT_LEARN: usage: node tools/kit-learn.mjs ${COMMANDS.join('|')} — see the header of this file`)
    return 2
  }
  const repo = resolve(f['kit-repo'] ?? kitRoot)
  const plansDir = resolve(f['plans-dir'] ?? join(repo, 'plans'))
  const lessonsDir = resolve(f['lessons-dir'] ?? join(kitRoot, 'core', 'docs', 'agent', 'kit-lessons'))
  const stateDir = resolve(f['state-dir'] ?? join(kitRoot, '.kit-learn'))
  const now = f.now ? Date.parse(f.now) : Date.now()
  if (!Number.isFinite(now)) {
    err('KIT_LEARN: --now is not a date')
    return 2
  }
  const git = { isAncestor: (a, b) => isAncestor(repo, a, b), fixCommitFor: (n) => fixCommitFor(repo, n, f['main-ref'] ?? 'origin/main'), planFor: (id) => planForIssue(plansDir, id) }

  if (cmd === 'plan-check') {
    if (!f._[1]) {
      err('KIT_LEARN: plan-check needs a plan file')
      return 2
    }
    if (!existsSync(f._[1])) {
      err(`KIT_LEARN: ${f._[1]} does not exist`)
      return 2
    }
    const r = planCheck(readFileSync(f._[1], 'utf8'))
    if (!r.ok) {
      err(`PLAN_CHECK: ${MISSING} (Source: brain issue ${r.issue})`)
      return 1
    }
    out(r.issue ? `PLAN_CHECK: ok — brain issue ${r.issue} is reproduced by ${r.tests.join(', ')}` : 'PLAN_CHECK: ok — no "Source: brain issue" line, nothing to prove')
    return 0
  }

  const uri = process.env.KIT_BRAIN_READER_URI
  if (!uri) {
    err('KIT_LEARN: KIT_BRAIN_READER_URI is not set (docs/agent/kit-brain.md "Setup")')
    return 1
  }
  let store
  try {
    store = await openStore({ uri, driverPath: f.driver ?? process.env.KIT_BRAIN_DRIVER })
  } catch (e) {
    err(`KIT_LEARN: cannot reach the brain — ${String(e?.message ?? e).split('\n')[0]}`)
    return 1
  }
  try {
    const evidence = Object.fromEntries(await Promise.all(EVIDENCE.map(async (c) => [c, await store.all(c)])))
    const [issues, proposals, cursors] = await Promise.all([store.all('issues'), store.all('proposals'), store.all('cursor')])
    const cursor = cursors.find((c) => c._id === 'collect') ?? null

    if (cmd === 'lessons') {
      const rows = lessonUpkeep({ lessons: readAll(lessonsDir), issues, ...evidence, minExposures: f['min-exposures'] ? Number(f['min-exposures']) : undefined })
      for (const r of rows) out(upkeepLine(r))
      if (!rows.length) out('KIT_LEARN: no live kit lessons')
      return 0
    }

    if (cmd === 'trend') {
      const rows = kitTrendRows(evidence)
      out(f.line ? kitTrendLine(rows) : kitTrendTable(rows))
      return 0
    }

    if (cmd === 'triage-prior') {
      const text = triagePriorText(evidence.grades)
      const file = resolve(f.out ?? join(lessonsDir, 'triage-calibration.md'))
      if (f['dry-run']) {
        out(text.trimEnd())
        return 0
      }
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text)
      out(`KIT_LEARN: wrote ${file} (${text.split('\n').length} lines)`)
      return 0
    }

    if (cmd === 'collect') {
      const upkeep = lessonUpkeep({ lessons: readAll(lessonsDir), issues, ...evidence })
      const r = collectLedger({ evidence, issues, proposals, cursor, now, git, upkeep })
      const rows = rank(r.issues, { now, top: Number(f.top ?? 5) })
      if (!f['dry-run']) {
        for (const id of r.changed) await store.put('issues', r.issues.find((i) => i._id === id))
        for (const id of r.expired) await store.put('proposals', { ...proposals.find((p) => p._id === id), decision: 'expired', decidedAt: new Date(now).toISOString() })
        // A card on the CARDS line is a card shown: a pending row, so one left unanswered for 14 days expires.
        for (const row of pendingRows({ ids: rows.filter((x) => x.card).map((x) => x._id), proposals: proposals.filter((p) => !r.expired.includes(p._id)), issues: r.issues, now })) await store.put('proposals', row)
        await store.put('cursor', r.cursor) // last: a failed write above leaves the cursor where it was
      }
      out(`COLLECT: ${r.newRuns.length} new run(s), ${r.created.length} new issue(s), ${r.changed.length} changed${f['dry-run'] ? ' (dry run: nothing written)' : ''}`)
      out(rankedTable(rows, { created: r.created }))
      out(`CARDS: ${rows.filter((x) => x.card).map((x) => x._id).join(' ') || '(none)'}`)
      return 0
    }

    // apply
    if (!f.reply) {
      err(`KIT_LEARN: apply needs --reply "…" — allowed: ${ALLOWED}`)
      return 2
    }
    const cardsFile = resolve(f.cards ?? join(stateDir, 'cards.json'))
    const cards = readJson(cardsFile) ?? {}
    const parsed = parseReply(f.reply, { known: issues.map((i) => i._id), recommend: Object.fromEntries(Object.entries(cards).filter(([, c]) => c?.recommend).map(([id, c]) => [id, c.recommend])) })
    if (parsed.error) {
      err(`KIT_LEARN: ${parsed.error}`)
      return 1
    }
    const a = applyDecisions({ items: parsed.items, issues, proposals, cards, now, readPlan: (n) => readPlanFile(plansDir, n), git })
    if (a.error) {
      err(`KIT_LEARN: ${a.error}`)
      return 1
    }
    if (!f['dry-run']) {
      for (const row of a.proposals) await store.put('proposals', row)
      for (const issue of a.issues) await store.put('issues', issue)
    }
    out(`APPLY: ${a.proposals.length} decision(s)${f['dry-run'] ? ' (dry run: nothing written)' : ' recorded'}`)
    for (const p of a.proposals) out(`  ${p.issue} ${p.decision}${p.arg ? ` ${p.arg}` : ''}${p.protected ? ' [protected]' : ''}`)
    for (const s of a.steps) out(`NEXT: ${s}`)
    return 0
  } catch (e) {
    err(`KIT_LEARN: ${cmd} failed — ${String(e?.message ?? e).split('\n')[0]}`)
    return 1
  } finally {
    await store.close()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.stdout.write('', () => process.exit(code)))
}
