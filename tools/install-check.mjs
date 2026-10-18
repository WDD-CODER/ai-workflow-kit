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

const CORE_CFG = { project: { name: 'core-only' }, commands: { build: 'build', lint: 'lint', test: 'test' }, hooks: { shellPath: 'bash' } }
const fixtures = [
  { name: 'core', args: [], cfg: CORE_CFG },
  { name: 'angular-cursor', args: ['--packs', 'angular', '--cursor'], cfg: { project: { name: 'ng-app' } } },
  { name: 'express-cursor-chef', args: ['--packs', 'node-express', '--cursor', '--yes-chef'], cfg: { project: { name: 'api-app' }, commands: { build: 'build', lint: 'lint' } } },
]

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
  const claude = read(dir, 'CLAUDE.md')
  if (fx.args.includes('--yes-chef') !== claude.includes('Yes chef!')) fail(`${fx.name}: Yes chef! gate must appear only with --yes-chef`)
  const agents = read(dir, 'AGENTS.md')
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
console.log(`INSTALL_CHECK: ok — ${fixtures.length} fixtures, re-install no-op, sync dry-run/apply, overrides, drift-check, adopt, local + github sources, 0 problems`)
