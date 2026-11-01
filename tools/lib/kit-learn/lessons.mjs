/**
 * Kit-owned lessons (plan 046): one file per role under core/docs/agent/kit-lessons/<role>.md, rendered into every project
 * as docs/agent/kit-lessons/. A file is a two-line header, live lines and a `## Retired` section:
 *
 *   # Kit lessons — builder
 *   <one line: what the file is>
 *   - K3: <lesson> — why: <reason> (issue I7, since v1.13.0)
 *
 *   ## Retired
 *   - K1: <lesson> — why: <reason> (issue I2, since v1.12.0) — retired enforced:tools/test/x.test.mjs
 *
 * Code applies every change by id; a model only proposes the text. An edit touches the one line asked for and leaves every
 * other line byte-identical. Node built-ins only.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

export const KIT_LESSON_ROLES = ['readiness', 'builder', 'check-plan', 'check-bugs', 'check-rules', 'security', 'verify', 'ui', 'gate', 'planner']
export const KIT_LESSON_CAP = 2000
export const RETIRED_HEADING = '## Retired'

const LINE_RE = /^- (K\d+): (.+?) — why: (.+) \(issue (\S+), since v(\d+\.\d+\.\d+)\)(?: — retired (.+))?$/
const SAFETY_RE = /\b(auth\w*|security|secrets?|data[- ]loss|credential\w*|password\w*)\b/i

export const isSafety = (lesson) => SAFETY_RE.test(`${lesson.text} ${lesson.why}`)

export function formatLine({ id, text, why, issue, since }) {
  return `- ${id}: ${text} — why: ${why} (issue ${issue}, since v${since})`
}

/** One line -> { id, text, why, issue, since, retired } or null. */
export function parseLine(line) {
  const m = LINE_RE.exec(line)
  return m ? { id: m[1], text: m[2], why: m[3], issue: m[4], since: m[5], retired: m[6] ?? null, raw: line } : null
}

/** { eol, lines, live: [{ ...lesson, at }], retired: [{ ...lesson, at }], retiredAt } — `at` is the index in `lines`. */
export function parseFile(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const retiredAt = lines.findIndex((l) => l.trim() === RETIRED_HEADING)
  const live = []
  const retired = []
  lines.forEach((line, at) => {
    if (at < 2) return
    const p = parseLine(line)
    if (!p) return
    if (retiredAt !== -1 && at > retiredAt) retired.push({ ...p, at })
    else if (retiredAt === -1 || at < retiredAt) live.push({ ...p, at })
  })
  return { eol, lines, live, retired, retiredAt }
}

/** Characters of the live lines (joined by newlines, one trailing newline). */
export const liveChars = (live) => (live.length ? live.map((l) => l.raw).join('\n').length + 1 : 0)

export const fileOf = (dir, role) => join(dir, `${role}.md`)

export function readRole(dir, role) {
  const f = fileOf(dir, role)
  return existsSync(f) ? parseFile(readFileSync(f, 'utf8')) : null
}

/** Every role file of `dir`: { role -> parsed } (only files that exist). */
export function readAll(dir) {
  const out = {}
  if (!existsSync(dir)) return out
  for (const role of KIT_LESSON_ROLES) {
    const p = readRole(dir, role)
    if (p) out[role] = p
  }
  return out
}

export function nextId(all) {
  let max = 0
  for (const p of Object.values(all)) for (const l of [...p.live, ...p.retired]) max = Math.max(max, Number(l.id.slice(1)))
  return `K${max + 1}`
}

const oneLine = (s) => typeof s === 'string' && s.trim() !== '' && !/[\r\n]/.test(s) && !s.includes('{{') && !s.includes('}}') && !s.includes(' — why: ')
const joined = (p, lines) => lines.join(p.eol)
const BAD_TEXT = '--text and --why are each one line, not empty, with no "{{" or "}}" and no " — why: " inside'

/** { text, id, role, line } or { error }: the role file's new text with one live line added after the last live line. */
export function addLesson(dir, { role, text, why, issue, since }) {
  if (!KIT_LESSON_ROLES.includes(role)) return { error: `unknown role "${role}" — allowed: ${KIT_LESSON_ROLES.join(', ')}` }
  if (!oneLine(text) || !oneLine(why)) return { error: BAD_TEXT }
  if (!/^I\d+$/.test(String(issue ?? ''))) return { error: '--issue is a ledger id such as I7' }
  const p = readRole(dir, role)
  if (!p) return { error: `${fileOf(dir, role)} does not exist` }
  const id = nextId(readAll(dir))
  const line = formatLine({ id, text: text.trim(), why: why.trim(), issue, since })
  const at = p.live.length ? p.live[p.live.length - 1].at + 1 : 2
  const lines = [...p.lines.slice(0, at), line, ...p.lines.slice(at)]
  const q = parseFile(joined(p, lines))
  if (liveChars(q.live) > KIT_LESSON_CAP) return { error: `${role}.md would hold ${liveChars(q.live)} characters of live lines (cap ${KIT_LESSON_CAP}): retire or update a line first` }
  return { text: joined(p, lines), id, role, line }
}

/** Finds a lesson by id across the role files: { role, parsed, lesson, retired } or null. */
export function findLesson(dir, id) {
  for (const [role, parsed] of Object.entries(readAll(dir))) {
    const lesson = parsed.live.find((l) => l.id === id)
    if (lesson) return { role, parsed, lesson, retired: false }
    const old = parsed.retired.find((l) => l.id === id)
    if (old) return { role, parsed, lesson: old, retired: true }
  }
  return null
}

export function updateLesson(dir, id, { text, why }) {
  const f = findLesson(dir, id)
  if (!f || f.retired) return { error: `${id} is not a live lesson` }
  const next = { ...f.lesson, ...(text !== undefined ? { text: text.trim() } : {}), ...(why !== undefined ? { why: why.trim() } : {}) }
  if (!oneLine(next.text) || !oneLine(next.why)) return { error: BAD_TEXT }
  const line = formatLine(next)
  const lines = f.parsed.lines.slice()
  lines[f.lesson.at] = line
  const q = parseFile(joined(f.parsed, lines))
  if (liveChars(q.live) > KIT_LESSON_CAP) return { error: `${f.role}.md would hold ${liveChars(q.live)} characters of live lines (cap ${KIT_LESSON_CAP})` }
  return { text: joined(f.parsed, lines), role: f.role, line }
}

/** Moves a live line to the end of the file's `## Retired` section with the reason; a safety line needs `human`. */
export function retireLesson(dir, id, { reason, human = false }) {
  if (!/^(enforced|gone):\S/.test(String(reason ?? ''))) return { error: '--reason is enforced:<path> or gone:<why>' }
  const f = findLesson(dir, id)
  if (!f || f.retired) return { error: `${id} is not a live lesson` }
  if (isSafety(f.lesson) && !human) return { error: `${id} is a safety lesson (it names auth, security, secrets or data loss): retiring it needs --human` }
  const line = `${f.lesson.raw} — retired ${reason.trim()}`
  const lines = f.parsed.lines.filter((_, i) => i !== f.lesson.at)
  let at = lines.findIndex((l) => l.trim() === RETIRED_HEADING)
  if (at === -1) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
    lines.push('', RETIRED_HEADING)
    at = lines.length - 1
  }
  let end = lines.length
  while (end > at + 1 && lines[end - 1].trim() === '') end--
  lines.splice(end, 0, line)
  return { text: joined(f.parsed, lines), role: f.role, line }
}

/** Problems with the lesson files of `dir` (empty = ok): a role file over the cap, a live line that does not parse, a reused id. */
export function checkDir(dir) {
  const problems = []
  const ids = new Map()
  for (const role of KIT_LESSON_ROLES) {
    const p = readRole(dir, role)
    if (!p) {
      problems.push(`${role}.md is missing`)
      continue
    }
    const chars = liveChars(p.live)
    if (chars > KIT_LESSON_CAP) problems.push(`${role}.md holds ${chars} characters of live lines (cap ${KIT_LESSON_CAP})`)
    p.lines.forEach((line, at) => {
      const live = at >= 2 && /^- /.test(line) && (p.retiredAt === -1 || at < p.retiredAt)
      if (live && !parseLine(line)) problems.push(`${role}.md line ${at + 1} is not "- K<n>: <lesson> — why: <reason> (issue <id>, since v<x.y.z>)"`)
    })
    for (const l of [...p.live, ...p.retired]) {
      if (ids.has(l.id)) problems.push(`${l.id} is used in ${ids.get(l.id)}.md and ${role}.md`)
      ids.set(l.id, role)
    }
  }
  return problems
}

export const roleFileSeed = (role) => `# Kit lessons — ${role}\nLessons true for every project, kept by the kit (node tools/kit-lessons.mjs); read by the ${role} role before the project's own. At most 2,000 characters of live lines.\n\n${RETIRED_HEADING}\n`

export function writeText(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}
