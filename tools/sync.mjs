/**
 * kit-sync — show what a newer kit would change in an installed project, then STOP.
 *
 *   node tools/sync.mjs --target <dir> [--apply]
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
 * Seed files (templates) are written once and never updated: only `new` applies to them.
 * Exit 0 always for a completed report; 1 on a usage or config error.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { KIT_ROOT, readJson, sha256, resolveConfig, planFiles, parseArgs } from './lib/kit.mjs'

let args
try {
  args = parseArgs(process.argv.slice(2), { target: 'value', apply: 'bool' })
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
try {
  const vals = resolveConfig({ kitRoot: KIT_ROOT, project, packs: inst.packs, target })
  plan = planFiles({ kitRoot: KIT_ROOT, packs: inst.packs, cursor: inst.cursor, yesChef: inst.yesChef, vals })
} catch (e) {
  console.error(`KIT_SYNC: FAIL — ${e.message}`)
  process.exit(1)
}

const rows = []
const record = { ...inst.files }
const planned = new Set()
for (const f of plan.files) {
  planned.add(f.dest)
  const rec = inst.files[f.dest]
  const dest = join(target, f.dest)
  const present = existsSync(dest)
  const cur = present ? readFileSync(dest, 'utf8') : null
  const next = f.content
  const nextHash = sha256(next)
  let state
  if (!rec) state = !present ? 'new' : cur === next ? 'same' : 'conflict'
  else if (!present) state = 'deleted-locally'
  else if (cur === next) state = 'same'
  else if (f.kind === 'seed') state = 'local-only'
  else if (sha256(cur) === rec.sha256) state = nextHash === rec.sha256 ? 'same' : 'kit-update'
  else state = nextHash === rec.sha256 ? 'local-only' : 'conflict'
  rows.push({ dest: f.dest, state })
  if (!args.apply) continue
  if (state === 'new' || state === 'kit-update') {
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, next, 'utf8')
    record[f.dest] = { sha256: nextHash, kind: f.kind, source: f.source }
  } else if (state === 'same') record[f.dest] = { sha256: nextHash, kind: f.kind, source: f.source }
}
for (const dest of Object.keys(inst.files)) if (!planned.has(dest)) rows.push({ dest, state: 'removed-from-kit' })

const order = ['new', 'kit-update', 'conflict', 'local-only', 'deleted-locally', 'removed-from-kit']
const count = (s) => rows.filter((r) => r.state === s).length
for (const s of order) for (const r of rows.filter((x) => x.state === s)) console.log(`${s.padEnd(16)} ${r.dest}`)
if (inst.kit?.version !== readJson(join(KIT_ROOT, 'kit.json')).version) {
  console.log(`NOTE installed from kit ${inst.kit?.version}, this kit is ${readJson(join(KIT_ROOT, 'kit.json')).version}`)
}
if (args.apply) {
  const kitVersion = readJson(join(KIT_ROOT, 'kit.json')).version
  const sorted = Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)))
  writeFileSync(installFile, JSON.stringify({ ...inst, kit: { version: kitVersion }, files: sorted }, null, 2) + '\n', 'utf8')
}
console.log(
  `KIT_SYNC: ${args.apply ? 'applied' : 'dry-run'} — ${count('new')} new, ${count('kit-update')} kit-update, ${count('conflict')} conflicts, ` +
    `${count('local-only')} local-only, ${count('deleted-locally')} deleted-locally, ${count('removed-from-kit')} removed-from-kit` +
    (args.apply ? '' : ' (nothing written; re-run with --apply to write new + kit-update)'),
)
