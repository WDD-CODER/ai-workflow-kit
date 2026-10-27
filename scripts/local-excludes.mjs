/**
 * Local excludes — the workflow's runtime files (slot markers, logs, hashes, session state) must never show up
 * as changes. The list below is the single source: the kit renders the runtime block of the `.gitignore`
 * skeleton from it, and this script appends it to the repository's local exclude file
 * (`$(git rev-parse --git-common-dir)/info/exclude`, shared by every worktree), which reaches every clone and
 * slot even when the project keeps its own `.gitignore` (an `overrides` entry, or an upstream-owned file).
 *
 * Usage:
 *   node scripts/local-excludes.mjs           # add the missing entries (idempotent); prints LOCAL_EXCLUDES: …
 *   node scripts/local-excludes.mjs --check   # exit 1 when an entry is missing, write nothing
 *
 * Run by the kit installer, take-plan.mjs (before its dirty check) and the worktree-setup skill. Node built-ins only.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join, isAbsolute } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

// KIT:runtime-ignores-begin (the kit's .gitignore skeleton is rendered from the quoted entries in this block)
export const RUNTIME_IGNORES = [
  // Worktree slot state (Planner-Worker workflow)
  '.worktree-port',
  '.worktree-root',
  '.worktree-plan',
  '.worktree-cleanup',
  '.claude/.slot-pids',
  '.claude/.slot-plan-start',
  '.claude/logs/',
  '.claude/*.log',
  // Claude Code local config and runtime state (never commit)
  '.claude/settings.local.json',
  '.claude/worktrees/',
  '.claude/.plan-write-ack',
  '.claude/.session-state-path', // legacy-session-state: older installs still have this pointer file
  '.claude/.ship-baseline',
  '.claude/.session-lock',
  '.claude/.last-npm-install-hash',
  '.claude/.last-npm-install-hash-server',
  '.claude/.last-npm-install-hash-scripts',
  '.claude/sessions/',
  // Orchestrator runs: live status.json and the local copy of each run report (the run branch keeps the record)
  '.claude/orchestrator-runs/',
  // Workflow script dependencies (npm install inside scripts/)
  'scripts/node_modules/'
]
// KIT:runtime-ignores-end

const HEADER = '# ai-workflow-kit runtime files (scripts/local-excludes.mjs)'

/** Absolute path of the shared info/exclude file, or null outside a git repository. */
export function excludeFile(root = repoRoot) {
  try {
    const dir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return join(isAbsolute(dir) ? dir : resolve(root, dir), 'info', 'exclude')
  } catch {
    return null
  }
}

/** Entries not yet in the exclude file. */
export function missingExcludes(root = repoRoot) {
  const file = excludeFile(root)
  if (!file) return []
  const have = new Set((existsSync(file) ? readFileSync(file, 'utf8') : '').split(/\r?\n/).map((l) => l.trim()))
  return RUNTIME_IGNORES.filter((p) => !have.has(p))
}

/** Append the missing entries. Returns { file, added: [entries] }; file is null outside a git repository. */
export function ensureLocalExcludes(root = repoRoot) {
  const file = excludeFile(root)
  if (!file) return { file: null, added: [] }
  const missing = missingExcludes(root)
  if (missing.length) {
    const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
    const lead = text && !text.endsWith('\n') ? '\n' : ''
    const header = text.includes(HEADER) ? '' : `${HEADER}\n`
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${text}${lead}${header}${missing.join('\n')}\n`)
  }
  return { file, added: missing }
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  if (!excludeFile()) {
    console.error('LOCAL_EXCLUDES: not a git repository - nothing to do')
    process.exit(1)
  }
  if (process.argv.includes('--check')) {
    const missing = missingExcludes()
    if (missing.length) {
      console.error(`LOCAL_EXCLUDES: missing ${missing.length} entr${missing.length === 1 ? 'y' : 'ies'}: ${missing.join(', ')} - run node scripts/local-excludes.mjs`)
      process.exit(1)
    }
    console.log('LOCAL_EXCLUDES: ok')
  } else {
    const { added } = ensureLocalExcludes()
    console.log(added.length ? `LOCAL_EXCLUDES: added ${added.length} entr${added.length === 1 ? 'y' : 'ies'} to .git/info/exclude` : 'LOCAL_EXCLUDES: ok - nothing to add')
  }
}
