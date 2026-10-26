/**
 * Decision log — records the decisions the Human graded wrong, finds repeated mistakes, and keeps the short rules file
 * builders read (docs/agent/decision-review.md).
 *
 *   node scripts/decision-log.mjs learn   --reply "<the Human's whole reply>"
 *       prints `LEARNING: record …` when the reply grades something wrong (a `✗` or a `failed:` card), else
 *       `LEARNING: nothing to record`. No model call: this is the gate in front of the learning step.
 *   node scripts/decision-log.mjs add     --reply "<graded reply>" --decisions <list.json|-> [--plan NNN] [--date YYYY-MM-DD]
 *                                         [--kinds D3=slug,D5=slug] [--checker-miss D3=yes,D5=no] [--dir <folder>]
 *       reply: `decisions: ok`, or `D<n> ✗ <what I'd choose>` items (several: comma-separated; `C<n>` for a failed
 *       card). The list file is a JSON array of { id, plan, text }. Only ✗ items are written (one row each) to
 *       docs/brain/decision-log.md; a malformed reply is refused (exit 2) and nothing is written.
 *   node scripts/decision-log.mjs repeats [--min 2] [--dir <folder>]
 *       kinds that appear in the log at least twice (the learning step proposes a rule for each)
 *   node scripts/decision-log.mjs rules   --check | --add "<one rule line>" [--dir <folder>]
 *       docs/brain/agent-rules.md is capped at 30 lines and 2,400 characters; --add refuses a rule that would exceed it
 *
 * Node built-ins only. Exit 0 = ok, 1 = a cap or file problem, 2 = usage (malformed reply, bad flag).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_LINES = 30
const MAX_CHARS = 2400
const LOG = 'docs/brain/decision-log.md'
const RULES = 'docs/brain/agent-rules.md'
const USAGE = 'usage: decision-log.mjs add --reply "decisions: ok | D<n> ✗ <what I\'d choose>[, D<m> ✗ …]" --decisions <list.json|->  (also: learn, repeats, rules --check|--add)'
const HEADER = [
  '| Date | Plan | Decision | Verdict | Human | Kind | Checker miss |',
  '| --- | --- | --- | --- | --- | --- | --- |',
]

/** The graded items of a reply, or { error }. `decisions: ok` -> { ok: true, items: [] }. */
export function parseReply(reply, knownIds) {
  const text = String(reply ?? '').trim()
  if (/^decisions:\s*ok\.?$/i.test(text)) return { ok: true, items: [] }
  const re = /([DC]\d+)\s*✗\s*([\s\S]*?)(?=\s*,?\s*[DC]\d+\s*✗|$)/g
  const items = []
  let consumed = ''
  for (const m of text.matchAll(re)) {
    const note = m[2].replace(/[\s,]+$/, '').trim()
    if (!note) return { error: `${m[1]} ✗ needs what you would choose after the mark` }
    if (knownIds && !knownIds.includes(m[1])) return { error: `${m[1]} is not in the list (${knownIds.join(', ')})` }
    items.push({ id: m[1], note })
    consumed += m[0]
  }
  if (!items.length) return { error: 'no `decisions: ok` and no `D<n> ✗ …` item found' }
  if (text.replace(/[\s,]/g, '') !== consumed.replace(/[\s,]/g, '')) return { error: 'text outside the `D<n> ✗ …` items' }
  const ids = items.map((i) => i.id)
  if (new Set(ids).size !== ids.length) return { error: 'a decision is graded twice' }
  return { ok: false, items }
}

const cell = (s) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '/').replace(/\s+/g, ' ').trim()
const today = () => new Date().toISOString().slice(0, 10)
const pairs = (s) => Object.fromEntries(String(s === true ? '' : (s ?? '')).split(',').map((p) => p.trim()).filter(Boolean).map((p) => p.split('=').map((x) => x.trim())))

function main(argv) {
  const cmd = argv[0]
  const flags = {}
  const usage = (why) => {
    process.stderr.write(`DECISION_LOG: ${why}\n${USAGE}\n`)
    process.exit(2)
  }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) usage(`unexpected argument "${a}"`)
    const eq = a.indexOf('=')
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1)
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i]
    else flags[a.slice(2)] = true
  }
  const dir = resolve(typeof flags.dir === 'string' ? flags.dir : process.cwd())
  const readLog = () => (existsSync(join(dir, LOG)) ? readFileSync(join(dir, LOG), 'utf8') : null)

  const rows = (text) => String(text ?? '').split(/\r?\n/).filter((l) => /^\|/.test(l) && !/^\|\s*(Date|-)/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((c) => c.length >= 7)
    .map(([date, plan, decision, verdict, human, kind, miss]) => ({ date, plan, decision, verdict, human, kind, miss }))

  const add = () => {
    if (typeof flags.reply !== 'string') usage('--reply is required')
    if (typeof flags.decisions !== 'string') usage('--decisions <list.json|-> is required')
    let list
    try {
      list = JSON.parse(flags.decisions === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(flags.decisions), 'utf8'))
    } catch (e) {
      usage(`cannot read the decisions list: ${e.message}`)
    }
    if (!Array.isArray(list) || list.some((d) => !d || !/^[DC]\d+$/.test(String(d.id)) || typeof d.text !== 'string')) usage('the decisions list must be a JSON array of { id: "D1", plan, text }')
    const parsed = parseReply(flags.reply, list.map((d) => d.id))
    if (parsed.error) usage(parsed.error)
    if (parsed.ok) {
      process.stdout.write('DECISION_LOG: all ok — nothing written\n')
      return
    }
    const date = typeof flags.date === 'string' ? flags.date : today()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) usage(`--date "${flags.date}" is not YYYY-MM-DD`)
    const kinds = pairs(flags.kinds)
    const miss = pairs(flags['checker-miss'])
    for (const [id, v] of Object.entries(miss)) if (!['yes', 'no'].includes(v)) usage(`--checker-miss ${id}=${v}: use yes or no`)
    const out = []
    const added = parsed.items.map((it) => {
      const d = list.find((x) => x.id === it.id)
      const kind = /^[a-z0-9][a-z0-9-]*$/.test(kinds[it.id] ?? '') ? kinds[it.id] : '-'
      const row = { date, plan: cell(d.plan ?? flags.plan ?? ''), decision: cell(d.text), verdict: '✗', human: cell(it.note), kind, miss: miss[it.id] ?? 'no' }
      out.push(`| ${row.date} | ${row.plan} | ${row.decision} | ${row.verdict} | ${row.human} | ${row.kind} | ${row.miss} |`)
      return { id: it.id, ...row }
    })
    const existing = readLog()
    const body = existing === null
      ? ['# Decision log', '', 'Decisions the Human graded wrong (`docs/agent/decision-review.md`). Builders do not read this file — they read `agent-rules.md`.', '', ...HEADER, ...out, ''].join('\n')
      : `${existing.replace(/\s*$/, '')}\n${out.join('\n')}\n`
    mkdirSync(dirname(join(dir, LOG)), { recursive: true })
    writeFileSync(join(dir, LOG), body)
    process.stdout.write(`DECISION_LOG: wrote ${added.length} row(s) to ${LOG}\nDECISION_LOG_JSON ${JSON.stringify(added)}\n`)
  }

  const repeats = () => {
    const min = Number(flags.min ?? 2)
    const byKind = new Map()
    for (const r of rows(readLog())) {
      if (r.kind === '-' || r.verdict !== '✗') continue
      byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r])
    }
    const hits = [...byKind].filter(([, v]) => v.length >= min)
    if (!hits.length) {
      process.stdout.write('REPEATS: none\n')
      return
    }
    for (const [kind, v] of hits) process.stdout.write(`REPEAT ${kind} x${v.length}: ${v.map((r) => `${r.date} ${r.plan} "${r.human}"`).join(' ; ')}\n`)
  }

  const rulesCmd = () => {
    const file = join(dir, RULES)
    const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
    const size = (t) => ({ lines: t.replace(/\s+$/, '') === '' ? 0 : t.replace(/\s+$/, '').split(/\r?\n/).length, chars: t.length })
    const over = (t) => {
      const s = size(t)
      return s.lines > MAX_LINES || s.chars > MAX_CHARS ? `${RULES} would be ${s.lines} lines / ${s.chars} characters — the cap is ${MAX_LINES} lines / ${MAX_CHARS} characters` : null
    }
    if (flags.add !== undefined) {
      if (typeof flags.add !== 'string' || !flags.add.trim()) usage('rules --add needs the rule text')
      const next = `${text.replace(/\s*$/, '')}\n- ${cell(flags.add).replace(/^-\s*/, '')}\n`
      const why = over(next)
      if (why) {
        process.stderr.write(`DECISION_LOG: ${why} — merge or drop an older rule first\n`)
        process.exit(1)
      }
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, next)
      process.stdout.write(`DECISION_LOG: rule added (${size(next).lines} lines / ${size(next).chars} characters)\n`)
      return
    }
    if (!flags.check) usage('rules needs --check or --add "<rule>"')
    if (!existsSync(file)) {
      process.stderr.write(`DECISION_LOG: ${RULES} is missing\n`)
      process.exit(1)
    }
    const why = over(text)
    if (why) {
      process.stderr.write(`DECISION_LOG: ${why}\n`)
      process.exit(1)
    }
    process.stdout.write(`DECISION_LOG: ${RULES} ok (${size(text).lines} lines / ${size(text).chars} characters; cap ${MAX_LINES} / ${MAX_CHARS})\n`)
  }

  const learn = () => {
    if (typeof flags.reply !== 'string') usage('--reply is required')
    process.stdout.write(/✗|\bfailed:/i.test(flags.reply) ? 'LEARNING: record — follow docs/agent/decision-review.md\n' : 'LEARNING: nothing to record\n')
  }

  if (cmd === 'add') add()
  else if (cmd === 'repeats') repeats()
  else if (cmd === 'rules') rulesCmd()
  else if (cmd === 'learn') learn()
  else usage(cmd ? `unknown command "${cmd}"` : 'a command is required')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
