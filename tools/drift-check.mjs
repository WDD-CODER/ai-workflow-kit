/**
 * kit-drift — does a project's copy of the workflow still match the kit, except for its declared overrides?
 *
 *   node tools/drift-check.mjs --target <dir> [--source github:<owner>/<repo> --ref <tag> | --source <kit folder>]
 *                              [--packs angular,node-express] [--layers supabase,upstream-owned] [--cursor | --no-cursor] [--verbose]
 *
 * Source: --source/--ref, else the source + ref recorded in .kit/install.json, else the kit these tools run from.
 *
 * Renders every managed file (core, packs, Cursor layer) with the target's kit.config.json, exactly as
 * install would, and compares it byte for byte with the target's copy. Seeds (templates/ and the brain lessons
 * under docs/brain/) are the project's own after install and are not compared; every other core file is,
 * including .claude/references/ (the PRD/HLD templates). Works with or without .kit/install.json, so it also runs on a
 * project that is not kit-installed yet.
 *
 * Packs, layers and Cursor: --packs / --layers / --cursor flags, else .kit/install.json, else kit.config.json `stack.packs` / `stack.layers` and
 * "a .cursor/ folder exists".
 *
 *   drift      the project's file differs from the rendered kit file      -> exit 1
 *   missing    the kit ships it, the project has no such file             -> exit 1
 *   override   listed in kit.config.json `overrides`, or upstream-owned   -> fine
 *              (an ownership.upstreamPaths glob matches it; any content)
 *   ignored    missing, and the project's git ignores the path            -> fine (it never reaches a clone)
 *   override-missing-step   an override of a workflow lacks a step the kit marks `# KIT:required` (names from
 *              .kit/install.json `required`, else the rendered kit file)  -> exit 1; not checked on the kit's own checkout
 *
 * Read-only. Exit 0 = no undeclared differences, 1 = differences or a usage/config error.
 */
import { readFileSync, existsSync } from 'fs'
import { resolve, join } from 'path'
import { resolveSource } from './lib/source.mjs'
import { missingSteps } from '../core/scripts/lib/override-steps.mjs'
import { KIT_ROOT, requiredByDest, readJson, resolveConfig, planFiles, parseArgs, readOverrides, ownsAgents, ignoredPaths, AGENTS_WORKFLOW, splitList, withUpstream, projectConfigPath, configLabel } from './lib/kit.mjs'

const die = (m) => {
  console.error(`KIT_DRIFT: FAIL — ${m}`)
  process.exit(1)
}

let args
try {
  args = parseArgs(process.argv.slice(2), { target: 'value', source: 'value', ref: 'value', packs: 'value', layers: 'value', cursor: 'bool', 'no-cursor': 'bool', verbose: 'bool' })
} catch (e) {
  die(e.message)
}
if (!args.target) die('--target <dir> is required')
const target = resolve(args.target)
if (!existsSync(target)) die(`${target} does not exist`)

const cfgFile = projectConfigPath(target)
const cfgName = configLabel(target, cfgFile)
const project = existsSync(cfgFile) ? readJson(cfgFile) : {}
const instFile = join(target, '.kit', 'install.json')
const inst = existsSync(instFile) ? readJson(instFile) : null

const packs = args.packs != null ? splitList(args.packs) : inst?.packs ?? project.stack?.packs ?? []
const layers = args.layers != null ? splitList(args.layers) : inst?.layers ?? project.stack?.layers ?? []
const cursor = args.cursor ? true : args['no-cursor'] ? false : inst ? !!inst.cursor : existsSync(join(target, '.cursor'))

let plan
let overrides
let kitRoot
let origin
try {
  const recorded = !args.source && inst?.source ? inst.source : null
  ;({ kitRoot, record: origin } = resolveSource({
    source: args.source ?? recorded,
    ref: args.ref ?? (recorded ? inst.ref : undefined),
    fallback: KIT_ROOT,
    target,
    baseDir: recorded ? target : process.cwd(),
  }))
  const vals = resolveConfig({ kitRoot, project, packs, layers, target })
  // Upstream-owned paths (ownership.upstreamPaths) count as overrides.
  overrides = withUpstream(readOverrides(project), vals, ['AGENTS.md'])
  // Without .kit/install.json only an override makes AGENTS.md the project's (a hand-copied AGENTS.md is the kit's).
  const agentsWorkflow = ownsAgents({ target, overrides, recorded: inst ? inst.files ?? {} : null })
  plan = planFiles({ kitRoot, packs, layers, cursor, yesChef: !!inst?.yesChef, vals, agentsWorkflow })
  overrides = withUpstream(overrides, vals, plan.files.map((f) => f.dest))
} catch (e) {
  die(e.message)
}

const rows = []
const managed = plan.files.filter((f) => f.kind === 'managed')
// A missing file the project's git ignores never reaches a clone: `ignored`, not `missing`.
const ignored = ignoredPaths(target, managed.filter((f) => !existsSync(join(target, f.dest))).map((f) => f.dest))
for (const f of managed) {
  const dest = join(target, f.dest)
  let state
  if (overrides.has(f.dest)) state = 'override'
  else if (ignored.has(f.dest)) state = 'ignored'
  else if (!existsSync(dest)) state = 'missing'
  else state = readFileSync(dest, 'utf8') === f.content ? 'same' : 'drift'
  rows.push({ dest: f.dest, state })
}

// An override keeps its own copy of the file: it must still carry every step the kit marks KIT:required.
// The kit's own checkout overrides ci.yml to test the kit itself, so it is not step-checked.
const selfInstall = origin.source === 'local:.' || (existsSync(join(target, 'kit.json')) && existsSync(join(target, '.kit', 'config.json')))
const stepRows = []
if (!selfInstall) {
  const rendered = requiredByDest(plan.files)
  for (const r of rows.filter((x) => x.state === 'override')) {
    const names = inst?.required ? inst.required[r.dest] : rendered[r.dest]
    if (!names?.length) continue
    const file = join(target, r.dest)
    const missing = existsSync(file) ? missingSteps(readFileSync(file, 'utf8'), names) : names
    for (const name of missing) stepRows.push({ dest: r.dest, name })
  }
}

// Seeds can be overridden too (kit-sync then never writes them), so they count as shipped here.
const shipped = new Set(plan.files.map((f) => f.dest))
if (shipped.has(AGENTS_WORKFLOW)) shipped.add('AGENTS.md') // its override is what sends the rules to AGENTS.workflow.md
for (const s of ['drift', 'missing', 'ignored']) for (const r of rows.filter((x) => x.state === s)) console.log(`${s.padEnd(9)} ${r.dest}`)
for (const r of stepRows) console.log(`override-missing-step ${r.dest}: "${r.name}"`)
if (args.verbose) for (const r of rows.filter((x) => x.state === 'override')) console.log(`override  ${r.dest} — ${overrides.get(r.dest)}`)
for (const p of overrides.keys()) if (!shipped.has(p)) console.log(`NOTE override ${p} is not a file this kit ships — remove it from ${cfgName}`)
const notSet = [...plan.report.notSet].sort()
if (notSet.length > 0) console.log(`NOTE not set in ${cfgName} (rendered "(not set)"): ${notSet.join(', ')}`)
if (plan.report.unknown.size > 0) console.log(`NOTE unknown placeholders: ${[...plan.report.unknown].sort().join(', ')}`)

const n = (s) => rows.filter((r) => r.state === s).length
const undeclared = n('drift') + n('missing') + stepRows.length
const tail = `${n('ignored') ? `${n('ignored')} ignored, ` : ''}packs=[${packs.join(', ')}], layers=[${layers.join(', ')}], cursor=${cursor}, ${managed.length} managed files, source=${origin.source}${origin.ref ? '@' + origin.ref : ''}`
if (undeclared > 0) {
  console.log(`KIT_DRIFT: FAIL — ${undeclared} undeclared differences (${n('drift')} drift, ${n('missing')} missing${stepRows.length ? `, ${stepRows.length} override-missing-step` : ''}), ${n('override')} overrides; ${tail}`)
  process.exit(1)
}
console.log(`KIT_DRIFT: ok — 0 undeclared differences, ${n('override')} overrides; ${tail}`)
