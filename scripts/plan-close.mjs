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
 *   --no-fetch (or GITHUB_ACTIONS=true) skips the origin check: otherwise it fetches origin/<main> first and skips a plan
 *   whose open path is gone there (the todo-sync bot closed it): PLAN_CLOSE: skipped <file> — already closed on origin/<main> by <sha>
 *
 * Exit: 0 always (advisory tooling). Prints one line per closed plan.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync } from 'fs'
import { spawnSync } from 'child_process'
import { resolve, dirname, join, posix } from 'path'
import { fileURLToPath } from 'url'
import { splitPlanSections } from './lib/todo-parse.mjs'
import { listOpenPlans } from './lib/plan-paths.mjs'
import { openAutoItems } from './lib/done-when.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const MAIN = 'main'

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

/**
 * A plan is closable when it is not in the open todo list, every Atomic Sub-task is ticked and either its todo section
 * was archived or it never had one and no `- [ ] [auto…]` Done-when item is open (squash merges and deleted branches
 * leave no todo section). An open todo section still blocks.
 */
export function findClosable({ files, openNums, archivedNums, readPlan }) {
  const out = []
  for (const file of files) {
    const m = posix.basename(file).match(PLAN_FILE_RE)
    if (!m) continue
    const nnn = m[1]
    if (openNums.has(nnn)) continue
    const text = readPlan(file)
    if (!archivedNums.has(nnn) && openAutoItems(text).length) continue
    if (!atomicAllClosed(text)) continue
    out.push({ file, nnn })
  }
  return out
}

/**
 * Close every finished open plan under root (plans/ and plans/design/ …) into plans/<range>/. Returns the report lines.
 * `closedOnOrigin(file)` (optional) returns the short sha that already closed the plan on origin/<main> (its open path is
 * gone there), or null: such a plan is skipped, never closed a second time by hand against the todo-sync bot.
 */
export function closePlans(root, { dryRun = false, closedOnOrigin = null } = {}) {
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
    const by = closedOnOrigin ? closedOnOrigin(file) : null
    if (by) {
      lines.push(`PLAN_CLOSE: skipped ${file} — already closed on origin/${MAIN} by ${by}`)
      continue
    }
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

/**
 * The origin check for the CLI: fetch origin/<main>, then a plan whose open path is gone there was closed by the
 * todo-sync bot (or another clone) already. Returns { closedOnOrigin } or { error } when the fetch failed.
 */
function originCheck(root) {
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' })
  const f = git('fetch', '--quiet', 'origin', MAIN)
  if (f.status !== 0) return { error: String(f.stderr || f.error?.message || 'git fetch failed').trim().split('\n').pop() }
  const closedOnOrigin = (file) => {
    if (git('cat-file', '-e', `origin/${MAIN}:${file}`).status === 0) return null
    const sha = git('log', '-1', '--format=%h', `origin/${MAIN}`, '--', file).stdout.trim()
    return sha || null // never on origin/<main>: a local plan not pushed yet, not a closed one
  }
  return { closedOnOrigin }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  let closedOnOrigin = null
  if (process.env.GITHUB_ACTIONS !== 'true' && !argv.includes('--no-fetch')) {
    const o = originCheck(repoRoot)
    if (o.error) {
      console.log(`PLAN_CLOSE: could not fetch origin/${MAIN} (${o.error}) — nothing closed`)
      process.exit(0)
    }
    closedOnOrigin = o.closedOnOrigin
  }
  for (const line of closePlans(repoRoot, { dryRun: argv.includes('--dry-run'), closedOnOrigin })) console.log(line)
}
