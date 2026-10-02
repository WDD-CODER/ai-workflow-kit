/**
 * Pre-commit security grep (Security Officer vulnerability patterns):
 * 1) [innerHTML] without a nearby sanitizer call
 * 2) console.log / LoggingService calls with likely-PII variable names
 */
import { execSync } from 'child_process'
import { readFileSync } from 'fs'

const staged = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' })
  .split('\n')
  .map(f => f.trim())
  .filter(f => /\.(ts|html|js)$/.test(f))
  // Add `.filter(f => !f.startsWith('<vendored-dir>/'))` here for vendored third-party
  // snapshots that are never imported into the build.

const PII_NAMES = /\b(email|password|token|fullName|full_name|phone|ssn|creditCard|credit_card)\b/i
let failed = false

for (const file of staged) {
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const lines = content.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/\[innerHTML\]/.test(line) || /\binnerHTML\b/.test(line)) {
      const windowStart = Math.max(0, i - 5)
      const windowEnd = Math.min(lines.length, i + 6)
      const nearby = lines.slice(windowStart, windowEnd).join('\n')
      if (!/DomSanitizer|bypassSecurityTrustHtml|sanitize/.test(nearby)) {
        console.error(`security-grep: ${file}:${i + 1} — [innerHTML]/innerHTML without nearby sanitizer`)
        failed = true
      }
    }

    if (/\bconsole\.log\s*\(/.test(line) || /\bLoggingService\b/.test(line) || /\.log\s*\(/.test(line)) {
      if (PII_NAMES.test(line)) {
        console.error(`security-grep: ${file}:${i + 1} — log call references likely-PII name`)
        failed = true
      }
    }
  }
}

if (failed) {
  console.error('\nCommit blocked by pre-commit-security-grep.mjs')
  process.exit(1)
}
