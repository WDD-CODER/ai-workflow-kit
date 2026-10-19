/**
 * Acceptance check — a fresh install into each fixture project (tools/fixtures/make-fixture.mjs) must work on the first
 * try, with no overrides except the files the project really does not own. Run from the kit root:
 *
 *   node tools/acceptance-check.mjs [--fixture angular|react-vite|upstream-owned] [--e2e] [--keep]
 *
 * Per fixture (default: all three):
 *   - stack detection: `install --dry-run` with no --packs and no stack.packs prints `KIT_INSTALL: detected packs=[…]
 *     layers=[…]`, exits 2 and writes nothing;
 *   - install with the fixture's explicit --packs / --layers → `KIT_INSTALL: ok` (upstream-owned:
 *     `--packs react-vite --layers upstream-owned`), and the workflow scripts' dependencies installed inside scripts/;
 *   - the install has no file of a pack it did not choose;
 *   - workflow-link-check → 0 missing; drift-check → ok, with an empty `overrides` list (upstream-owned paths come from
 *     ownership.upstreamPaths, never from hand-written overrides);
 *   - the rendered CI: no `--prefix` with nothing after it, a server job only with a backend, ESLint on the changed
 *     files only for the upstream-owned copy;
 *   - adoption-report → no fail row;
 *   - the first commit runs the git hooks (core.hooksPath=.husky, no husky, no --no-verify) and reaches origin.
 * --e2e: then `tools/e2e-check.mjs --project <fixture>` on the react-vite and upstream-owned fixtures (Vite slot server,
 * /pull-copy, Planner close-out, …).
 * Needs git, bash, npm (network for the workflow scripts' dependencies). Exit 0 = every case passed, 1 = failures.
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync, statSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, relative } from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { makeFixture, KINDS, git } from './fixtures/make-fixture.mjs'
import { linkProblems } from './workflow-link-check.mjs'

const kit = resolve(fileURLToPath(new URL('..', import.meta.url)))
const argv = process.argv.slice(2)
const keep = argv.includes('--keep')
const only = argv.includes('--fixture') ? argv[argv.indexOf('--fixture') + 1] : null
if (only && !KINDS[only]) {
  console.error(`ACCEPTANCE_CHECK: FAIL — unknown fixture ${only} (${Object.keys(KINDS).join(', ')})`)
  process.exit(1)
}
const results = []
let failed = 0
const check = (name, ok, evidence) => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${evidence}`}`)
  if (!ok) failed++
  return ok
}
const tail = (s) => String(s).trim().split(/\r?\n/).slice(-3).join(' | ')
const tool = (script, ...args) => {
  const r = spawnSync(process.execPath, [join(kit, 'tools', script), ...args], { encoding: 'utf8' })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}
const files = (dir, base = dir, out = []) => {
  for (const e of readdirSync(dir)) {
    if (e === '.git' || e === 'node_modules') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) files(p, base, out)
    else out.push(relative(base, p).replace(/\\/g, '/'))
  }
  return out
}
// Files only a pack or layer ships: none may appear in an install that did not choose it.
const OWN = {
  angular: /standards-angular\.md|angularComponentStructure|breadcrumbs/,
  'node-express': /docs\/agent\/standards-backend\.md/,
  'react-vite': /standards-react\.md|react-component-structure/,
  supabase: /standards-supabase\.md/,
  'upstream-owned': /pull-copy\.md/,
}

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'kit-accept-')))
const e2eTargets = []
for (const kind of only ? [only] : Object.keys(KINDS)) {
  const fx = makeFixture(kind, root)
  const at = (s) => `${kind}: ${s}`
  const clean = () => git(fx.dir, 'status', '--porcelain').out.trim() === ''

  const det = tool('install.mjs', '--target', fx.dir, '--dry-run')
  check(at(`stack detection proposes ${fx.detected} and writes nothing`), det.status === 2 && det.out.includes(`KIT_INSTALL: detected ${fx.detected}`) && clean(), tail(det.out))

  const args = ['--packs', fx.packs.join(','), ...(fx.layers.length ? ['--layers', fx.layers.join(',')] : []), ...(fx.args ?? [])]
  const inst = tool('install.mjs', '--target', fx.dir, ...args)
  if (!check(at(`install ${args.join(' ')} → KIT_INSTALL: ok`), inst.status === 0 && /KIT_INSTALL: ok/.test(inst.out), tail(inst.out))) continue
  const deps = spawnSync('npm install --no-audit --no-fund', { cwd: join(fx.dir, 'scripts'), encoding: 'utf8', shell: true })
  check(at('the workflow scripts\' dependencies install inside scripts/'), deps.status === 0 && existsSync(join(fx.dir, 'scripts', 'node_modules', 'picomatch')), tail(`${deps.stdout}${deps.stderr}`))
  const installed = files(fx.dir)
  const chosen = [...fx.packs, ...fx.layers]
  const foreign = installed.filter((f) => Object.entries(OWN).some(([u, re]) => !chosen.includes(u) && re.test(f)))
  check(at('no file of a pack or layer it did not choose'), foreign.length === 0, foreign.join(', '))

  const links = linkProblems(fx.dir)
  check(at('workflow-link-check: 0 missing'), links.length === 0, links.slice(0, 3).map((p) => `${p.file}:${p.line}: ${p.what}`).join(' | '))
  const drift = tool('drift-check.mjs', '--target', fx.dir, '--verbose')
  const cfg = JSON.parse(readFileSync(join(fx.dir, 'kit.config.json'), 'utf8'))
  const ovRows = drift.out.split('\n').filter((l) => l.startsWith('override '))
  check(at('drift-check ok, overrides only upstream-owned paths (kit.config.json overrides empty)'),
    drift.status === 0 && !(cfg.overrides ?? []).length && ovRows.every((l) => l.includes('upstream-owned (ownership.upstreamPaths)')), tail(drift.out))
  if (kind === 'upstream-owned') {
    const own = ['.gitignore', 'package.json', 'AGENTS.md'].filter((f) => git(fx.dir, 'diff', '--quiet', '--', f).status !== 0)
    check(at('install left the upstream-owned .gitignore, package.json and AGENTS.md untouched; rules in AGENTS.workflow.md'),
      own.length === 0 && existsSync(join(fx.dir, 'AGENTS.workflow.md')) && /^@AGENTS\.workflow\.md$/m.test(readFileSync(join(fx.dir, 'CLAUDE.md'), 'utf8')), own.join(', '))
  }

  const ci = readFileSync(join(fx.dir, '.github/workflows/ci.yml'), 'utf8')
  const sec = readFileSync(join(fx.dir, '.github/workflows/security.yml'), 'utf8')
  const backend = fx.packs.includes('node-express')
  check(at('rendered CI: no "--prefix" with nothing after it'), !/--prefix\s*$/m.test(ci + sec), 'found')
  check(at(`rendered CI: ${backend ? 'a' : 'no'} server job`), /^ {2}server-tests:\s*$/m.test(ci) === backend && /working-directory: server/.test(sec) === backend, 'server job / steps do not follow paths.serverRoot')
  if (kind === 'upstream-owned') {
    check(at('rendered CI lints the changed files only, installs with npm install, reports app advisories'),
      ci.includes('name: ESLint (changed files)') && !ci.includes('run: npm run lint') && ci.includes('run: npm install --no-audit --no-fund') && sec.includes('::warning'), 'ci.* defaults of the upstream-owned layer not rendered')
  }

  // The first commit: hooks on without husky; a refused or unspawnable hook fails it.
  git(fx.dir, 'config', 'core.hooksPath', '.husky')
  git(fx.dir, 'add', '-A')
  const c = git(fx.dir, 'commit', '-q', '-m', 'chore: install the workflow kit')
  const p = git(fx.dir, 'push', '-q', '-u', 'origin', 'main')
  check(at('the first commit runs the git hooks (no husky, no --no-verify) and reaches origin'), c.status === 0 && !/cannot spawn/.test(c.out) && p.status === 0, tail(c.out + p.out))
  const report = tool('adoption-report.mjs', '--target', fx.dir)
  check(at('adoption-report: no fail row'), report.status === 0 && /ADOPTION_REPORT: ok/.test(report.out), report.out.split('\n').filter((l) => /\sfail\s/.test(l)).concat(tail(report.out)).join(' | '))
  if (kind !== 'angular') e2eTargets.push([kind, fx.dir])
}

if (argv.includes('--e2e')) {
  for (const [kind, dir] of e2eTargets) {
    const r = spawnSync(process.execPath, [join(kit, 'tools', 'e2e-check.mjs'), '--project', dir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    for (const l of out.split(/\r?\n/).filter((x) => /^(PASS|FAIL) /.test(x))) results.push(`${l.slice(0, 6)}${kind}: e2e: ${l.slice(6)}`)
    check(`${kind}: e2e-check --project passes every case`, r.status === 0, tail(out))
  }
}

console.log(results.join('\n'))
if (keep) console.log(`ACCEPTANCE: kept ${root}`)
else try { rmSync(root, { recursive: true, force: true }) } catch { console.log(`ACCEPTANCE: could not delete ${root} — delete it by hand`) }
console.log(failed ? `ACCEPTANCE_CHECK: FAIL — ${failed} of ${results.filter((l) => !l.includes(': e2e: ')).length} checks failed` : `ACCEPTANCE_CHECK: ok — ${results.length} checks passed (${only ?? Object.keys(KINDS).join(', ')}${argv.includes('--e2e') ? ', e2e --project' : ''})`)
process.exit(failed ? 1 : 0)
