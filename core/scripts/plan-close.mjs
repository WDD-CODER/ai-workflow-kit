/**
 * Plan close — sets `Status: done` on finished plans and files them under plans/<range>/.
 *
 * A merge only happens after the Human validated the work, so a plan is finished once its
 * todo section has left `.claude/todo.md` for `.claude/todo-archive/` (todo-archive.mjs
 * moves it when every item is ticked) and the plan file's own `## Atomic Sub-tasks` has no
 * `- [ ]` left. Runs in the todo-sync workflow right after `todo-archive.mjs`.
 *
 * Only flat `plans/NNN-<slug>.plan.md` files are candidates. The range folder is
 * `plans/1-100/` for 001–099, then `plans/100-200/`, `plans/200-300/`, …
 *
 * Usage:
 *   node scripts/plan-close.mjs            # close and move
 *   node scripts/plan-close.mjs --dry-run  # report only
 *
 * Exit: 0 always (advisory tooling). Prints one line per closed plan.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { splitPlanSections } from './lib/todo-parse.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const PLANS_DIR = join(repoRoot, 'plans')
const TODO_PATH = join(repoRoot, '.claude', 'todo.md')
const ARCHIVE_DIR = join(repoRoot, '.claude', 'todo-archive')

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

function openTodoNumbers() {
  if (!existsSync(TODO_PATH)) return new Set()
  const { sections } = splitPlanSections(readFileSync(TODO_PATH, 'utf8'))
  return headingNumbers(sections.map(s => s.heading).join('\n'))
}

function archivedNumbers() {
  if (!existsSync(ARCHIVE_DIR)) return new Set()
  const all = readdirSync(ARCHIVE_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => readFileSync(join(ARCHIVE_DIR, f), 'utf8'))
    .join('\n')
  return headingNumbers(all)
}

export function findClosable({ files, openNums, archivedNums, readPlan }) {
  const out = []
  for (const file of files) {
    const m = file.match(PLAN_FILE_RE)
    if (!m) continue
    const nnn = m[1]
    if (openNums.has(nnn) || !archivedNums.has(nnn)) continue
    if (!atomicAllClosed(readPlan(file))) continue
    out.push({ file, nnn })
  }
  return out
}

function main() {
  const dryRun = process.argv.includes('--dry-run')
  if (!existsSync(PLANS_DIR)) {
    console.log('PLAN_CLOSE: no plans/ folder')
    return
  }
  const closable = findClosable({
    files: readdirSync(PLANS_DIR),
    openNums: openTodoNumbers(),
    archivedNums: archivedNumbers(),
    readPlan: f => readFileSync(join(PLANS_DIR, f), 'utf8')
  })
  if (!closable.length) {
    console.log('PLAN_CLOSE: nothing to close')
    return
  }
  for (const { file, nnn } of closable) {
    const dest = `plans/${rangeFolder(nnn)}/${file}`
    if (!dryRun) {
      const src = join(PLANS_DIR, file)
      writeFileSync(src, setStatusDone(readFileSync(src, 'utf8')), 'utf8')
      mkdirSync(join(PLANS_DIR, rangeFolder(nnn)), { recursive: true })
      renameSync(src, join(repoRoot, dest))
    }
    console.log(`PLAN_CLOSE: ${dryRun ? 'would close' : 'closed'} plans/${file} → ${dest}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
