/**
 * kit-install — copy the workflow into a project.
 *
 *   node tools/install.mjs --target <dir> [--source github:<owner>/<repo> --ref <tag> | --source <kit folder>]
 *                          [--config <file>] [--packs angular,node-express] [--cursor]
 *                          [--yes-chef] [--dry-run] [--force] [--allow-unfilled]
 *   node tools/install.mjs --adopt --target <dir> [--source … --ref …] [--cursor | --no-cursor] [--dry-run]
 *
 * Source: a tagged GitHub release (fetched into a per-user cache, see lib/source.mjs), a local kit folder,
 * or (no --source) the kit these tools run from. .kit/install.json records source, ref and commit.
 *
 * Config: --config file, else <target>/kit.config.json, else the kit defaults plus the packs' defaults.
 * Never overwrites an existing file unless --force (reported SKIP-EXISTING). Paths in kit.config.json `overrides`
 * are never written, even with --force (reported SKIP-OVERRIDE). Writes <target>/.kit/install.json
 * (commit it: kit-sync reads it) and, when absent, <target>/kit.config.json with the effective config.
 * --adopt: for a project that already carries the workflow (kit.config.json present, no .kit/install.json yet).
 * Writes only .kit/install.json, recording the hash of every current managed file and every present seed, so
 * kit-sync can target the project. Refuses (nothing written) unless the drift check is clean: every managed
 * file outside `overrides` must match the rendered kit byte for byte. Cursor: --cursor/--no-cursor, else
 * "a .cursor/ folder exists".
 * Exit 0 ok, 1 error, 2 required config keys missing (nothing written).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { spawnSync } from 'child_process'
import { builtinModules } from 'module'
import { resolve, join, dirname } from 'path'
import { resolveSource } from './lib/source.mjs'
import { KIT_ROOT, REQUIRED, isEmpty, readJson, sha256, resolveConfig, planFiles, parseArgs, unflatten, NOT_SET, readOverrides } from './lib/kit.mjs'

let args
try {
  args = parseArgs(process.argv.slice(2), {
    target: 'value', source: 'value', ref: 'value', config: 'value', packs: 'value', cursor: 'bool', 'yes-chef': 'bool',
    'dry-run': 'bool', force: 'bool', 'allow-unfilled': 'bool', 'install-deps': 'bool', adopt: 'bool', 'no-cursor': 'bool',
  })
} catch (e) {
  console.error(`KIT_INSTALL: FAIL — ${e.message}`)
  process.exit(1)
}
if (!args.target) {
  console.error('KIT_INSTALL: FAIL — --target <dir> is required')
  process.exit(1)
}
const target = resolve(args.target)
const log = (s) => console.log(s)

let projectCfg = {}
const cfgFile = args.config ? resolve(args.config) : join(target, 'kit.config.json')
if (existsSync(cfgFile)) projectCfg = readJson(cfgFile)
else if (args.config) {
  console.error(`KIT_INSTALL: FAIL — config not found: ${cfgFile}`)
  process.exit(1)
}
if (args.adopt) {
  const why = !existsSync(join(target, 'kit.config.json')) ? 'kit.config.json not found in the target'
    : existsSync(join(target, '.kit', 'install.json')) ? '.kit/install.json already exists; use kit-sync'
    : args.force || args.config ? '--adopt takes no --force or --config' : null
  if (why) {
    console.error(`KIT_INSTALL: FAIL — --adopt: ${why}`)
    process.exit(1)
  }
  args.cursor = args.cursor ? true : args['no-cursor'] ? false : existsSync(join(target, '.cursor'))
}
const packs = args.packs ? args.packs.split(',').map((s) => s.trim()).filter(Boolean) : (projectCfg.stack?.packs ?? [])

let vals
let plan
let overrides
let kitRoot
let origin
try {
  ;({ kitRoot, record: origin } = resolveSource({ source: args.source, ref: args.ref, fallback: KIT_ROOT, target }))
  overrides = readOverrides(projectCfg)
  vals = resolveConfig({ kitRoot, project: projectCfg, packs, target })
  plan = planFiles({ kitRoot, packs, cursor: !!args.cursor, yesChef: !!args['yes-chef'], vals })
} catch (e) {
  console.error(`KIT_INSTALL: FAIL — ${e.message}`)
  process.exit(1)
}

const missing = REQUIRED.filter((k) => isEmpty(vals[k]))
if (missing.length > 0 && !args['allow-unfilled']) {
  console.error(`KIT_INSTALL: STOP — required config not set: ${missing.join(', ')}`)
  console.error('Add them to kit.config.json (or pick a stack pack with --packs, which fills build/lint/test), then re-run. Nothing was written.')
  process.exit(2)
}

if (args.adopt) {
  const record = {}
  const bad = []
  let same = 0
  for (const f of plan.files) {
    if (overrides.has(f.dest)) continue
    const dest = join(target, f.dest)
    const present = existsSync(dest)
    if (f.kind === 'seed') {
      if (present) record[f.dest] = { sha256: sha256(readFileSync(dest, 'utf8')), kind: f.kind, source: f.source }
      continue
    }
    if (!present) bad.push(`missing   ${f.dest}`)
    else if (readFileSync(dest, 'utf8') !== f.content) bad.push(`drift     ${f.dest}`)
    else {
      same++
      record[f.dest] = { sha256: sha256(f.content), kind: f.kind, source: f.source }
    }
  }
  if (bad.length > 0) {
    console.error(bad.join('\n'))
    console.error(`KIT_INSTALL: FAIL — --adopt: ${bad.length} undeclared differences; fix them or declare them in kit.config.json overrides (see kit-drift). Nothing was written.`)
    process.exit(1)
  }
  const sorted = Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)))
  const out = { kit: { version: readJson(join(kitRoot, 'kit.json')).version }, ...origin, packs, cursor: !!args.cursor, yesChef: !!args['yes-chef'], files: sorted }
  if (!args['dry-run']) {
    mkdirSync(join(target, '.kit'), { recursive: true })
    writeFileSync(join(target, '.kit', 'install.json'), JSON.stringify(out, null, 2) + '\n', 'utf8')
  }
  log(`KIT_INSTALL: adopted${args['dry-run'] ? ' (dry-run, nothing written)' : ''} — ${same} managed files recorded, ${Object.keys(record).length - same} seeds recorded, ${overrides.size} overrides, packs=[${packs.join(', ')}], cursor=${!!args.cursor}, source=${origin.source}${origin.ref ? '@' + origin.ref : ''}`)
  process.exit(0)
}

const prior = existsSync(join(target, '.kit', 'install.json')) ? readJson(join(target, '.kit', 'install.json')) : { files: {} }
const record = { ...prior.files }
const counts = { written: 0, same: 0, skipped: 0, overridden: 0 }
for (const f of plan.files) {
  if (overrides.has(f.dest)) {
    counts.overridden++
    log(`SKIP-OVERRIDE ${f.dest}`)
    continue
  }
  const dest = join(target, f.dest)
  const digest = sha256(f.content)
  if (existsSync(dest)) {
    const cur = readFileSync(dest, 'utf8')
    if (cur === f.content) {
      counts.same++
      record[f.dest] = { sha256: digest, kind: f.kind, source: f.source }
      continue
    }
    if (!args.force) {
      counts.skipped++
      log(`SKIP-EXISTING ${f.dest}`)
      continue
    }
  }
  counts.written++
  log(`${args['dry-run'] ? 'WOULD-WRITE' : 'WRITE'} ${f.dest}`)
  if (!args['dry-run']) {
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, f.content, 'utf8')
  }
  record[f.dest] = { sha256: digest, kind: f.kind, source: f.source }
}

const kitVersion = readJson(join(kitRoot, 'kit.json')).version
const sorted = Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)))
const installJson = JSON.stringify(
  { kit: { version: kitVersion }, ...origin, packs, cursor: !!args.cursor, yesChef: !!args['yes-chef'], files: sorted },
  null,
  2,
) + '\n'
if (!args['dry-run']) {
  mkdirSync(join(target, '.kit'), { recursive: true })
  writeFileSync(join(target, '.kit', 'install.json'), installJson, 'utf8')
  if (!existsSync(join(target, 'kit.config.json'))) {
    const effective = { $comment: 'Effective config written by kit-install; edit freely, kit-sync reads it.', ...unflatten(vals) }
    for (const k of Object.keys(effective.kit ?? {})) delete effective.kit[k]
    delete effective.kit
    writeFileSync(join(target, 'kit.config.json'), JSON.stringify(effective, null, 2) + '\n', 'utf8')
    log('WRITE kit.config.json')
  }
}

const notSet = [...plan.report.notSet].sort()
if (notSet.length > 0) log(`NOTE not set (rendered "${NOT_SET}"): ${notSet.join(', ')}`)
if (plan.report.unknown.size > 0) log(`NOTE unknown placeholders left as-is: ${[...plan.report.unknown].sort().join(', ')}`)
const pkgFile = join(target, 'package.json')
if (existsSync(pkgFile)) {
  const scripts = readJson(pkgFile).scripts ?? {}
  const absent = ['commands.build', 'commands.lint', 'commands.test'].map((k) => vals[k]).filter((s) => s && !(s in scripts))
  if (absent.length > 0) log(`NOTE package.json has no script(s): ${absent.join(', ')} — the workflow runs them with npm run`)
} else log('NOTE no package.json yet — create one with the build/lint/test scripts before the first /ship')
// devDependencies the installed scripts import (bare specifiers) plus the hook runners.
const BUILTIN = new Set(builtinModules)
const deps = new Set()
for (const f of plan.files) {
  if (!f.dest.endsWith('.mjs')) continue
  for (const m of f.content.matchAll(/^import\s[^'"\n]*from\s+'([^'.\/][^']*)'/gm)) {
    const name = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0]
    if (!BUILTIN.has(name) && !name.startsWith('node:')) deps.add(name)
  }
}
const hasHusky = plan.files.some((f) => f.dest.startsWith('.husky/'))
if (hasHusky) deps.add('husky')
if (plan.files.some((f) => f.dest === '.lintstagedrc.mjs')) deps.add('lint-staged')
if (deps.size > 0) {
  const list = [...deps].sort().join(' ')
  if (args['install-deps'] && !args['dry-run'] && existsSync(pkgFile)) {
    // One command string: on Windows npm is a .cmd and needs a shell, which must not get an args array (DEP0190).
    const r = spawnSync(`npm install -D ${list}`, { cwd: target, stdio: 'inherit', shell: true })
    log(r.status === 0 ? `NOTE installed devDependencies: ${list}` : `NOTE npm install failed; run: npm install -D ${list}`)
  } else log(`NOTE the installed scripts need devDependencies — run: npm install -D ${list}  (or re-run with --install-deps)`)
}
if (hasHusky) log('NOTE git hooks are inactive until husky is set up — add "prepare": "husky" to package.json scripts, then run: npm run prepare')
log(`KIT_INSTALL: ok — ${counts.written} ${args['dry-run'] ? 'would be written' : 'written'}, ${counts.same} identical, ${counts.skipped} skipped-existing, ${counts.overridden} overrides, packs=[${packs.join(', ')}], cursor=${!!args.cursor}, source=${origin.source}${origin.ref ? '@' + origin.ref : ''}`)
