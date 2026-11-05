/**
 * Pre-commit security grep (Security Officer vulnerability patterns):
 * 1) [innerHTML] without a nearby sanitizer call
 * 2) console.log / LoggingService calls with a likely-PII name — on the log line itself, or carried by a variable the
 *    same file assigned from a likely-PII expression earlier
 *
 * A deliberate exception is one line, never a folder: put `security-grep-allow: <reason of at least 10 characters>` in
 * a comment on the line the guard would block. The reason is printed when the guard passes that line, so every exception
 * shows in the commit output. No path, folder, option or environment variable turns the guard off.
 *
 * `scanGuardText(text, file)` is the rule set as a function (the orchestrator's preflight runs it over the code a plan
 * prescribes); run as a script it checks the staged files and exits 1 when one is blocked.
 */
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { resolve } from 'path'

const PII_NAMES = /\b(email|password|token|fullName|full_name|phone|ssn|creditCard|credit_card)\b/i
const LOG_CALL = /\bconsole\.log\s*\(|\bLoggingService\b|\.log\s*\(/
const ALLOW = /security-grep-allow:\s*(.*?)\s*(?:\*\/|-->)?\s*$/
const MIN_REASON = 10
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The rules, each marked with its RULE id so a hit can name the line of this file that holds it.
export const GUARD_RULES = [
  { id: 'inner-html', rule: '[innerHTML]/innerHTML without nearby sanitizer' }, // RULE inner-html
  { id: 'pii-log', rule: 'log call references likely-PII name' }, // RULE pii-log
]
const SELF = (() => {
  try {
    return readFileSync(fileURLToPath(import.meta.url), 'utf8').split(/\r?\n/)
  } catch {
    return []
  }
})()
const ruleLine = (id) => SELF.findIndex((l) => l.includes(`// RULE ${id}`)) + 1
const ruleOf = (id) => GUARD_RULES.find((r) => r.id === id)

/** The reason of an allow marker on this line, or null when there is none or it is shorter than MIN_REASON. */
function allowReason(line) {
  const m = ALLOW.exec(line)
  const reason = m ? m[1].trim() : ''
  return reason.length >= MIN_REASON ? reason : null
}

/**
 * The lines of `text` the guard blocks: [{ line, rule, id, ruleLine, text }]. `file` is used for the message only — it
 * never exempts anything. A line with a valid allow marker is not a hit; its reason is returned in `allowed`.
 */
export function scanGuardText(text, file) {
  const lines = String(text).split(/\r?\n/)
  const hits = []
  const carriers = new Set()
  lines.forEach((line, i) => {
    // A variable assigned from a likely-PII expression carries the value to a later log call in the same file.
    const assign = /(?:\b(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=(?!=)\s*(.+)$/.exec(line)
    if (assign && !LOG_CALL.test(line) && PII_NAMES.test(assign[2])) carriers.add(assign[1])
    const hit = (id) => {
      if (allowReason(line)) return
      hits.push({ line: i + 1, id, rule: ruleOf(id).rule, ruleLine: ruleLine(id), text: line.trim(), file: String(file ?? '') })
    }
    if (/\[innerHTML\]/.test(line) || /\binnerHTML\b/.test(line)) {
      const nearby = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 6)).join('\n')
      if (!/DomSanitizer|bypassSecurityTrustHtml|sanitize/.test(nearby)) hit('inner-html')
    }
    if (LOG_CALL.test(line)) {
      const carried = [...carriers].some((name) => new RegExp(`(^|[^\\w$.])${escapeRe(name)}(?![\\w$])`).test(line.replace(/^.*?\.log\s*\(|^.*?LoggingService/, '')))
      if (PII_NAMES.test(line) || carried) hit('pii-log')
    }
  })
  return hits
}

/** The allow markers in `text` with their reasons: [{ line, reason }] (printed when the guard passes those lines). */
export function allowedLines(text) {
  return String(text).split(/\r?\n/).flatMap((line, i) => {
    const reason = allowReason(line)
    return reason ? [{ line: i + 1, reason }] : []
  })
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const staged = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' })
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => /\.(ts|html|js)$/.test(f))
  let failed = false
  for (const file of staged) {
    let content
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const h of scanGuardText(content, file)) {
      console.error(`security-grep: ${file}:${h.line} — ${h.rule}`)
      failed = true
    }
    for (const a of allowedLines(content)) console.log(`security-grep: ${file}:${a.line} allowed — ${a.reason}`)
  }
  if (failed) {
    console.error('\nCommit blocked by pre-commit-security-grep.mjs')
    process.exit(1)
  }
}
