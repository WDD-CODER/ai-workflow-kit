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
 *   node scripts/decision-log.mjs grade   --run <name> --reply "<graded reply>" --decisions <list.json|-> [--date YYYY-MM-DD] [--dir <folder>]
 *       one JSON line per listed decision (ok ones too) in docs/brain/decision-grades.jsonl — never twice for one run + id;
 *       the seen: items (and a behaviour: item the triage called follow-up) also go to docs/brain/follow-ups.md.
 *       The list is the orchestrator's decisions with their triage fields; a malformed reply is refused (exit 2).
 *   node scripts/decision-log.mjs stats   [--kind K] [--last N] [--write] [--dir <folder>]
 *       agreement between the triage agent and the Human per kind; --write keeps docs/brain/triage-calibration.md
 *       (at most 40 lines / 3,000 characters)
 *   node scripts/decision-log.mjs follow-ups --open [--files a,b] [--dir <folder>]
 *       the follow-up rows no plan has taken yet (a `follow-up: <run> <id>` line under plans/), for those files
 *   node scripts/decision-log.mjs repeats [--min 2] [--dir <folder>]
 *       kinds that appear in the log at least twice (the learning step proposes a rule for each)
 *   node scripts/decision-log.mjs rules   --check | --add "<one rule line>" [--dir <folder>]
 *       docs/brain/agent-rules.md is capped at 30 lines and 2,400 characters; --add refuses a rule that would exceed it
 *
 * Node built-ins only. Exit 0 = ok, 1 = a cap or file problem, 2 = usage (malformed reply, bad flag).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERDICTS = ['accept', 'ask', 'follow-up', 'noise']
const MAX_LINES = 30
const MAX_CHARS = 2400
const CAL_LINES = 40
const CAL_CHARS = 3 * 1000
const GRADES = 'docs/brain/decision-grades.jsonl'
const FOLLOWUPS = 'docs/brain/follow-ups.md'
const CALIBRATION = 'docs/brain/triage-calibration.md'
const LOG = 'docs/brain/decision-log.md'
const RULES = 'docs/brain/agent-rules.md'
const USAGE = 'usage: decision-log.mjs add --reply "decisions: ok | D<n> ✗ <what I\'d choose>[, D<m> ✗ …]" --decisions <list.json|->  (also: learn, repeats, rules --check|--add)'
const HEADER = [
  '| Date | Plan | Decision | Verdict | Human | Kind | Checker miss |',
  '| --- | --- | --- | --- | --- | --- | --- |',
]

/**
 * Agreement between the triage agent and the Human, from the grade rows (docs/brain/decision-grades.jsonl): a row
 * counts when the triage gave a verdict (not `none`) and the Human graded it; an `ask` agrees with `✗`, every other
 * verdict agrees with `ok`. Returns { kinds: { <kind>: { graded, agree, agreement } }, all: { last, graded, agree,
 * agreement } } — `all` covers the last `last` counted rows; `agreement` is a fraction, null with no rows.
 */
export function agreementStats(rows, { last = 50 } = {}) {
  const counted = (Array.isArray(rows) ? rows : []).filter((r) => r && VERDICTS.includes(r.triageVerdict) && (r.humanVerdict === 'ok' || r.humanVerdict === '✗'))
  const agrees = (r) => (r.triageVerdict === 'ask') === (r.humanVerdict === '✗')
  const tally = (list) => {
    const agree = list.filter(agrees).length
    return { graded: list.length, agree, agreement: list.length ? agree / list.length : null }
  }
  const kinds = {}
  for (const r of counted) (kinds[r.kind && r.kind !== '' ? r.kind : '-'] ??= []).push(r)
  return { kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, tally(v)])), all: { last, ...tally(counted.slice(-last)) } }
}

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

  const readJsonl = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)]
    } catch {
      return []
    }
  }) : [])
  const gradeRows = () => readJsonl(join(dir, GRADES))
  const FOLLOW_HEADER = [
    '# Follow-ups', '',
    'Defects and gaps agents saw outside their job (`docs/agent/decision-review.md` §5). Written by `node scripts/decision-log.mjs grade` — never by hand.', '',
    '| Date | Run | Plan | Id | File:line | Decision | Human |', '| --- | --- | --- | --- | --- | --- | --- |',
  ]
  const followRows = () => String(existsSync(join(dir, FOLLOWUPS)) ? readFileSync(join(dir, FOLLOWUPS), 'utf8') : '').split(/\r?\n/)
    .filter((l) => /^\|/.test(l) && !/^\|\s*(Date|-)/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim())).filter((c) => c.length >= 7)
    .map(([date, run, plan, id, fileLine, decision, human]) => ({ date, run, plan, id, fileLine, decision, human }))
  const fileLineOf = (text) => /[\w./-]+\.\w{1,5}:\d+/.exec(String(text))?.[0] ?? '-'
  const kitVersion = () => {
    try {
      return String(JSON.parse(readFileSync(join(dir, '.kit', 'install.json'), 'utf8'))?.kit?.version ?? 'unknown')
    } catch {
      return 'unknown'
    }
  }

  // Every graded item is one JSON line (ok ones too), so a later step can measure how often the triage agent and the
  // Human agreed; the seen: items (and a behaviour: item the triage called a follow-up) are kept as follow-up rows.
  const grade = () => {
    if (typeof flags.run !== 'string' || !flags.run) usage('--run is required')
    if (typeof flags.reply !== 'string') usage('--reply is required')
    if (typeof flags.decisions !== 'string') usage('--decisions <file> is required')
    let list
    try {
      list = JSON.parse(flags.decisions === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(flags.decisions), 'utf8'))
    } catch (e) {
      usage(`cannot read the decisions list: ${e.message}`)
    }
    if (!Array.isArray(list) || list.some((d) => !d || !/^[DC]\d+$/.test(String(d.id)) || typeof d.text !== 'string')) usage('the decisions list must be a JSON array of { id: "D1", plan, text, … }')
    const parsed = parseReply(flags.reply, list.map((d) => d.id))
    if (parsed.error) usage(parsed.error)
    const date = typeof flags.date === 'string' ? flags.date : today()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) usage(`--date "${flags.date}" is not YYYY-MM-DD`)
    const wrong = new Map(parsed.items.map((i) => [i.id, i.note]))
    const have = new Set(gradeRows().filter((r) => r.run === flags.run).map((r) => r.id))
    const version = kitVersion()
    const rowsOut = []
    const followOut = []
    const haveFollow = new Set(followRows().filter((r) => r.run === flags.run).map((r) => r.id))
    for (const d of list.filter((x) => String(x.id).startsWith('D'))) {
      if (have.has(d.id)) continue
      const type = /^\s*(behaviour|seen|removes):/i.exec(d.text)?.[1].toLowerCase() ?? 'behaviour'
      const verdict = ['accept', 'ask', 'follow-up', 'noise'].includes(d.verdict) ? d.verdict : 'none'
      const bad = wrong.has(d.id)
      rowsOut.push(JSON.stringify({
        date, run: flags.run, plan: String(d.plan ?? ''), id: d.id, type, kind: /^[a-z0-9][a-z0-9-]*$/.test(d.kind ?? '') ? d.kind : '-', text: String(d.text).replace(/\s+/g, ' ').trim().slice(0, 400),
        triageVerdict: verdict, triageRecommendation: String(d.rec ?? d.recommendation ?? ''), confidence: Number.isFinite(d.confidence) ? d.confidence : null,
        humanVerdict: bad ? '✗' : 'ok', humanChoice: bad ? wrong.get(d.id) : '', kitVersion: version,
      }))
      const keep = (type === 'seen' && !(verdict === 'noise' && !bad)) || (type === 'behaviour' && verdict === 'follow-up' && !bad)
      if (keep && !haveFollow.has(d.id)) followOut.push(`| ${date} | ${cell(flags.run)} | ${cell(d.plan)} | ${d.id} | ${cell(fileLineOf(d.text))} | ${cell(String(d.text).slice(0, 400))} | ${bad ? `✗ ${cell(wrong.get(d.id))}` : 'ok'} |`)
    }
    if (rowsOut.length) {
      mkdirSync(dirname(join(dir, GRADES)), { recursive: true })
      const old = existsSync(join(dir, GRADES)) ? readFileSync(join(dir, GRADES), 'utf8') : ''
      writeFileSync(join(dir, GRADES), `${old}${old && !old.endsWith('\n') ? '\n' : ''}${rowsOut.join('\n')}\n`)
    }
    if (followOut.length) {
      mkdirSync(dirname(join(dir, FOLLOWUPS)), { recursive: true })
      const old = existsSync(join(dir, FOLLOWUPS)) ? readFileSync(join(dir, FOLLOWUPS), 'utf8') : `${FOLLOW_HEADER.join('\n')}\n`
      writeFileSync(join(dir, FOLLOWUPS), `${old.replace(/\s*$/, '')}\n${followOut.join('\n')}\n`)
    }
    const x = rowsOut.filter((l) => JSON.parse(l).humanVerdict === '✗').length
    process.stdout.write(`DECISION_LOG: graded ${rowsOut.length} item(s) (${x} ✗) → ${GRADES}; ${followOut.length} follow-up(s) → ${FOLLOWUPS}\n`)
  }

  // Agreement per kind from the grade rows: an ask agrees with ✗, every other verdict with ok (rows the triage left
  // `none` are not counted). --write keeps docs/brain/triage-calibration.md, which the triage agent reads, short.
  const statsCmd = () => {
    const last = flags.last === undefined ? 50 : Number(flags.last)
    if (!(Number.isInteger(last) && last >= 1)) usage('--last takes a whole number')
    const rows = gradeRows()
    const stats = agreementStats(rows, { last })
    const pct = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)}%`)
    const kinds = Object.entries(stats.kinds).filter(([k]) => typeof flags.kind !== 'string' || k === flags.kind).sort((a, b) => b[1].graded - a[1].graded || (a[0] < b[0] ? -1 : 1))
    for (const [k, v] of kinds) process.stdout.write(`STATS ${k} graded=${v.graded} agreement=${pct(v.agreement)}\n`)
    process.stdout.write(`STATS all last=${last} agreement=${pct(stats.all.agreement)}\n`)
    if (flags.write !== true) return
    const disagreements = rows.filter((r) => ['accept', 'ask', 'follow-up', 'noise'].includes(r.triageVerdict) && (r.triageVerdict === 'ask') !== (r.humanVerdict === '✗'))
      .map((r) => `- ${r.date} ${r.kind || '-'}: triage ${r.triageVerdict}, Human ${r.humanVerdict}${r.humanChoice ? ` (${String(r.humanChoice).slice(0, 40)})` : ''} — ${String(r.text).replace(/\s+/g, ' ').slice(0, 100)}`)
    let examples = disagreements.slice(-20)
    const render = () => [
      '# Triage calibration', '',
      'Written by `node scripts/decision-log.mjs stats --write` from `decision-grades.jsonl`. The triage agent reads it; never edit it by hand.', '',
      `Agreement over the last ${stats.all.graded} graded: ${pct(stats.all.agreement)}`, '',
      '| Kind | Graded | Agreement |', '| --- | --- | --- |',
      ...Object.entries(stats.kinds).sort((a, b) => b[1].graded - a[1].graded || (a[0] < b[0] ? -1 : 1)).slice(0, 12).map(([k, v]) => `| ${k} | ${v.graded} | ${pct(v.agreement)} |`),
      ...(examples.length ? ['', 'Where the Human disagreed (newest last):', ...examples] : []),
    ].join('\n')
    let body = render()
    const fits = (t) => t.split('\n').length <= CAL_LINES && t.length + 1 <= CAL_CHARS
    while (!fits(body) && examples.length) {
      examples = examples.slice(1)
      body = render()
    }
    if (!fits(body)) {
      process.stderr.write(`DECISION_LOG: ${CALIBRATION} would be over ${CAL_LINES} lines / ${CAL_CHARS} characters even with no examples\n`)
      process.exit(1)
    }
    mkdirSync(dirname(join(dir, CALIBRATION)), { recursive: true })
    writeFileSync(join(dir, CALIBRATION), `${body}\n`)
    process.stdout.write(`DECISION_LOG: wrote ${CALIBRATION} (${body.split('\n').length} lines / ${body.length + 1} characters)\n`)
  }

  // Open follow-ups: rows no plan has taken yet (a `follow-up: <run> <id>` line in any file under plans/), for the files given.
  const followUpsCmd = () => {
    if (flags.open !== true) usage('follow-ups needs --open')
    const files = typeof flags.files === 'string' ? flags.files.split(',').map((f) => f.trim().replace(/\\/g, '/')).filter(Boolean) : null
    const taken = new Set()
    const walk = (d) => {
      for (const e of existsSync(d) ? readdirSync(d, { withFileTypes: true }) : []) {
        if (e.isDirectory()) walk(join(d, e.name))
        else if (/\.md$/.test(e.name)) for (const m of readFileSync(join(d, e.name), 'utf8').matchAll(/follow-up:\s*(\S+)\s+(D\d+)/g)) taken.add(`${m[1]} ${m[2]}`)
      }
    }
    walk(join(dir, 'plans'))
    const open = followRows().filter((r) => !taken.has(`${r.run} ${r.id}`) && (!files || files.includes(r.fileLine.replace(/:\d+$/, ''))))
    if (!open.length) {
      process.stdout.write('FOLLOW_UPS: none\n')
      return
    }
    for (const r of open) process.stdout.write(`FOLLOW_UP ${r.run} ${r.id} ${r.fileLine} — ${r.decision}\n`)
  }

  if (cmd === 'add') add()
  else if (cmd === 'grade') grade()
  else if (cmd === 'stats') statsCmd()
  else if (cmd === 'follow-ups') followUpsCmd()
  else if (cmd === 'repeats') repeats()
  else if (cmd === 'rules') rulesCmd()
  else if (cmd === 'learn') learn()
  else usage(cmd ? `unknown command "${cmd}"` : 'a command is required')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
