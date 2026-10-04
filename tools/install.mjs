/**
 * kit-install — copy the workflow into a project.
 *
 *   node tools/install.mjs --target <dir> [--config <file>] [--packs angular,node-express] [--cursor]
 *                          [--yes-chef] [--dry-run] [--force] [--allow-unfilled]
 *
 * Config: --config file, else <target>/kit.config.json, else the kit defaults plus the packs' defaults.
 * Never overwrites an existing file unless --force (reported SKIP-EXISTING). Writes <target>/.kit/install.json
 * (commit it: kit-sync reads it) and, when absent, <target>/kit.config.json with the effective config.
 * Exit 0 ok, 1 error, 2 required config keys missing (nothing written).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { spawnSync } from 'child_process'
import { resolve, join, dirname } from 'path'
import { KIT_ROOT, REQUIRED, isEmpty, readJson, sha256, resolveConfig, planFiles, parseArgs, unflatten, NOT_SET } from './lib/kit.mjs'

let args
try {
  args = parseArgs(process.argv.slice(2), {
    target: 'value', config: 'value', packs: 'value', cursor: 'bool', 'yes-chef': 'bool',
    'dry-run': 'bool', force: 'bool', 'allow-unfilled': 'bool', 'install-deps': 'bool',
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
const packs = args.packs ? args.packs.split(',').map((s) => s.trim()).filter(Boolean) : (projectCfg.stack?.packs ?? [])

let vals
let plan
try {
  vals = resolveConfig({ kitRoot: KIT_ROOT, project: projectCfg, packs, target })
  plan = planFiles({ kitRoot: KIT_ROOT, packs, cursor: !!args.cursor, yesChef: !!args['yes-chef'], vals })
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

const prior = existsSync(join(target, '.kit', 'install.json')) ? readJson(join(target, '.kit', 'install.json')) : { files: {} }
const record = { ...prior.files }
const counts = { written: 0, same: 0, skipped: 0 }
for (const f of plan.files) {
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

const kitVersion = readJson(join(KIT_ROOT, 'kit.json')).version
const sorted = Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)))
const installJson = JSON.stringify(
  { kit: { version: kitVersion }, packs, cursor: !!args.cursor, yesChef: !!args['yes-chef'], files: sorted },
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
const BUILTIN = new Set(['fs', 'path', 'url', 'child_process', 'crypto', 'os', 'util', 'readline', 'http', 'https', 'zlib', 'stream', 'events', 'assert'])
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
    const r = spawnSync('npm', ['install', '-D', ...deps], { cwd: target, stdio: 'inherit', shell: process.platform === 'win32' })
    log(r.status === 0 ? `NOTE installed devDependencies: ${list}` : `NOTE npm install failed; run: npm install -D ${list}`)
  } else log(`NOTE the installed scripts need devDependencies — run: npm install -D ${list}  (or re-run with --install-deps)`)
}
if (hasHusky) log('NOTE git hooks are inactive until husky is set up — add "prepare": "husky" to package.json scripts, then run: npm run prepare')
log(`KIT_INSTALL: ok — ${counts.written} ${args['dry-run'] ? 'would be written' : 'written'}, ${counts.same} identical, ${counts.skipped} skipped-existing, packs=[${packs.join(', ')}], cursor=${!!args.cursor}`)
