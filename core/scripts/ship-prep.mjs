/**
 * Ship prep — lane classification + baseline check for /ship, shared by
 * Claude Code and Cursor. Source of truth for the thresholds in
 * .claude/commands/ship.md Phase 0 (classify) and Phase 3 (--check-baseline).
 * See plans/324-ship-prep-and-write-session-state-scripts.plan.md.
 *
 * Usage:
 *   node scripts/ship-prep.mjs [--mode auto|regular] [--json]
 *   node scripts/ship-prep.mjs --check-baseline [--json]
 *
 * Exit: 0 always (advisory tooling — the calling command decides whether to
 * stop based on the printed lane / status).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { isSlot, listSlots } from './lib/slot.mjs'
import { isOpenPlanPath } from './lib/plan-paths.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const BASELINE_PATH = join(repoRoot, '.claude', '.ship-baseline')

// Verbatim from .claude/commands/ship.md Phase 0 — keep in sync.
const SENSITIVE_PATHS_RE = /auth|crypto|guard|interceptor|security|payment|migration|schema|\.env|server\/routes|package(-lock)?\.json|\.github\/workflows|\.claude\/(settings|commands\/ship)\./
const ULTRA_TRIVIAL_RE = /docs\/session-state-.*\.md|\.claude\/todo\.md|CHANGELOG\.md|docs\/.*\.md/
const SECRET_PATH_RE = /(^|\/)\.env|\.pem$|\.key$|secret/i
// Planner admin-bypass shape — a diff entirely inside this is
// always ULTRA-TRIVIAL, evaluated before SENSITIVE_PATHS_RE so a plan named
// e.g. "…-migration-spec.plan.md" doesn't get bumped to REGULAR.
const isPlanOnly = f => isOpenPlanPath(f) || f === '.claude/todo.md'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next
        i++
      } else {
        out[key] = true
      }
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const asJson = Boolean(args.json)
const checkBaseline = Boolean(args['check-baseline'])
const mode = args.mode === 'regular' ? 'regular' : 'auto'

function git(cmdArgs) {
  try {
    // Trim only trailing newlines — a leading space is significant on the
    // first line of `git status --short` (" M path" for unstaged-modified).
    return execFileSync('git', cmdArgs, { cwd: repoRoot, encoding: 'utf8' }).replace(/\r?\n+$/, '')
  } catch {
    return ''
  }
}

function currentBranch() {
  return git(['branch', '--show-current'])
}

function currentHead() {
  return git(['rev-parse', 'HEAD'])
}

function worktreeCount() {
  const out = git(['worktree', 'list'])
  return out ? out.split('\n').filter(Boolean).length : 1
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return null
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  } catch {
    return null
  }
}

function writeBaseline(branch, head) {
  mkdirSync(dirname(BASELINE_PATH), { recursive: true })
  writeFileSync(BASELINE_PATH, JSON.stringify({ branch, head }, null, 2), 'utf8')
}

function getManifestFiles(branch) {
  const manifestPath = join(repoRoot, '.claude', 'sessions', branch, 'manifest.txt')
  if (!existsSync(manifestPath)) return null
  const lines = readFileSync(manifestPath, 'utf8').split(/\r?\n/).filter(Boolean)
  return new Set(lines)
}

function getManifestOverlaps(branch) {
  try {
    const out = execFileSync('python3', ['scripts/session-manifest-ship.py', branch], {
      cwd: repoRoot,
      encoding: 'utf8'
    })
    return JSON.parse(out)
  } catch {
    return { no_manifest: true, files: [], overlaps: [] }
  }
}

function hasActiveSiblingSlot() {
  return listSlots().some(s => !s.detached)
}

function scopeDiffReport() {
  try {
    execFileSync('node', ['scripts/scope-check.mjs', '--diff=origin/{{git.mainBranch}}'], { cwd: repoRoot, encoding: 'utf8' })
    return { scope: 'ok', files: [] }
  } catch (e) {
    const out = String(e.stdout || '')
    const files = out.split(/\r?\n/).map(l => l.trim()).filter(l => l && l !== 'SCOPE: out')
    return { scope: 'out', files }
  }
}

// Architecture-invariant warnings (`scope-check.mjs --arch --diff`): advisory, never blocks.
function archDiffReport() {
  try {
    const out = execFileSync('node', ['scripts/scope-check.mjs', '--arch', '--diff=origin/{{git.mainBranch}}'], { cwd: repoRoot, encoding: 'utf8' })
    return out.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('ARCH: warn'))
  } catch {
    return []
  }
}

function parseStatusPaths() {
  // --untracked-files=all: don't collapse a brand-new directory into one
  // "?? dir/" line — list each untracked file individually (e.g. a new
  // scripts/lib/ with one file inside would otherwise report as 1 "file").
  const out = git(['status', '--short', '--untracked-files=all'])
  if (!out) return []
  return out.split('\n').map(line => {
    const rest = line.slice(3)
    const arrowIdx = rest.indexOf(' -> ')
    return (arrowIdx >= 0 ? rest.slice(arrowIdx + 4) : rest).trim()
  }).filter(Boolean)
}

function parseNumstat(cmdArgs) {
  const out = git(cmdArgs)
  const map = new Map()
  if (!out) return map
  for (const line of out.split('\n')) {
    if (!line) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const [add, del, ...pathParts] = parts
    let path = pathParts.join('\t')
    const arrowIdx = path.indexOf(' => ')
    if (arrowIdx >= 0) path = path.slice(arrowIdx + 4).replace(/[{}]/g, '')
    const a = Number(add)
    const d = Number(del)
    map.set(path, (map.get(path) || 0) + (Number.isFinite(a) ? a : 0) + (Number.isFinite(d) ? d : 0))
  }
  return map
}

function untrackedLineCount(relPath) {
  try {
    const text = readFileSync(join(repoRoot, relPath), 'utf8')
    return text.length ? text.split(/\r?\n/).length : 0
  } catch {
    return 0
  }
}

function classify() {
  const branch = currentBranch()
  const head = currentHead()

  const allDirty = parseStatusPaths()
  const manifestFiles = getManifestFiles(branch)
  const noManifest = manifestFiles === null
  const thisChatFiles = noManifest ? allDirty : allDirty.filter(f => manifestFiles.has(f))

  const unstagedLines = parseNumstat(['diff', '--numstat'])
  const stagedLines = parseNumstat(['diff', '--cached', '--numstat'])

  const linesByFile = new Map()
  for (const f of thisChatFiles) {
    let lines = (unstagedLines.get(f) || 0) + (stagedLines.get(f) || 0)
    if (lines === 0 && !unstagedLines.has(f) && !stagedLines.has(f)) {
      lines = untrackedLineCount(f)
    }
    linesByFile.set(f, lines)
  }

  const fileCount = thisChatFiles.length
  const totalLines = [...linesByFile.values()].reduce((a, b) => a + b, 0)
  const sensitiveMatches = thisChatFiles.filter(f => SENSITIVE_PATHS_RE.test(f))
  const secretPaths = thisChatFiles.filter(f => SECRET_PATH_RE.test(f))

  const allPlanOnly = fileCount > 0 && thisChatFiles.every(isPlanOnly)

  let lane
  let laneReason
  if (mode === 'regular') {
    lane = 'REGULAR'
    laneReason = 'forced via --mode regular'
  } else if (allPlanOnly) {
    lane = 'ULTRA-TRIVIAL'
    laneReason = `${fileCount} file(s), plan/todo only`
  } else if (sensitiveMatches.length) {
    lane = 'REGULAR'
    laneReason = `touches ${sensitiveMatches[0]}`
  } else if (fileCount === 1 && totalLines <= 10 && ULTRA_TRIVIAL_RE.test(thisChatFiles[0])) {
    lane = 'ULTRA-TRIVIAL'
    laneReason = `${fileCount} file, ${totalLines} lines`
  } else if (fileCount <= 3 && totalLines <= 40) {
    lane = 'FAST'
    laneReason = `${fileCount} files, ${totalLines} lines, no sensitive paths`
  } else {
    lane = 'REGULAR'
    laneReason = fileCount > 3 || totalLines > 40
      ? `${fileCount} files, ${totalLines} lines`
      : 'does not clearly qualify for a faster lane'
  }

  const wtCount = worktreeCount()
  const inSlot = isSlot()
  const scopeReport = inSlot ? scopeDiffReport() : null
  const archWarnings = archDiffReport()
  const manifestOverlap = inSlot
    ? { no_manifest: noManifest, files: [...thisChatFiles], overlaps: [] }
    : hasActiveSiblingSlot()
      ? getManifestOverlaps(branch)
      : { no_manifest: noManifest, files: [...thisChatFiles], overlaps: [] }

  const branchPlanMatch = branch.match(/(\d{3,4})/)
  let planTodos = null
  if (branchPlanMatch) {
    try {
      const out = execFileSync('node', ['scripts/todo-query.mjs', 'open', '--plan', branchPlanMatch[1], '--json'], {
        cwd: repoRoot,
        encoding: 'utf8'
      })
      planTodos = { plan: branchPlanMatch[1], sections: JSON.parse(out) }
    } catch {
      planTodos = { plan: branchPlanMatch[1], sections: [] }
    }
  }

  writeBaseline(branch, head)

  return {
    branch,
    head,
    lane,
    laneReason,
    fileCount,
    totalLines,
    thisChatFiles,
    noManifest,
    sensitiveMatches,
    secretPaths,
    worktreeCount: wtCount,
    overlaps: manifestOverlap.overlaps || [],
    scope: scopeReport ? scopeReport.scope : null,
    scopeFiles: scopeReport ? scopeReport.files : [],
    archWarnings,
    planTodos
  }
}

function checkBaselineReport() {
  const branch = currentBranch()
  const head = currentHead()
  const baseline = readBaseline()

  let status
  if (!baseline) {
    status = 'OK'
  } else if (baseline.branch !== branch) {
    status = 'BRANCH_CHANGED'
  } else if (baseline.head !== head) {
    status = 'HEAD_MOVED'
  } else {
    status = 'OK'
  }

  const wtCount = worktreeCount()
  const inSlot = isSlot()
  const scopeReport = inSlot ? scopeDiffReport() : null
  const archWarnings = archDiffReport()
  const manifestOverlap = inSlot
    ? { no_manifest: false, files: [], overlaps: [] }
    : hasActiveSiblingSlot()
      ? getManifestOverlaps(branch)
      : getManifestFiles(branch) === null
        ? { no_manifest: true, files: [], overlaps: [] }
        : { no_manifest: false, files: [...getManifestFiles(branch)], overlaps: [] }

  return {
    status,
    branch,
    head,
    scope: scopeReport ? scopeReport.scope : null,
    scopeFiles: scopeReport ? scopeReport.files : [],
    archWarnings,
    baselineBranch: baseline ? baseline.branch : null,
    baselineHead: baseline ? baseline.head : null,
    worktreeCount: wtCount,
    noManifest: manifestOverlap.no_manifest,
    overlaps: manifestOverlap.overlaps || []
  }
}

if (checkBaseline) {
  const report = checkBaselineReport()
  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`SHIP_PREP: --check-baseline`)
    console.log(`  status: ${report.status}`)
    if (report.status !== 'OK') {
      console.log(`  baseline: ${report.baselineBranch}@${(report.baselineHead || '').slice(0, 8)}`)
      console.log(`  current:  ${report.branch}@${report.head.slice(0, 8)}`)
    }
    if (report.noManifest) console.log('  no_manifest: true')
    if (report.overlaps.length) {
      console.log(`  overlaps: ${report.overlaps.length}`)
      for (const o of report.overlaps) console.log(`    - ${o.branch}: ${o.files.join(', ')}`)
    }
    if (report.scope) {
      console.log(`  scope: ${report.scope}`)
      for (const f of report.scopeFiles) console.log(`    - ${f}`)
    }
    for (const w of report.archWarnings) console.log(`  ${w}`)
  }
} else {
  const report = classify()
  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`Lane: ${report.lane} (${report.laneReason})`)
    if (report.noManifest) console.log('  no_manifest: true — using full dirty-file list')
    if (report.overlaps.length) {
      console.log(`  overlaps: ${report.overlaps.length}`)
      for (const o of report.overlaps) console.log(`    - ${o.branch}: ${o.files.join(', ')}`)
    }
    if (report.scope) {
      console.log(`  scope: ${report.scope}`)
      for (const f of report.scopeFiles) console.log(`    - ${f}`)
    }
    for (const w of report.archWarnings) console.log(`  ${w}`)
    if (report.secretPaths.length) {
      console.log(`  SECRET-SHAPED PATHS — do not stage: ${report.secretPaths.join(', ')}`)
    }
    if (report.planTodos) {
      console.log(`  plan ${report.planTodos.plan} open items:`)
      for (const s of report.planTodos.sections) {
        for (const item of s.items) console.log(`    ${item.line}: ${item.text}`)
      }
    }
  }
}
