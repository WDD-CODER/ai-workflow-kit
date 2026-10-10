/**
 * Techdebt report plumbing — the deterministic half of the `techdebt` skill.
 *
 * Reports live in .claude/techdebt-reports/techdebt-YYYY-MM-DD.md, one per day,
 * and the folder keeps the newest 7 (a rolling window is enough to see a trend
 * and keeps the folder from growing forever).
 *
 *   prepare   ensure the folder exists, prune to 6 older reports so today's
 *             makes 7, and print: today's report path, scope hints, and a
 *             trend table built from the Summary block of each kept report.
 *             Re-running on the same day overwrites today's file and prunes
 *             nothing extra.
 *   list      print the kept reports, newest first.
 *
 * Node built-ins only. Exit 0 always for prepare/list; the skill does the
 * analysis and writes the report body.
 *
 * Usage: node scripts/techdebt-report.mjs prepare [--scope working-tree|full-project]
 *        node scripts/techdebt-report.mjs list
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const DIR = join(repoRoot, '.claude/techdebt-reports')
const KEEP = 7 // rolling window: 7 reports ≈ a week of daily audits or ~2 months of weekly ones
const argv = process.argv.slice(2)
const cmd = argv[0] ?? 'prepare'
const flagValue = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}

const today = new Date().toISOString().slice(0, 10)
const todayFile = join(DIR, `techdebt-${today}.md`)

function kept() {
  if (!existsSync(DIR)) return []
  return readdirSync(DIR)
    .filter((f) => /^techdebt-\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort() // ISO dates sort lexically
}

// Pull "- Label: N" lines out of a report's ## Summary block.
function summary(file) {
  const text = readFileSync(join(DIR, file), 'utf8')
  const block = text.split(/^## Summary\s*$/m)[1]?.split(/^## /m)[0] ?? ''
  const counts = {}
  for (const m of block.matchAll(/^- ([^:\n]+):\s*(\d+)/gm)) counts[m[1].trim()] = Number(m[2])
  return counts
}

if (cmd === 'list') {
  for (const f of kept().reverse()) console.log(f)
  process.exit(0)
}

mkdirSync(DIR, { recursive: true })
const others = kept().filter((f) => f !== `techdebt-${today}.md`)
const toDelete = others.slice(0, Math.max(0, others.length - (KEEP - 1)))
for (const f of toDelete) unlinkSync(join(DIR, f))

const scope = flagValue('--scope') ?? 'full-project'
let staged = []
if (scope === 'working-tree') {
  try {
    staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: repoRoot, encoding: 'utf8' })
      .split(/\r?\n/).filter((f) => /\.(ts|html|scss|js|mjs)$/.test(f))
  } catch { /* no git → empty scope */ }
}

console.log(`REPORT_PATH: ${todayFile.replace(/\\/g, '/')}`)
console.log(`SCOPE: ${scope}${scope === 'working-tree' ? ` (${staged.length} staged source files)` : ' (src/app/)'}`)
for (const f of staged) console.log(`  ${f}`)
if (toDelete.length) console.log(`PRUNED: ${toDelete.join(', ')}`)
console.log(`KEPT: ${others.length - toDelete.length} previous report(s)`)

const prev = others.slice(-(KEEP - 1))
if (prev.length) {
  const labels = new Set()
  const rows = prev.map((f) => ({ date: f.slice(9, 19), counts: summary(f) }))
  for (const r of rows) Object.keys(r.counts).forEach((l) => labels.add(l))
  console.log('TREND (fill the arrows vs the newest previous report):')
  console.log(`| metric | ${rows.map((r) => r.date).join(' | ')} |`)
  for (const l of labels) console.log(`| ${l} | ${rows.map((r) => r.counts[l] ?? '-').join(' | ')} |`)
} else {
  console.log('TREND: no previous reports')
}
