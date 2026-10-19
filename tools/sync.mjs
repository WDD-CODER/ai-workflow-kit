/**
 * kit-sync — show what a newer kit would change in an installed project, then STOP.
 *
 *   node tools/sync.mjs --target <dir> [--ref <tag>] [--source github:<owner>/<repo> | --source <kit folder>] [--apply]
 *
 * Source: --source, else the source + ref recorded in .kit/install.json, else the kit these tools run from.
 * --ref <tag> upgrades (or downgrades) a github source; --apply then records the new source/ref/commit.
 * A ref that does not exist fails before anything is written.
 *
 * Dry-run by default; writes nothing. --apply writes only `new` and `kit-update` files and refreshes
 * .kit/install.json. A `conflict` (local edit AND kit change, or an untracked file in the way) is never overwritten.
 *
 *   new               the kit has a file the project never received       -> written on --apply
 *   kit-update        project file untouched since install, kit changed   -> overwritten on --apply
 *   local-only        project edited it, kit unchanged                    -> kept
 *   conflict          both changed (or untracked file differs)            -> kept, resolve by hand
 *   removed-from-kit  installed earlier, no longer shipped                -> kept, delete by hand if unwanted
 *   deleted-locally   installed earlier, missing now                      -> kept missing
 *   override          listed in kit.config.json `overrides`               -> never written, not a conflict
 * Seed files (templates) are written once and never updated: only `new` applies to them. An optional pack seed is not
 * written at all while the project has its own equivalent (a NOTE).
 * A file recorded as a seed that the kit now ships as managed is `conflict` unless it already matches the kit
 * (`same`, which records it as managed): its recorded hash is the project's copy, not a kit version.
 *   ignored           a missing path the project's git ignores           -> never written
 * When the project owns AGENTS.md (an override, or present and not kit-installed) the kit's rules come as
 * AGENTS.workflow.md (managed) instead.
 * --apply that writes scripts/package.json also runs npm install inside scripts/ when the project has
 * scripts/package-lock.json (the lockfile is the project's; this keeps it in step with the kit's package.json).
 * Exit 0 always for a completed report; 1 on a usage or config error; 2 when a commands.* value is a full
 * command instead of an npm script name (nothing written).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { spawnSync } from 'child_process'
import { resolve, join, dirname } from 'path'
import { resolveSource } from './lib/source.mjs'
import {
  KIT_ROOT, readJson, sha256, resolveConfig, planFiles, parseArgs, readOverrides, isHook, markHooksExecutable, commandProblems,
  ownsAgents, ignoredPaths, AGENTS_WORKFLOW, frontendNote, presentAlternative, backendNote,
} from './lib/kit.mjs'

let args
try {
  args = parseArgs(process.argv.slice(2), { target: 'value', source: 'value', ref: 'value', apply: 'bool' })
} catch (e) {
  console.error(`KIT_SYNC: FAIL — ${e.message}`)
  process.exit(1)
}
if (!args.target) {
  console.error('KIT_SYNC: FAIL — --target <dir> is required')
  process.exit(1)
}
const target = resolve(args.target)
const installFile = join(target, '.kit', 'install.json')
if (!existsSync(installFile)) {
  console.error(`KIT_SYNC: FAIL — ${installFile} not found; run kit-install first`)
  process.exit(1)
}
const inst = readJson(installFile)
const cfgFile = join(target, 'kit.config.json')
const project = existsSync(cfgFile) ? readJson(cfgFile) : {}
let plan
let feNote
let beNote
let overrides
let kitRoot
let origin
try {
  const recorded = !args.source && inst.source ? inst.source : null
  ;({ kitRoot, record: origin } = resolveSource({
    source: args.source ?? recorded,
    ref: args.ref ?? (recorded && !args.source ? inst.ref : undefined),
    fallback: KIT_ROOT,
    target,
    baseDir: recorded ? target : process.cwd(),
  }))
  overrides = readOverrides(project)
  const vals = resolveConfig({ kitRoot, project, packs: inst.packs, target })
  const bad = commandProblems(vals)
  if (bad.length > 0) {
    for (const m of bad) console.error(`KIT_SYNC: STOP — ${m}`)
    console.error('Fix kit.config.json, then re-run. Nothing was written.')
    process.exit(2)
  }
  feNote = frontendNote(vals)
  beNote = backendNote(vals, target)
  const agentsWorkflow = ownsAgents({ target, overrides, recorded: inst.files ?? {} })
  plan = planFiles({ kitRoot, packs: inst.packs, cursor: inst.cursor, yesChef: inst.yesChef, vals, agentsWorkflow })
} catch (e) {
  console.error(`KIT_SYNC: FAIL — ${e.message}`)
  process.exit(1)
}
const ignored = ignoredPaths(target, plan.files.filter((f) => !existsSync(join(target, f.dest))).map((f) => f.dest))

const rows = []
const record = { ...inst.files }
const planned = new Set()
const hooksWritten = []
const skippedSeeds = []
let scriptsPkgWritten = false
for (const f of plan.files) {
  planned.add(f.dest)
  const rec = inst.files[f.dest]
  const dest = join(target, f.dest)
  const present = existsSync(dest)
  const cur = present ? readFileSync(dest, 'utf8') : null
  const next = f.content
  const nextHash = sha256(next)
  let state
  if (overrides.has(f.dest)) {
    rows.push({ dest: f.dest, state: 'override' })
    continue
  }
  if (ignored.has(f.dest)) {
    rows.push({ dest: f.dest, state: 'ignored' })
    continue
  }
  // An optional pack seed the project never received, next to its own equivalent: never written.
  const alt = !rec && !present && presentAlternative(target, f.skipWhenPresent)
  if (alt) {
    skippedSeeds.push(`NOTE ${f.dest} not written: the project has ${alt}`)
    continue
  }
  if (!rec) state = !present ? 'new' : cur === next ? 'same' : 'conflict'
  else if (!present) state = 'deleted-locally'
  else if (cur === next) state = 'same'
  else if (f.kind === 'seed') state = 'local-only'
  // A seed the kit now manages: the recorded hash is the project's own copy (seeds are the project's after
  // install, and --adopt records whatever is there), so "unchanged since install" proves nothing. Never overwrite.
  else if (rec.kind === 'seed') state = 'conflict'
  else if (sha256(cur) === rec.sha256) state = nextHash === rec.sha256 ? 'same' : 'kit-update'
  else state = nextHash === rec.sha256 ? 'local-only' : 'conflict'
  rows.push({ dest: f.dest, state })
  if (!args.apply) continue
  if (state === 'new' || state === 'kit-update') {
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, next, 'utf8')
    if (isHook(f.dest)) hooksWritten.push(f.dest)
    if (f.dest === 'scripts/package.json') scriptsPkgWritten = true
    record[f.dest] = { sha256: nextHash, kind: f.kind, source: f.source }
  } else if (state === 'same') record[f.dest] = { sha256: nextHash, kind: f.kind, source: f.source }
}
for (const dest of Object.keys(inst.files)) if (!planned.has(dest) && !overrides.has(dest)) rows.push({ dest, state: 'removed-from-kit' })
// An AGENTS.md override is what sends the kit's rules to AGENTS.workflow.md: a known path.
const unknownOverrides = [...overrides.keys()].filter((p) => !planned.has(p) && !(p === 'AGENTS.md' && planned.has(AGENTS_WORKFLOW)))

const order = ['new', 'kit-update', 'conflict', 'local-only', 'deleted-locally', 'removed-from-kit', 'override', 'ignored']
const count = (s) => rows.filter((r) => r.state === s).length
for (const s of order) for (const r of rows.filter((x) => x.state === s)) console.log(`${s.padEnd(16)} ${r.dest}`)
for (const n of skippedSeeds) console.log(n)
for (const p of unknownOverrides) console.log(`NOTE override ${p} is not a file this kit ships — remove it from kit.config.json`)
if (feNote) console.log(feNote)
if (beNote) console.log(beNote)
if (inst.kit?.version !== readJson(join(kitRoot, 'kit.json')).version) {
  console.log(`NOTE installed from kit ${inst.kit?.version}, this kit is ${readJson(join(kitRoot, 'kit.json')).version}`)
}
const label = (o) => (o.source ? `${o.source}${o.ref ? '@' + o.ref : ''}` : '(not recorded)')
if (label(inst) !== label(origin)) console.log(`NOTE source ${label(inst)} -> ${label(origin)}${args.apply ? '' : ' (recorded on --apply)'}`)
else console.log(`NOTE source ${label(origin)}`)
if (args.apply) {
  const hookNote = markHooksExecutable(target, hooksWritten)
  if (hookNote) console.log(hookNote)
  const kitVersion = readJson(join(kitRoot, 'kit.json')).version
  const sorted = Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)))
  const { kit: _kit, source: _source, ref: _ref, commit: _commit, files: _files, ...rest } = inst
  writeFileSync(installFile, JSON.stringify({ kit: { version: kitVersion }, ...origin, ...rest, files: sorted }, null, 2) + '\n', 'utf8')
  // scripts/package.json is the kit's, scripts/package-lock.json the project's: refresh the lockfile with the new
  // dependencies, or `npm ci` inside scripts/ (CI, slots) fails on the sync PR. Inside scripts/, never --prefix (npm 10).
  if (scriptsPkgWritten && existsSync(join(target, 'scripts', 'package-lock.json'))) {
    // One command string: on Windows npm is a .cmd and needs a shell, which must not get an args array (DEP0190).
    const r = spawnSync('npm install --no-audit --no-fund', { cwd: join(target, 'scripts'), stdio: 'inherit', shell: true })
    console.log(r.status === 0
      ? 'NOTE scripts/package.json changed: refreshed scripts/package-lock.json (npm install inside scripts/); commit it with the sync'
      : 'NOTE scripts/package.json changed but npm install inside scripts/ failed. Run it, then commit scripts/package-lock.json:  cd scripts && npm install --no-audit --no-fund')
  }
}
console.log(
  `KIT_SYNC: ${args.apply ? 'applied' : 'dry-run'} — ${count('new')} new, ${count('kit-update')} kit-update, ${count('conflict')} conflicts, ` +
    `${count('local-only')} local-only, ${count('deleted-locally')} deleted-locally, ${count('removed-from-kit')} removed-from-kit, ${count('override')} overrides` +
    (count('ignored') ? `, ${count('ignored')} ignored` : '') +
    (args.apply ? '' : ' (nothing written; re-run with --apply to write new + kit-update)'),
)
