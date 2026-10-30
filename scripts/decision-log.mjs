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
 *       kinds that appear in the log at least twice (the learning step proposes a rule for each); a pending rule
 *       (` (pending — seen once)`) of such a kind is promoted — the suffix and its `[kind]` tag are dropped
 *   node scripts/decision-log.mjs rules   --check | --enforce | --add "<one rule line>" [--section builder|checkers|readiness|ui]
 *                                         [--pending --kind <slug>] [--dir <folder>]
 *       docs/brain/agent-rules.md has one section per role (`## builder`, `## checkers`, `## readiness`, `## ui`); each is
 *       capped at 30 lines and 2,400 characters (--check names a section that is over); --add refuses a rule that would
 *       exceed it (default section `builder`). A line that starts with `enforce:` goes to `## enforce candidates` (cap 10
 *       lines, never read by an agent); --enforce lists them.
 *   node scripts/decision-log.mjs lessons --check | --add --role <r> --text "<lesson>" [--run <name>] [--date YYYY-MM-DD] [--dir <folder>]
 *       docs/brain/agent-lessons/<role>.md: a two-line header, then at most 40 lines / 3,000 characters of
 *       `- <date> <run>: <lesson>` lines, newest last; --add drops the oldest lines first and prints which
 *   node scripts/decision-log.mjs case    --from D<n> --run <name> [--checker orch-check-bugs] [--dir <folder>]
 *       an eval-case scaffold for a checker miss (no model call): docs/agent-evals/cases/<checker>/<date>-<kind>/
 *
 * Node built-ins only. Exit 0 = ok, 1 = a cap or file problem, 2 = usage (malformed reply, bad flag).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const VERDICTS = ['accept', 'ask', 'follow-up', 'noise']
const MAX_LINES = 30
const MAX_CHARS = 2400
const ENFORCE = 'enforce candidates'
const ENFORCE_LINES = 10
export const RULE_SECTIONS = ['builder', 'checkers', 'readiness', 'ui']
export const PENDING = ' (pending — seen once)'
export const LESSON_ROLES = ['readiness', 'builder', 'check-plan', 'check-bugs', 'check-rules', 'security', 'verify', 'ui', 'gate', 'planner']
export const LESSON_LINES = 40
export const LESSON_CHARS = 3000
const LESSONS_DIR = 'docs/brain/agent-lessons'
const CHECKERS = ['orch-check-plan', 'orch-check-bugs', 'orch-check-rules']
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

// ---- lessons: docs/brain/agent-lessons/<role>.md (plan 030) -------------------------------------------------------------
const oneLine = (s) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()

/** The seed of a role's lessons file: a two-line header and nothing else. */
export function lessonSeed(role) {
  return [`# Lessons — ${role}`, `Facts from earlier runs of the ${role} role in this project, written by scripts (\`node scripts/orch-state.mjs lessons\`) and read by the role at launch. At most ${LESSON_LINES} lines / ${LESSON_CHARS} characters, newest last.`].join('\n') + '\n'
}

/** { header: first two lines, body: the non-blank lines after them }. */
export function lessonParts(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
  return { header: lines.slice(0, 2), body: lines.slice(2).filter((l) => l.trim() !== '') }
}

/** { lines, chars } of a lessons body (the lines after the two-line header). */
export const lessonSize = (body) => ({ lines: body.length, chars: body.length ? body.join('\n').length + 1 : 0 })

/** The lesson after the `- <date> <run>: ` prefix of one line. */
export const lessonOf = (line) => String(line).replace(/^-\s+\S+\s+\S+?:\s+/, '')

/**
 * Adds one lesson line to a role's file text (a missing file starts from the seed). A lesson already in the file — the
 * same text, or a match of `dedupe` (a RegExp tested against each lesson) — adds nothing. Over the cap, the oldest lines
 * go first: returns { text, added, dropped: [line…] }.
 */
export function addLesson(existing, role, { date, run, text, dedupe = null }) {
  const base = existing && String(existing).trim() ? String(existing) : lessonSeed(role)
  const { header, body } = lessonParts(base)
  const lesson = oneLine(text).slice(0, 300)
  if (!lesson) return { text: base, added: false, dropped: [] }
  const have = body.map(lessonOf)
  if (dedupe instanceof RegExp ? have.some((t) => dedupe.test(t)) : have.includes(lesson)) return { text: base, added: false, dropped: [] }
  const next = [...body, `- ${date} ${run}: ${lesson}`]
  const dropped = []
  while (next.length > 1 && (next.length > LESSON_LINES || lessonSize(next).chars > LESSON_CHARS)) dropped.push(next.shift())
  return { text: `${[...header, ...next].join('\n')}\n`, added: true, dropped }
}

// ---- rules: docs/brain/agent-rules.md, one section per role (plan 030) ---------------------------------------------------
function ruleLayout(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
  const heads = []
  lines.forEach((l, i) => {
    const m = /^##\s+(.+?)\s*$/.exec(l)
    if (m) heads.push({ name: m[1].toLowerCase(), at: i })
  })
  return { lines, heads }
}
// The lines of a section: after its `## name` heading up to the next heading; `builder` without a heading of its own is
// everything before the first heading (the v1.7.0 file had no sections: the whole file is the builder's).
function sectionRange(layout, name) {
  const i = layout.heads.findIndex((h) => h.name === name)
  if (i >= 0) return { start: layout.heads[i].at + 1, end: layout.heads[i + 1]?.at ?? layout.lines.length, head: true }
  if (name === 'builder') return { start: 0, end: layout.heads[0]?.at ?? layout.lines.length, head: false }
  return null
}
const bodySize = (bodyLines) => {
  const t = bodyLines.join('\n').replace(/^\s+|\s+$/g, '')
  return t === '' ? { lines: 0, chars: 0 } : { lines: t.split('\n').length, chars: t.length + 1 }
}
const sectionBody = (text, name) => {
  const l = ruleLayout(text)
  const r = sectionRange(l, name)
  return r ? l.lines.slice(r.start, r.end) : []
}
const capOf = (name) => (name === ENFORCE ? { lines: ENFORCE_LINES, chars: MAX_CHARS } : { lines: MAX_LINES, chars: MAX_CHARS })

/** The rule lines (`- …`) of one section of agent-rules.md text; [] when the section is missing. */
export function ruleLines(text, name = 'builder') {
  const layout = ruleLayout(text)
  const r = sectionRange(layout, name)
  return r ? layout.lines.slice(r.start, r.end).map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => l.replace(/^-\s+/, '')) : []
}

/** Every section over its cap: [{ section, lines, chars, capLines, capChars }]. */
export function rulesOver(text) {
  const layout = ruleLayout(text)
  const names = [...new Set([...(sectionRange(layout, 'builder') ? ['builder'] : []), ...layout.heads.map((h) => h.name)])]
  return names.flatMap((name) => {
    const r = sectionRange(layout, name)
    const s = bodySize(layout.lines.slice(r.start, r.end))
    const cap = capOf(name)
    return s.lines > cap.lines || s.chars > cap.chars ? [{ section: name, ...s, capLines: cap.lines, capChars: cap.chars }] : []
  })
}

/** Appends one rule line to a section (created when missing). Returns the new text. */
export function addRule(text, section, rule) {
  const layout = ruleLayout(text)
  const line = `- ${oneLine(rule).replace(/^-\s*/, '')}`
  const r = sectionRange(layout, section)
  const lines = layout.lines
  if (!r) {
    const base = String(text ?? '').replace(/\s+$/, '')
    return `${base}${base ? '\n\n' : ''}## ${section}\n\n${line}\n`
  }
  let last = -1
  for (let i = r.end - 1; i >= r.start; i--) if (lines[i].trim() !== '') { last = i; break }
  if (last >= 0) lines.splice(last + 1, 0, line)
  else lines.splice(r.start, r.end - r.start, ...(r.head ? ['', line, ''] : [line, '']))
  return `${lines.join('\n').replace(/\s+$/, '')}\n`
}

/** Drops ` (pending — seen once)` and the `[kind] ` tag from every pending rule of the given kinds. Returns { text, promoted }. */
export function promotePending(text, kinds) {
  let promoted = 0
  const out = String(text).split('\n').map((l) => {
    const m = /^(-\s+)\[([a-z0-9][a-z0-9-]*)\]\s+(.*?)\s*\(pending — seen once\)\s*$/.exec(l)
    if (!m || !kinds.includes(m[2])) return l
    promoted++
    return `${m[1]}${m[3]}`
  })
  return { text: out.join('\n'), promoted }
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
    // A rule starts at the first ✗ of a kind (pending — seen once); the second row of that kind promotes it (`repeats`).
    const seenKinds = new Set(rows(readLog()).filter((r) => r.verdict === '✗' && r.kind !== '-').map((r) => r.kind))
    const added = parsed.items.map((it) => {
      const d = list.find((x) => x.id === it.id)
      const kind = /^[a-z0-9][a-z0-9-]*$/.test(kinds[it.id] ?? '') ? kinds[it.id] : '-'
      const row = { date, plan: cell(d.plan ?? flags.plan ?? ''), decision: cell(d.text), verdict: '✗', human: cell(it.note), kind, miss: miss[it.id] ?? 'no' }
      out.push(`| ${row.date} | ${row.plan} | ${row.decision} | ${row.verdict} | ${row.human} | ${row.kind} | ${row.miss} |`)
      const ruleState = kind === '-' ? 'none' : seenKinds.has(kind) ? 'repeat' : 'pending'
      if (kind !== '-') seenKinds.add(kind)
      return { id: it.id, ...row, ruleState, sections: row.miss === 'yes' ? ['builder', 'checkers'] : ['builder'] }
    })
    const existing = readLog()
    const body = existing === null
      ? ['# Decision log', '', 'Decisions the Human graded wrong (`docs/agent/decision-review.md`). Builders do not read this file — they read `agent-rules.md`.', '', ...HEADER, ...out, ''].join('\n')
      : `${existing.replace(/\s*$/, '')}\n${out.join('\n')}\n`
    mkdirSync(dirname(join(dir, LOG)), { recursive: true })
    writeFileSync(join(dir, LOG), body)
    const proposals = added.filter((a) => a.ruleState === 'pending').map((a) => `RULE_PROPOSAL ${a.id} ${a.kind} pending — word one rule now: rules --add "<rule>" --pending --kind ${a.kind}${a.miss === 'yes' ? ' (also --section checkers)' : ''}\n`)
    process.stdout.write(`DECISION_LOG: wrote ${added.length} row(s) to ${LOG}\n${proposals.join('')}DECISION_LOG_JSON ${JSON.stringify(added)}\n`)
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
    // The second row of a kind promotes the rule the first one started: the pending suffix and the kind tag go.
    const file = join(dir, RULES)
    if (!existsSync(file)) return
    const p = promotePending(readFileSync(file, 'utf8'), hits.map(([k]) => k))
    if (p.promoted) {
      writeFileSync(file, p.text)
      process.stdout.write(`DECISION_LOG: promoted ${p.promoted} pending rule(s) in ${RULES}\n`)
    }
  }

  const rulesCmd = () => {
    const file = join(dir, RULES)
    const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
    // The section a problem names: every section over its cap, with its size.
    const overMsg = (t) => rulesOver(t).map((o) => `${RULES} section "${o.section}" would be ${o.lines} lines / ${o.chars} characters — the cap is ${o.capLines} lines / ${o.capChars} characters`)
    if (flags.enforce === true) {
      const lines = ruleLines(text, ENFORCE)
      if (!lines.length) process.stdout.write('ENFORCE: none\n')
      for (const l of lines) process.stdout.write(`ENFORCE ${l}\n`)
      return
    }
    if (flags.add !== undefined) {
      if (typeof flags.add !== 'string' || !flags.add.trim()) usage('rules --add needs the rule text')
      let rule = cell(flags.add).replace(/^-\s*/, '').trim()
      // `enforce: <what would catch it>` is not a rule: it goes to a section no agent reads, and the wrap-up lists it.
      const enforce = /^enforce:\s*/i.test(rule)
      let section = enforce ? ENFORCE : typeof flags.section === 'string' ? flags.section.toLowerCase() : 'builder'
      if (enforce) rule = rule.replace(/^enforce:\s*/i, '')
      if (!enforce && !RULE_SECTIONS.includes(section)) usage(`--section "${section}" — use ${RULE_SECTIONS.join(', ')}`)
      if (flags.pending === true) {
        if (typeof flags.kind !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(flags.kind)) usage('--pending needs --kind <slug>')
        rule = `[${flags.kind}] ${rule}${PENDING}`
      }
      if (!rule) usage('rules --add needs the rule text')
      const next = addRule(text, section, rule)
      const why = overMsg(next).filter((m) => m.includes(`section "${section}"`))
      if (why.length) {
        process.stderr.write(`DECISION_LOG: ${why[0]} — merge or drop an older rule first\n`)
        process.exit(1)
      }
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, next)
      const o = bodySize(sectionBody(next, section))
      process.stdout.write(`DECISION_LOG: ${enforce ? 'enforce candidate' : 'rule'} added to ${section} (${o.lines} lines / ${o.chars} characters)\n`)
      return
    }
    if (!flags.check) usage('rules needs --check, --enforce or --add "<rule>"')
    if (!existsSync(file)) {
      process.stderr.write(`DECISION_LOG: ${RULES} is missing\n`)
      process.exit(1)
    }
    const why = overMsg(text)
    if (why.length) {
      process.stderr.write(`${why.map((m) => `DECISION_LOG: ${m}`).join('\n')}\n`)
      process.exit(1)
    }
    const sizes = ['builder', ...RULE_SECTIONS.slice(1), ENFORCE].filter((n) => sectionBody(text, n).length || n === 'builder').map((n) => `${n} ${bodySize(sectionBody(text, n)).lines}`)
    process.stdout.write(`DECISION_LOG: ${RULES} ok (lines per section: ${sizes.join(', ')}; cap ${MAX_LINES} lines / ${MAX_CHARS} characters each, enforce candidates ${ENFORCE_LINES} lines)\n`)
  }

  // docs/brain/agent-lessons/<role>.md: --check holds every file to its cap; --add appends one lesson, oldest lines out first.
  const lessonsCmd = () => {
    const folder = join(dir, LESSONS_DIR)
    if (flags.add === true) {
      const role = String(flags.role ?? '')
      if (!LESSON_ROLES.includes(role)) usage(`--role "${role}" — use ${LESSON_ROLES.join(', ')}`)
      if (typeof flags.text !== 'string' || !flags.text.trim()) usage('lessons --add needs --text "<the lesson>"')
      const date = typeof flags.date === 'string' ? flags.date : today()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) usage(`--date "${flags.date}" is not YYYY-MM-DD`)
      const run = typeof flags.run === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(flags.run) ? flags.run : 'manual'
      const file = join(folder, `${role}.md`)
      const r = addLesson(existsSync(file) ? readFileSync(file, 'utf8') : '', role, { date, run, text: flags.text })
      if (!r.added) {
        process.stdout.write(`DECISION_LOG: lesson already in ${LESSONS_DIR}/${role}.md — nothing written\n`)
        return
      }
      mkdirSync(folder, { recursive: true })
      writeFileSync(file, r.text)
      if (r.dropped.length) process.stdout.write(`DECISION_LOG: ${role}.md is full — dropped the oldest ${r.dropped.length} line(s):\n${r.dropped.map((l) => `  ${l}`).join('\n')}\n`)
      const s = lessonSize(lessonParts(r.text).body)
      process.stdout.write(`DECISION_LOG: lesson added to ${LESSONS_DIR}/${role}.md (${s.lines} lines / ${s.chars} characters)\n`)
      return
    }
    if (flags.check !== true) usage('lessons needs --check or --add --role <r> --text "<lesson>"')
    const bad = []
    const sizes = []
    for (const f of existsSync(folder) ? readdirSync(folder).filter((n) => n.endsWith('.md')).sort() : []) {
      const s = lessonSize(lessonParts(readFileSync(join(folder, f), 'utf8')).body)
      sizes.push(`${f.replace(/\.md$/, '')} ${s.lines}`)
      if (s.lines > LESSON_LINES || s.chars > LESSON_CHARS) bad.push(`${LESSONS_DIR}/${f} is ${s.lines} lines / ${s.chars} characters — the cap is ${LESSON_LINES} lines / ${LESSON_CHARS} characters`)
    }
    if (bad.length) {
      process.stderr.write(`${bad.map((m) => `DECISION_LOG: ${m}`).join('\n')}\n`)
      process.exit(1)
    }
    process.stdout.write(`DECISION_LOG: ${LESSONS_DIR} ok (${sizes.length ? sizes.join(', ') : 'no files yet'}; cap ${LESSON_LINES} lines / ${LESSON_CHARS} characters each)\n`)
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

  // A graded checker miss becomes an eval case with no model call (plan 030): docs/agent-evals/cases/<checker>/<date>-<kind>/
  // in the harness shape (docs/agent/agent-evals.md "Case shape"): input/plan.md, input/diff.patch (the hunk around the
  // decision's file:line), the touched file under input/, expected.json (one finding there, a `human-verdict <date>:`
  // note) and a README. The decision comes from the run's status.json (or --decisions), the Human's line from the log row
  // `add` wrote. The case holds project code: it stays in the project's own case set.
  const caseCmd = () => {
    if (!/^D\d+$/.test(String(flags.from ?? ''))) usage('case needs --from D<n>')
    if (typeof flags.run !== 'string' || !flags.run) usage('--run is required')
    const checker = typeof flags.checker === 'string' ? flags.checker : 'orch-check-bugs'
    if (!CHECKERS.includes(checker)) usage(`--checker "${checker}" — use ${CHECKERS.join(', ')}`)
    const die = (why) => {
      process.stderr.write(`DECISION_LOG: case: ${why}\n`)
      process.exit(1)
    }
    let list = []
    if (typeof flags.decisions === 'string') {
      try {
        list = JSON.parse(readFileSync(resolve(flags.decisions), 'utf8'))
      } catch (e) {
        usage(`cannot read the decisions list: ${e.message}`)
      }
    } else {
      const status = [`.claude/orchestrator-runs/${flags.run}/status.json`, `docs/orchestrator/runs/${flags.run}/status.json`].map((r) => join(dir, r)).find((f) => existsSync(f))
      if (status) list = JSON.parse(readFileSync(status, 'utf8')).decisions ?? []
    }
    const d = (Array.isArray(list) ? list : []).find((x) => x?.id === flags.from)
    if (!d) die(`${flags.from} is not among the decisions of run ${flags.run}`)
    const row = rows(readLog()).reverse().find((r) => r.verdict === '✗' && r.decision === cell(d.text))
    if (!row) die(`${flags.from} is not in ${LOG} — run \`add\` for the graded reply first`)
    const fl = /([\w./-]+\.\w{1,5}):(\d+)/.exec(`${d.text} ${row.human}`)
    if (!fl || fl[1].includes('..') || fl[1].startsWith('/')) die(`${flags.from} names no file:line — no case can be built`)
    const [, file, lineStr] = fl
    const line = Number(lineStr)
    const git = (...a) => {
      const r = spawnSync('git', a, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      return { status: r.status ?? 1, out: (r.stdout ?? '').replace(/\r?\n+$/, '') }
    }
    const plan = String(row.plan || d.plan || '')
    const padded = plan.padStart(3, '0')
    // Where the plan's change lives: the plan branch when it is still unmerged, else the merge commit on this branch.
    const tipRef = git('for-each-ref', '--format=%(refname)', `refs/heads/feat/${padded}-*`, `refs/remotes/origin/feat/${padded}-*`, `refs/heads/feat/${plan}-*`, `refs/remotes/origin/feat/${plan}-*`).out.split('\n').filter(Boolean)[0]
    const mergeCommit = git('log', '--first-parent', '--format=%H', '-n1', '-E', `--grep=\\(plan 0*${plan.replace(/^0+/, '')}\\)`).out
    let base
    let tip
    if (tipRef) {
      const mb = git('merge-base', 'HEAD', tipRef)
      tip = tipRef
      base = mb.status === 0 && mb.out !== git('rev-parse', tipRef).out ? mb.out : null
    }
    if (!base && mergeCommit) {
      base = `${mergeCommit}^1`
      tip = mergeCommit
    }
    if (!base || !tip) die(`no plan branch and no merge commit found for plan ${plan}`)
    const diff = git('diff', '-U3', base, tip, '--', file)
    if (diff.status !== 0 || !diff.out) die(`no change to ${file} between ${base} and ${tip}`)
    const parts = diff.out.split(/\n(?=@@ )/)
    const head = parts[0].startsWith('@@') ? '' : `${parts.shift()}\n`
    const span = (h) => {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(h)
      return m ? [Number(m[1]), Number(m[1]) + Number(m[2] ?? 1) - 1] : [0, 0]
    }
    const dist = (h) => {
      const [a, b] = span(h)
      return line >= a && line <= b ? 0 : Math.min(Math.abs(line - a), Math.abs(line - b))
    }
    const hunk = [...parts].sort((x, y) => dist(x) - dist(y))[0]
    const content = git('show', `${tip}:${file}`)
    if (content.status !== 0) die(`cannot read ${file} at ${tip}`)
    const planFile = (() => {
      const walk = (d0) => (existsSync(d0) ? readdirSync(d0, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d0, e.name)) : [join(d0, e.name)])) : [])
      return walk(join(dir, 'plans')).find((f) => new RegExp(`[\\\\/](0*${plan.replace(/^0+/, '')}|${padded})-[^\\\\/]*\\.plan\\.md$`).test(f))
    })()
    const kind = row.kind === '-' ? 'checker-miss' : row.kind
    const folder = join(dir, 'docs', 'agent-evals', 'cases', checker, `${row.date}-${kind}`)
    if (existsSync(join(folder, 'expected.json'))) {
      process.stdout.write(`DECISION_LOG: case exists — ${relPath(folder)}\n`)
      return
    }
    const put = (rel, text) => {
      mkdirSync(dirname(join(folder, rel)), { recursive: true })
      writeFileSync(join(folder, rel), text.endsWith('\n') ? text : `${text}\n`)
    }
    put('input/plan.md', planFile ? readFileSync(planFile, 'utf8') : `# Plan ${plan}\n\n(the plan file was not found in plans/)`)
    put('input/diff.patch', `${head}${hunk}`)
    put(`input/${file}`, content.out)
    put('expected.json', JSON.stringify({
      note: `human-verdict ${row.date}: ${row.human}`,
      findings: [{ file, line, rule: [...new Set([kind, kind.replace(/-/g, ' ')])], severity: 'major' }],
    }, null, 2))
    put('README.md', `# ${row.date}-${kind}\n\nA checker miss the Human graded \`✗\` (run ${flags.run}, plan ${plan}, decision ${flags.from}). The finder that ran: \`${checker}\`.\n\nDecision: ${row.decision}\n\nThe Human's line: ${row.human}\n\nBuilt by \`node scripts/decision-log.mjs case\` from the plan branch; the case holds project code and stays in this project's case set (\`docs/agent/agent-evals.md\`).`)
    process.stdout.write(`DECISION_LOG: case written — ${relPath(folder)}\n`)
  }
  const relPath = (p) => p.slice(dir.length + 1).replace(/\\/g, '/')

  if (cmd === 'add') add()
  else if (cmd === 'grade') grade()
  else if (cmd === 'stats') statsCmd()
  else if (cmd === 'follow-ups') followUpsCmd()
  else if (cmd === 'repeats') repeats()
  else if (cmd === 'rules') rulesCmd()
  else if (cmd === 'lessons') lessonsCmd()
  else if (cmd === 'case') caseCmd()
  else if (cmd === 'learn') learn()
  else usage(cmd ? `unknown command "${cmd}"` : 'a command is required')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
