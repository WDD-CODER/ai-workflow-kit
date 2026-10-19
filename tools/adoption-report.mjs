/**
 * Adoption report — which parts of the workflow an installed project has, and whether each one works. Read-only.
 *
 *   node tools/adoption-report.mjs --target <dir> [--markdown <file>]
 *
 * One row per part, each with a status and the evidence:
 *   install record        .kit/install.json: kit version, source, packs, layers
 *   managed files         every kit-managed file matches the kit render (as drift-check), overrides and ignored paths named
 *   stack                 the packs / layers installed vs what the installer would detect in the project now
 *   hook:<event>          each Claude Code hook in .claude/settings.json: the scripts it runs exist
 *   .husky/<hook>         each git hook: a shebang, executable in the git index, the scripts it runs exist
 *   git hooks enabled     core.hooksPath=.husky, or husky's prepare script with husky installed
 *   scripts dependencies  scripts/package.json installed inside scripts/ (each dependency present), lockfile committed
 *   runtime ignores       scripts/local-excludes.mjs --check (slot runtime files never show as changes)
 *   kit rules loaded      CLAUDE.md imports AGENTS.md (and AGENTS.workflow.md when the project owns AGENTS.md)
 *   npm scripts           commands.build / lint / test are package.json scripts (test: only with ci.testMode run)
 *   frontend dev server   commands.dev is a package.json script; the command a slot starts it with (slots.fe*), {port} as is
 *   workflow doc links    every path, `node scripts/…` and `npm run …` the installed docs name exists
 *   CI workflows          ci.yml present, no `--prefix` with nothing after it, a server job only with paths.serverRoot,
 *                         a test job unless ci.testMode is skip
 *   todo-sync setting     the GitHub repo setting todo-sync needs (manual: the report cannot see it)
 * Status: ok | warn (works, but needs a step) | fail (broken) | manual | n/a. Node built-ins only.
 * Exit 0 = no fail rows, 1 = a fail row or a usage error. --markdown also writes the table to that file.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { spawnSync } from 'child_process'
import {
  KIT_ROOT, readJson, resolveConfig, planFiles, parseArgs, readOverrides, ownsAgents, ignoredPaths, withUpstream, detectStack, isEmpty,
} from './lib/kit.mjs'
import { linkProblems } from './workflow-link-check.mjs'
// The slot frontend command: the same builder the installed scripts/lib/slot-procs.mjs starts the server with.
import { frontendCommand } from '../core/scripts/lib/fe-command.mjs'

let args
try {
  args = parseArgs(process.argv.slice(2), { target: 'value', markdown: 'value' })
} catch (e) {
  console.error(`ADOPTION_REPORT: FAIL — ${e.message}`)
  process.exit(1)
}
if (!args.target) {
  console.error('ADOPTION_REPORT: FAIL — --target <dir> is required')
  process.exit(1)
}
const target = resolve(args.target)
const rows = []
const row = (part, status, evidence) => rows.push({ part, status, evidence })
const has = (p) => existsSync(join(target, p))
const read = (p) => readFileSync(join(target, p), 'utf8')
const git = (...a) => spawnSync('git', a, { cwd: target, encoding: 'utf8' })
const inRepo = git('rev-parse', '--is-inside-work-tree').stdout?.trim() === 'true'

// install record
const inst = has('.kit/install.json') ? readJson(join(target, '.kit/install.json')) : null
if (!inst) {
  row('install record', 'fail', '.kit/install.json not found — install the kit (or --adopt a hand-copied workflow)')
  finish()
}
const packs = inst.packs ?? []
const layers = inst.layers ?? []
row('install record', 'ok', `kit ${inst.kit?.version ?? '?'}, source ${inst.source ?? '(not recorded)'}${inst.ref ? `@${inst.ref}` : ''}, packs=[${packs.join(', ')}], layers=[${layers.join(', ')}], cursor=${!!inst.cursor}`)

// managed files (the drift-check comparison, against this kit)
const project = has('kit.config.json') ? readJson(join(target, 'kit.config.json')) : {}
let vals
let plan
let overrides
try {
  vals = resolveConfig({ kitRoot: KIT_ROOT, project, packs, layers, target })
  overrides = withUpstream(readOverrides(project), vals, ['AGENTS.md'])
  const agentsWorkflow = ownsAgents({ target, overrides, recorded: inst.files ?? {} })
  plan = planFiles({ kitRoot: KIT_ROOT, packs, layers, cursor: !!inst.cursor, yesChef: !!inst.yesChef, vals, agentsWorkflow })
  overrides = withUpstream(overrides, vals, plan.files.map((f) => f.dest))
} catch (e) {
  row('managed files', 'fail', `the kit could not render this project: ${e.message}`)
  finish()
}
const managed = plan.files.filter((f) => f.kind === 'managed')
const ignored = ignoredPaths(target, managed.filter((f) => !has(f.dest)).map((f) => f.dest))
const state = { same: [], drift: [], missing: [], override: [], ignored: [] }
for (const f of managed) {
  if (overrides.has(f.dest)) state.override.push(f.dest)
  else if (ignored.has(f.dest)) state.ignored.push(f.dest)
  else if (!has(f.dest)) state.missing.push(f.dest)
  else state[read(f.dest) === f.content ? 'same' : 'drift'].push(f.dest)
}
const undeclared = [...state.drift.map((d) => `drift ${d}`), ...state.missing.map((m) => `missing ${m}`)]
const sameNote = `${state.same.length} of ${managed.length} match this kit (${KIT_ROOT.replace(/\\/g, '/').split('/').pop()}), ${state.override.length} overrides, ${state.ignored.length} ignored`
row('managed files', undeclared.length ? 'warn' : 'ok', undeclared.length ? `${sameNote}; ${undeclared.length} differ (kit-sync shows which are kit updates): ${undeclared.slice(0, 5).join(', ')}${undeclared.length > 5 ? ', …' : ''}` : sameNote)

// stack: what the installer would detect now
const found = detectStack({ kitRoot: KIT_ROOT, target, project })
const notInstalled = [...found.packs.filter((p) => !packs.includes(p.name)), ...found.layers.filter((l) => !layers.includes(l.name))]
const suggested = found.suggested.filter((s) => !(s.kind === 'layer' ? layers : packs).includes(s.name))
const suggestNote = suggested.length ? `; suggested, check it applies: ${suggested.map((s) => `${s.name} (${s.why})`).join('; ')}` : ''
row('stack', notInstalled.length ? 'warn' : 'ok', notInstalled.length
  ? `detected but not installed: ${notInstalled.map((u) => `${u.name} (${u.why})`).join('; ')} — kit-sync --packs/--layers adds them${suggestNote}`
  : `packs=[${packs.join(', ')}] layers=[${layers.join(', ')}] (detection agrees)${suggestNote}`)
// The config and the install record name the same stack (install stops when they disagree).
const cfgStack = project.stack ?? {}
const mismatch = ['packs', 'layers'].filter((k) => Array.isArray(cfgStack[k]) && Array.isArray(inst[k]) && JSON.stringify(cfgStack[k]) !== JSON.stringify(inst[k]))
row('stack record', mismatch.length ? 'warn' : 'ok', mismatch.length
  ? mismatch.map((k) => `kit.config.json stack.${k} [${cfgStack[k].join(', ')}] ≠ .kit/install.json ${k} [${inst[k].join(', ')}]`).join('; ') + ' — a re-install stops until they agree (kit-sync --packs/--layers --apply updates both)'
  : 'kit.config.json and .kit/install.json name the same stack')

// Claude Code hooks: each command's scripts exist
const scriptRefs = (cmd) => [...cmd.matchAll(/(?:^|[\s"'/])(scripts\/[\w./-]+\.(?:mjs|js|sh|py))/g)].map((m) => m[1])
if (has('.claude/settings.json')) {
  let settings = {}
  try {
    settings = readJson(join(target, '.claude/settings.json'))
  } catch (e) {
    row('hook:settings.json', 'fail', `.claude/settings.json is not valid JSON (${e.message})`)
  }
  for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
    for (const e of entries ?? []) {
      for (const h of e.hooks ?? []) {
        const refs = scriptRefs(h.command ?? '')
        const missing = refs.filter((r) => !has(r))
        const name = `hook:${event}${e.matcher ? `(${e.matcher})` : ''}:${refs[0]?.split('/').pop() ?? (h.command ?? '').slice(0, 30)}`
        row(name, missing.length ? 'fail' : 'ok', missing.length ? `missing: ${missing.join(', ')}` : refs.length ? `runs ${refs.join(', ')}` : 'no script to check')
      }
    }
  }
} else row('hook:settings.json', 'fail', '.claude/settings.json not found')

// git hooks
const index = inRepo ? git('ls-files', '-s', '--', '.husky').stdout : ''
for (const f of has('.husky') ? readdirSync(join(target, '.husky')).filter((x) => !x.startsWith('_') && !x.startsWith('.')) : []) {
  const p = `.husky/${f}`
  const text = read(p)
  const problems = []
  if (!text.startsWith('#!')) problems.push('no shebang (git on Windows cannot run it without husky)')
  const mode = new RegExp(`^(\\d+) [0-9a-f]+ \\d\\t${p.replace(/[.]/g, '\\.')}$`, 'm').exec(index)?.[1]
  const runs = [...text.matchAll(/\bnode (scripts\/[\w./-]+)/g)].map((m) => m[1])
  const missing = runs.filter((r) => !has(r))
  if (missing.length) problems.push(`missing: ${missing.join(', ')}`)
  const status = problems.length ? 'fail' : mode && mode !== '100755' ? 'warn' : 'ok'
  row(p, status, problems.length ? problems.join('; ') : mode === '100755' ? `executable in git${runs.length ? `, runs ${runs.join(', ')}` : ''}`
    : mode ? `mode ${mode} in git: git add --chmod=+x ${p}` : 'not committed yet')
}
const hooksPath = inRepo ? git('config', '--get', 'core.hooksPath').stdout.trim() : ''
let pkg = null
try {
  pkg = readJson(join(target, 'package.json'))
} catch { /* no package.json */ }
const husky = /\bhusky\b/.test(pkg?.scripts?.prepare ?? '') && has('node_modules/husky')
row('git hooks enabled', /^\.husky\/?(_)?$/.test(hooksPath) || husky ? 'ok' : 'warn',
  hooksPath ? `core.hooksPath=${hooksPath}` : husky ? 'husky prepare script' : 'inactive in this checkout — git config core.hooksPath .husky (no husky needed)')

// the workflow scripts' own dependencies
if (has('scripts/package.json')) {
  const spkg = readJson(join(target, 'scripts/package.json'))
  const deps = Object.keys({ ...(spkg.dependencies ?? {}), ...(spkg.devDependencies ?? {}) })
  const absent = deps.filter((d) => !has(`scripts/node_modules/${d}`))
  const locked = inRepo && git('ls-files', '--error-unmatch', 'scripts/package-lock.json').status === 0
  row('scripts dependencies', absent.length ? 'warn' : locked ? 'ok' : 'warn', absent.length
    ? `not installed: ${absent.join(', ')} — run npm install inside scripts/`
    : locked ? `${deps.join(', ')} installed, scripts/package-lock.json committed` : `${deps.join(', ')} installed; commit scripts/package-lock.json`)
} else row('scripts dependencies', 'fail', 'scripts/package.json not found')

// runtime ignores
if (has('scripts/local-excludes.mjs') && inRepo) {
  const r = spawnSync(process.execPath, [join(target, 'scripts/local-excludes.mjs'), '--check'], { cwd: target, encoding: 'utf8' })
  row('runtime ignores', r.status === 0 ? 'ok' : 'warn', (r.stdout + r.stderr).trim().split('\n').pop() || `exit ${r.status}`)
} else row('runtime ignores', inRepo ? 'fail' : 'n/a', inRepo ? 'scripts/local-excludes.mjs not found' : 'not a git work tree')

// kit rules loaded
const claude = has('CLAUDE.md') ? read('CLAUDE.md') : ''
const wantImports = ['@AGENTS.md', ...(has('AGENTS.workflow.md') ? ['@AGENTS.workflow.md'] : [])]
const lacking = wantImports.filter((i) => !new RegExp(`^${i.replace(/\./g, '\\.')}\\s*$`, 'm').test(claude))
row('kit rules loaded', !claude ? 'fail' : lacking.length ? 'fail' : 'ok', !claude ? 'CLAUDE.md not found' : lacking.length ? `CLAUDE.md does not import ${lacking.join(', ')}` : `CLAUDE.md imports ${wantImports.join(' + ')}`)

// npm scripts the workflow runs
const scripts = pkg?.scripts ?? null
// ci.testMode if-present / skip: CI needs no test script (the workflow docs still name commands.test).
const named = ['commands.build', 'commands.lint', ...(vals['ci.testMode'] === 'run' ? ['commands.test'] : [])].map((k) => [k, vals[k]]).filter(([, v]) => !isEmpty(v))
const absentScripts = scripts ? named.filter(([, v]) => !(v in scripts)) : named
row('npm scripts', !scripts ? 'warn' : absentScripts.length ? 'warn' : 'ok', !scripts ? 'no package.json'
  : absentScripts.length ? `package.json has no ${absentScripts.map(([k, v]) => `${v} (${k})`).join(', ')}` : named.map(([, v]) => `npm run ${v}`).join(', '))
const dev = vals['commands.dev']
row('frontend dev server', isEmpty(dev) ? 'n/a' : scripts && dev in scripts ? 'ok' : 'fail', isEmpty(dev) ? 'commands.dev not set: slots start no frontend'
  : scripts && dev in scripts ? `npm ${frontendCommand({ script: dev, exec: vals['slots.feExec'], portArgs: vals['slots.fePortArgs'], port: '{port}' }).join(' ')}` : `commands.dev "${dev}" is not a package.json script`)

// workflow doc links
const links = linkProblems(target)
row('workflow doc links', links.length ? 'fail' : 'ok', links.length ? `${links.length} missing, e.g. ${links.slice(0, 3).map((p) => `${p.file}:${p.line} ${p.what}`).join('; ')}` : '0 missing')

// CI workflows
if (has('.github/workflows/ci.yml')) {
  const ci = read('.github/workflows/ci.yml')
  const problems = []
  if (/--prefix\s*$/m.test(ci)) problems.push('"--prefix" with nothing after it')
  if (/^ {2}server-tests:\s*$/m.test(ci) !== !isEmpty(vals['paths.serverRoot'])) problems.push(`server-tests job ${isEmpty(vals['paths.serverRoot']) ? 'without' : 'missing with'} paths.serverRoot`)
  // An overridden ci.yml is the project's: its test job is its own choice.
  if (!overrides.has('.github/workflows/ci.yml') && /^ {2}test:\s*$/m.test(ci) === (vals['ci.testMode'] === 'skip')) problems.push(`test job ${vals['ci.testMode'] === 'skip' ? 'present with' : 'missing without'} ci.testMode skip`)
  row('CI workflows', problems.length ? 'fail' : 'ok', problems.length ? problems.join('; ') : `ci.yml: install "${vals['ci.install']}", lint ${vals['ci.lintScope']}, app audit ${vals['ci.appAuditMode']}, tests ${vals['ci.testMode']}`)
} else row('CI workflows', overrides.has('.github/workflows/ci.yml') ? 'n/a' : 'fail', overrides.has('.github/workflows/ci.yml') ? 'ci.yml is an override' : '.github/workflows/ci.yml not found')

row('todo-sync setting', 'manual', 'GitHub: Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests"')
finish()

function finish() {
  const n = (s) => rows.filter((r) => r.status === s).length
  const w = Math.max(...rows.map((r) => r.part.length))
  for (const r of rows) console.log(`${r.part.padEnd(w)}  ${r.status.padEnd(6)}  ${r.evidence}`)
  if (args.markdown) {
    const esc = (s) => String(s).replace(/\|/g, '\\|')
    const md = `# Workflow adoption report\n\nGenerated by \`node tools/adoption-report.mjs\` (ai-workflow-kit).\n\n| Part | Status | Evidence |\n| --- | --- | --- |\n${rows.map((r) => `| \`${esc(r.part)}\` | ${r.status} | ${esc(r.evidence)} |`).join('\n')}\n`
    writeFileSync(resolve(args.markdown), md, 'utf8')
  }
  const summary = `${n('ok')} ok, ${n('warn')} warn, ${n('fail')} fail, ${n('manual')} manual, ${n('n/a')} n/a`
  console.log(n('fail') ? `ADOPTION_REPORT: FAIL — ${summary}` : `ADOPTION_REPORT: ok — ${summary}`)
  process.exit(n('fail') ? 1 : 0)
}
