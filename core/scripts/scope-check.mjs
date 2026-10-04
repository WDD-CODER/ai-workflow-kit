/**
 * Scope check — enforces a plan's Read-Write Scope for Workers. Shared by
 * scope-guard.sh (PreToolUse), ship-prep.mjs and take-plan.mjs.
 * See plans/326-planner-worker-workflow.plan.md.
 *
 * Usage:
 *   node scripts/scope-check.mjs --file=<path> [--plan=<path>]
 *   node scripts/scope-check.mjs --diff=<base> [--plan=<path>]
 *   node scripts/scope-check.mjs --overlap --plan=<path>
 *   node scripts/scope-check.mjs --drift [--plan=<path>]
 *
 * --plan defaults to the active slot's .worktree-plan. Exit 1 on a missing
 * plan / scope block, on --file/--diff finding an out-of-scope file, on
 * --overlap finding a shared glob with another active plan, or on --drift
 * finding an in-scope commit since the plan's Snapshot.
 */
import { readFileSync, existsSync, readdirSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import picomatch from 'picomatch'
import { activePlanPath } from './lib/slot.mjs'
import { extractScopeGlobs } from './lib/plan-scope.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

// Append-only hotspots (Planner-Worker rules): every plan may touch
// these regardless of its own Read-Write Scope, but must never remove or
// rewrite an existing entry — only add to them.
const HOTSPOTS = [
  {{project.i18nFile|quoted}},
  {{paths.hotspots|quoted}}
]

function fail(message) {
  console.error(`SCOPE_CHECK: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const out = {}
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue
    const eq = arg.indexOf('=')
    if (eq >= 0) out[arg.slice(2, eq)] = arg.slice(eq + 1)
    else out[arg.slice(2)] = true
  }
  return out
}

function git(cmdArgs) {
  try {
    return execFileSync('git', cmdArgs, { cwd: repoRoot, encoding: 'utf8' }).replace(/\r?\n+$/, '')
  } catch {
    return ''
  }
}

function normalize(p) {
  return String(p).replace(/\\/g, '/')
}

function sanitizeBranch(branch) {
  return branch.replace(/[^a-zA-Z0-9]/g, '-')
}

function readPlanFile(planPath) {
  const abs = join(repoRoot, planPath)
  if (!existsSync(abs)) fail(`plan not found: ${planPath}`)
  return readFileSync(abs, 'utf8')
}

function extractField(planText, name) {
  const m = planText.match(new RegExp(`^${name}:\\s*(\\S+)`, 'm'))
  return m ? m[1] : null
}

function resolvePlanPath(args) {
  if (args.plan) return normalize(args.plan)
  const active = activePlanPath()
  if (!active) fail('no --plan given and no active plan for this slot (.worktree-plan missing)')
  return normalize(active)
}

function buildMatcher(planPath) {
  const planText = readPlanFile(planPath)
  const scopeGlobs = extractScopeGlobs(planText)
  if (!scopeGlobs) fail(`${planPath} has no readable scope under "## Read-Write Scope" (need a \`\`\`scope block or a **Scope:** list of \`globs\`)`)

  const branch = sanitizeBranch(git(['branch', '--show-current']))
  const alwaysAllowed = [
    planPath,
    `docs/session-state-${branch}.md`,
    '.claude/sessions/**',
    '.worktree-*',
    ...HOTSPOTS
  ]

  const allowed = [...alwaysAllowed, ...scopeGlobs]
  const isMatch = picomatch(allowed, { dot: true })
  return { isMatch, planText, scopeGlobs }
}

function changedFiles(base) {
  const ranged = git(['diff', '--name-only', `${base}...HEAD`])
  const staged = git(['diff', '--name-only', '--cached'])
  const unstaged = git(['diff', '--name-only'])
  const untracked = git(['ls-files', '--others', '--exclude-standard'])

  const all = new Set()
  for (const block of [ranged, staged, unstaged, untracked]) {
    for (const line of block.split('\n')) {
      const t = line.trim()
      if (t) all.add(normalize(t))
    }
  }
  return [...all]
}

function cmdFile(args) {
  const planPath = resolvePlanPath(args)
  const { isMatch } = buildMatcher(planPath)
  const file = normalize(args.file)

  if (isMatch(file)) {
    console.log(`SCOPE: ok ${file}`)
    process.exit(0)
  }
  console.error(`SCOPE: out ${file}`)
  process.exit(1)
}

function cmdDiff(args) {
  const planPath = resolvePlanPath(args)
  const { isMatch } = buildMatcher(planPath)
  const out = changedFiles(args.diff).filter(f => !isMatch(f))

  if (!out.length) {
    console.log('SCOPE: ok')
    return
  }
  console.log('SCOPE: out')
  for (const f of out) console.log(`  ${f}`)
  process.exit(1)
}

function cmdOverlap(args) {
  if (!args.plan) fail('--overlap requires --plan=<path>')
  const planPath = normalize(args.plan)
  const { scopeGlobs } = buildMatcher(planPath)

  const plansDir = join(repoRoot, 'plans')
  const siblingFiles = existsSync(plansDir)
    ? readdirSync(plansDir).filter(f => f.endsWith('.plan.md')).map(f => `plans/${f}`)
    : []

  const overlaps = []
  for (const other of siblingFiles) {
    if (other === planPath) continue
    const otherText = readFileSync(join(repoRoot, other), 'utf8')
    if (extractField(otherText, 'Status') !== 'active') continue
    const otherGlobs = extractScopeGlobs(otherText)
    if (!otherGlobs) continue
    const shared = scopeGlobs.filter(g => otherGlobs.includes(g))
    if (shared.length) overlaps.push({ plan: other, globs: shared })
  }

  if (!overlaps.length) {
    console.log('OVERLAP: none')
    return
  }
  console.log('OVERLAP:')
  for (const o of overlaps) console.log(`  ${o.plan}: ${o.globs.join(', ')}`)
  process.exit(1)
}

function cmdDrift(args) {
  const planPath = resolvePlanPath(args)
  const planText = readPlanFile(planPath)
  const snapshot = extractField(planText, 'Snapshot')
  if (!snapshot) fail(`${planPath} has no "Snapshot:" line`)

  const scopeGlobs = extractScopeGlobs(planText)
  if (!scopeGlobs) fail(`${planPath} has no readable scope under "## Read-Write Scope" (need a \`\`\`scope block or a **Scope:** list of \`globs\`)`)

  // Hotspots are append-only and shared by every plan — a hotspot commit
  // from someone else's work isn't drift for this plan.
  const pathspecs = scopeGlobs.filter(g => !HOTSPOTS.includes(g)).map(g => `:(glob)${g}`)
  const out = pathspecs.length ? git(['log', '--oneline', `${snapshot}..origin/{{git.mainBranch}}`, '--', ...pathspecs]) : ''

  if (!out) {
    console.log('REALITY: clean')
    return
  }
  console.log('REALITY: drift')
  console.log(out)
  process.exit(1)
}

const args = parseArgs(process.argv.slice(2))

if (args.file) cmdFile(args)
else if (args.diff) cmdDiff(args)
else if (args.overlap) cmdOverlap(args)
else if (args.drift) cmdDrift(args)
else fail('usage: --file=<p> | --diff=<base> | --overlap --plan=<p> | --drift [--plan=<p>]')
