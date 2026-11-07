/**
 * Ship prep — lane classification, the build gate and the baseline check for /ship, shared by Claude Code and Cursor.
 * Source of truth for .claude/commands/ship.md Phase 0 (classify), Phase 1 (--gate) and Phase 3 (--check-baseline).
 *
 * Usage:
 *   node scripts/ship-prep.mjs [--mode auto|regular] [--json]
 *   node scripts/ship-prep.mjs --gate [--lane FAST|ULTRA-TRIVIAL|REGULAR]
 *   node scripts/ship-prep.mjs --check-baseline [--json]
 *
 * Exit: 0 for the lane and the baseline (advisory — the calling command decides on the printed lane / status);
 * --gate exits 1 on the first failing command (a hard stop) and 0 when every command passed.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { execFileSync, spawnSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { isSlot, listSlots, scopedPlanPath } from './lib/slot.mjs'
import { isOpenPlanPath } from './lib/plan-paths.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const BASELINE_PATH = join(repoRoot, '.claude', '.ship-baseline')

// Sensitive paths (a FAST lane is never taken over one). kit.config.json security.sensitivePaths: a regex
// string replaces this default, a list of globs (`**` any depth, `*` within a folder) is added to it.
const DEFAULT_SENSITIVE_RE = /auth|crypto|guard|interceptor|security|payment|migration|schema|\.env|server\/routes|package(-lock)?\.json|\.github\/workflows|\.claude\/(settings|commands\/ship)\./
const SENSITIVE_CFG = {{security.sensitivePaths|json}}
const globRe = (g) => new RegExp(`^${g.split('**').map((part) => part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`)
function sensitiveTests() {
  if (Array.isArray(SENSITIVE_CFG)) return [DEFAULT_SENSITIVE_RE, ...SENSITIVE_CFG.filter(Boolean).map(globRe)]
  if (typeof SENSITIVE_CFG !== 'string' || !SENSITIVE_CFG) return [DEFAULT_SENSITIVE_RE]
  try {
    return [new RegExp(SENSITIVE_CFG)]
  } catch {
    console.log('ship-prep: warning - security.sensitivePaths is not a valid regex; using the built-in sensitive paths')
    return [DEFAULT_SENSITIVE_RE]
  }
}
const SENSITIVE_TESTS = sensitiveTests()
const isSensitive = (f) => SENSITIVE_TESTS.some((re) => re.test(f))
// Build and CI files take the REGULAR lane whatever security.sensitivePaths says: a project regex replaces the default
// list above, and one that left these out once sent a 22-file package-manager move down the FAST lane.
export const BUILD_RE = /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|kit\.config\.json)$|^\.github\/workflows\//
const isBuildFile = (f) => BUILD_RE.test(f)
const ULTRA_TRIVIAL_RE = /\.claude\/todo\.md|CHANGELOG\.md|docs\/.*\.md/
const SECRET_PATH_RE = /(^|\/)\.env|\.pem$|\.key$|secret/i
// Planner admin-bypass shape — a diff entirely inside this is
// always ULTRA-TRIVIAL, evaluated before the sensitive paths so a plan named
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

// The first interpreter that actually runs: on Windows `python3` is often the Store stub, which fails.
const PYTHONS = ['python3', 'python', 'py']
function findPython() {
  for (const py of PYTHONS) {
    try {
      execFileSync(py, ['-c', 'import sys'], { stdio: 'ignore' })
      return py
    } catch { /* try the next one */ }
  }
  return null
}

function getManifestOverlaps(branch) {
  const py = findPython()
  if (!py) {
    console.error(`WARNING: no working Python (tried ${PYTHONS.join(', ')}); session manifest skipped, using the full dirty-file list`)
    return { no_manifest: true, files: [], overlaps: [] }
  }
  try {
    const out = execFileSync(py, ['scripts/session-manifest-ship.py', branch], {
      cwd: repoRoot,
      encoding: 'utf8'
    })
    return JSON.parse(out)
  } catch (e) {
    console.error(`WARNING: scripts/session-manifest-ship.py failed under ${py} (${String(e.message).split(/\r?\n/)[0]}); using the full dirty-file list`)
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

/**
 * The lane for a set of changed files. Plan/todo files only → ULTRA-TRIVIAL; a sensitive, build or CI file → REGULAR;
 * one small doc-shaped file → ULTRA-TRIVIAL; up to 3 files / 40 lines → FAST; else REGULAR. Exported for the tests.
 */
export function laneFor({ mode = 'auto', files, totalLines, sensitiveMatches = files.filter(isSensitive), buildMatches = files.filter(isBuildFile) }) {
  const fileCount = files.length
  if (mode === 'regular') return { lane: 'REGULAR', laneReason: 'forced via --mode regular' }
  if (fileCount > 0 && files.every(isPlanOnly)) return { lane: 'ULTRA-TRIVIAL', laneReason: `${fileCount} file(s), plan/todo only` }
  if (sensitiveMatches.length) return { lane: 'REGULAR', laneReason: `touches ${sensitiveMatches[0]}` }
  if (buildMatches.length) return { lane: 'REGULAR', laneReason: `touches ${buildMatches[0]} (build or CI file)` }
  if (fileCount === 1 && totalLines <= 10 && ULTRA_TRIVIAL_RE.test(files[0])) return { lane: 'ULTRA-TRIVIAL', laneReason: `${fileCount} file, ${totalLines} lines` }
  if (fileCount <= 3 && totalLines <= 40) return { lane: 'FAST', laneReason: `${fileCount} files, ${totalLines} lines, no sensitive paths` }
  return {
    lane: 'REGULAR',
    laneReason: fileCount > 3 || totalLines > 40 ? `${fileCount} files, ${totalLines} lines` : 'does not clearly qualify for a faster lane',
  }
}

// ---- Phase 1: the build gate (--gate) — run by code, no runner agent ------------------------------------------------
const GATE_PM = {{project.packageManager|json}} === 'pnpm' ? 'pnpm' : 'npm'
const GATE_SCRIPTS = { build: {{commands.build|json}}, lint: {{commands.lint|json}}, test: {{commands.test|json}}, testCi: {{commands.testCi|json}} }
const LEDGER_CMD = 'node scripts/plan-ledger-check.mjs'
const GATE_TAIL = 20

/**
 * The gate's commands for a lane: build, lint, the test script (commands.testCi wins over commands.test) on REGULAR
 * only, then the plan ledger and the override check. An unset script is left out. Exported for the tests.
 */
export function shipGateCommands({ lane, pm = GATE_PM, build = GATE_SCRIPTS.build, lint = GATE_SCRIPTS.lint, test = GATE_SCRIPTS.test, testCi = GATE_SCRIPTS.testCi }) {
  const run = (s) => (typeof s === 'string' && s !== '' ? `${pm} run ${s}` : null)
  return [run(build), run(lint), lane === 'REGULAR' ? run(testCi || test) : null, LEDGER_CMD, 'node scripts/override-check.mjs'].filter(Boolean)
}

/** One gate command by spawnSync: `node …` with this node, `npm|pnpm run <script>` (through the shell on Windows). */
function spawnGateCommand(cmd, cwd = repoRoot) {
  const w = cmd.split(/\s+/)
  const argv = w[0] === 'node' ? { file: process.execPath, args: w.slice(1), shell: false }
    : process.platform === 'win32' ? { file: cmd, args: [], shell: true } : { file: w[0], args: w.slice(1), shell: false }
  const r = spawnSync(argv.file, argv.args, { cwd, shell: argv.shell, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  return { exit: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}` }
}

/**
 * Run the gate in order: one `GATE: <cmd> → exit <n>` line per command; the ledger's output is printed even on exit 0
 * (its warnings are advisory); the first failure prints its last lines and `GATE: FAIL — <cmd>` and stops (exit 1).
 * `run` (tests) replaces spawnSync. Returns { exit, results: [{ command, status, exit, tail }] } — the gate receipt.
 */
export function runShipGate({ commands, run = spawnGateCommand, log = console.log }) {
  const results = []
  for (const command of commands) {
    const r = run(command)
    const lines = String(r.out ?? '').split(/\r?\n/).filter((l) => l.trim() !== '')
    const tail = lines.slice(-GATE_TAIL).join('\n')
    log(`GATE: ${command} → exit ${r.exit}`)
    results.push({ command, status: r.exit === 0 ? 'pass' : 'fail', exit: r.exit, tail })
    if (r.exit !== 0) {
      for (const l of lines.slice(-GATE_TAIL)) log(`  | ${l}`)
      log(`GATE: FAIL — ${command}`)
      return { exit: 1, results }
    }
    if (command === LEDGER_CMD) for (const l of lines) log(`  | ${l}`)
  }
  log(`GATE: PASS — ${results.length} command(s)`)
  return { exit: 0, results }
}

function classify({ write = true } = {}) {
  const branch = currentBranch()
  const head = currentHead()

  const allDirty = parseStatusPaths()
  const manifestFiles = getManifestFiles(branch)
  const noManifest = manifestFiles === null
  // On a plan branch every dirty file is the plan's work. The session manifest knows only Edit/Write, so shell edits,
  // `git rm` and generated lockfiles would be left out of the count; it still filters a shared main folder.
  const onPlanBranch = isSlot() || Boolean(scopedPlanPath(branch))
  const thisChatFiles = noManifest || onPlanBranch ? allDirty : allDirty.filter(f => manifestFiles.has(f))
  const offManifest = onPlanBranch && !noManifest ? allDirty.filter(f => !manifestFiles.has(f)) : []

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
  const sensitiveMatches = thisChatFiles.filter(isSensitive)
  const buildMatches = thisChatFiles.filter(isBuildFile)
  const secretPaths = thisChatFiles.filter(f => SECRET_PATH_RE.test(f))

  const { lane, laneReason } = laneFor({ mode, files: thisChatFiles, totalLines, sensitiveMatches, buildMatches })

  const wtCount = worktreeCount()
  const inSlot = isSlot()
  // Outside a slot, a branch that names a plan (feat/NNN-<slug>, or a merge folder's .worktree-plan) is still held to
  // its plan's scope: the same rule the scope-guard hook uses (lib/slot.mjs scopedPlanPath).
  const scopeReport = inSlot || scopedPlanPath(branch) ? scopeDiffReport() : null
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

  if (write) writeBaseline(branch, head)

  return {
    branch,
    head,
    lane,
    laneReason,
    fileCount,
    totalLines,
    thisChatFiles,
    noManifest,
    offManifest,
    sensitiveMatches,
    buildMatches,
    secretPaths,
    worktreeCount: wtCount,
    overlaps: manifestOverlap.overlaps || [],
    pruned: manifestOverlap.pruned || [],
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
  // Outside a slot, a branch that names a plan (feat/NNN-<slug>, or a merge folder's .worktree-plan) is still held to
  // its plan's scope: the same rule the scope-guard hook uses (lib/slot.mjs scopedPlanPath).
  const scopeReport = inSlot || scopedPlanPath(branch) ? scopeDiffReport() : null
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
    overlaps: manifestOverlap.overlaps || [],
    pruned: manifestOverlap.pruned || []
  }
}

// Imported by the tests (laneFor, BUILD_RE): nothing below runs unless this file is the script node started.
const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (!isMain) {
  // imported, not run
} else if (args.gate) {
  const LANES = ['FAST', 'ULTRA-TRIVIAL', 'REGULAR']
  const given = typeof args.lane === 'string' ? args.lane.toUpperCase() : null
  if (given && !LANES.includes(given)) {
    console.log(`GATE: refused — --lane ${args.lane} is not one of ${LANES.join(', ')}`)
    process.exit(1)
  }
  const lane = given ?? (mode === 'regular' ? 'REGULAR' : classify({ write: false }).lane)
  console.log(`GATE: lane ${lane}`)
  const gate = runShipGate({ commands: shipGateCommands({ lane }) })
  // The receipt for the single reviewer (review.ship = reviewer): what the checks printed, in this checkout's git
  // folder, written atomically and bound to HEAD + the tree, so a stale or foreign receipt is never read as this one.
  const { writeShipGateReceipt } = await import('./lib/plan-review.mjs')
  try {
    const receiptPath = writeShipGateReceipt(repoRoot, { lane, at: new Date().toISOString(), results: gate.results })
    console.log(`GATE_RECEIPT: ${receiptPath}`)
  } catch (e) {
    console.log(`GATE_RECEIPT: not written (${e.message})`)
  }
  process.exitCode = gate.exit
} else if (checkBaseline) {
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
    if (report.pruned && report.pruned.length) {
      console.log(`  pruned stale manifests (merged/deleted branch): ${report.pruned.join(', ')}`)
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
    if (report.offManifest.length) console.log(`  ${report.offManifest.length} dirty file(s) not in the session manifest (shell edits, git rm, generated files) — counted: plan branch`)
    if (report.overlaps.length) {
      console.log(`  overlaps: ${report.overlaps.length}`)
      for (const o of report.overlaps) console.log(`    - ${o.branch}: ${o.files.join(', ')}`)
    }
    if (report.pruned && report.pruned.length) {
      console.log(`  pruned stale manifests (merged/deleted branch): ${report.pruned.join(', ')}`)
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
