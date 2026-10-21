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
 *   scan      count debt markers in the project's own source files (tracked files
 *             under the scope, kit-managed files left out): the core rules below
 *             plus the stack pack's rules. Compares with the recorded baseline and
 *             prints NEW_DEBT: yes (a count went up) | no | unknown (no baseline).
 *             --write-baseline records today's counts as the baseline (do it once at
 *             adoption, and after a cleanup lowered the numbers); --strict exits 1 on
 *             NEW_DEBT: yes; --list prints every hit; --path <dir> scans another folder.
 *
 * Node built-ins only. Exit 0 for prepare/list/scan (scan --strict: 1 on new debt);
 * the skill does the analysis and writes the report body.
 *
 * Usage: node scripts/techdebt-report.mjs prepare [--scope working-tree|full-project]
 *        node scripts/techdebt-report.mjs list
 *        node scripts/techdebt-report.mjs scan [--write-baseline] [--strict] [--list] [--path <dir>]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync, statSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join, relative } from 'path'
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

// Source files the audit covers, for any stack (the stylesheet extension of the configured stack included).
const SOURCE_EXT = [...new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'html', 'css', 'scss', 'css'])]
const SOURCE_RE = new RegExp(`\\.(${SOURCE_EXT.join('|')})$`)
const SRC_ROOT = ''
const BASELINE = 'docs/project/techdebt-baseline.json'
const BIG_FILE_LINES = 300

// Core rules (any stack). A rule counts the lines that match `pattern` in files with one of `ext` (none = every
// source file), minus paths matching `exclude`. `lines` instead counts the files longer than that many lines.
const CORE_RULES = [
  { id: 'any', pattern: ':\\s*any\\b|<any>|\\bas any\\b', ext: ['ts', 'tsx'], exclude: '\\.(spec|test)\\.tsx?$' },
  { id: 'ts-ignore', pattern: '@ts-(ignore|nocheck)\\b', ext: ['ts', 'tsx', 'js', 'jsx'] },
  { id: 'eslint-disable', pattern: 'eslint-disable', ext: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'] },
  { id: 'console-log', pattern: '\\bconsole\\.log\\(', ext: ['ts', 'tsx', 'js', 'jsx'], exclude: '\\.(spec|test)\\.[jt]sx?$' },
  { id: 'todo', pattern: '\\b(TODO|FIXME)\\b' },
  { id: 'big-file', lines: BIG_FILE_LINES, ext: ['ts', 'tsx', 'js', 'jsx'], exclude: '\\.(spec|test)\\.[jt]sx?$' },
]
// The stack pack's rules (pack.json techdebtRules), same shape.
const PACK_RULES = []

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

// The project's own source files under `root`: tracked files (git), else a walk without dependency/build folders.
// Files the kit installed (.kit/install.json) are the kit's, not the project's debt.
function sourceFiles(root) {
  const rel = relative(repoRoot, root).replace(/\\/g, '/')
  let list
  try {
    list = execFileSync('git', ['ls-files', '-z', '--', rel || '.'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0').filter(Boolean)
  } catch {
    list = []
    const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.cache', '.claude'])
    const walk = (d) => {
      for (const e of readdirSync(d)) {
        if (SKIP.has(e)) continue
        const p = join(d, e)
        if (statSync(p).isDirectory()) walk(p)
        else list.push(relative(repoRoot, p).replace(/\\/g, '/'))
      }
    }
    if (existsSync(root)) walk(root)
  }
  let kit = {}
  try {
    kit = JSON.parse(readFileSync(join(repoRoot, '.kit/install.json'), 'utf8')).files ?? {}
  } catch { /* not kit-installed: nothing to leave out */ }
  return list.filter((f) => SOURCE_RE.test(f) && !kit[f] && existsSync(join(repoRoot, f)))
}

function scan() {
  const root = resolve(repoRoot, flagValue('--path') ?? (SRC_ROOT || '.'))
  const rules = [...CORE_RULES, ...(Array.isArray(PACK_RULES) ? PACK_RULES : [])].map((r) => ({
    ...r,
    re: r.pattern ? new RegExp(r.pattern, r.flags ?? '') : null,
    exts: r.ext?.length ? new Set(r.ext) : null,
    ex: r.exclude ? new RegExp(r.exclude) : null,
  }))
  const files = sourceFiles(root)
  const counts = Object.fromEntries(rules.map((r) => [r.id, 0]))
  const hits = Object.fromEntries(rules.map((r) => [r.id, []]))
  for (const f of files) {
    const ext = f.slice(f.lastIndexOf('.') + 1)
    const lines = readFileSync(join(repoRoot, f), 'utf8').split(/\r?\n/)
    for (const r of rules) {
      if ((r.exts && !r.exts.has(ext)) || r.ex?.test(f)) continue
      if (r.lines) {
        if (lines.length > r.lines) {
          counts[r.id]++
          hits[r.id].push(`${f} (${lines.length} lines)`)
        }
        continue
      }
      lines.forEach((l, i) => {
        if (r.re.test(l)) {
          counts[r.id]++
          hits[r.id].push(`${f}:${i + 1}`)
        }
      })
    }
  }
  const scopeLabel = relative(repoRoot, root).replace(/\\/g, '/') || '.'
  console.log(`SCAN: ${files.length} source files under ${scopeLabel} (.${SOURCE_EXT.join(' .')}; kit-managed files left out)`)
  const baseFile = join(repoRoot, BASELINE)
  let base = null
  try {
    base = JSON.parse(readFileSync(baseFile, 'utf8'))
  } catch { /* no baseline yet */ }
  const rows = rules.map((r) => {
    const was = base?.counts?.[r.id]
    return { id: r.id, now: counts[r.id], was, delta: was == null ? null : counts[r.id] - was }
  })
  console.log(`| rule | ${base ? `baseline ${base.date}` : 'baseline'} | now | change |`)
  console.log('| --- | --- | --- | --- |')
  for (const r of rows) console.log(`| ${r.id} | ${r.was ?? '-'} | ${r.now} | ${r.delta == null ? (base ? 'new rule' : '-') : r.delta > 0 ? `+${r.delta}` : r.delta} |`)
  if (argv.includes('--list')) {
    for (const r of rules) for (const h of hits[r.id]) console.log(`HIT ${r.id} ${h}`)
  }
  if (argv.includes('--write-baseline')) {
    mkdirSync(dirname(baseFile), { recursive: true })
    writeFileSync(baseFile, JSON.stringify({ date: today, scope: scopeLabel, files: files.length, counts }, null, 2) + '\n')
    console.log(`BASELINE: written ${BASELINE} (commit it)`)
    console.log('NEW_DEBT: no')
    return
  }
  if (!base) {
    console.log('BASELINE: none — record one with: node scripts/techdebt-report.mjs scan --write-baseline')
    console.log('NEW_DEBT: unknown')
    return
  }
  if (base.scope && base.scope !== scopeLabel) console.log(`NOTE the baseline covers ${base.scope}, this scan ${scopeLabel}`)
  // A rule the baseline does not know yet (a newer kit or pack) is shown but never counts as new debt.
  const worse = rows.filter((r) => r.delta != null && r.delta > 0)
  console.log(`BASELINE: ${BASELINE} (${base.date})`)
  console.log(`NEW_DEBT: ${worse.length ? `yes (${worse.map((r) => `${r.id} +${r.delta}`).join(', ')})` : 'no'}`)
  if (worse.length && argv.includes('--strict')) process.exitCode = 1
}

if (cmd === 'list') {
  for (const f of kept().reverse()) console.log(f)
  process.exit(0)
}

if (cmd === 'scan') {
  scan()
  process.exit(process.exitCode ?? 0)
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
      .split(/\r?\n/).filter((f) => SOURCE_RE.test(f))
  } catch { /* no git → empty scope */ }
}

console.log(`REPORT_PATH: ${todayFile.replace(/\\/g, '/')}`)
console.log(`SCOPE: ${scope}${scope === 'working-tree' ? ` (${staged.length} staged source files)` : ` (${SRC_ROOT || 'the whole repo'})`}`)
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
