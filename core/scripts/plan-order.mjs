/**
 * Plan order — the run order of a set of plans: waves (what can run in parallel), lanes, lock groups (conflicts
 * derived from Read-Write Scope overlap) and the reason of every edge.
 *
 * Usage:
 *   node scripts/plan-order.mjs [NNN | plans/NNN-x.plan.md ...] [--json]
 *                               [--branch <name> --merged-from git] [--root <dir>]
 *
 * No plans named = every open plan. A dependency that is an open plan but not named is added to the order.
 * A dependency counts as met (done) when its plan is closed (moved out of the open plan folders), its Status: says
 * done/superseded/closed, or — with --branch <b> --merged-from git — a commit subject on <b> reads exactly
 *   Merge <source-branch> into <b> (plan NNN)
 * (anchored: "plan NNN" anywhere else in a subject never counts). A named plan that is done is left out of the waves.
 *
 * Dependencies come from the plan's "Depends-on:" line and legacy prose ("Prerequisite: plan NNN merged"), read by
 * scripts/lib/plan-deps.mjs — the same parser scope-check --deps and take-plan use.
 *
 * Output: one line per wave ("WAVE 2: 013, 017 (lock group: core/scripts/scope-check.mjs)"), then LANE, CONFLICT and
 * EDGE lines. --json prints { waves, lanes, conflicts, edges, done, plans }. Exit 1 on a cycle (CYCLE: names the
 * plans) or a missing dependency (MISSING: names the plan and the file it expected); 0 otherwise.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join, isAbsolute, relative } from 'path'
import { fileURLToPath } from 'url'
import { extractScopeGlobs } from './lib/plan-scope.mjs'
import { listOpenPlans, isOpenPlanPath, OPEN_PLAN_DIRS } from './lib/plan-paths.mjs'
import { planNumber, planTitle, planDependencies, isFinishedStatus, mergedPlansFromSubjects } from './lib/plan-deps.mjs'
import { computeOrder, formatOrder } from './lib/plan-graph.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Append-only files every plan may touch (the same list scope-check.mjs allows): never a conflict.
const HOTSPOTS = [
  {{project.i18nFile|quoted}},
  {{paths.hotspots|quoted}}
].filter(Boolean)

function parseArgs(argv) {
  const out = { plans: [] }
  const valued = new Set(['branch', 'merged-from', 'root'])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      out.plans.push(a)
      continue
    }
    const eq = a.indexOf('=')
    const key = eq >= 0 ? a.slice(2, eq) : a.slice(2)
    if (eq >= 0) out[key] = a.slice(eq + 1)
    else if (valued.has(key) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[key] = argv[++i]
    else out[key] = true
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const root = args.root ? resolve(String(args.root)) : resolve(__dirname, '..')
const toPosix = (p) => String(p).replace(/\\/g, '/')

function fail(message, json) {
  if (args.json && json) console.log(JSON.stringify(json, null, 2))
  console.error(message)
  process.exit(1)
}

function git(cmdArgs) {
  try {
    return execFileSync('git', cmdArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r?\n+$/, '')
  } catch {
    return ''
  }
}

// Every *.plan.md under plans/ (open and closed), repo-relative.
function allPlanFiles() {
  const out = []
  const walk = (rel) => {
    const abs = join(root, rel)
    if (!existsSync(abs)) return
    for (const name of readdirSync(abs)) {
      const childRel = `${rel}/${name}`
      if (statSync(join(root, childRel)).isDirectory()) walk(childRel)
      else if (name.endsWith('.plan.md')) out.push(childRel)
    }
  }
  for (const top of new Set(OPEN_PLAN_DIRS.map((d) => d.split('/')[0]))) walk(top)
  return out.sort()
}

if (args['merged-from'] && args['merged-from'] !== 'git') fail(`PLAN_ORDER: --merged-from supports only "git", got "${args['merged-from']}"`)
if (args['merged-from'] && !args.branch) fail('PLAN_ORDER: --merged-from git needs --branch <name>')

const files = allPlanFiles()
const openPlans = listOpenPlans(root)
const openByNnn = new Map(openPlans.map((p) => [planNumber(p), p]))
const closedByNnn = new Map(files.filter((p) => !isOpenPlanPath(p) && planNumber(p)).map((p) => [planNumber(p), p]))

// What counts as done: closed, finished Status:, or (--merged-from git) the anchored merge subject on --branch.
const done = new Map()
for (const [n, p] of closedByNnn) if (!openByNnn.has(n)) done.set(n, `closed: ${p}`)
if (args['merged-from'] === 'git') {
  const branch = String(args.branch)
  const ref = git(['rev-parse', '--verify', '--quiet', branch]) ? branch : git(['rev-parse', '--verify', '--quiet', `origin/${branch}`]) ? `origin/${branch}` : null
  if (!ref) fail(`PLAN_ORDER: branch ${branch} not found in ${toPosix(root)}`)
  const subjects = git(['log', '--format=%s', ref]).split('\n')
  for (const n of mergedPlansFromSubjects(subjects, branch)) done.set(n, `merged into ${branch}`)
}

const texts = new Map()
const readPlan = (rel) => {
  if (!texts.has(rel)) texts.set(rel, readFileSync(join(root, rel), 'utf8'))
  return texts.get(rel)
}
for (const [n, p] of openByNnn) if (!done.has(n) && isFinishedStatus(readPlan(p))) done.set(n, `Status: done in ${p}`)

// The named plans (numbers or paths); none named = every open plan.
const requested = []
for (const a of args.plans.length ? args.plans : openPlans) {
  const nnn = planNumber(a)
  if (!nnn) fail(`PLAN_ORDER: "${a}" is not a plan number or a plans/NNN-<slug>.plan.md path`)
  let rel = openByNnn.get(nnn)
  if (/\.plan\.md$/.test(a)) {
    const abs = isAbsolute(a) ? a : join(root, a)
    if (!existsSync(abs)) fail(`PLAN_ORDER: plan not found: ${a}`)
    rel = toPosix(relative(root, abs))
    if (!texts.has(rel)) texts.set(rel, readFileSync(abs, 'utf8'))
  }
  if (!rel && !done.has(nnn)) fail(`PLAN_ORDER: plan ${nnn} not found — expected ${OPEN_PLAN_DIRS[0]}/${nnn}-*.plan.md`, { error: 'missing', missing: [{ plan: nnn, expected: `${OPEN_PLAN_DIRS[0]}/${nnn}-*.plan.md` }] })
  requested.push({ nnn, rel })
}

// The order: named plans that are not done, plus every open dependency they reach.
const plans = new Map()
const skipped = []
const queue = []
for (const r of requested) {
  if (done.has(r.nnn)) skipped.push(r.nnn)
  else queue.push(r)
}
while (queue.length) {
  const { nnn, rel } = queue.shift()
  if (plans.has(nnn)) continue
  const text = readPlan(rel)
  const { deps } = planDependencies(text, nnn)
  plans.set(nnn, { nnn, path: rel, title: planTitle(text), deps, scope: extractScopeGlobs(text) || [], added: !requested.some((r) => r.nnn === nnn) })
  for (const d of deps) {
    if (plans.has(d.nnn) || done.has(d.nnn)) continue
    const depRel = openByNnn.get(d.nnn)
    if (depRel) queue.push({ nnn: d.nnn, rel: depRel })
  }
}

const order = computeOrder({ plans: [...plans.values()], done, hotspots: HOTSPOTS, files: git(['ls-files']).split('\n').filter(Boolean) })
const expected = (n) => `${OPEN_PLAN_DIRS[0]}/${n}-*.plan.md`
if (!order.ok && order.error === 'cycle') {
  fail(`CYCLE: ${order.cycle.join(' -> ')} — these plans depend on each other; remove one Depends-on: line`, { error: 'cycle', cycle: order.cycle })
}
if (!order.ok && order.error === 'missing') {
  const lines = order.missing.map((m) => `MISSING: plan ${m.plan} depends on ${m.dependency} (${m.reason}), expected ${expected(m.dependency)} — not found, not closed${args['merged-from'] ? ', not merged' : ''}`)
  fail(lines.join('\n'), { error: 'missing', missing: order.missing.map((m) => ({ ...m, expected: expected(m.dependency) })) })
}

const meta = Object.fromEntries([...plans.values()].map((p) => [p.nnn, { title: p.title, path: p.path, added: p.added }]))
if (args.json) {
  console.log(JSON.stringify({ waves: order.waves, lanes: order.lanes, conflicts: order.conflicts, waveLocks: order.waveLocks, edges: order.edges, done: order.done, skipped, plans: meta }, null, 2))
} else {
  for (const n of skipped) console.log(`SKIPPED: ${n} (${done.get(n)})`)
  const titles = Object.fromEntries([...plans.values()].map((p) => [p.nnn, p.title]))
  const text = formatOrder(order, titles)
  console.log(text || 'PLAN_ORDER: nothing to order')
  for (const p of plans.values()) if (p.added) console.log(`ADDED: ${p.nnn} (${p.title}) — a dependency of a named plan`)
}
