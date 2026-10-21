/**
 * Plan close — sets `Status: done` on finished plans and files them under plans/<range>/.
 *
 * A merge only happens after the Human validated the work, so a plan is finished once its
 * todo section has left `.claude/todo.md` for `.claude/todo-archive/` (todo-archive.mjs
 * moves it when every item is ticked) and the plan file's own `## Atomic Sub-tasks` has no
 * `- [ ]` left. Runs in the todo-sync workflow right after `todo-archive.mjs`.
 *
 * Only open plans are candidates: `plans/NNN-<slug>.plan.md` and the open subfolders such as
 * `plans/design/` (lib/plan-paths.mjs). Every closed plan goes to its range folder:
 * `plans/1-100/` for 001–099, then `plans/100-200/`, `plans/200-300/`, …
 *
 * Usage:
 *   node scripts/plan-close.mjs            # close and move
 *   node scripts/plan-close.mjs --dry-run  # report only
 *
 * Exit: 0 always (advisory tooling). Prints one line per closed plan.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync } from 'fs'
import { resolve, dirname, join, posix } from 'path'
import { fileURLToPath } from 'url'
import { splitPlanSections } from './lib/todo-parse.mjs'
import { listOpenPlans } from './lib/plan-paths.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

const PLAN_FILE_RE = /^(\d{3})-.+\.plan\.md$/

export function rangeFolder(nnn) {
  const lo = Math.floor(Number(nnn) / 100) * 100
  return `${lo || 1}-${lo + 100}`
}

/** The `## Atomic Sub-tasks` block of a plan, or null when the plan has none. */
export function atomicBlock(planText) {
  const m = planText.match(/^## Atomic Sub-tasks[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)
  return m ? m[1] : null
}

export function atomicAllClosed(planText) {
  const block = atomicBlock(planText)
  if (!block) return false
  return !/^\s*- \[ \]/m.test(block) && /^\s*- \[[xX-]\]/m.test(block)
}

export function setStatusDone(planText) {
  return /^Status:.*$/m.test(planText)
    ? planText.replace(/^Status:.*$/m, 'Status: done')
    : planText.replace(/^(# .+\r?\n)/, '$1\nStatus: done\n')
}

function headingNumbers(text) {
  const out = new Set()
  for (const m of text.matchAll(/^### Plans?\s+(\d+)/gm)) out.add(m[1].padStart(3, '0'))
  return out
}

function openTodoNumbers(root) {
  const todoPath = join(root, '.claude', 'todo.md')
  if (!existsSync(todoPath)) return new Set()
  const { sections } = splitPlanSections(readFileSync(todoPath, 'utf8'))
  return headingNumbers(sections.map(s => s.heading).join('\n'))
}

function archivedNumbers(root) {
  const archiveDir = join(root, '.claude', 'todo-archive')
  if (!existsSync(archiveDir)) return new Set()
  const all = readdirSync(archiveDir)
    .filter(f => f.endsWith('.md'))
    .map(f => readFileSync(join(archiveDir, f), 'utf8'))
    .join('\n')
  return headingNumbers(all)
}

export function findClosable({ files, openNums, archivedNums, readPlan }) {
  const out = []
  for (const file of files) {
    const m = posix.basename(file).match(PLAN_FILE_RE)
    if (!m) continue
    const nnn = m[1]
    if (openNums.has(nnn) || !archivedNums.has(nnn)) continue
    if (!atomicAllClosed(readPlan(file))) continue
    out.push({ file, nnn })
  }
  return out
}

/** Close every finished open plan under root (plans/ and plans/design/ …) into plans/<range>/. Returns the report lines. */
export function closePlans(root, { dryRun = false } = {}) {
  if (!existsSync(join(root, 'plans'))) return ['PLAN_CLOSE: no plans/ folder']
  const closable = findClosable({
    files: listOpenPlans(root),
    openNums: openTodoNumbers(root),
    archivedNums: archivedNumbers(root),
    readPlan: f => readFileSync(join(root, f), 'utf8')
  })
  if (!closable.length) return ['PLAN_CLOSE: nothing to close']
  const lines = []
  for (const { file, nnn } of closable) {
    const dest = `plans/${rangeFolder(nnn)}/${posix.basename(file)}`
    if (!dryRun) {
      const src = join(root, file)
      writeFileSync(src, setStatusDone(readFileSync(src, 'utf8')), 'utf8')
      mkdirSync(join(root, 'plans', rangeFolder(nnn)), { recursive: true })
      renameSync(src, join(root, dest))
    }
    lines.push(`PLAN_CLOSE: ${dryRun ? 'would close' : 'closed'} ${file} → ${dest}`)
  }
  return lines
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const line of closePlans(repoRoot, { dryRun: process.argv.includes('--dry-run') })) console.log(line)
}
