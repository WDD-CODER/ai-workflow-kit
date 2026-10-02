/**
 * Todo archive volume rotation — shared by Claude Code and Cursor.
 *
 * Moves fully-done plan sections from `.claude/todo.md` into numbered
 * `.claude/todo-archive/NNN.md` volumes (max 300 lines each).
 *
 * Usage:
 *   node scripts/todo-archive.mjs              # archive all-[x] from todo.md
 *   node scripts/todo-archive.mjs --dry-run    # report only
 *   node scripts/todo-archive.mjs --migrate    # split legacy todo-archive.md
 *   node scripts/todo-archive.mjs --migrate --dry-run
 *   node scripts/todo-archive.mjs --migrate-only --migrate
 *   node scripts/todo-archive.mjs --json
 *
 * Exit: 0 always (advisory tooling). Prints summary to stdout.
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  renameSync
} from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  isTodoFooterLine,
  splitPlanSections,
  isDeferredBlocked,
  checkboxStats,
  isFullyDone,
  findArchiveCandidates
} from './lib/todo-parse.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

const MAX_LINES = 300
const TODO_PATH = join(repoRoot, '.claude', 'todo.md')
const ARCHIVE_DIR = join(repoRoot, '.claude', 'todo-archive')
const LEGACY_ARCHIVE = join(repoRoot, '.claude', 'todo-archive.md')
const LEGACY_BAK = join(repoRoot, '.claude', 'todo-archive.legacy.md')

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/)
    if (!m) return [arg, true]
    return [m[1], m[2] ?? true]
  })
)

const dryRun = Boolean(args['dry-run'])
const doMigrate = Boolean(args.migrate)
const migrateOnly = Boolean(args['migrate-only'])
const asJson = Boolean(args.json)

function ensureArchiveDir() {
  if (!existsSync(ARCHIVE_DIR)) mkdirSync(ARCHIVE_DIR, { recursive: true })
}

function listVolumes() {
  if (!existsSync(ARCHIVE_DIR)) return []
  return readdirSync(ARCHIVE_DIR)
    .filter(name => /^\d{3}\.md$/.test(name))
    .map(name => ({
      name,
      n: Number(name.slice(0, 3)),
      path: join(ARCHIVE_DIR, name)
    }))
    .sort((a, b) => a.n - b.n)
}

function padVol(n) {
  return `${String(n).padStart(3, '0')}.md`
}

function volumeHeader(n) {
  const pad = String(n).padStart(3, '0')
  return [
    `# Todo Archive Volume ${pad}`,
    '',
    `Moved from todo.md. Max ${MAX_LINES} lines per volume.`,
    '',
    '---',
    '',
    '## Done',
    ''
  ].join('\n')
}

function lineCount(text) {
  if (!text) return 0
  return text.split(/\r?\n/).length
}

/**
 * Pack blocks into volumes. Returns written metadata.
 * Single oversized blocks still land in their own volume (never dropped).
 */
function appendBlocksToVolumes(blocks, { dryRun: dry, startN = null }) {
  ensureArchiveDir()
  const results = []
  const volumes = listVolumes()

  let n = startN != null
    ? startN
    : volumes.length
      ? volumes[volumes.length - 1].n
      : 0
  let path = n ? join(ARCHIVE_DIR, padVol(n)) : null
  let text = path && existsSync(path)
    ? readFileSync(path, 'utf8').replace(/\s*$/, '')
    : ''

  function startNewVolume() {
    n = n ? n + 1 : 1
    path = join(ARCHIVE_DIR, padVol(n))
    text = volumeHeader(n).replace(/\s*$/, '')
  }

  function headerOnlyLines(volN) {
    return lineCount(volumeHeader(volN))
  }

  for (const block of blocks) {
    const piece = String(block).replace(/^\s+|\s+$/g, '')
    if (!piece) continue

    if (!path) startNewVolume()

    const addition = `\n\n${piece}\n\n---`
    let candidate = `${text}${addition}\n`
    let lines = lineCount(candidate)

    if (lines > MAX_LINES && lineCount(text) > headerOnlyLines(n)) {
      if (!dry) writeFileSync(path, `${text}\n`, 'utf8')
      startNewVolume()
      candidate = `${text}\n\n${piece}\n\n---\n`
      lines = lineCount(candidate)
    }

    if (!dry) writeFileSync(path, candidate, 'utf8')
    text = candidate.replace(/\s*$/, '')
    results.push({
      volume: padVol(n),
      heading: piece.split(/\r?\n/)[0],
      linesAfter: lines
    })
  }

  return results
}

function removeSectionsFromTodo(todoText, headingsToRemove) {
  const removeSet = new Set(headingsToRemove)
  const { sections, lines, sectionStarts } = splitPlanSections(todoText)

  if (!sectionStarts.length) return todoText

  // Excise only the exact [start, end) line ranges of removed sections, leaving
  // every other line — including non-"### Plan" content sitting between two
  // plan sections (e.g. "## 6. KEEP DEFERRED") — completely untouched.
  const removeRanges = sections
    .filter(sec => removeSet.has(sec.heading))
    .map(sec => [sec.start, sec.end])

  const isRemoved = i => removeRanges.some(([start, end]) => i >= start && i < end)

  const keptLines = lines.filter((_, i) => !isRemoved(i))

  let out = keptLines.join('\n')
  out = out.replace(/\n{3,}/g, '\n\n')
  if (!out.endsWith('\n')) out += '\n'
  return out
}

function migrateLegacy({ dryRun: dry }) {
  if (!existsSync(LEGACY_ARCHIVE)) {
    return {
      ok: true,
      message: 'No legacy .claude/todo-archive.md to migrate',
      volumes: 0,
      blocks: 0,
      volumeFiles: []
    }
  }

  const existing = listVolumes()
  if (existing.length) {
    return {
      ok: false,
      message: `Refuse migrate: ${existing.length} volume(s) already under todo-archive/`,
      volumes: existing.length,
      blocks: 0,
      volumeFiles: []
    }
  }

  const legacy = readFileSync(LEGACY_ARCHIVE, 'utf8')
  const { sections } = splitPlanSections(legacy)
  const blocks = sections.map(s => s.full)

  if (!blocks.length) {
    return {
      ok: true,
      message: 'Legacy archive has no ### Plan sections',
      volumes: 0,
      blocks: 0,
      volumeFiles: []
    }
  }

  const written = appendBlocksToVolumes(blocks, { dryRun: dry, startN: 0 })

  // Summarize unique volumes + final line counts
  const byVol = new Map()
  for (const w of written) {
    byVol.set(w.volume, w.linesAfter)
  }
  const volumeFiles = [...byVol.entries()].map(([file, lines]) => ({ file, lines }))

  if (!dry) {
    if (!existsSync(LEGACY_BAK)) renameSync(LEGACY_ARCHIVE, LEGACY_BAK)
  }

  return {
    ok: true,
    message: dry
      ? `Would migrate ${blocks.length} plan sections into ${volumeFiles.length} volume(s)`
      : `Migrated ${blocks.length} plan sections into ${volumeFiles.length} volume(s); legacy renamed to todo-archive.legacy.md`,
    volumes: volumeFiles.length,
    blocks: blocks.length,
    volumeFiles
  }
}

function archiveFromTodo({ dryRun: dry }) {
  if (!existsSync(TODO_PATH)) {
    return { ok: false, message: 'Missing .claude/todo.md', moved: [] }
  }

  const todoText = readFileSync(TODO_PATH, 'utf8')
  const candidates = findArchiveCandidates(todoText)

  if (!candidates.length) {
    return { ok: true, message: 'No all-[x] plan sections to archive', moved: [] }
  }

  const blocks = candidates.map(c => c.full)
  const written = appendBlocksToVolumes(blocks, { dryRun: dry })

  if (!dry) {
    const headings = candidates.map(c => c.heading)
    writeFileSync(TODO_PATH, removeSectionsFromTodo(todoText, headings), 'utf8')
  }

  return {
    ok: true,
    message: dry
      ? `Would archive ${candidates.length} plan section(s)`
      : `Archived ${candidates.length} plan section(s) from todo.md`,
    moved: candidates.map((c, i) => ({
      heading: c.heading,
      volume: written[i]?.volume ?? null,
      items: checkboxStats(c.full).done
    }))
  }
}

const report = {
  dryRun,
  migrate: null,
  archive: null
}

if (doMigrate) {
  report.migrate = migrateLegacy({ dryRun })
}

if (!(doMigrate && migrateOnly)) {
  report.archive = archiveFromTodo({ dryRun })
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`TODO_ARCHIVE: ${dryRun ? 'dry-run' : 'apply'}`)
  if (report.migrate) {
    console.log(`  migrate: ${report.migrate.message}`)
    for (const v of report.migrate.volumeFiles || []) {
      console.log(`    - ${v.file} (~${v.lines} lines)`)
    }
  }
  if (report.archive) {
    console.log(`  archive: ${report.archive.message}`)
    for (const m of report.archive.moved || []) {
      const title = m.heading.length > 100 ? `${m.heading.slice(0, 97)}...` : m.heading
      console.log(`    - ${title} → ${m.volume || '(pending)'} (${m.items} items)`)
    }
  }
}

process.exit(0)
