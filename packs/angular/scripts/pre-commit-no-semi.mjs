/**
 * Pre-commit hook: strip trailing semicolons from staged *.ts files.
 * Runs automatically via .git/hooks/pre-commit.
 *
 * Only processes files that are staged (git diff --cached --name-only).
 * Re-stages the file after fixing so the commit includes the clean version.
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const ASI_DANGER = /^\s*[([`]/

// Get staged .ts files inside src/app (exclude bootstrap files)
const EXCLUDED = new Set([
  'src/main.ts',
  'src/app/app.config.ts',
  '{{paths.hotspots}}',
])

const staged = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' })
  .split('\n')
  .map(f => f.trim())
  .filter(f => f.endsWith('.ts') && f.startsWith('src/app/') && !EXCLUDED.has(f))

if (staged.length === 0) process.exit(0)

let totalFixed = 0

for (const file of staged) {
  const original = readFileSync(file, 'utf8')
  const lines = original.split(/\r?\n/)
  let fixed = 0

  const result = lines.map((line, i) => {
    if (!/;\s*$/.test(line)) return line
    const nextLine = lines.slice(i + 1).find(l => {
      const t = l.trim()
      return t.length > 0 && !t.startsWith('//')
    })
    if (nextLine && ASI_DANGER.test(nextLine)) return line
    fixed++
    return line.replace(/;\s*$/, '')
  })

  if (fixed > 0) {
    const updated = result.join(original.includes('\r\n') ? '\r\n' : '\n')
    writeFileSync(file, updated, 'utf8')
    execSync(`git add ${file}`)
    console.log(`  no-semi: ${file} — ${fixed} semicolon(s) removed and re-staged`)
    totalFixed += fixed
  }
}

if (totalFixed > 0) {
  console.log(`\nno-semi: ${totalFixed} semicolons auto-removed from staged files.`)
}
