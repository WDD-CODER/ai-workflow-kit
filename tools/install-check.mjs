/**
 * Install proof — installs the kit into temp dirs and checks the result. Run from the kit root:
 *
 *   node tools/install-check.mjs
 *
 * Fixtures: core only; angular + Cursor; node-express + Cursor + yes-chef. No git needed.
 * Also covers: idempotent re-install, SKIP-EXISTING on a local edit, and kit-sync (dry-run writes nothing,
 * local-only kept, conflict never overwritten, --apply updates only new + kit-update).
 * Exit 0 = ok, 1 = problems (one per line).
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync, statSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative, resolve } from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

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
}

// Required keys: core only with no config must STOP and write nothing.
const bare = tmp('bare')
const stop = run('install.mjs', ['--target', bare, '--packs', ''])
if (stop.status !== 2 || files(bare).length !== 0) fail(`missing required keys must exit 2 and write nothing (exit ${stop.status}, ${files(bare).length} files)`)

for (const d of [...Object.values(dirs), bare]) rmSync(d, { recursive: true, force: true })
if (problems.length > 0) {
  console.error(problems.join('\n'))
  console.error(`INSTALL_CHECK: FAIL — ${problems.length} problems`)
  process.exit(1)
}
console.log(`INSTALL_CHECK: ok — ${fixtures.length} fixtures, re-install no-op, sync dry-run/apply, 0 problems`)
