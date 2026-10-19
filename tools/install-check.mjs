/**
 * Install proof — installs the kit into temp dirs and checks the result. Run from the kit root:
 *
 *   node tools/install-check.mjs
 *
 * Fixtures: core only; angular + Cursor; node-express + Cursor + yes-chef.
 * Sources: local:<path> recorded by a plain install; a GitHub release fetched from a local bare repo standing in
 * for github.com (needs the git CLI, no network): cache reuse, recorded source/ref/commit, sync and drift-check
 * defaulting to them, sync --ref upgrade, a missing ref refused with nothing written, a moved tag refused.
 * Also covers: idempotent re-install, SKIP-EXISTING on a local edit, and kit-sync (dry-run writes nothing,
 * local-only kept, conflict never overwritten, --apply updates only new + kit-update, overrides never written).
 * Adopt: an existing project gets only .kit/install.json and a clean sync; a second adopt or one with drift is refused.
 * A seed the kit now manages: a customised copy is a conflict --apply never overwrites. Every path /plan and the
 * workflow-map /plan row load exists in each fixture (packs [] up to angular + node-express).
 * Config-driven runtime: a commands.* full command is refused (install and sync, exit 2); no render doubles
 * `npm run`; a project-owned AGENTS.md gets AGENTS.workflow.md and a CLAUDE.md that imports both; an ignored path
 * is SKIP-IGNORED / `ignored`; the .gitignore skeleton and .git/info/exclude carry the runtime list; ship-prep's
 * sensitive paths, the frontend dev server values, an i18n folder hotspot and the browser line follow the config.
 * Exit 0 = ok, 1 = problems (one per line).
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync, statSync, existsSync, cpSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative, resolve } from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { builtinModules } from 'module'

const kit = resolve(fileURLToPath(new URL('..', import.meta.url)))
const problems = []
const fail = (m) => problems.push(m)
const run = (script, args) => spawnSync(process.execPath, [join(kit, 'tools', script), ...args], { encoding: 'utf8' })

const files = (dir, base = dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) files(p, base, out)
    else out.push(relative(base, p).replace(/\\/g, '/'))
  }
  return out
}
const read = (dir, f) => readFileSync(join(dir, f), 'utf8')
const tmp = (name) => mkdtempSync(join(tmpdir(), `kit-${name}-`))

const HOSTILE_RE = 'a`b\'c"d${e}\\w'
const CORE_CFG = { project: { name: 'core-only' }, commands: { build: 'build', lint: 'lint', test: 'test' }, hooks: { shellPath: 'bash' } }
const fixtures = [
  // core: an i18n folder (every file under it is a hotspot) and a sensitive-path regex that replaces the default.
  { name: 'core', args: [], cfg: { ...CORE_CFG, project: { name: 'core-only', i18nFile: 'src/locales/' }, security: { sensitivePaths: 'only-this' } } },
  { name: 'angular-cursor', args: ['--packs', 'angular', '--cursor'], cfg: { project: { name: 'ng-app' } } },
  // express: an old backend-only `commands.dev: "dev"` with the kit's default slots.fe* values (install must NOTE it).
  { name: 'express-cursor-chef', args: ['--packs', 'node-express', '--cursor', '--yes-chef'], cfg: { project: { name: 'api-app' }, commands: { build: 'build', lint: 'lint', dev: 'dev' } } },
  // full: a frontend matcher full of characters that would break a quoted render (quotes, backtick, `${`, backslash).
  { name: 'angular-express-cursor', args: ['--packs', 'angular,node-express', '--cursor'], cfg: { project: { name: 'full-app' }, tools: { browser: 'acme-browser' }, slots: { feMatcher: HOSTILE_RE } } },
]

// Evaluate a block of a rendered script (from the line starting with `from` up to and including the line
// starting with `to`) and return the value of `expr`. Used for the config-driven constants.
function evalBlock(text, from, to, expr) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const a = lines.findIndex((l) => l.startsWith(from))
  const b = lines.findIndex((l, i) => i >= a && l.startsWith(to))
  if (a < 0 || b < 0) throw new Error(`block ${from} … ${to} not found`)
  return new Function(`${lines.slice(a, b + 1).join('\n')}\nreturn ${expr}`)()
}

// Every path `/plan` loads (its `## Loads` list) and the `/plan` row of workflow-map.md names must exist after
// install. Entries marked optional ("when the file exists" / "(when present)") are skipped. A bare file name
// (`hld-template.md`) sits in the folder of the path before it; `dir/*` means the folder.
function loadPathProblems(dir) {
  const out = []
  const check = (where, tokens) => {
    let prevDir = ''
    for (const t of tokens) {
      const p = t.includes('/') ? t.replace(/\/?\*$/, '') : prevDir + t
      prevDir = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : ''
      if (!existsSync(join(dir, p))) out.push(`${where} loads ${t}, which install did not write`)
    }
  }
  const plan = read(dir, '.claude/commands/plan.md').replace(/\r\n/g, '\n')
  const loads = plan.match(/^## Loads\n([\s\S]*?)\n## /m)?.[1]
  if (!loads) out.push('.claude/commands/plan.md has no ## Loads section')
  else check('/plan', loads.split('\n').filter((l) => l.startsWith('- ') && !/when the file exists/.test(l)).flatMap((l) => [...l.split(' — ')[0].matchAll(/`([^`]+)`/g)].map((m) => m[1])))
  const row = read(dir, 'docs/agent/workflow-map.md').split('\n').find((l) => l.startsWith('| `/plan` |'))
  if (!row) out.push('workflow-map.md has no /plan row')
  else check('workflow-map /plan row', row.split('|')[2].split(/,|;/).filter((part) => !/\(when present\)/.test(part)).flatMap((part) => [...part.matchAll(/`([^`]+)`/g)].map((m) => m[1])))
  return out
}

const dirs = {}
for (const fx of fixtures) {
  const dir = tmp(fx.name)
  dirs[fx.name] = dir
  writeFileSync(join(dir, 'kit.config.json'), JSON.stringify({ ...fx.cfg, hooks: { shellPath: 'bash', ...(fx.cfg.hooks ?? {}) } }))
  const r = run('install.mjs', ['--target', dir, ...fx.args])
  if (r.status !== 0) {
    fail(`${fx.name}: install exited ${r.status}: ${(r.stdout + r.stderr).trim().split('\n').pop()}`)
    continue
  }
  const feNoted = /NOTE commands\.dev "dev" starts a frontend dev server/.test(r.stdout)
  if ((fx.name === 'express-cursor-chef') !== feNoted) fail(`${fx.name}: the commands.dev NOTE must appear only for commands.dev with default slots.fe* values (got ${feNoted})`)
  const deps = (r.stdout.match(/npm install -D ([^ (]+(?: [^ (]+)*)/)?.[1] ?? '').split(' ')
  const builtin = deps.filter((d) => builtinModules.includes(d))
  if (builtin.length) fail(`${fx.name}: devDependencies list Node built-ins: ${builtin.join(', ')}`)
  const all = files(dir)
  for (const f of all) {
    const text = read(dir, f)
    const left = [...text.matchAll(/\{\{([a-zA-Z][\w.]*)(?:\|\w+)?\}\}/g)].map((m) => m[1])
    if (left.length) fail(`${fx.name}: unresolved placeholder {{${left[0]}}} in ${f}`)
    if (f.endsWith('.json') && !f.startsWith('.vscode/')) { // .vscode/*.json is JSONC
      try { JSON.parse(text.replace(/^﻿/, '')) } catch (e) { fail(`${fx.name}: ${f} is not valid JSON (${e.message})`) }
    }
    if (f.endsWith('.mjs') && f !== 'kit.config.json') {
      const c = spawnSync(process.execPath, ['--check', join(dir, f)], { encoding: 'utf8' })
      if (c.status !== 0) fail(`${fx.name}: ${f} fails node --check: ${c.stderr.trim().split('\n')[0]}`)
    }
  }
  const settings = read(dir, '.claude/settings.json')
  if (/Write\(|Edit\(/.test(settings)) fail(`${fx.name}: settings.json still has Write(/Edit( entries`)
  if (/[A-Za-z]:[\\/]|\/Users\/|\/home\//.test(settings)) fail(`${fx.name}: settings.json has a machine path`)
  if (!existsSync(join(dir, '.kit/install.json'))) fail(`${fx.name}: .kit/install.json missing`)
  if (/mcp__(plugin_)?playwright/i.test(all.map((f) => read(dir, f)).join('\n'))) fail(`${fx.name}: installed files allow a raw Playwright MCP`)
  for (const f of all.filter((x) => /(^|\/)\.?mcp\.json$/.test(x))) if (/playwright/i.test(read(dir, f))) fail(`${fx.name}: ${f} configures a Playwright MCP server`)
  if (!all.includes('docs/project/tech-stack.md')) fail(`${fx.name}: docs/project/tech-stack.md missing`)
  if (all.some((f) => f.startsWith('_shared/'))) fail(`${fx.name}: _shared/ must not be installed`)
  for (const p of loadPathProblems(dir)) fail(`${fx.name}: ${p}`)
  // commands.* are script names: no render may double the npm run.
  for (const f of all) if (read(dir, f).includes('npm run npm run')) fail(`${fx.name}: ${f} renders "npm run npm run"`)
  // The .gitignore skeleton carries the runtime list from scripts/local-excludes.mjs; scripts/ has its own package.
  const gi = read(dir, '.gitignore')
  if (/KIT:runtime-ignores/.test(gi) || !gi.includes('.worktree-port\n') || !gi.includes('.claude/.last-npm-install-hash-scripts\n')) fail(`${fx.name}: .gitignore lacks the runtime list of scripts/local-excludes.mjs`)
  const spkg = all.includes('scripts/package.json') ? JSON.parse(read(dir, 'scripts/package.json')) : null
  if (!spkg?.dependencies?.picomatch || spkg.type !== 'commonjs') fail(`${fx.name}: scripts/package.json missing, without picomatch, or type ${spkg?.type} (no root package.json = commonjs)`)
  // The ship-prep sensitive paths (evaluated from the kit's own render): a list adds globs, a regex string replaces.
  // The frontend dev server values come from the pack (or the kit defaults).
  try {
    const sens = evalBlock(read(dir, 'scripts/ship-prep.mjs'), 'const DEFAULT_SENSITIVE_RE', 'const isSensitive', 'isSensitive')
    const fe = evalBlock(read(dir, 'scripts/lib/slot-procs.mjs'), 'const asList = ', 'const FE_MATCHER = ', '{ FE_SCRIPT, FE_EXEC, FE_PORT_ARGS, FE_ENV_FILE, FE_MATCHER }')
    if (fx.name === 'angular-express-cursor' && fe.FE_MATCHER?.source !== HOSTILE_RE) fail(`${fx.name}: slots.feMatcher did not survive rendering: ${fe.FE_MATCHER?.source}`)
    if (fx.name === 'core') {
      if (!sens('only-this/x.ts') || sens('package.json')) fail(`${fx.name}: a security.sensitivePaths regex must replace the built-in sensitive paths`)
      if (fe.FE_SCRIPT || fe.FE_MATCHER || fe.FE_PORT_ARGS.join(' ') !== '--port {port}') fail(`${fx.name}: frontend defaults unexpected: ${JSON.stringify(fe)}`)
    }
    if (fx.name === 'angular-cursor') {
      if (!sens('src/app/core/guards/auth.guard.ts') || !sens('src/app/core/interceptors/a/b.ts') || !sens('package.json') || sens('src/app/feature/list.ts')) fail(`${fx.name}: pack sensitive-path globs must add to the built-in ones`)
      if (fe.FE_SCRIPT !== 'start' || fe.FE_EXEC.join(' ') !== 'ng serve' || fe.FE_PORT_ARGS.join(' ') !== '-c slot --port {port}' || !fe.FE_MATCHER.test('node "/x/node_modules/@angular/cli/bin/ng.js" serve -c slot') || !fe.FE_ENV_FILE) fail(`${fx.name}: frontend values do not come from the pack: ${JSON.stringify(fe)}`)
    }
  } catch (e) {
    fail(`${fx.name}: could not evaluate the rendered config constants: ${e.message}`)
  }
  const claude = read(dir, 'CLAUDE.md')
  if (fx.args.includes('--yes-chef') !== claude.includes('Yes chef!')) fail(`${fx.name}: Yes chef! gate must appear only with --yes-chef`)
  const agents = read(dir, 'AGENTS.md')
  if (fx.name === 'angular-express-cursor' && !agents.includes('- Browser tool: acme-browser. Default: hand the Human')) fail(`${fx.name}: a configured tools.browser must be named in AGENTS.md`)
  if (fx.name === 'angular-cursor') {
    if (!agents.includes('Signals only')) fail(`${fx.name}: AGENTS.md is missing the angular pack's hard rules`)
    if (!agents.includes('angularComponentStructure')) fail(`${fx.name}: AGENTS.md is missing the angular skill triggers`)
    if (!all.some((f) => f.startsWith('.cursor/'))) fail(`${fx.name}: --cursor installed no .cursor files`)
    if (!read(dir, '.cursor/rules/security.mdc').includes('src/app/core/guards/**')) fail(`${fx.name}: security.mdc globs not filled from the pack`)
    if (!read(dir, '.husky/pre-commit').includes('pre-commit-no-semi.mjs')) fail(`${fx.name}: pre-commit lost the angular hook`)
  }
  if (fx.name === 'core') {
    // A fresh project with no i18n file and no hotspots: the scope guard's list must hold no empty pattern
    // (picomatch throws on '' and the guard then fails open), and the first save-plan starts the ledger.
    const hs = read(dir, 'scripts/scope-check.mjs').match(/const HOTSPOTS = (\[[\s\S]*?\](?:\.filter\(Boolean\))?)/)
    const items = hs ? [...hs[1].matchAll(/'([^']*)'/g)].map((m) => m[1]) : null
    const list = items && hs[1].endsWith('.filter(Boolean)') ? items.filter(Boolean) : items
    if (!list || list.some((p) => !p)) fail(`${fx.name}: scope-check HOTSPOTS has an empty pattern: ${hs?.[1]}`)
    if (existsSync(join(dir, '.claude/todo.md'))) fail(`${fx.name}: a fresh install should have no .claude/todo.md yet`)
    writeFileSync(join(dir, 'section.tmp.md'), '### Plan 001 — First (`plans/001-first.plan.md`)\n\n- [ ] F1: first task\n')
    const ap = spawnSync(process.execPath, [join(dir, 'scripts/todo-query.mjs'), 'append', '--from', join(dir, 'section.tmp.md')], { cwd: dir, encoding: 'utf8' })
    rmSync(join(dir, 'section.tmp.md'))
    if (ap.status !== 0 || !existsSync(join(dir, '.claude/todo.md')) || !read(dir, '.claude/todo.md').includes('### Plan 001 — First')) fail(`${fx.name}: todo-query append on a fresh project: ${(ap.stdout + ap.stderr).trim()}`)
    rmSync(join(dir, '.claude/todo.md'))
    if (agents.includes('Signals only')) fail(`${fx.name}: core-only AGENTS.md must not carry angular rules`)
    if (/Browser tool: browser tool/.test(agents) || !agents.includes('- Browser checks: hand the Human')) fail(`${fx.name}: tools.browser at the default must leave the tool name out of AGENTS.md`)
    const hotspots = evalBlock(read(dir, 'scripts/scope-check.mjs'), 'const HOTSPOTS = [', '  .map((p) =>', 'HOTSPOTS')
    if (!hotspots.includes('src/locales/**')) fail(`${fx.name}: an i18n folder (project.i18nFile "src/locales/") must be the hotspot src/locales/**, got ${JSON.stringify(hotspots)}`)
    if (all.some((f) => f.startsWith('.cursor/'))) fail(`${fx.name}: no --cursor, yet .cursor files were installed`)
    const hook = read(dir, '.husky/pre-commit')
    if (/no-semi|security-grep|lint-staged/.test(hook)) fail(`${fx.name}: pre-commit still runs a hook whose script was not installed`)
    if (/<!-- (PACK:(hard-rules|skill-triggers|standards-index)|KIT:)/.test(agents + claude)) fail(`${fx.name}: skeleton marker left in AGENTS.md/CLAUDE.md`)
  }
}

// Idempotent re-install and SKIP-EXISTING.
const ng = dirs['angular-cursor']
if (ng) {
  const again = run('install.mjs', ['--target', ng, '--packs', 'angular', '--cursor'])
  if (!/ 0 written, \d+ identical, 0 skipped-existing/.test(again.stdout)) fail(`re-install was not a no-op: ${again.stdout.trim().split('\n').pop()}`)
  writeFileSync(join(ng, 'docs/project/tech-stack.md'), '# edited\n')
  const kept = run('install.mjs', ['--target', ng, '--packs', 'angular', '--cursor'])
  if (!kept.stdout.includes('SKIP-EXISTING docs/project/tech-stack.md')) fail('a locally edited file was not reported SKIP-EXISTING')
  if (read(ng, 'docs/project/tech-stack.md') !== '# edited\n') fail('install overwrote a locally edited file')

  // Sync: dry-run writes nothing; local edit to a managed file is local-only; seed edits are local-only too.
  writeFileSync(join(ng, '.claude/commands/ship.md'), read(ng, '.claude/commands/ship.md') + '\nlocal line\n')
  const dry = run('sync.mjs', ['--target', ng])
  if (!/KIT_SYNC: dry-run — 0 new, 0 kit-update, 0 conflicts, 2 local-only/.test(dry.stdout)) fail(`sync dry-run summary unexpected: ${dry.stdout.trim().split('\n').pop()}`)
  if (!dry.stdout.includes('local-only       .claude/commands/ship.md')) fail('sync did not report the local edit as local-only')

  // Simulate a kit-side change: remove a recorded file (becomes `new`), and edit the recorded hash of another
  // managed file so the project copy looks "untouched since an older kit" (becomes `kit-update`).
  const instPath = join(ng, '.kit/install.json')
  const inst = JSON.parse(readFileSync(instPath, 'utf8'))
  rmSync(join(ng, 'scripts/todo-query.mjs'))
  delete inst.files['scripts/todo-query.mjs']
  const old = '# older kit copy\n'
  writeFileSync(join(ng, 'scripts/todo-archive.mjs'), old)
  inst.files['scripts/todo-archive.mjs'].sha256 = (await import('crypto')).createHash('sha256').update(old).digest('hex')
  // and a conflict: edited locally AND recorded as an older kit version
  writeFileSync(join(ng, 'scripts/scope-check.mjs'), '// local edit\n')
  inst.files['scripts/scope-check.mjs'].sha256 = 'f'.repeat(64)
  writeFileSync(instPath, JSON.stringify(inst, null, 2))
  const before = read(ng, 'scripts/scope-check.mjs')
  const dry2 = run('sync.mjs', ['--target', ng])
  if (!/1 new, 1 kit-update, 1 conflicts/.test(dry2.stdout)) fail(`sync after kit change: unexpected summary: ${dry2.stdout.trim().split('\n').pop()}`)
  if (existsSync(join(ng, 'scripts/todo-query.mjs'))) fail('sync dry-run wrote a file')
  const applied = run('sync.mjs', ['--target', ng, '--apply'])
  if (!existsSync(join(ng, 'scripts/todo-query.mjs'))) fail('sync --apply did not write the new file')
  if (read(ng, 'scripts/todo-archive.mjs') === old) fail('sync --apply did not update the kit-update file')
  if (read(ng, 'scripts/scope-check.mjs') !== before) fail('sync --apply overwrote a conflict')
  if (!/applied — 1 new, 1 kit-update, 1 conflicts/.test(applied.stdout)) fail(`sync --apply summary unexpected: ${applied.stdout.trim().split('\n').pop()}`)

  // Overrides: the conflicting file, once declared in kit.config.json, is an `override` — never a conflict,
  // never written by sync --apply or by install --force.
  const cfgPath = join(ng, 'kit.config.json')
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
  writeFileSync(cfgPath, JSON.stringify({ ...cfg, overrides: [{ path: 'scripts/scope-check.mjs', reason: 'install-check: project keeps its own copy' }] }))
  const ov = run('sync.mjs', ['--target', ng, '--apply'])
  if (!ov.stdout.includes('override         scripts/scope-check.mjs')) fail('sync did not report the overridden path as override')
  if (!/applied — 0 new, 0 kit-update, 0 conflicts, .* 1 overrides/.test(ov.stdout)) fail(`sync with an override: unexpected summary: ${ov.stdout.trim().split('\n').pop()}`)
  if (read(ng, 'scripts/scope-check.mjs') !== before) fail('sync --apply wrote an overridden path')
  const forced = run('install.mjs', ['--target', ng, '--packs', 'angular', '--cursor', '--force'])
  if (!forced.stdout.includes('SKIP-OVERRIDE scripts/scope-check.mjs')) fail('install --force did not skip the overridden path')
  if (read(ng, 'scripts/scope-check.mjs') !== before) fail('install --force wrote an overridden path')
  writeFileSync(cfgPath, JSON.stringify({ ...cfg, overrides: [{ path: 'scripts/scope-check.mjs' }] }))
  const bad = run('sync.mjs', ['--target', ng])
  if (bad.status !== 1 || !bad.stderr.includes('needs a non-empty "path" and "reason"')) fail('an override without a reason was not refused')
}

// Drift check: a fresh install has no drift; editing one managed file makes it exit 1 naming that file;
// declaring it as an override makes it pass again.
const core = dirs['core']
if (core) {
  const clean = run('drift-check.mjs', ['--target', core])
  if (clean.status !== 0 || !/KIT_DRIFT: ok — 0 undeclared differences, 0 overrides/.test(clean.stdout)) fail(`drift-check on a fresh install: ${clean.stdout.trim().split('\n').pop()}`)
  writeFileSync(join(core, '.claude/commands/ship.md'), read(core, '.claude/commands/ship.md') + '\nlocal line\n')
  const dirty = run('drift-check.mjs', ['--target', core])
  if (dirty.status !== 1 || !dirty.stdout.includes('drift     .claude/commands/ship.md')) fail('drift-check did not exit 1 naming the edited file')
  const cfgPath = join(core, 'kit.config.json')
  writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(readFileSync(cfgPath, 'utf8')), overrides: [{ path: '.claude/commands/ship.md', reason: 'install-check' }] }))
  const declared = run('drift-check.mjs', ['--target', core])
  if (declared.status !== 0 || !/0 undeclared differences, 1 overrides/.test(declared.stdout)) fail(`drift-check with the override: ${declared.stdout.trim().split('\n').pop()}`)
}

// Adopt: a project that already carries the workflow (an install with .kit/ removed, one managed file and
// one seed overridden) gets only .kit/install.json; kit-sync then sees nothing to do. A second adopt, or one
// with drift, is refused. (Some files render the target folder's name, so the fixture is installed in place.)
{
  const ad = tmp('adopt')
  writeFileSync(join(ad, 'kit.config.json'), JSON.stringify(CORE_CFG))
  run('install.mjs', ['--target', ad])
  rmSync(join(ad, '.kit'), { recursive: true, force: true })
  writeFileSync(join(ad, 'docs/project/tech-stack.md'), '# our stack\n') // a seed the project filled in
  writeFileSync(join(ad, '.claude/commands/ship.md'), '# our ship\n')
  const overrides = [
    { path: '.claude/commands/ship.md', reason: 'install-check: an overridden managed file' },
    { path: 'docs/brain/glossary.md', reason: 'install-check: an overridden seed' },
  ]
  writeFileSync(join(ad, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, overrides }))
  const listed = files(ad).sort()
  const r = run('install.mjs', ['--adopt', '--target', ad])
  const added = files(ad).filter((f) => !listed.includes(f))
  if (r.status !== 0 || !/KIT_INSTALL: adopted — \d+ managed files recorded/.test(r.stdout)) fail(`adopt: exit ${r.status}: ${(r.stdout + r.stderr).trim().replace(/\s*\n\s*/g, ' | ')}`)
  else if (added.join() !== '.kit/install.json') fail(`adopt must write only .kit/install.json, wrote: ${added.join(', ')}`)
  else {
    const inst = JSON.parse(read(ad, '.kit/install.json'))
    if (inst.files['.claude/commands/ship.md']) fail('adopt recorded an overridden file')
    if (!inst.files['docs/project/tech-stack.md']) fail('adopt did not record a present seed')
    const s = run('sync.mjs', ['--target', ad])
    if (!/dry-run — 0 new, 0 kit-update, 0 conflicts, 1 local-only, 0 deleted-locally, 0 removed-from-kit, 2 overrides/.test(s.stdout)) fail(`sync right after adopt: ${s.stdout.trim().split('\n').pop()}`)
    const d = run('drift-check.mjs', ['--target', ad])
    if (d.stdout.includes('is not a file this kit ships')) fail('drift-check called an overridden seed unknown')
  }
  const twice = run('install.mjs', ['--adopt', '--target', ad])
  if (twice.status !== 1 || !twice.stderr.includes('already exists')) fail('a second adopt was not refused')
  rmSync(join(ad, '.kit'), { recursive: true, force: true })
  writeFileSync(join(ad, 'scripts/todo-query.mjs'), '// local edit\n')
  const drifted = run('install.mjs', ['--adopt', '--target', ad])
  if (drifted.status !== 1 || !drifted.stderr.includes('drift     scripts/todo-query.mjs') || existsSync(join(ad, '.kit'))) fail('adopt with drift was not refused, or it wrote something')
  rmSync(ad, { recursive: true, force: true })
}

// A seed the kit now manages (the PRD/HLD templates were seeds before they moved to core): the recorded hash is
// the project's own copy, so a customised copy is a `conflict` that --apply never overwrites, and a copy that
// already matches the kit is `same` and is recorded as managed from then on.
{
  const sp = tmp('seed-promoted')
  writeFileSync(join(sp, 'kit.config.json'), JSON.stringify(CORE_CFG))
  run('install.mjs', ['--target', sp])
  const instPath = join(sp, '.kit/install.json')
  const inst = JSON.parse(readFileSync(instPath, 'utf8'))
  const custom = '# Plan XXX — our own template\n\n- a project-only line\n'
  const hash = (await import('crypto')).createHash('sha256').update(custom).digest('hex')
  const prd = '.claude/references/prd-template.md'
  const hld = '.claude/references/hld-template.md'
  writeFileSync(join(sp, prd), custom)
  inst.files[prd] = { sha256: hash, kind: 'seed', source: `templates/${prd}` }
  inst.files[hld] = { ...inst.files[hld], kind: 'seed', source: `templates/${hld}` }
  writeFileSync(instPath, JSON.stringify(inst, null, 2))
  const dry = run('sync.mjs', ['--target', sp])
  if (!dry.stdout.includes(`conflict         ${prd}`)) fail(`a customised copy of a seed the kit now manages is not a conflict: ${dry.stdout.trim().split('\n').pop()}`)
  if (!/dry-run — 0 new, 0 kit-update, 1 conflicts/.test(dry.stdout)) fail(`sync with a promoted seed: unexpected summary: ${dry.stdout.trim().split('\n').pop()}`)
  const ap = run('sync.mjs', ['--target', sp, '--apply'])
  if (read(sp, prd) !== custom) fail('sync --apply overwrote a customised copy of a seed the kit now manages')
  const after = JSON.parse(readFileSync(instPath, 'utf8')).files
  if (after[hld]?.kind !== 'managed') fail(`an unchanged promoted seed was not recorded as managed (kind ${after[hld]?.kind}): ${ap.stdout.trim().split('\n').pop()}`)
  if (after[prd]?.kind !== 'seed') fail('sync --apply re-recorded a conflicting promoted seed')
  rmSync(sp, { recursive: true, force: true })
}

// Sources. A plain install records the kit it ran from as `local:<path>`; an explicit --source folder works too.
if (core) {
  const inst = JSON.parse(read(core, '.kit/install.json'))
  if (!/^local:/.test(inst.source ?? '')) fail(`a plain install must record source local:<path>, got ${inst.source}`)
  const explicit = tmp('local-src')
  writeFileSync(join(explicit, 'kit.config.json'), JSON.stringify(CORE_CFG))
  const r = run('install.mjs', ['--target', explicit, '--source', kit])
  const src = r.status === 0 ? JSON.parse(read(explicit, '.kit/install.json')).source : null
  if (r.status !== 0 || !/^local:/.test(src ?? '') || resolve(explicit, src.slice(6)) !== kit) fail(`--source <kit folder> install: exit ${r.status}, source ${src}`)
  rmSync(explicit, { recursive: true, force: true })
}

// GitHub source, offline: a bare repo stands in for github.com (AI_WORKFLOW_KIT_GIT_BASE) and the cache is a temp dir.
// Release v9.9.9 (annotated tag) and v9.9.10 (lightweight tag) of a copy of this kit.
const ghDirs = []
const g = (args, cwd) => spawnSync('git', ['-c', 'user.name=kit-check', '-c', 'user.email=kit-check@example.invalid', ...args], { cwd, encoding: 'utf8' })
if (g(['--version']).status !== 0) fail('git is required for the GitHub-source checks')
else {
  const base = tmp('gh-base')
  const work = tmp('gh-work')
  const cache = tmp('gh-cache')
  ghDirs.push(base, work, cache)
  const remote = join(base, 'acme', 'kit.git')
  mkdirSync(remote, { recursive: true })
  g(['init', '-q', '--bare'], remote)
  for (const p of ['core', 'packs', 'layers', 'templates', 'kit.json', 'kit.config.json', '.gitattributes']) cpSync(join(kit, p), join(work, p), { recursive: true })
  const setVersion = (v) => writeFileSync(join(work, 'kit.json'), JSON.stringify({ name: 'ai-workflow-kit', version: v }, null, 2) + '\n')
  setVersion('9.9.9')
  for (const s of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'v9.9.9'], ['tag', '-a', 'v9.9.9', '-m', 'v9.9.9']]) g(s, work)
  setVersion('9.9.10')
  for (const s of [['commit', '-q', '-am', 'v9.9.10'], ['tag', 'v9.9.10'], ['push', '-q', remote, 'HEAD:refs/heads/main', '--tags']]) g(s, work)
  const sha = (ref) => g(['rev-parse', `${ref}^{commit}`], work).stdout.trim()
  const fileUrl = 'file://' + (base.startsWith('/') ? '' : '/') + base.replace(/\\/g, '/')
  const env = { ...process.env, AI_WORKFLOW_KIT_GIT_BASE: fileUrl, AI_WORKFLOW_KIT_CACHE: cache }
  const ghRun = (script, args) => spawnSync(process.execPath, [join(kit, 'tools', script), ...args], { encoding: 'utf8', env })
  const GH = ['--source', 'github:acme/kit']
  const target = tmp('gh-target')
  ghDirs.push(target)
  writeFileSync(join(target, 'kit.config.json'), JSON.stringify({ project: { name: 'gh-app' }, hooks: { shellPath: 'bash' } }))

  const first = ghRun('install.mjs', [...GH, '--ref', 'v9.9.9', '--target', target, '--packs', 'angular'])
  const instPath = join(target, '.kit/install.json')
  const inst = first.status === 0 ? JSON.parse(readFileSync(instPath, 'utf8')) : {}
  if (first.status !== 0) fail(`github install exited ${first.status}: ${(first.stdout + first.stderr).trim().split('\n').pop()}`)
  else {
    if (!first.stdout.includes('SOURCE fetched github:acme/kit@v9.9.9')) fail('github install did not report the fetch')
    if (inst.source !== 'github:acme/kit' || inst.ref !== 'v9.9.9' || inst.commit !== sha('v9.9.9')) fail(`github install recorded ${inst.source} ${inst.ref} ${inst.commit}, expected github:acme/kit v9.9.9 ${sha('v9.9.9')}`)
    if (inst.kit?.version !== '9.9.9') fail(`github install recorded kit version ${inst.kit?.version}, expected the release's 9.9.9`)
    if (!existsSync(join(cache, 'acme', 'kit', 'v9.9.9', 'kit.json'))) fail('the release was not cached under <cache>/acme/kit/v9.9.9')
  }
  const second = tmp('gh-second')
  ghDirs.push(second)
  writeFileSync(join(second, 'kit.config.json'), JSON.stringify(CORE_CFG))
  const again = ghRun('install.mjs', [...GH, '--ref', 'v9.9.9', '--target', second])
  if (again.status !== 0 || !again.stdout.includes('SOURCE cached github:acme/kit@v9.9.9')) fail(`a second github install did not reuse the cache: ${again.stdout.trim().split('\n').pop()}`)
  const noRef = ghRun('install.mjs', [...GH, '--target', second])
  if (noRef.status !== 1 || !noRef.stderr.includes('--ref <tag> is required')) fail('a github source without --ref was not refused')

  // Sync with no --source uses the recorded source + ref.
  const sync = ghRun('sync.mjs', ['--target', target])
  if (sync.status !== 0 || !sync.stdout.includes('NOTE source github:acme/kit@v9.9.9') || !/dry-run — 0 new, 0 kit-update, 0 conflicts/.test(sync.stdout)) fail(`sync from the recorded github source: ${(sync.stdout + sync.stderr).trim().split('\n').slice(-2).join(' | ')}`)
  // A ref that does not exist: non-zero, the exact message, nothing written.
  const before = readFileSync(instPath, 'utf8')
  const missingRef = ghRun('sync.mjs', ['--target', target, '--ref', 'v0.0.404', '--apply'])
  if (missingRef.status === 0 || !missingRef.stderr.includes('KIT_SYNC: FAIL — ref v0.0.404 not found')) fail(`sync --ref <missing>: exit ${missingRef.status}, ${missingRef.stderr.trim()}`)
  if (readFileSync(instPath, 'utf8') !== before) fail('sync --ref <missing> wrote install.json')
  // Upgrade: --ref v9.9.10 dry-run records nothing, --apply records the new ref + commit.
  const upDry = ghRun('sync.mjs', ['--target', target, '--ref', 'v9.9.10'])
  if (!upDry.stdout.includes('NOTE source github:acme/kit@v9.9.9 -> github:acme/kit@v9.9.10 (recorded on --apply)') || readFileSync(instPath, 'utf8') !== before) fail('sync --ref dry-run did not report the move or wrote install.json')
  const up = ghRun('sync.mjs', ['--target', target, '--ref', 'v9.9.10', '--apply'])
  const upInst = JSON.parse(readFileSync(instPath, 'utf8'))
  if (up.status !== 0 || upInst.ref !== 'v9.9.10' || upInst.commit !== sha('v9.9.10') || upInst.kit?.version !== '9.9.10' || upInst.source !== 'github:acme/kit') fail(`sync --ref v9.9.10 --apply recorded ${upInst.source} ${upInst.ref} ${upInst.commit} ${upInst.kit?.version}`)
  if (Object.keys(upInst.files ?? {}).length !== Object.keys(inst.files ?? {}).length) fail('sync --ref --apply changed the recorded file list')
  // Drift check with no --source uses the recorded release too.
  const drift = ghRun('drift-check.mjs', ['--target', target])
  if (drift.status !== 0 || !drift.stdout.includes('source=github:acme/kit@v9.9.10')) fail(`drift-check from the recorded github source: ${drift.stdout.trim().split('\n').pop()}`)
  // A tag that moved after it was cached is refused, not silently re-fetched.
  g(['tag', '-f', '-a', 'v9.9.9', '-m', 'moved'], work)
  g(['push', '-q', '-f', remote, 'refs/tags/v9.9.9'], work)
  const moved = ghRun('install.mjs', [...GH, '--ref', 'v9.9.9', '--target', second])
  if (moved.status !== 1 || !moved.stderr.includes('tag v9.9.9 moved')) fail(`a moved tag was not refused: ${moved.stderr.trim()}`)
}

// commands.* take npm script names: a full command ("npm run build") is refused with exit 2 by install (nothing
// written) and by sync (install.json untouched), with the script name to use instead.
{
  const fc = tmp('full-command')
  writeFileSync(join(fc, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, commands: { ...CORE_CFG.commands, build: 'npm run build' } }))
  const r = run('install.mjs', ['--target', fc])
  if (r.status !== 2 || !r.stderr.includes('commands.build is "npm run build"') || !r.stderr.includes('set it to "build"') || files(fc).length !== 1) fail(`install with commands.build "npm run build": exit ${r.status}, ${files(fc).length} files, ${r.stderr.trim().split('\n')[0]}`)
  writeFileSync(join(fc, 'kit.config.json'), JSON.stringify(CORE_CFG))
  run('install.mjs', ['--target', fc])
  const before = read(fc, '.kit/install.json')
  writeFileSync(join(fc, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, commands: { ...CORE_CFG.commands, lint: 'npm run lint' } }))
  const s = run('sync.mjs', ['--target', fc, '--apply'])
  if (s.status !== 2 || !s.stderr.includes('KIT_SYNC: STOP — commands.lint is "npm run lint"') || read(fc, '.kit/install.json') !== before) fail(`sync with commands.lint "npm run lint": exit ${s.status}, ${s.stderr.trim().split('\n')[0]}`)
  rmSync(fc, { recursive: true, force: true })
}

// The project owns AGENTS.md (present before install, or listed in overrides): the kit's rules go to
// AGENTS.workflow.md (managed, fully rendered), AGENTS.md is left alone, CLAUDE.md imports both; sync and
// drift-check agree. `no-config`: no kit.config.json, so install writes the effective config (tools.browser at its
// default included) — drift-check right after must still be ok.
for (const mode of ['present', 'override', 'no-config']) {
  const ag = tmp(`agents-${mode}`)
  const own = '# AGENTS.md — the project\'s own rules\n'
  writeFileSync(join(ag, 'AGENTS.md'), own)
  const overrides = mode === 'override' ? [{ path: 'AGENTS.md', reason: 'install-check: the project owns AGENTS.md' }] : []
  if (mode !== 'no-config') writeFileSync(join(ag, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, overrides }))
  const r = run('install.mjs', ['--target', ag, ...(mode === 'no-config' ? ['--packs', 'angular'] : [])])
  const wf = existsSync(join(ag, 'AGENTS.workflow.md')) ? read(ag, 'AGENTS.workflow.md') : ''
  const claude = existsSync(join(ag, 'CLAUDE.md')) ? read(ag, 'CLAUDE.md') : ''
  if (r.status !== 0 || !wf.includes('## Hard rules') || /\{\{/.test(wf) || !wf.includes('Kit-managed')) fail(`AGENTS.md ${mode}: AGENTS.workflow.md not rendered (exit ${r.status}): ${(r.stdout + r.stderr).trim().split('\n').pop()}`)
  if (read(ag, 'AGENTS.md') !== own) fail(`AGENTS.md ${mode}: install wrote the project's AGENTS.md`)
  if (!/^@AGENTS\.md$/m.test(claude) || !/^@AGENTS\.workflow\.md$/m.test(claude)) fail(`AGENTS.md ${mode}: CLAUDE.md must import @AGENTS.md and @AGENTS.workflow.md`)
  if (JSON.parse(read(ag, '.kit/install.json')).files['AGENTS.workflow.md']?.kind !== 'managed') fail(`AGENTS.md ${mode}: AGENTS.workflow.md is not recorded as managed`)
  const s = run('sync.mjs', ['--target', ag])
  if (!/dry-run — 0 new, 0 kit-update, 0 conflicts/.test(s.stdout)) fail(`AGENTS.md ${mode}: sync right after install: ${s.stdout.trim().split('\n').pop()}`)
  const d = run('drift-check.mjs', ['--target', ag])
  if (d.status !== 0) fail(`AGENTS.md ${mode}: drift-check: ${d.stdout.trim().split('\n').pop()}`)
  rmSync(ag, { recursive: true, force: true })
}

// A kit file the project's .gitignore ignores never reaches a clone: install skips it (SKIP-IGNORED), drift-check
// reports it `ignored` (not `missing`), sync never writes it. Install also adds the runtime list to .git/info/exclude.
{
  const ig = tmp('ignored')
  if (g(['init', '-q'], ig).status !== 0) fail('git init failed for the ignored-paths case')
  writeFileSync(join(ig, '.gitignore'), '.vscode/\n')
  writeFileSync(join(ig, 'kit.config.json'), JSON.stringify(CORE_CFG))
  const r = run('install.mjs', ['--target', ig])
  if (r.status !== 0 || !r.stdout.includes('SKIP-IGNORED .vscode/settings.json') || existsSync(join(ig, '.vscode/settings.json'))) fail(`install over an ignored path: ${(r.stdout + r.stderr).trim().split('\n').pop()}`)
  const d = run('drift-check.mjs', ['--target', ig])
  if (d.status !== 0 || !d.stdout.includes('ignored   .vscode/settings.json') || d.stdout.includes('missing   .vscode/')) fail(`drift-check with an ignored path: ${d.stdout.trim().split('\n').pop()}`)
  const s = run('sync.mjs', ['--target', ig, '--apply'])
  if (!s.stdout.includes('ignored          .vscode/settings.json') || existsSync(join(ig, '.vscode/settings.json'))) fail(`sync with an ignored path: ${s.stdout.trim().split('\n').pop()}`)
  const exclude = readFileSync(join(ig, '.git', 'info', 'exclude'), 'utf8')
  if (!exclude.includes('.worktree-port\n') || !exclude.includes('.claude/.last-npm-install-hash-scripts\n')) fail('install did not add the runtime list to .git/info/exclude')
  rmSync(ig, { recursive: true, force: true })
}

// Required keys: core only with no config must STOP and write nothing.
const bare = tmp('bare')
const stop = run('install.mjs', ['--target', bare, '--packs', ''])
if (stop.status !== 2 || files(bare).length !== 0) fail(`missing required keys must exit 2 and write nothing (exit ${stop.status}, ${files(bare).length} files)`)

for (const d of [...Object.values(dirs), bare, ...ghDirs]) rmSync(d, { recursive: true, force: true })
if (problems.length > 0) {
  console.error(problems.join('\n'))
  console.error(`INSTALL_CHECK: FAIL — ${problems.length} problems`)
  process.exit(1)
}
console.log(`INSTALL_CHECK: ok — ${fixtures.length} fixtures, re-install no-op, sync dry-run/apply, overrides, drift-check, adopt, promoted seeds, /plan load paths, local + github sources, 0 problems`)
