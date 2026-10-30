/**
 * kit-install — copy the workflow into a project.
 *
 *   node tools/install.mjs --target <dir> [--source github:<owner>/<repo> --ref <tag> | --source <kit folder>]
 *                          [--config <file>] [--packs angular,node-express] [--layers supabase,upstream-owned] [--cursor]
 *                          [--yes] [--yes-chef] [--dry-run] [--force] [--allow-unfilled]
 *   node tools/install.mjs --adopt --target <dir> [--source … --ref …] [--cursor | --no-cursor] [--dry-run]
 *
 * Source: a tagged GitHub release (fetched into a per-user cache, see lib/source.mjs), a local kit folder,
 * or (no --source) the kit these tools run from. .kit/install.json records source, ref and commit.
 *
 * Config: --config file, else <target>/.kit/config.json, else <target>/kit.config.json, else the kit defaults plus
 *   the packs' defaults (.kit/config.json: a project whose kit.config.json is something else, e.g. the kit repo).
 * Never overwrites an existing file unless --force (reported SKIP-EXISTING). Paths in kit.config.json `overrides`
 * are never written, even with --force (reported SKIP-OVERRIDE). Writes <target>/.kit/install.json
 * (commit it: kit-sync reads it) and, when absent, <target>/kit.config.json with the effective config.
 * --adopt: for a project that already carries the workflow (kit.config.json present, no .kit/install.json yet).
 * Writes only .kit/install.json, recording the hash of every current managed file and every present seed, so
 * kit-sync can target the project. Refuses (nothing written) unless the drift check is clean: every managed
 * file outside `overrides` must match the rendered kit byte for byte. Cursor: --cursor/--no-cursor, else
 * "a .cursor/ folder exists".
 * A path the target's git ignores is not written (SKIP-IGNORED), nor an optional pack seed when the project has its own
 * equivalent (SKIP-PRESENT, e.g. .prettierrc.json next to a prettier.config.js). When the project owns AGENTS.md (an override,
 * or present and not kit-installed), the kit's rules go to AGENTS.workflow.md (managed) and CLAUDE.md imports both.
 * The workflow scripts' dependencies are in scripts/package.json: --install-deps runs npm install inside scripts/ (not
 * `npm install --prefix scripts`: npm 10 then runs the root package's lifecycle scripts, e.g. a husky prepare).
 * In a git repository the runtime ignore list is added to .git/info/exclude (scripts/local-excludes.mjs).
 * Stack: --packs / --layers, else kit.config.json stack.packs / stack.layers, else what .kit/install.json recorded. With
 * none of them, install detects the packs and layers from the project (each pack.json / layer.json `detect` rules: a
 * package.json dependency, a folder, a git remote), prints `KIT_INSTALL: detected packs=[…] layers=[…]` with the reason
 * for each, and stops (exit 2, nothing written) until --yes confirms; then it installs them and records them in
 * kit.config.json. Nothing matches: exit 2 (name the packs, or --packs "" for core only). A `suggestOnly` match (the
 * upstream-owned layer: an `upstream` remote) is printed as a suggestion, never installed by --yes. Config stack.packs /
 * stack.layers that disagree with .kit/install.json (no --packs / --layers given): exit 2. --layers cursor = --cursor.
 * ownership.upstreamPaths (globs; the upstream-owned layer): matching kit files are never written (SKIP-OVERRIDE, like
 * an override), and a matching AGENTS.md sends the kit's rules to AGENTS.workflow.md.
 * Exit 0 ok, 1 error, 2 required config keys missing, a commands.* value that is a full command, or a detected stack
 * not confirmed yet (nothing written).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { spawnSync } from 'child_process'
import { builtinModules } from 'module'
import { resolve, join, dirname } from 'path'
import { resolveSource } from './lib/source.mjs'
import {
  KIT_ROOT, REQUIRED, isEmpty, readJson, sha256, resolveConfig, planFiles, parseArgs, unflatten, NOT_SET, readOverrides, isHook,
  markHooksExecutable, commandProblems, ownsAgents, ignoredPaths, AGENTS_WORKFLOW, frontendNote, presentAlternative, backendNote, ciMirrorNotes,
  detectStack, splitList, withUpstream, projectConfigPath, configLabel, requiredByDest,
} from './lib/kit.mjs'

let args
try {
  args = parseArgs(process.argv.slice(2), {
    target: 'value', source: 'value', ref: 'value', config: 'value', packs: 'value', layers: 'value', cursor: 'bool', 'yes-chef': 'bool',
    'dry-run': 'bool', force: 'bool', 'allow-unfilled': 'bool', 'install-deps': 'bool', adopt: 'bool', 'no-cursor': 'bool', yes: 'bool',
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
const cfgFile = projectConfigPath(target, args.config)
// Where the effective config is written: the project's own file (kit.config.json when --config names another).
const ownCfgFile = args.config ? join(target, 'kit.config.json') : cfgFile
const cfgName = configLabel(target, ownCfgFile)
if (existsSync(cfgFile)) projectCfg = readJson(cfgFile)
else if (args.config) {
  console.error(`KIT_INSTALL: FAIL — config not found: ${cfgFile}`)
  process.exit(1)
}
if (args.adopt) {
  const why = !existsSync(cfgFile) ? 'kit.config.json (or .kit/config.json) not found in the target'
    : existsSync(join(target, '.kit', 'install.json')) ? '.kit/install.json already exists; use kit-sync'
    : args.force || args.config ? '--adopt takes no --force or --config' : null
  if (why) {
    console.error(`KIT_INSTALL: FAIL — --adopt: ${why}`)
    process.exit(1)
  }
  args.cursor = args.cursor ? true : args['no-cursor'] ? false : existsSync(join(target, '.cursor'))
}
const prior = existsSync(join(target, '.kit', 'install.json')) ? readJson(join(target, '.kit', 'install.json')) : { files: {} }
// The stack, explicit first: --packs, kit.config.json stack.packs, then what an earlier install recorded. None of
// them (and not --adopt): detected from the project below, installed only after --yes.
let packs = args.packs != null ? splitList(args.packs)
  : Array.isArray(projectCfg.stack?.packs) ? projectCfg.stack.packs
  : Array.isArray(prior.packs) ? prior.packs
  : args.adopt ? [] : null
let layers = args.layers != null ? splitList(args.layers)
  : Array.isArray(projectCfg.stack?.layers) ? projectCfg.stack.layers
  : Array.isArray(prior.layers) ? prior.layers
  : null
if (layers?.includes('cursor')) {
  args.cursor = true
  layers = layers.filter((l) => l !== 'cursor')
}
let recordStack = false // detected and confirmed: write stack.packs / stack.layers into kit.config.json
// The config and the install record must name the same stack: a silent pick of one would drop (or add) packs.
for (const [key, flag] of [['packs', 'packs'], ['layers', 'layers']]) {
  const cfgList = projectCfg.stack?.[key]
  if (args[flag] != null || !Array.isArray(cfgList) || !Array.isArray(prior[key])) continue
  if (JSON.stringify(cfgList) !== JSON.stringify(prior[key])) {
    console.error(`KIT_INSTALL: STOP — kit.config.json stack.${key} [${cfgList.join(', ')}] and .kit/install.json ${key} [${prior[key].join(', ')}] disagree.`)
    console.error(`Set stack.${key} to the stack you want (kit-sync --${flag} <list> --apply updates both), or pass --${flag}. Nothing was written.`)
    process.exit(2)
  }
}

let vals
let plan
let overrides
let kitRoot
let origin
let agentsWorkflow
try {
  ;({ kitRoot, record: origin } = resolveSource({ source: args.source, ref: args.ref, fallback: KIT_ROOT, target }))
  if (packs == null) {
    const found = detectStack({ kitRoot, target, project: projectCfg })
    if (found.packs.length === 0) {
      console.error(`KIT_INSTALL: STOP — no stack pack matches this project${found.layers.length ? ` (layers that match: ${found.layers.map((l) => l.name).join(', ')})` : ''}.`)
      console.error('Name the packs with --packs <a,b> (or --packs "" for the stack-neutral core only), or set stack.packs in kit.config.json. Nothing was written.')
      process.exit(2)
    }
    packs = found.packs.map((p) => p.name)
    if (layers == null) layers = found.layers.map((l) => l.name)
    log(`KIT_INSTALL: detected packs=[${packs.join(', ')}] layers=[${layers.join(', ')}]`)
    for (const u of [...found.packs, ...found.layers.filter((l) => layers.includes(l.name))]) log(`  ${u.name} — ${u.why}`)
    for (const s of found.suggested) log(`  suggested ${s.kind} ${s.name} — ${s.why}; not included: if it applies, add --${s.kind}s ${[...(s.kind === 'layer' ? layers : packs), s.name].join(',')}`)
    if (!args.yes) {
      console.error('KIT_INSTALL: STOP — confirm the detected stack: re-run with --yes to install it and record it in kit.config.json (stack.packs, stack.layers), or name it with --packs / --layers. Nothing was written.')
      process.exit(2)
    }
    recordStack = true
  }
  layers ??= []
  vals = resolveConfig({ kitRoot, project: projectCfg, packs, layers, target })
  // Upstream-owned paths (ownership.upstreamPaths) are overrides the project never declares one by one.
  overrides = withUpstream(readOverrides(projectCfg), vals, ['AGENTS.md'])
  // --adopt records what is there: only an override makes AGENTS.md the project's.
  agentsWorkflow = ownsAgents({ target, overrides, recorded: args.adopt ? null : prior.files })
  plan = planFiles({ kitRoot, packs, layers, cursor: !!args.cursor, yesChef: !!args['yes-chef'], vals, agentsWorkflow })
  overrides = withUpstream(overrides, vals, plan.files.map((f) => f.dest))
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
const badCommands = commandProblems(vals)
if (badCommands.length > 0) {
  for (const m of badCommands) console.error(`KIT_INSTALL: STOP — ${m}`)
  console.error('Fix kit.config.json, then re-run. Nothing was written.')
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
  const out = { kit: { version: readJson(join(kitRoot, 'kit.json')).version }, ...origin, packs, layers, cursor: !!args.cursor, yesChef: !!args['yes-chef'], files: sorted, required: requiredByDest(plan.files) }
  if (!args['dry-run']) {
    mkdirSync(join(target, '.kit'), { recursive: true })
    writeFileSync(join(target, '.kit', 'install.json'), JSON.stringify(out, null, 2) + '\n', 'utf8')
  }
  log(`KIT_INSTALL: adopted${args['dry-run'] ? ' (dry-run, nothing written)' : ''} — ${same} managed files recorded, ${Object.keys(record).length - same} seeds recorded, ${overrides.size} overrides, packs=[${packs.join(', ')}], layers=[${layers.join(', ')}], cursor=${!!args.cursor}, source=${origin.source}${origin.ref ? '@' + origin.ref : ''}`)
  process.exit(0)
}

const record = { ...prior.files }
const counts = { written: 0, same: 0, skipped: 0, overridden: 0, ignored: 0 }
const hooksWritten = []
// A path the project's git ignores would never reach another clone: not written, reported SKIP-IGNORED.
const ignored = ignoredPaths(target, plan.files.filter((f) => !existsSync(join(target, f.dest))).map((f) => f.dest))
for (const f of plan.files) {
  if (overrides.has(f.dest)) {
    counts.overridden++
    log(`SKIP-OVERRIDE ${f.dest}`)
    continue
  }
  if (ignored.has(f.dest)) {
    counts.ignored++
    log(`SKIP-IGNORED ${f.dest} (the project's .gitignore ignores it)`)
    continue
  }
  const dest = join(target, f.dest)
  const digest = sha256(f.content)
  // An optional pack seed (e.g. a formatter config) is not written next to the project's own.
  const alt = !existsSync(dest) && presentAlternative(target, f.skipWhenPresent)
  if (alt) {
    log(`SKIP-PRESENT ${f.dest} (the project has ${alt})`)
    continue
  }
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
    if (isHook(f.dest)) hooksWritten.push(f.dest)
  }
  record[f.dest] = { sha256: digest, kind: f.kind, source: f.source }
}

const hookNote = markHooksExecutable(target, hooksWritten)
if (hookNote) log(hookNote)

const kitVersion = readJson(join(kitRoot, 'kit.json')).version
const sorted = Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)))
const installJson = JSON.stringify(
  { kit: { version: kitVersion }, ...origin, packs, layers, cursor: !!args.cursor, yesChef: !!args['yes-chef'], files: sorted, required: requiredByDest(plan.files) },
  null,
  2,
) + '\n'
if (!args['dry-run']) {
  mkdirSync(join(target, '.kit'), { recursive: true })
  writeFileSync(join(target, '.kit', 'install.json'), installJson, 'utf8')
  if (!existsSync(ownCfgFile)) {
    const effective = { $comment: 'Effective config written by kit-install; edit freely, kit-sync reads it.', ...unflatten(vals) }
    for (const k of Object.keys(effective.kit ?? {})) delete effective.kit[k]
    delete effective.kit
    writeFileSync(ownCfgFile, JSON.stringify(effective, null, 2) + '\n', 'utf8')
    log(`WRITE ${cfgName}`)
  } else if (recordStack) {
    // The detected stack, confirmed with --yes: the project's own config names it from now on.
    const cfgPath = ownCfgFile
    const cfg = readJson(cfgPath)
    cfg.stack = { ...(cfg.stack ?? {}), packs, layers }
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
    log(`WRITE ${cfgName} (stack.packs=[${packs.join(', ')}], stack.layers=[${layers.join(', ')}])`)
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
// devDependencies the installed files import (bare specifiers) plus the hook runners. The workflow scripts'
// own dependencies live in the kit-managed scripts/package.json (installed by npm install inside scripts/),
// so a project never has to add them to its own package.json.
const BUILTIN = new Set(builtinModules)
const scriptsPkg = plan.files.find((f) => f.dest === 'scripts/package.json')
const scriptsDeps = new Set(Object.keys(scriptsPkg ? JSON.parse(scriptsPkg.content).dependencies ?? {} : {}))
const deps = new Set()
for (const f of plan.files) {
  if (!f.dest.endsWith('.mjs')) continue
  for (const m of f.content.matchAll(/^import\s[^'"\n]*from\s+'([^'.\/][^']*)'/gm)) {
    const name = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0]
    if (BUILTIN.has(name) || name.startsWith('node:')) continue
    if (f.dest.startsWith('scripts/') && scriptsDeps.has(name)) continue
    deps.add(name)
  }
}
if (scriptsPkg && !overrides.has('scripts/package.json')) {
  if (args['install-deps'] && !args['dry-run']) {
    const r = spawnSync('npm install --no-audit --no-fund', { cwd: join(target, 'scripts'), stdio: 'inherit', shell: true })
    log(r.status === 0 ? 'NOTE installed the workflow scripts\' dependencies (npm install in scripts/); commit scripts/package-lock.json'
      : 'NOTE npm install in scripts/ failed; run it again before using the workflow scripts')
  } else log('NOTE the workflow scripts\' dependencies are in scripts/package.json — run npm install inside scripts/  (or re-run with --install-deps), then commit scripts/package-lock.json')
}
const hasHusky = plan.files.some((f) => f.dest.startsWith('.husky/'))
if (hasHusky) deps.add('husky')
if (plan.files.some((f) => f.dest === '.lintstagedrc.mjs')) deps.add('lint-staged')
// An upstream-owned package.json (ownership.upstreamPaths) gets no devDependencies: the hooks run without husky.
const pkgUpstream = withUpstream(new Map(), vals, ['package.json']).has('package.json')
if (deps.size > 0 && pkgUpstream) {
  log(`NOTE package.json is upstream-owned: no devDependencies added (${[...deps].sort().join(' ')}); the git hooks need no husky — git config core.hooksPath .husky`)
} else if (deps.size > 0) {
  const list = [...deps].sort().join(' ')
  if (args['install-deps'] && !args['dry-run'] && existsSync(pkgFile)) {
    // One command string: on Windows npm is a .cmd and needs a shell, which must not get an args array (DEP0190).
    const r = spawnSync(`npm install -D ${list}`, { cwd: target, stdio: 'inherit', shell: true })
    log(r.status === 0 ? `NOTE installed devDependencies: ${list}` : `NOTE npm install failed; run: npm install -D ${list}`)
  } else log(`NOTE the installed scripts need devDependencies — run: npm install -D ${list}  (or re-run with --install-deps)`)
}
if (hasHusky) log('NOTE git hooks are inactive until enabled — either husky ("prepare": "husky" in package.json scripts, then npm run prepare) or: git config core.hooksPath .husky')
if (plan.files.some((f) => f.dest === '.github/workflows/todo-sync.yml')) {
  log('NOTE todo-sync needs a repo setting on GitHub: Settings → Actions → General → Workflow permissions → tick "Allow GitHub Actions to create and approve pull requests"')
}
const feNote = frontendNote(vals)
if (feNote) log(feNote)
const beNote = backendNote(vals, target)
if (beNote) log(beNote)
for (const n of ciMirrorNotes(vals, target)) log(n)
if (agentsWorkflow) {
  const claude = join(target, 'CLAUDE.md')
  const imports = existsSync(claude) && readFileSync(claude, 'utf8').includes(`@${AGENTS_WORKFLOW}`)
  log(`NOTE AGENTS.md is the project's: the kit's rules are in ${AGENTS_WORKFLOW}${imports || args['dry-run'] ? '' : ` — add the line @${AGENTS_WORKFLOW} to CLAUDE.md under @AGENTS.md`}`)
}
// Runtime files (.worktree-*, logs, hashes) never show as changes, even when the project keeps its own .gitignore.
const excludes = join(target, 'scripts', 'local-excludes.mjs')
if (!args['dry-run'] && existsSync(join(target, '.git')) && existsSync(excludes)) {
  const r = spawnSync(process.execPath, [excludes], { cwd: target, encoding: 'utf8' })
  if (r.status === 0 && /added/.test(r.stdout)) log(`NOTE ${r.stdout.trim().replace(/^LOCAL_EXCLUDES: /, '')} (scripts/local-excludes.mjs)`)
}
log(`KIT_INSTALL: ok — ${counts.written} ${args['dry-run'] ? 'would be written' : 'written'}, ${counts.same} identical, ${counts.skipped} skipped-existing, ${counts.overridden} overrides, ${counts.ignored} ignored, packs=[${packs.join(', ')}], layers=[${layers.join(', ')}], cursor=${!!args.cursor}, source=${origin.source}${origin.ref ? '@' + origin.ref : ''}`)
