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
 * local-only kept, conflict never overwritten, --apply updates only new + kit-update, overrides never written) and its
 * clean-up of files the kit stopped shipping (a missing one's record dropped on --apply; --prune deletes an unchanged
 * managed file and releases an edited one or a seed; overrides untouched).
 * Adopt: an existing project gets only .kit/install.json and a clean sync; a second adopt or one with drift is refused.
 * A seed the kit now manages: a customised copy is a conflict --apply never overwrites. Every path /plan and the
 * workflow-map /plan row load exists in each fixture (packs [] up to angular + node-express).
 * Config-driven runtime: a commands.* full command is refused (install and sync, exit 2); no render doubles
 * `npm run`; a project-owned AGENTS.md gets AGENTS.workflow.md and a CLAUDE.md that imports both; an ignored path
 * is SKIP-IGNORED / `ignored`; the .gitignore skeleton and .git/info/exclude carry the runtime list; ship-prep's
 * sensitive paths, the frontend dev server values (and frontendArgs, built by the shared fe-command.mjs), an i18n folder
 * hotspot and the browser line follow the config; the optional wording keys (project.uiDirection, project.icons.*,
 * commands.logQuery, docs.domainSummary) render the project's lines when set and the generic ones when not.
 * CI and packs: the rendered ci.yml / security.yml with and without paths.serverRoot and in every ci.* mode (ci.testMode
 * run / if-present / skip included; actionlint
 * on each rendered workflow when installed: ACTIONLINT=<path> or on PATH; KIT_REQUIRE_ACTIONLINT=1 makes it required),
 * workflow-link-check on every fixture, no KIT:/PACK: directive left, style rules / prettier seed / pre-commit hooks only
 * from the angular pack, an optional pack seed skipped next to the project's own, and the tech-debt scan + baseline.
 * Exit 0 = ok, 1 = problems (one per line).
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync, statSync, existsSync, cpSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative, resolve } from 'path'
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { fileURLToPath, pathToFileURL } from 'url'
import { builtinModules } from 'module'
import { linkProblems } from './workflow-link-check.mjs'

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
const WORDING = { icons: { library: 'Acme', component: 'AcmeIconComponent', registry: 'src/app/icons.ts' }, logQuery: 'npx acme-logs --since=plan-start --level=error', domainSummary: 'Orders, Refunds, Stock' }
// stack.packs [] names the stack-neutral core explicitly (no stack named at all = install detects one and asks).
const CORE_CFG = { project: { name: 'core-only' }, stack: { packs: [] }, commands: { build: 'build', lint: 'lint', test: 'test' }, hooks: { shellPath: 'bash' } }
const fixtures = [
  // core: an i18n folder (every file under it is a hotspot), a sensitive-path regex that replaces the default, and the CI
  // keys of a project whose lockfile, lint debt and dependency advisories are not its own to fix (no backend).
  { name: 'core', args: [], cfg: { ...CORE_CFG, project: { name: 'core-only', i18nFile: 'src/locales/' }, security: { sensitivePaths: 'only-this' }, ci: { install: 'npm install --no-audit --no-fund', lintScope: 'changed', appAuditMode: 'report', testMode: 'if-present' } } },
  { name: 'angular-cursor', args: ['--packs', 'angular', '--cursor'], cfg: { project: { name: 'ng-app' } } },
  // express: an old backend-only `commands.dev: "dev"` with the kit's default slots.fe* values (install must NOTE it).
  { name: 'express-cursor-chef', args: ['--packs', 'node-express', '--cursor', '--yes-chef'], cfg: { project: { name: 'api-app' }, commands: { build: 'build', lint: 'lint', dev: 'dev' } } },
  // full: a frontend matcher full of characters that would break a quoted render (quotes, backtick, `${`, backslash), and
  // the optional wording keys (an RTL UI, an icon library, a log query, a domain summary) the angular-cursor fixture leaves unset.
  { name: 'angular-express-cursor', args: ['--packs', 'angular,node-express', '--cursor'], cfg: { project: { name: 'full-app', uiLocale: 'Arabic RTL', uiDirection: 'rtl', icons: WORDING.icons }, commands: { build: 'build', lint: 'lint', test: 'test', logQuery: WORDING.logQuery }, docs: { domainSummary: WORDING.domainSummary }, tools: { browser: 'acme-browser' }, slots: { feMatcher: HOSTILE_RE } } },
  // react: the React-Vite pack with the Supabase layer (no backend folder: no server job), and no unit-test job.
  { name: 'react-vite-supabase', args: ['--packs', 'react-vite', '--layers', 'supabase'], cfg: { project: { name: 'rv-app' }, ci: { testMode: 'skip' } } },
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

// The Planner's instructions agree with each other: a prose feature request reaches the review (brief-detection's rule,
// its gate text, and its examples obey the rule's two mechanical tests); option a runs the review and saves nothing;
// option b hands to /plan, save-plan and a slot (take-plan), and nothing says the Planner runs a milestone; /plan, the
// PRD template and save-plan describe one shape (Atomic Sub-tasks, no Verify per milestone, ## Execution Notes, no
// dead Q&A reference); the review block lists fixed:/open: lines and always runs the overlap search.
function plannerDocProblems(dir) {
  const out = []
  const doc = (f) => read(dir, f).replace(/\r\n/g, '\n')
  const need = (f, text, what) => { if (!doc(f).includes(text)) out.push(`${f}: ${what} (missing: ${text})`) }
  const never = (f, re, what) => { const m = doc(f).match(re); if (m) out.push(`${f}: ${what} (found: ${m[0]})`) }
  const bd = '.claude/skills/brief-detection/SKILL.md'
  need(bd, '**A feature request in prose** meets all three:', 'no prose feature-request rule')
  need(bd, '- It is longer than one sentence.', 'prose rule: the sentence test')
  need(bd, '- It does not end with a question mark.', 'prose rule: the question test')
  need(bd, 'Looks like a feature request: {one-line goal}.\na. refine it with a review (default) · b. /plan it · c. just discuss', 'feature request gate text')
  never(bd, /execute \*\*one milestone\*\*|Execute as-is|do not trigger `\/plan`/, 'option a/b still skip the review or run a milestone')
  const rows = Object.fromEntries(doc(bd).split('\n').filter((l) => /^\| [abc] \|/.test(l)).map((l) => [l[2], l]))
  if (!/Architect \+ PM review/.test(rows.a ?? '') || !/Save nothing/.test(rows.a ?? '')) out.push(`${bd}: option a must run the Architect + PM review and save nothing`)
  if (!['/plan', 'save-plan', 'take-plan', 'does not start the work'].every((t) => (rows.b ?? '').includes(t))) out.push(`${bd}: option b must hand to /plan, save-plan and take-plan, and the Planner must not start the work`)
  // Examples: a "feature request" row passes both mechanical tests; a "none" row is a question, one sentence, or a
  // request to run / explain something.
  const examples = doc(bd).split('**Examples**')[1]?.split('\n## ')[0] ?? ''
  const ex = examples.split('\n').filter((l) => /^\| (?!Message|---)/.test(l)).map((l) => l.split('|').map((c) => c.trim()))
  const sentences = (m) => m.split(/(?<=[.!?])\s+/).filter(Boolean).length
  const feature = ex.filter((c) => c[2] === 'feature request')
  const none = ex.filter((c) => /^none\b/.test(c[2]))
  if (feature.length < 2 || none.length < 2) out.push(`${bd}: needs at least two feature-request and two no-gate examples (got ${feature.length} / ${none.length})`)
  for (const [, m] of feature) if (sentences(m) < 2 || m.endsWith('?')) out.push(`${bd}: example "${m}" is marked a feature request but fails the sentence or question test`)
  for (const [, m, gate] of none) if (!(m.includes('?') || sentences(m) < 2 || /^(Run|Check|Explain|Review)\b/.test(m) || gate === 'none (a small change)')) out.push(`${bd}: example "${m}" is marked none but looks like a feature request`)
  need(bd, '- a small change: one file, a typo or a one-line fix', 'prose rule: the small-change exception')
  need(bd, 'also a request phrased as a question', 'prose rule: a question-form request is a question')
  need(bd, 'the one tool call this gate allows before it is done (read-only)', 'the main-folder test is the only tool call before the gate')
  const plan = '.claude/commands/plan.md'
  never(plan, /Verify command per milestone|numbered milestones/, '/plan still asks for milestones + a Verify command the PRD template lacks')
  need(plan, 'fixed: <gap> → <what you changed>', 'review block: fixed: line')
  need(plan, 'open: <gap> — <question for the Human>', 'review block: open: line')
  need(plan, 'Print `no gaps` only when there is no `fixed:` line and no `open:` line', 'review block: no gaps rule')
  need(plan, 'node scripts/plan-name-similarity.mjs --name="<the draft\'s title>" --related --scope=', 'review: overlap search')
  need(plan, 'picks **a** at the `brief-detection` gate', 'review: runs on option a')
  need(plan, '**On a brief (option a at the `brief-detection` gate)** there is no plan file yet.', 'review: a brief is not checked as a plan file')
  need(plan, 'List every other plan you read on one line: `checked: <plan numbers>`.', 'review: overlap hits that are not the same work go on one checked: line')
  const prd = '.claude/references/prd-template.md'
  need(prd, '\n## Execution Notes\n', 'no ## Execution Notes section (plan.md writes rejected gaps there)')
  need(prd, '\n## Atomic Sub-tasks\n', 'no ## Atomic Sub-tasks section')
  never(prd, /Q&A format per the `brief-detection` skill/, 'dead Q&A reference')
  need('.claude/skills/save-plan/SKILL.md', 'Its `## Atomic Sub-tasks` are the milestones', 'save-plan: one plan shape')
  // Plan 038: the number comes from the plan files on every branch, not only from numbered branch names.
  need('.claude/skills/save-plan/SKILL.md', 'every plan file on any local or remote branch', 'save-plan: Phase 1 Number must say plan files on every branch count')
  // Plan 037: a slot merge asks whether the repo already deletes merged branches before deleting one itself.
  for (const f of ['docs/agent/standards-git.md', 'docs/agent/ship-regular.md', 'docs/agent/ship-recovery.md', '.claude/commands/ship.md']) need(f, 'branch-autodelete-check.mjs', 'slot merge must run the branch auto-delete check before deleting the merged branch')
  // The workflow map and the Cursor rule describe the same trigger and routes as the skill.
  const wm = 'docs/agent/workflow-map.md'
  never(wm, /3\+ structured H2|routes to `\/feat` \(option b\)|--routes--> \/feat/, 'workflow map: old brief-detection trigger or option b → /feat')
  need(wm, 'a feature request in prose in the main folder', 'workflow map: brief-detection row names the prose rule')
  const rule = '.cursor/rules/brief-detection-must-use-skill.mdc'
  if (existsSync(join(dir, rule))) {
    never(rule, /3\+ (structured )?H2|3\+ H2 markers/, 'Cursor rule: still loads the skill only on 3+ H2 markers')
    need(rule, 'asks in a few sentences to build,', 'Cursor rule: loads the skill for a prose feature request')
  }
  return out
}

// actionlint (pinned in kit CI, which sets KIT_REQUIRE_ACTIONLINT=1) lints every rendered workflow when available.
const actionlint = process.env.ACTIONLINT || 'actionlint'
const haveActionlint = spawnSync(actionlint, ['-version'], { encoding: 'utf8' }).status === 0
if (!haveActionlint && process.env.KIT_REQUIRE_ACTIONLINT === '1') fail(`actionlint not found (${actionlint}); kit CI must install it`)
let actionlinted = 0

// The rendered CI: backend job and steps only with paths.serverRoot; ci.install / ci.lintScope / ci.appAuditMode as set.
function ciProblems(dir, fx) {
  const out = []
  const ci = read(dir, '.github/workflows/ci.yml').replace(/\r\n/g, '\n')
  const sec = read(dir, '.github/workflows/security.yml').replace(/\r\n/g, '\n')
  const has = (text, ...lines) => text.includes(lines.join('\n'))
  const backend = fx.args.join(' ').includes('node-express')
  const lintJob = ci.split('\n  lint:\n')[1]?.split('\n  build:\n')[0] ?? ''
  if (/--prefix\s*$/m.test(ci + sec)) out.push('a workflow renders "--prefix" with nothing after it')
  if (backend !== /^ {2}server-tests:$/m.test(ci) || backend !== /^ {6}- server-tests$/m.test(ci) || backend !== ci.includes('needs.server-tests.result')) {
    out.push(`ci.yml server-tests job, gate needs and gate check must all be ${backend ? 'present' : 'absent'} (paths.serverRoot ${backend ? 'set' : 'empty'})`)
  }
  if (!backend && /Install server|npm audit \(server\)|working-directory: server/.test(sec)) out.push('security.yml has a server step without paths.serverRoot')
  if (backend && !has(sec, '      - name: Install server', '        run: npm ci', '        working-directory: server/')) out.push('security.yml lost the server install step')
  if (backend && !has(sec, '      - name: npm audit (server)', '        run: npm audit --omit=dev --audit-level=critical', '        working-directory: server/')) out.push('security.yml lost the server audit')
  const install = (fx.ci ?? fx.cfg.ci)?.install ?? 'npm ci'
  // lint, build and test install the app (no test job with ci.testMode skip).
  if (ci.split(`        run: ${install}\n`).length - 1 < ((fx.ci ?? fx.cfg.ci)?.testMode === 'skip' ? 2 : 3) || !sec.includes(`        run: ${install}\n`)) out.push(`ci.yml / security.yml do not install with ci.install "${install}"`)
  if ((fx.ci ?? fx.cfg.ci)?.lintScope === 'changed') {
    const ok = lintJob.includes('name: ESLint (changed files)') && !lintJob.includes('run: npm run lint') && lintJob.includes('fetch-depth: 0') &&
      lintJob.includes("git -c core.quotePath=false diff -z --name-only --diff-filter=d \"$BASE\" HEAD -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' > \"$LIST\"") &&
      lintJob.includes("BASE=\"$(git rev-parse --verify 'HEAD^1')\"") && lintJob.includes('PUSH_BEFORE: ${{ github.event.before }}') &&
      lintJob.includes("git rev-parse -q --verify 'HEAD~1'") && lintJob.includes('nothing to lint') &&
      lintJob.includes("Object.keys(require('./.kit/install.json').files || {})")
    if (!ok) out.push('ci.yml lintScope changed: lint must be ESLint on the changed files (PR HEAD^1, push before, HEAD~1 fallback, none = pass, kit files left out)')
  } else if (!has(lintJob, '      - name: ESLint', '        run: npm run lint') || lintJob.includes('changed files')) out.push('ci.yml lintScope all: lint must run npm run <commands.lint> on the whole repo')
  const cut = sec.indexOf('npm audit (workflow scripts')
  const audits = cut < 0 ? sec : sec.slice(0, cut)
  const scriptsAudit = cut < 0 ? '' : sec.slice(cut + 'npm audit (workflow scripts'.length)
  if ((fx.ci ?? fx.cfg.ci)?.appAuditMode === 'report') {
    if (!audits.includes('set +e') || !audits.includes('>> "$GITHUB_STEP_SUMMARY"') || !audits.includes('::warning') || audits.includes('--audit-level')) out.push('security.yml report mode: set +e, job summary and a warning, no enforced app audit')
  } else if (!has(audits, '      - name: npm audit (root)', '        run: npm audit --omit=dev --audit-level=critical') || audits.includes('set +e')) out.push('security.yml enforce mode must keep the critical production audit')
  // The kit-managed scripts/ dependencies: a kit release fixes them, so their audit only reports.
  const scriptsStep = scriptsAudit.split('Semgrep')[0]
  if (!scriptsAudit.startsWith(', report only)') || !scriptsStep.includes("if: hashFiles('scripts/package-lock.json') != ''") || !scriptsStep.includes('working-directory: scripts') ||
    !scriptsStep.includes('set +e') || !scriptsStep.includes('>> "$GITHUB_STEP_SUMMARY"') || !scriptsStep.includes('exit 0') || scriptsStep.includes('--audit-level')) out.push('security.yml: the scripts/ dependency audit must be report-only (set +e, summary, warning, exit 0)')
  // ci.testMode: run = `npm run <commands.test>` (the job as before), if-present = with --if-present, skip = no test job
  // and nothing that needs it.
  const testMode = (fx.ci ?? fx.cfg.ci)?.testMode ?? 'run'
  const testJob = ci.split('\n  test:\n')[1]?.split(/\n {2}[\w-]+:\n/)[0] ?? ''
  if (testMode === 'skip') {
    if (testJob || /^ {6}- test$/m.test(ci) || ci.includes('needs.test.result')) out.push('ci.yml testMode skip: no test job, no gate need, no gate check')
  } else {
    const line = testMode === 'if-present' ? '        run: npm run --if-present test' : '        run: npm run test'
    if (!has(testJob, '      - name: Unit tests', line) || !/^ {6}- test$/m.test(ci) || !ci.includes('needs.test.result')) out.push(`ci.yml testMode ${testMode}: the test job must run "${line.trim()}" and the gate must need it`)
    if (testMode === 'run' && testJob.includes('--if-present')) out.push('ci.yml testMode run: the test job must not pass on a missing script')
  }
  if (!has(lintJob, '      - name: Install workflow script dependencies', "        if: hashFiles('scripts/package-lock.json') != ''", '        working-directory: scripts')) out.push('ci.yml must install the scripts/ dependencies inside scripts/ before the workflow script tests')
  // Required-step markers (plan 031): the record lists them, each sits directly above its step, and the lint job checks overrides.
  const MARK = '# KIT:required — a project override must keep this step'
  const inst = JSON.parse(read(dir, '.kit/install.json'))
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  if (!same(inst.required?.['.github/workflows/ci.yml'], ['Install workflow script dependencies', 'Kit override check', 'Workflow script tests', 'Secret scan (gitleaks)', 'Require quality gates'])) out.push(`.kit/install.json required[ci.yml] is ${JSON.stringify(inst.required?.['.github/workflows/ci.yml'])}`)
  if (!same(inst.required?.['.github/workflows/security.yml'], ['npm audit (workflow scripts, report only)', 'Semgrep OWASP Top Ten'])) out.push(`.kit/install.json required[security.yml] is ${JSON.stringify(inst.required?.['.github/workflows/security.yml'])}`)
  for (const [name, text] of [['ci.yml', ci], ['security.yml', sec]]) {
    const ls = text.split('\n')
    ls.forEach((l, i) => {
      if (/^\s*#\s*KIT:required\b/.test(l) && (l !== MARK || !/^ +- name: /.test(ls[i + 1] ?? ''))) out.push(`${name}:${i + 1}: a KIT:required marker must be "${MARK}" directly above a "- name:" line`)
    })
  }
  if (!has(lintJob, '      - name: Kit override check', '        run: node scripts/override-check.mjs') || lintJob.indexOf('Install workflow script dependencies') > lintJob.indexOf('Kit override check')) out.push('ci.yml lint job must run node scripts/override-check.mjs (step Kit override check) after Install workflow script dependencies')
  if (!read(dir, '.claude/commands/ship.md').includes('node scripts/override-check.mjs')) out.push('/ship Phase 1 must list node scripts/override-check.mjs among the build-gate commands')
  if (haveActionlint) {
    const wf = readdirSync(join(dir, '.github/workflows')).filter((x) => /\.ya?ml$/.test(x)).map((x) => join(dir, '.github/workflows', x))
    const r = spawnSync(actionlint, ['-no-color', ...wf], { encoding: 'utf8' })
    actionlinted += wf.length
    if (r.status !== 0) out.push(`actionlint: ${(r.stdout + r.stderr).trim().split('\n').slice(0, 6).join(' | ')}`)
  }
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
  for (const p of plannerDocProblems(dir)) fail(`${fx.name}: Planner docs: ${p}`)
  for (const p of ciProblems(dir, fx)) fail(`${fx.name}: ${p}`)
  // Every path, `node scripts/…` and `npm run …` the workflow docs name exists (packs [] too: no dangling pack file).
  for (const p of linkProblems(dir)) fail(`${fx.name}: link check: ${p.file}:${p.line}: ${p.what}`)
  // No KIT:if/else/end or PACK:<name> directive line survives a render (a `PACK:stack — …` note may: it is prose).
  const directive = /^[ \t]*(?:#|<!--)[ \t]*(?:KIT:(?:if|else|end)\b|PACK:[\w:.-]+[ \t]*(?:-->)?[ \t]*$)/m
  for (const f of all) if (directive.test(read(dir, f))) fail(`${fx.name}: ${f} keeps a KIT:/PACK: directive line`)
  // Style rules come from the pack; core only says to match the file's style.
  const feat = read(dir, '.claude/commands/feat.md')
  const angular = fx.args.join(' ').includes('angular')
  if (!feat.includes('Match the file\'s existing style; never reformat untouched lines.')) fail(`${fx.name}: /feat lost the match-existing-style rule`)
  if (angular !== feat.includes('- No semicolons in `.ts` files. Single quotes in TS, double quotes in HTML.')) fail(`${fx.name}: the /feat style rules must come from the angular pack, and only from it`)
  if (angular !== all.includes('.prettierrc.json')) fail(`${fx.name}: .prettierrc.json must be an angular pack seed only`)
  const preCommit = read(dir, '.husky/pre-commit')
  if (angular !== preCommit.includes('node scripts/pre-commit-no-semi.mjs\nnode scripts/pre-commit-secret-scan.mjs\nnode scripts/pre-commit-security-grep.mjs\n')) fail(`${fx.name}: the angular pre-commit hooks (no-semi before the secret scan, security grep after) are wrong`)
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
    if (fx.name === 'react-vite-supabase') {
      // Vite: npm run dev -- --port N --strictPort (a taken port is an error, never the next free port).
      if (fe.FE_SCRIPT !== 'dev' || fe.FE_EXEC.length || fe.FE_PORT_ARGS.join(' ') !== '--port {port} --strictPort' || !fe.FE_MATCHER.test('node /x/node_modules/vite/bin/vite.js --port 5174 --strictPort') || fe.FE_MATCHER.test('node server.js') || fe.FE_ENV_FILE) fail(`${fx.name}: frontend values do not come from the react-vite pack: ${JSON.stringify(fe)}`)
      if (!sens('supabase/functions/_shared/cors.ts') || !sens('supabase/config.toml') || sens('src/pages/Home.tsx')) fail(`${fx.name}: the supabase layer's sensitive-path globs must add to the built-in ones`)
    }
  } catch (e) {
    fail(`${fx.name}: could not evaluate the rendered config constants: ${e.message}`)
  }
  // The slot frontend command comes from the shared builder (scripts/lib/fe-command.mjs, also the adoption report's).
  const procs = read(dir, 'scripts/lib/slot-procs.mjs')
  if (!procs.includes("import { frontendCommand } from './fe-command.mjs'") || procs.includes("['exec', '--'")) fail(`${fx.name}: slot-procs.mjs must build the frontend command with fe-command.mjs, not its own copy`)
  try {
    const { frontendArgs } = await import(pathToFileURL(join(dir, 'scripts/lib/slot-procs.mjs')).href)
    const want = { core: 'run  -- --port 4321', 'angular-cursor': 'exec -- ng serve -c slot --port 4321', 'react-vite-supabase': 'run dev -- --port 4321 --strictPort' }[fx.name]
    if (want && frontendArgs(4321).join(' ') !== want) fail(`${fx.name}: slot-procs frontendArgs(4321) is "${frontendArgs(4321).join(' ')}", expected "${want}"`)
  } catch (e) {
    fail(`${fx.name}: could not import the rendered slot-procs.mjs: ${e.message}`)
  }
  const claude = read(dir, 'CLAUDE.md')
  if (fx.args.includes('--yes-chef') !== claude.includes('Yes chef!')) fail(`${fx.name}: Yes chef! gate must appear only with --yes-chef`)
  const agents = read(dir, 'AGENTS.md')
  if (fx.name === 'angular-express-cursor' && !agents.includes('- Browser tool: acme-browser. Default: hand the Human')) fail(`${fx.name}: a configured tools.browser must be named in AGENTS.md`)
  // Optional wording keys: set (full fixture) = the project's wording; unset = the generic kit lines, unchanged.
  if (fx.args.join(' ').includes('angular')) {
    const set = fx.name === 'angular-express-cursor'
    const css = read(dir, '.claude/skills/cssLayer/SKILL.md')
    const comp = read(dir, '.claude/skills/angularComponentStructure/SKILL.md')
    const conv = read(dir, 'docs/agent/conventions.md')
    const std = read(dir, 'docs/agent/standards-angular.md')
    const want = set
      ? [[css, 'The UI is Arabic RTL; physical `left`/`right` breaks mirroring.'], [comp, '  imports: [TranslatePipe, AcmeIconComponent],'],
        [comp, '- Register every Acme icon the template uses in `src/app/icons.ts` before using it'], [conv, '* Acme icons used in templates must be registered in `src/app/icons.ts` before use.'],
        [std, '* **Logic**: Orders, Refunds, Stock.\n']]
      : [[css, 'Physical `left`/`right` break mirroring when the UI runs right-to-left.'], [comp, '  imports: [TranslatePipe, IconComponent],'],
        [comp, '- Register every icon the template uses with the project icon registry before using it'], [conv, "* Icons used in templates must be registered with the project's icon registry before use."],
        [std, '* **Logic**: project-specific domain rules live in `(not set)`, not here.']]
    for (const [text, line] of want) if (!text.includes(line)) fail(`${fx.name}: ${set ? 'a set' : 'an unset'} wording key must render "${line.trim()}"`)
  }
  const review = read(dir, '.claude/commands/review-it.md')
  const logs = fx.name === 'angular-express-cursor'
  if (logs !== review.includes(`   - **Logs**: Run \`${WORDING.logQuery}\`. Any entry not explained by the plan fails the review.`) || logs !== review.includes(`| Logs | PASS/FAIL | ${WORDING.logQuery} |`) || (!logs && review.includes('Logs'))) fail(`${fx.name}: /review-it must have the Logs check only with commands.logQuery`)
  if (fx.name === 'angular-cursor') {
    if (!agents.includes('Signals only')) fail(`${fx.name}: AGENTS.md is missing the angular pack's hard rules`)
    if (!agents.includes('angularComponentStructure')) fail(`${fx.name}: AGENTS.md is missing the angular skill triggers`)
    if (!all.some((f) => f.startsWith('.cursor/'))) fail(`${fx.name}: --cursor installed no .cursor files`)
    if (!read(dir, '.cursor/rules/security.mdc').includes('src/app/core/guards/**')) fail(`${fx.name}: security.mdc globs not filled from the pack`)
    if (!read(dir, '.husky/pre-commit').includes('pre-commit-no-semi.mjs')) fail(`${fx.name}: pre-commit lost the angular hook`)
  }
  // React-Vite pack + Supabase layer: their rules, skills, contract keys, fragments and tech-debt rules, and nothing of
  // the angular or node-express packs.
  if (fx.name === 'react-vite-supabase') {
    const want = ['docs/agent/standards-react.md', 'docs/agent/conventions.md', 'docs/agent/standards-supabase.md', '.claude/skills/react-component-structure/SKILL.md',
      '.claude/skills/cssLayer/SKILL.md', '.claude/skills/auth-and-logging/SKILL.md', 'docs/brain/gotchas/react-vite.md', 'docs/brain/gotchas/supabase.md']
    for (const f of want) if (!all.includes(f)) fail(`${fx.name}: ${f} not installed`)
    for (const f of all) if (/standards-angular|angularComponentStructure|breadcrumbs|standards-backend\.md|pull-copy|layer\.json|pack\.json|FRAGMENTS\.md/.test(f)) fail(`${fx.name}: ${f} must not be installed`)
    if (!agents.includes('Server state through the query library') || !agents.includes('row-level security is the access control') || !agents.includes('react-component-structure/SKILL.md')) fail(`${fx.name}: AGENTS.md lacks the react-vite / supabase hard rules or skill triggers`)
    if (agents.includes('Signals only')) fail(`${fx.name}: AGENTS.md carries angular rules`)
    const fix = read(dir, '.claude/commands/fix.md')
    if (!fix.includes('| `css` | `docs/agent/standards-react.md` (Styling: Tailwind and component primitives section) + `cssLayer` skill |') ||
      !fix.includes('`docs/agent/standards-supabase.md`')) fail(`${fx.name}: /fix does not load the react-vite styling section and the supabase backend doc`)
    if (!read(dir, '.claude/commands/refactor.md').includes('- `react-component-structure` skill')) fail(`${fx.name}: /refactor lacks the react-vite loads fragment`)
    if (!read(dir, 'docs/agent/workflow-map.md').includes('| `react-component-structure` | creating or reviewing')) fail(`${fx.name}: workflow-map.md lacks the react-vite skill rows`)
    if (!read(dir, '.claude/skills/techdebt/SKILL.md').includes('`inner-html`')) fail(`${fx.name}: the techdebt skill lacks the react-vite fragment`)
    if (!read(dir, '.claude/skills/auth-and-logging/SKILL.md').includes('Server side (access rules, server functions): `docs/agent/standards-supabase.md`.')) fail(`${fx.name}: auth-and-logging does not point at the supabase backend doc`)
    if (!read(dir, '.claude/commands/docs-refresh.md').includes('No stack pack in this project ships a docs-map skill')) fail(`${fx.name}: /docs-refresh must fall back without a docs-map skill`)
  } else if (all.some((f) => /standards-react|react-component-structure|standards-supabase|pull-copy/.test(f))) fail(`${fx.name}: react-vite / layer files installed without --packs react-vite / --layers`)
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

// Files the kit stopped shipping (records with no planned file). A missing one's record is dropped on every --apply; the
// rest stay `removed-from-kit` and on disk until --prune: an unchanged managed file is deleted (a CRLF checkout of it
// too), an edited one and a seed are kept with their records dropped (`released`). Never touched: an override, an
// upstream-owned path (ownership.upstreamPaths), a record outside the project, and a case-only rename of a shipped file
// (its record is dropped, the file stays). Dry-runs print what --prune would do.
{
  const pr = tmp('prune')
  writeFileSync(join(pr, 'kit.config.json'), JSON.stringify(CORE_CFG))
  run('install.mjs', ['--target', pr])
  const instPath = join(pr, '.kit/install.json')
  const inst = JSON.parse(readFileSync(instPath, 'utf8'))
  const sha = (t) => createHash('sha256').update(t).digest('hex')
  const old = { unchanged: 'old/unchanged.md', edited: 'old/edited.md', seed: 'old/seed.md', override: 'old/override.md', missing: 'old/missing.md', crlf: 'old/crlf.md', upstream: 'old/upstream.md' }
  mkdirSync(join(pr, 'old'))
  for (const k of ['unchanged', 'edited', 'seed', 'override', 'upstream']) writeFileSync(join(pr, old[k]), `# ${k}\n`)
  writeFileSync(join(pr, old.crlf), '# crlf\r\nline two\r\n') // the kit wrote LF; a CRLF checkout of it is still unchanged
  inst.files[old.unchanged] = { sha256: sha('# unchanged\n'), kind: 'managed', source: `core/${old.unchanged}` }
  inst.files[old.edited] = { sha256: sha('# as the kit shipped it\n'), kind: 'managed', source: `core/${old.edited}` }
  inst.files[old.seed] = { sha256: sha('# seed\n'), kind: 'seed', source: `templates/${old.seed}` }
  inst.files[old.override] = { sha256: sha('# override\n'), kind: 'managed', source: `core/${old.override}` }
  inst.files[old.missing] = { sha256: sha('# gone\n'), kind: 'managed', source: `core/${old.missing}` }
  inst.files[old.crlf] = { sha256: sha('# crlf\nline two\n'), kind: 'managed', source: `core/${old.crlf}` }
  inst.files[old.upstream] = { sha256: sha('# upstream\n'), kind: 'managed', source: `core/${old.upstream}` }
  // Outside the project: an unchanged file next to the target, recorded as ../<name>.
  const outsideName = `${pr.split(/[\\/]/).pop()}-outside.md`
  const outsideFile = join(pr, '..', outsideName)
  writeFileSync(outsideFile, '# outside\n')
  inst.files[`../${outsideName}`] = { sha256: sha('# outside\n'), kind: 'managed', source: 'core/x.md' }
  // A case-only rename: the kit ships scripts/todo-query.mjs, the record says Scripts/Todo-Query.mjs with the same content.
  // On a case-insensitive file system that name IS the shipped file; it must never be deleted.
  const shipped = 'scripts/todo-query.mjs'
  const shippedText = read(pr, shipped)
  inst.files['Scripts/Todo-Query.mjs'] = { sha256: sha(shippedText), kind: 'managed', source: 'core/Scripts/Todo-Query.mjs' }
  writeFileSync(instPath, JSON.stringify(inst, null, 2))
  writeFileSync(join(pr, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, overrides: [{ path: old.override, reason: 'install-check: kept by the project' }], ownership: { upstreamPaths: [old.upstream] } }))
  const files = () => JSON.parse(readFileSync(instPath, 'utf8')).files
  const recorded = () => Object.keys(files()).filter((f) => f.startsWith('old/')).sort().join(',')
  const onDisk = () => readdirSync(join(pr, 'old')).sort().join(',')
  const lines = (r) => r.stdout.trim().split('\n').filter((l) => /old\/|outside|Todo-Query|KIT_SYNC/.test(l)).join(' | ')
  const outsideNote = `NOTE ../${outsideName} is recorded in .kit/install.json but lies outside the project: left alone`
  const dry = run('sync.mjs', ['--target', pr])
  if (!dry.stdout.includes(`pruned           ${old.missing} — already deleted: record dropped (on --apply)`) || !dry.stdout.includes(`removed-from-kit ${old.unchanged}`) ||
    !dry.stdout.includes(`NOTE --prune would delete ${old.unchanged}: deleted (unchanged since install)`) || !dry.stdout.includes(`NOTE --prune would keep ${old.edited}: kept, record dropped (edited`) ||
    !dry.stdout.includes(`NOTE --prune would keep ${old.seed}: kept, record dropped (a seed`) || !dry.stdout.includes(`NOTE --prune would delete ${old.crlf}: deleted (unchanged since install)`) ||
    !dry.stdout.includes(`pruned           Scripts/Todo-Query.mjs — case-only rename of ${shipped}: record dropped, file left alone (on --apply)`) ||
    !dry.stdout.includes(outsideNote) || /old\/(override|upstream)\.md —|would \w+ old\/(override|upstream)/.test(dry.stdout) ||
    !/ 4 removed-from-kit, 0 overrides, 2 pruned \(nothing written/.test(dry.stdout) || recorded() !== Object.values(old).sort().join(',')) fail(`sync dry-run with files the kit stopped shipping: ${lines(dry)}`)
  const ap = run('sync.mjs', ['--target', pr, '--apply'])
  const keptAll = 'crlf.md,edited.md,override.md,seed.md,unchanged.md,upstream.md'
  if (recorded() !== [old.crlf, old.edited, old.override, old.seed, old.unchanged, old.upstream].sort().join(',') || onDisk() !== keptAll || files()['Scripts/Todo-Query.mjs'] ||
    !/applied — .* 4 removed-from-kit, 0 overrides, 2 pruned$/m.test(ap.stdout)) fail(`sync --apply without --prune must drop only the missing and renamed records and delete nothing: recorded ${recorded()}, on disk ${onDisk()}: ${lines(ap)}`)
  if (!existsSync(join(pr, shipped)) || read(pr, shipped) !== shippedText) fail('sync --apply deleted or changed a shipped file behind a case-only rename record')
  const pdry = run('sync.mjs', ['--target', pr, '--prune'])
  if (!pdry.stdout.includes(`pruned           ${old.unchanged} — deleted (unchanged since install) (on --apply)`) || !pdry.stdout.includes(`pruned           ${old.crlf} — deleted (unchanged since install) (on --apply)`) ||
    !pdry.stdout.includes(`released         ${old.edited} — kept, record dropped (edited`) || !pdry.stdout.includes(`released         ${old.seed} — kept, record dropped (a seed`) ||
    !/ 0 removed-from-kit, 0 overrides, 2 pruned, 2 released \(nothing written/.test(pdry.stdout) || onDisk() !== keptAll || recorded().split(',').length !== 6) fail(`sync --prune dry-run: ${lines(pdry)}`)
  const pap = run('sync.mjs', ['--target', pr, '--prune', '--apply'])
  if (recorded() !== [old.override, old.upstream].join(',') || onDisk() !== 'edited.md,override.md,seed.md,upstream.md' || read(pr, old.edited) !== '# edited\n' || read(pr, old.override) !== '# override\n' ||
    read(pr, old.upstream) !== '# upstream\n' || !existsSync(outsideFile) || !files()[`../${outsideName}`] || !pap.stdout.includes(outsideNote) ||
    !/applied — .* 0 removed-from-kit, 0 overrides, 2 pruned, 2 released$/m.test(pap.stdout)) fail(`sync --prune --apply: recorded ${recorded()}, on disk ${onDisk()}, outside kept ${existsSync(outsideFile)}: ${lines(pap)}`)
  const after = run('sync.mjs', ['--target', pr])
  if (!/dry-run — 0 new, 0 kit-update, 0 conflicts, 0 local-only, 0 deleted-locally, 0 removed-from-kit, 0 overrides \(nothing written/.test(after.stdout) || /NOTE override old\/upstream/.test(after.stdout)) fail(`sync after --prune: ${lines(after)}`)
  rmSync(pr, { recursive: true, force: true })
  rmSync(outsideFile, { force: true })
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

// .kit/config.json: the project config of a project whose kit.config.json is something else (the kit repo: its
// scaffold). Install, sync and drift-check read it before kit.config.json; install leaves kit.config.json alone.
{
  const dk = tmp('dotkit-config')
  const scaffold = JSON.stringify({ $comment: 'not this project\'s config', project: { name: 'scaffold-name' } })
  writeFileSync(join(dk, 'kit.config.json'), scaffold)
  mkdirSync(join(dk, '.kit'), { recursive: true })
  const dkCfg = (name) => writeFileSync(join(dk, '.kit', 'config.json'), JSON.stringify({ ...CORE_CFG, project: { name } }))
  dkCfg('dotkit-app')
  const r = run('install.mjs', ['--target', dk])
  const agents = r.status === 0 ? read(dk, 'AGENTS.md') : ''
  if (r.status !== 0 || !agents.includes('dotkit-app') || agents.includes('scaffold-name')) fail(`install with .kit/config.json: exit ${r.status}, AGENTS.md names ${agents.includes('dotkit-app') ? 'dotkit-app' : 'not dotkit-app'}: ${(r.stdout + r.stderr).trim().split('\n').pop()}`)
  if (read(dk, 'kit.config.json') !== scaffold) fail('install with .kit/config.json rewrote kit.config.json')
  const s = run('sync.mjs', ['--target', dk])
  if (s.status !== 0 || !/dry-run — 0 new, 0 kit-update, 0 conflicts/.test(s.stdout)) fail(`sync with .kit/config.json right after install: ${(s.stdout + s.stderr).trim().split('\n').pop()}`)
  const d = run('drift-check.mjs', ['--target', dk])
  if (d.status !== 0) fail(`drift-check with .kit/config.json right after install: exit ${d.status}, ${d.stdout.trim().split('\n').pop()}`)
  dkCfg('dotkit-renamed')
  const s2 = run('sync.mjs', ['--target', dk])
  if (!/dry-run — 0 new, [1-9]\d* kit-update/.test(s2.stdout)) fail(`sync did not see a value changed in .kit/config.json: ${s2.stdout.trim().split('\n').pop()}`)
  rmSync(dk, { recursive: true, force: true })
}

// The kit installed into itself (source folder = target): install.json records "local:." (no machine path), and
// sync / drift-check resolve it against the target.
{
  const self = tmp('self-install')
  for (const p of ['core', 'packs', 'layers', 'templates', 'kit.json', 'kit.config.json', '.gitattributes']) cpSync(join(kit, p), join(self, p), { recursive: true })
  mkdirSync(join(self, '.kit'), { recursive: true })
  // The kit keeps its own .gitattributes (install skips an existing one; without the override drift-check flags it).
  writeFileSync(join(self, '.kit', 'config.json'), JSON.stringify({ ...CORE_CFG, project: { name: 'self-kit' }, overrides: [{ path: '.gitattributes', reason: 'the kit repo keeps its own' }] }))
  const r = run('install.mjs', ['--target', self, '--source', self])
  const src = r.status === 0 ? JSON.parse(read(self, '.kit/install.json')).source : null
  if (r.status !== 0 || src !== 'local:.') fail(`self-install: exit ${r.status}, recorded source ${src}, expected local:.: ${(r.stdout + r.stderr).trim().split('\n').pop()}`)
  const d = run('drift-check.mjs', ['--target', self])
  if (d.status !== 0) fail(`drift-check of a self-install: exit ${d.status}, ${d.stdout.trim().split('\n').pop()}`)
  const s = run('sync.mjs', ['--target', self])
  if (s.status !== 0 || !/dry-run — 0 new, 0 kit-update, 0 conflicts/.test(s.stdout)) fail(`sync of a self-install: ${(s.stdout + s.stderr).trim().split('\n').pop()}`)
  rmSync(self, { recursive: true, force: true })
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

// An optional pack seed is not written next to the project's own equivalent: the angular .prettierrc.json is
// SKIP-PRESENT when the project has a prettier.config.js (install) and a NOTE, never `new`, in sync.
{
  const pr = tmp('prettier')
  writeFileSync(join(pr, 'kit.config.json'), JSON.stringify({ project: { name: 'styled-app' }, hooks: { shellPath: 'bash' } }))
  writeFileSync(join(pr, 'prettier.config.js'), 'module.exports = { semi: true }\n')
  const r = run('install.mjs', ['--target', pr, '--packs', 'angular'])
  if (r.status !== 0 || !r.stdout.includes('SKIP-PRESENT .prettierrc.json (the project has prettier.config.js)') || existsSync(join(pr, '.prettierrc.json'))) fail(`install next to a prettier.config.js: ${(r.stdout + r.stderr).trim().split('\n').pop()}`)
  const s = run('sync.mjs', ['--target', pr])
  if (!s.stdout.includes('NOTE .prettierrc.json not written: the project has prettier.config.js') || !/dry-run — 0 new, 0 kit-update, 0 conflicts/.test(s.stdout)) fail(`sync next to a prettier.config.js: ${s.stdout.trim().split('\n').pop()}`)
  rmSync(pr, { recursive: true, force: true })
}

// Tech-debt scan: core rules on .ts/.tsx/.jsx/.html/.css, the angular pack's rules on top, kit-managed files left out,
// a baseline, NEW_DEBT yes|no and --strict.
for (const [name, packArgs] of [['core', []], ['angular', ['--packs', 'angular']], ['react', ['--packs', 'react-vite', '--layers', 'supabase']]]) {
  const td = tmp(`techdebt-${name}`)
  writeFileSync(join(td, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, project: { name: `td-${name}` } }))
  run('install.mjs', ['--target', td, ...packArgs])
  mkdirSync(join(td, 'src', 'app'), { recursive: true })
  writeFileSync(join(td, 'src/app/a.component.ts'), 'export class A {\n  @Input() x: any;\n  s = new BehaviorSubject(1)\n}\n')
  writeFileSync(join(td, 'src/app/b.tsx'), 'export const B = () => { console.log(1) } // TODO tidy\n')
  writeFileSync(join(td, 'src/app/c.jsx'), '// eslint-disable-next-line\n' + 'export const c = 1\n'.repeat(301))
  writeFileSync(join(td, 'src/app/d.html'), '<!-- FIXME -->\n')
  writeFileSync(join(td, 'src/app/e.css'), '/* TODO */\n')
  // React-Vite + Supabase rules: a page with each; supabase.from( outside pages/components is not a ui-table-call.
  if (name === 'react') {
    mkdirSync(join(td, 'src/app/pages'), { recursive: true })
    mkdirSync(join(td, 'src/app/lib'), { recursive: true })
    writeFileSync(join(td, 'src/app/pages/g.tsx'), "import { create } from 'zustand'\nexport const G = () => <div dangerouslySetInnerHTML={{ __html: h }} />\nconst r = fetch(url)\nconst q = supabase.from('t')\n")
    writeFileSync(join(td, 'src/app/lib/h.ts'), "export const q = supabase.from('t')\nexport const r = api.fetch(1)\n")
  }
  const scan = (...a) => spawnSync(process.execPath, [join(td, 'scripts/techdebt-report.mjs'), 'scan', ...a], { cwd: td, encoding: 'utf8' })
  const count = (out, id) => Number(new RegExp(`^\\| ${id} \\| [^|]+ \\| (\\d+) \\|`, 'm').exec(out)?.[1] ?? -1)
  const first = scan()
  const want = { any: 1, 'console-log': 1, todo: 3, 'eslint-disable': 1, 'big-file': 1, ...(name === 'angular' ? { 'legacy-decorator': 1, 'behavior-subject': 1, semicolon: 1 } : {}),
    ...(name === 'react' ? { 'inner-html': 1, 'banned-state': 1, 'raw-fetch': 1, 'ui-table-call': 1 } : {}) }
  const got = Object.fromEntries(Object.keys(want).map((id) => [id, count(first.stdout, id)]))
  if (JSON.stringify(got) !== JSON.stringify(want) || !first.stdout.includes(`SCAN: ${name === 'react' ? 7 : 5} source files`) || !first.stdout.includes('NEW_DEBT: unknown')) fail(`techdebt scan (${name}): ${JSON.stringify(got)} vs ${JSON.stringify(want)}: ${first.stdout.trim().split('\n')[0]} / ${first.stderr.trim()}`)
  if (name !== 'angular' && /legacy-decorator|behavior-subject|semicolon/.test(first.stdout)) fail(`techdebt scan (${name}): angular rules without the angular pack`)
  if (name !== 'react' && /inner-html|banned-state|raw-fetch|ui-table-call/.test(first.stdout)) fail(`techdebt scan (${name}): react-vite / supabase rules without them`)
  const base = scan('--write-baseline')
  if (!base.stdout.includes('BASELINE: written docs/project/techdebt-baseline.json') || !existsSync(join(td, 'docs/project/techdebt-baseline.json'))) fail(`techdebt scan --write-baseline (${name}): ${base.stdout.trim().split('\n').pop()}`)
  const same = scan('--strict')
  if (same.status !== 0 || !same.stdout.includes('NEW_DEBT: no')) fail(`techdebt scan against an unchanged baseline (${name}): ${same.stdout.trim().split('\n').pop()}`)
  writeFileSync(join(td, 'src/app/f.ts'), 'let y: any = 2\n')
  const worse = scan('--strict')
  if (worse.status !== 1 || !worse.stdout.includes('NEW_DEBT: yes (any +1)')) fail(`techdebt scan with new debt (${name}): exit ${worse.status}, ${worse.stdout.trim().split('\n').pop()}`)
  rmSync(td, { recursive: true, force: true })
}

// ci.* modes outside the allowed set are refused like a full command (exit 2, nothing written); a server/package.json
// with an empty paths.serverRoot gets a NOTE (CI would render no server step).
{
  const cm = tmp('ci-modes')
  writeFileSync(join(cm, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, project: { name: 'core-only', uiDirection: 'right' }, ci: { lintScope: 'changed-only', appAuditMode: 'warn', testMode: 'sometimes' } }))
  const r = run('install.mjs', ['--target', cm])
  if (r.status !== 2 || !r.stderr.includes('ci.lintScope is "changed-only" — allowed: "all", "changed"') || !r.stderr.includes('ci.appAuditMode is "warn" — allowed: "enforce", "report"') ||
    !r.stderr.includes('ci.testMode is "sometimes" — allowed: "run", "if-present", "skip"') || !r.stderr.includes('project.uiDirection is "right" — allowed: "rtl", "ltr"') || files(cm).length !== 1) fail(`install with bad ci.* modes: exit ${r.status}, ${r.stderr.trim().split('\n')[0]}`)
  writeFileSync(join(cm, 'kit.config.json'), JSON.stringify(CORE_CFG))
  mkdirSync(join(cm, 'server'))
  writeFileSync(join(cm, 'server/package.json'), '{ "name": "api" }\n')
  const ok = run('install.mjs', ['--target', cm])
  if (ok.status !== 0 || !ok.stdout.includes('NOTE server/package.json exists but paths.serverRoot is empty')) fail(`install with server/ and no paths.serverRoot: no NOTE: ${ok.stdout.trim().split('\n').pop()}`)
  writeFileSync(join(cm, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, ci: { appAuditMode: 'off' } }))
  const s = run('sync.mjs', ['--target', cm, '--apply'])
  if (s.status !== 2 || !s.stderr.includes('KIT_SYNC: STOP — ci.appAuditMode is "off"')) fail(`sync with a bad ci.appAuditMode: exit ${s.status}, ${s.stderr.trim().split('\n')[0]}`)
  writeFileSync(join(cm, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, ci: { testMode: 'never' } }))
  const t = run('sync.mjs', ['--target', cm, '--apply'])
  if (t.status !== 2 || !t.stderr.includes('KIT_SYNC: STOP — ci.testMode is "never"')) fail(`sync with a bad ci.testMode: exit ${t.status}, ${t.stderr.trim().split('\n')[0]}`)
  // commands.logQuery is shown in a Markdown table cell and a code span: a pipe or a backtick is refused.
  for (const lq of ['node logs.mjs | grep error', 'node `which logs`']) {
    writeFileSync(join(cm, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, commands: { ...CORE_CFG.commands, logQuery: lq } }))
    const q = run('sync.mjs', ['--target', cm])
    if (q.status !== 2 || !q.stderr.includes(`KIT_SYNC: STOP — commands.logQuery is "${lq}" — it cannot contain "|" or a backtick`)) fail(`sync with commands.logQuery ${JSON.stringify(lq)}: exit ${q.status}, ${q.stderr.trim().split('\n')[0]}`)
  }
  rmSync(cm, { recursive: true, force: true })
}

// mods.* : enabled mods render the kit's marketplace and their enabledPlugins entries into settings.json (valid JSON,
// security-guidance kept); none enabled = neither key; an unknown mod or a bad repo is refused; a sync right after
// install leaves settings.json as it is.
{
  const mm = tmp('mods')
  writeFileSync(join(mm, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, mods: { enabled: ['fleet', 'guards', 'ship-pilot'] } }))
  const r = run('install.mjs', ['--target', mm])
  if (r.status !== 0) fail(`install with mods.enabled: exit ${r.status}, ${(r.stdout + r.stderr).trim().split('\n').pop()}`)
  else {
    const st = JSON.parse(read(mm, '.claude/settings.json'))
    const mkt = st.extraKnownMarketplaces?.['ai-workflow-kit-mods']
    if (mkt?.source?.source !== 'github' || mkt?.source?.repo !== 'WDD-CODER/ai-workflow-kit' || mkt?.autoUpdate !== true) fail(`mods: settings.json marketplace entry is ${JSON.stringify(mkt)}`)
    for (const m of ['fleet', 'guards', 'ship-pilot']) if (st.enabledPlugins?.[`${m}@ai-workflow-kit-mods`] !== true) fail(`mods: settings.json does not enable ${m}`)
    if (st.enabledPlugins?.['security-guidance@claude-plugins-official'] !== true) fail('mods: settings.json lost security-guidance')
    // The contract the mods read: fleet parses the port bases from scripts/lib/slot.mjs, guards the hotspot list from
    // scripts/scope-check.mjs (mods/fleet, mods/guards). A change to either rendered shape must change the mods too.
    if (!/return\s*\{\s*fe:\s*\d+\s*\+\s*n\s*,\s*be:\s*\d+\s*\+\s*n\s*\}/.test(read(mm, 'scripts/lib/slot.mjs'))) fail('mods: scripts/lib/slot.mjs no longer renders `return { fe: <n> + n, be: <n> + n }` (fleet reads it)')
    if (!/const HOTSPOTS = \[[^\]]*\]/.test(read(mm, 'scripts/scope-check.mjs'))) fail('mods: scripts/scope-check.mjs no longer renders `const HOTSPOTS = [ … ]` (guards reads it)')
    const again = run('sync.mjs', ['--target', mm])
    const touched = again.stdout.split('\n').filter((l) => l.includes('.claude/settings.json'))
    if (again.status !== 0 || touched.length) fail(`mods: sync right after install: exit ${again.status}, ${touched.join(' | ')}`)
    writeFileSync(join(mm, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, mods: { enabled: ['fleet'] } }))
    const fewer = run('sync.mjs', ['--target', mm])
    if (!/kit-update\s+\.claude\/settings\.json/.test(fewer.stdout)) fail('mods: sync after a change to mods.enabled does not update settings.json')
  }
  rmSync(mm, { recursive: true, force: true })

  const mn = tmp('mods-none')
  writeFileSync(join(mn, 'kit.config.json'), JSON.stringify(CORE_CFG))
  const n = run('install.mjs', ['--target', mn])
  if (n.status !== 0) fail(`install without mods: exit ${n.status}`)
  else {
    const st = JSON.parse(read(mn, '.claude/settings.json'))
    if (st.extraKnownMarketplaces || Object.keys(st.enabledPlugins ?? {}).some((k) => k.endsWith('@ai-workflow-kit-mods'))) fail('mods: settings.json carries mods with mods.enabled empty')
  }
  rmSync(mn, { recursive: true, force: true })

  const mb = tmp('mods-bad')
  writeFileSync(join(mb, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, mods: { enabled: ['fleet', 'radar'], marketplaceRepo: 'not a repo' } }))
  const b = run('install.mjs', ['--target', mb])
  if (b.status !== 2 || !b.stderr.includes('mods.enabled names "radar" — allowed: "fleet", "guards", "ship-pilot"') || !b.stderr.includes('mods.marketplaceRepo is "not a repo" — it must be <owner>/<repo>') || files(mb).length !== 1) fail(`install with a bad mods config: exit ${b.status}, ${b.stderr.trim().split('\n')[0]}`)
  rmSync(mb, { recursive: true, force: true })
}

// orchestrator.* (docs/agent/orchestrator.md): the installer ships the workflow folder, the /orchestrate command and
// the run rules; the three keys render with their defaults; a project value renders; a bad value is refused naming
// the key (install exit 2, nothing written; sync STOP).
{
  const od = tmp('orch-default')
  writeFileSync(join(od, 'kit.config.json'), JSON.stringify(CORE_CFG))
  const r = run('install.mjs', ['--target', od])
  if (r.status !== 0) fail(`install for the orchestrator files: exit ${r.status}, ${(r.stdout + r.stderr).trim().split('\n').pop()}`)
  else {
    for (const f of ['.claude/workflows/orchestrate.js', '.claude/commands/orchestrate.md', 'docs/agent/orchestrator.md', 'scripts/orch-state.mjs', 'scripts/orch-preflight.mjs', 'scripts/lib/orch-run.mjs',
      'scripts/decision-log.mjs', 'scripts/kit-feedback.mjs', '.claude/commands/kit-feedback.md', 'docs/agent/decision-review.md', 'docs/brain/decision-log.md', 'docs/brain/agent-rules.md',
      // The workflow scout: command, page builder, pull request step, page template and the seed sources list.
      '.claude/commands/scout.md', 'scripts/scout/render.mjs', 'scripts/scout/pr.mjs', 'scripts/scout/page-template.html', 'docs/scout/sources.json']) {
      if (!existsSync(join(od, f))) fail(`orchestrator: install did not copy ${f}`)
    }
    const wf = read(od, '.claude/workflows/orchestrate.js')
    if (!wf.includes('const MAX_FIX_ROUNDS = 2') || !wf.includes('const RUN_PREFIX = "orch/"') || !wf.includes('const PILOT_SIZE = 3')) fail('orchestrator: orchestrate.js does not render maxFixRounds 2 / runBranchPrefix "orch/" / pilotSize 3')
    if (!wf.includes('const FALLBACK_MODEL = "opus"') || !wf.includes('const MAX_NOTES = 12') || !wf.includes('const MAX_CALLS = 60')) fail('orchestrator: orchestrate.js does not render fallbackModel "opus" / maxNotesPerPlan 12 / maxAgentCallsPerPlan 60')
    if (!read(od, 'scripts/orch-state.mjs').includes('const STALE_MIN = 10')) fail('orchestrator: orch-state.mjs does not render staleMin 10')
    // Plan 032: the light merge step, main-folder checks, decisions only, no pause when there is nothing to ask.
    const doc0 = (d) => read(d, 'docs/agent/orchestrator.md')
    if (!wf.includes('const MERGE_CHECKS_MODE = "build"')) fail('orchestrator: orchestrate.js does not render mergeChecks "build"')
    for (const [f, bad, why] of [['.claude/agents/orch-gate.md', /say in `decisions`/, 'still asks for a decisions confirmation'], ['.claude/agents/orch-ui.md', /of `decisions`/, 'still asks for a decisions confirmation']]) {
      if (bad.test(read(od, f))) fail(`decisions: ${f} ${why}`)
    }
    if (!doc0(od).includes('## A check whose file does not exist') || !read(od, 'scripts/orch-state.mjs').includes("'check-files'")) fail('orchestrator: orchestrator.md / orch-state.mjs do not carry the missing check file rule (check-files)')
    if (!read(od, '.claude/agents/orch-readiness.md').includes('mainCommands')) fail('orchestrator: orch-readiness.md does not name mainCommands ([auto:main] items)')
    // Plan 033: a bad copy of a state line is retried once; the runner runs only its list.
    if (!read(od, '.claude/agents/kit-runner.md').includes('Run only the commands in the list')) fail('orchestrator: kit-runner.md does not say "Run only the commands in the list"')
    if (!doc0(od).includes('retried once')) fail('orchestrator: orchestrator.md does not say a bad copy of a state line is retried once')
    if (!wf.includes('[capture]') || !wf.includes('after 2 attempts')) fail('orchestrator: orchestrate.js does not mark the state command [capture] / say "after 2 attempts"')
    // The learning loop's files: the rules seed fits its own cap, and the rendered files name the rule they teach.
    const rc = spawnSync(process.execPath, [join(od, 'scripts', 'decision-log.mjs'), 'rules', '--check', '--dir', od], { encoding: 'utf8' })
    if (rc.status !== 0) fail(`decision-log: the rules seed does not pass its own cap: ${(rc.stdout + rc.stderr).trim().split('\n').pop()}`)
    for (const f of ['.claude/agents/orch-builder.md', '.claude/commands/take-plan.md']) {
      const t = read(od, f)
      if (!t.includes('behaviour:')) fail(`decision review: ${f} does not state the no-invented-behaviour rule (behaviour:)`)
      if (!t.includes('docs/brain/agent-rules.md') || !/never[^.]*decision-log\.md/.test(t)) fail(`decision review: ${f} must read agent-rules.md and never decision-log.md`)
    }
    if (/\{\{[\w.|]+\}\}/.test(wf)) fail(`orchestrator: orchestrate.js keeps a placeholder: ${/\{\{[\w.|]+\}\}/.exec(wf)[0]}`)
    if (!read(od, 'scripts/orch-state.mjs').includes('const MIN_FREE_GB = 5')) fail('orchestrator: orch-state.mjs does not render minFreeDiskGb 5')
    const doc = read(od, 'docs/agent/orchestrator.md')
    if (!doc.includes('| `runBranchPrefix` | `orch/` |') || !doc.includes('| `maxFixRounds` | `2` |') || !doc.includes('| `minFreeDiskGb` | `5` |') || !doc.includes('| `pilotSize` | `3` |')) fail('orchestrator: orchestrator.md does not name the default settings')
    if (!doc.includes('| `fallbackModel` | `opus` |') || !doc.includes('| `staleMin` | `10` |') || !doc.includes('| `maxNotesPerPlan` | `12` |') || !doc.includes('| `maxAgentCallsPerPlan` | `60` |')) fail('orchestrator: orchestrator.md does not name the plan 029 defaults (fallbackModel, staleMin, maxNotesPerPlan, maxAgentCallsPerPlan)')
    if (!doc.includes('| `mergeChecks` | `build` |') || !doc.includes('## Checks that run from the main folder')) fail('orchestrator: orchestrator.md does not name mergeChecks "build" and the main-folder checks section')
    const cmd = read(od, '.claude/commands/orchestrate.md')
    if (!cmd.includes('node scripts/orch-state.mjs watch --run <run>') || cmd.includes('startedAt')) fail('orchestrator: orchestrate.md must name the watch line and pass no startedAt')
    if (!cmd.includes('`askHuman` false') || !cmd.includes('"mainChecks"') || !cmd.includes('`ask`') || !cmd.includes('decisionsDropped')) fail('orchestrator: orchestrate.md must start the run on askHuman false (the `ask` word keeps the pause), pass mainChecks and print decisionsDropped')
    // Plan 034: a main-folder check always waits for go.
    if (!cmd.includes('"mainApproved": true') || !cmd.includes('from the main folder') || !cmd.includes('no main-folder command')) fail('orchestrator: orchestrate.md must list the main-folder commands, wait for go and pass mainApproved')
    if (!doc.includes('stopped: main-approval')) fail('orchestrator: orchestrator.md does not say the run refuses unapproved main checks (stopped: main-approval)')
    // Plan 043: readiness checks the plan's claims; a delegated answer is backed by main-try; npx checks map to scripts.
    if (!read(od, '.claude/agents/orch-readiness.md').includes('claims')) fail('orchestrator: orch-readiness.md does not name claims')
    if (!cmd.includes('mainDelegated') || !cmd.includes('main-try')) fail('orchestrator: orchestrate.md must pass mainDelegated and run main-try on a delegated reply')
    if (!doc.includes('## What a plan claims') || !read(od, 'scripts/orch-state.mjs').includes("'main-try'")) fail('orchestrator: orchestrator.md / orch-state.mjs do not carry the claims and main-try rules')
    if (!/^\.claude\/orchestrator-runs\/$/m.test(read(od, '.gitignore'))) fail('orchestrator: the rendered .gitignore does not ignore .claude/orchestrator-runs/')
  }
  rmSync(od, { recursive: true, force: true })

  const op = tmp('orch-project')
  writeFileSync(join(op, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, orchestrator: { runBranchPrefix: 'runs/', maxFixRounds: 3, minFreeDiskGb: 10, pilotSize: 0 } }))
  const p = run('install.mjs', ['--target', op])
  if (p.status !== 0) fail(`install with project orchestrator values: exit ${p.status}`)
  else if (!read(op, '.claude/workflows/orchestrate.js').includes('const PILOT_SIZE = 0')) fail('orchestrator: pilotSize 0 does not render')
  else if (!read(op, '.claude/workflows/orchestrate.js').includes('const MAX_FIX_ROUNDS = 3') || !read(op, '.claude/workflows/orchestrate.js').includes('const RUN_PREFIX = "runs/"') || !read(op, 'scripts/orch-state.mjs').includes('const MIN_FREE_GB = 10')) fail('orchestrator: project values do not render')
  rmSync(op, { recursive: true, force: true })

  // A pnpm project audits with pnpm (npm audit fails without a package-lock.json); the kit-managed scripts/ audit stays npm.
  const pp = tmp('pnpm-project')
  writeFileSync(join(pp, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, project: { name: 'pnpm-app', packageManager: 'pnpm' }, ci: { install: 'pnpm install --frozen-lockfile' } }))
  const pi = run('install.mjs', ['--target', pp])
  if (pi.status !== 0) fail(`install with project.packageManager pnpm: exit ${pi.status}`)
  else {
    const sec = read(pp, '.github/workflows/security.yml').replace(/\r\n/g, '\n')
    if (!sec.includes('      - name: npm audit (root)\n        run: pnpm audit --prod --audit-level critical') || sec.includes('npm audit --omit=dev --audit-level=critical')) fail('security.yml: a pnpm project must audit with pnpm audit --prod, not npm audit')
    if (!sec.includes('out="$(npm audit --omit=dev 2>&1)"') || !sec.includes("if: hashFiles('scripts/package-lock.json') != ''")) fail('security.yml: the kit-managed scripts/ audit stays npm in a pnpm project')
    if (!sec.includes('      - uses: pnpm/action-setup@v4') || !sec.includes('        run: pnpm install --frozen-lockfile')) fail('security.yml: a pnpm project must set up pnpm and install with ci.install')
  }
  rmSync(pp, { recursive: true, force: true })

  const bad = [
    [{ runBranchPrefix: 'Orch' }, 'orchestrator.runBranchPrefix is "Orch" — it must be lower-case letters, digits, dots, dashes and slashes ending with "/"'],
    [{ runBranchPrefix: 'main/' }, 'orchestrator.runBranchPrefix is "main/"'],
    [{ maxFixRounds: 0 }, 'orchestrator.maxFixRounds is 0 — it must be a whole number from 1 to 5'],
    [{ maxFixRounds: '2' }, 'orchestrator.maxFixRounds is "2" — it must be a whole number from 1 to 5'],
    [{ minFreeDiskGb: -1 }, 'orchestrator.minFreeDiskGb is -1 — it must be a number of GB from 0 to 1000'],
    [{ pilotSize: 11 }, 'orchestrator.pilotSize is 11 — it must be a whole number from 0 to 10'],
    [{ pilotSize: 1.5 }, 'orchestrator.pilotSize is 1.5 — it must be a whole number from 0 to 10'],
    [{ pilotSize: '3' }, 'orchestrator.pilotSize is "3" — it must be a whole number from 0 to 10'],
    [{ fallbackModel: 'haiku' }, 'orchestrator.fallbackModel is "haiku" — allowed: "sonnet", "opus", "fable", "inherit" (no retry) or a non-Haiku model id starting "claude-"'],
    [{ fallbackModel: 'claude-haiku-5-5' }, 'orchestrator.fallbackModel is "claude-haiku-5-5"'],
    [{ staleMin: 0 }, 'orchestrator.staleMin is 0 — it must be a whole number of minutes from 1 to 240'],
    [{ maxNotesPerPlan: 101 }, 'orchestrator.maxNotesPerPlan is 101 — it must be a whole number of notes from 1 to 100'],
    [{ mergeChecks: 'tests' }, 'orchestrator.mergeChecks is "tests" — it must be "build" (the project build plus the plan\'s scope check) or "full" (the plan\'s whole check list)'],
    [{ maxAgentCallsPerPlan: 5 }, 'orchestrator.maxAgentCallsPerPlan is 5 — it must be a whole number of agent calls from 10 to 500'],
    [{ ciMirror: 'npm run lint' }, 'orchestrator.ciMirror is "npm run lint" — it must be a list of check commands'],
    [{ ciMirror: ['git push'] }, 'orchestrator.ciMirror item "git push" — git push: not an allowed check'],
    [{ ciMirror: ['node tools/x.mjs --apply'] }, 'orchestrator.ciMirror item "node tools/x.mjs --apply" — node tools/x.mjs --apply: --apply writes files'],
  ]
  for (const [orch, msg] of bad) {
    const ob = tmp('orch-bad')
    writeFileSync(join(ob, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, orchestrator: orch }))
    const b = run('install.mjs', ['--target', ob])
    if (b.status !== 2 || !b.stderr.includes(msg) || files(ob).length !== 1) fail(`install with orchestrator ${JSON.stringify(orch)}: exit ${b.status}, ${b.stderr.trim().split('\n')[0]}`)
    rmSync(ob, { recursive: true, force: true })
  }
  // sync refuses a bad value too, naming the key.
  const os = tmp('orch-sync')
  writeFileSync(join(os, 'kit.config.json'), JSON.stringify(CORE_CFG))
  run('install.mjs', ['--target', os])
  writeFileSync(join(os, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, orchestrator: { maxFixRounds: 9 } }))
  const s = run('sync.mjs', ['--target', os, '--apply'])
  if (s.status !== 2 || !s.stderr.includes('KIT_SYNC: STOP — orchestrator.maxFixRounds is 9')) fail(`sync with orchestrator.maxFixRounds 9: exit ${s.status}, ${s.stderr.trim().split('\n')[0]}`)
  writeFileSync(join(os, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, orchestrator: { fallbackModel: 'haiku', staleMin: 0 } }))
  const s2 = run('sync.mjs', ['--target', os, '--apply'])
  if (s2.status !== 2 || !s2.stderr.includes('orchestrator.fallbackModel is "haiku"') || !s2.stderr.includes('orchestrator.staleMin is 0')) fail(`sync with orchestrator.fallbackModel haiku / staleMin 0: exit ${s2.status}, ${s2.stderr.trim().split('\n')[0]}`)
  rmSync(os, { recursive: true, force: true })

  // Plan 044: orchestrator.ciMirror is rendered into the final gate, and sync suggests (never writes) the CI commands the gate does not run.
  const cm = tmp('orch-mirror')
  writeFileSync(join(cm, 'kit.config.json'), JSON.stringify(CORE_CFG))
  const cmInstall = run('install.mjs', ['--target', cm])
  if (cmInstall.status !== 0) fail(`install for ciMirror: exit ${cmInstall.status}, ${(cmInstall.stdout + cmInstall.stderr).trim().split('\n').pop()}`)
  else if (!read(cm, '.claude/workflows/orchestrate.js').includes('const CI_MIRROR = []')) fail('orchestrator: orchestrate.js does not render ciMirror [] as const CI_MIRROR = []')
  else if (!read(cm, 'docs/agent/orchestrator.md').includes('| `ciMirror` | `[]` |')) fail('orchestrator: orchestrator.md does not name the ciMirror default')
  else {
    mkdirSync(join(cm, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(cm, '.github', 'workflows', 'extra.yml'), 'name: extra\njobs:\n  rules:\n    steps:\n      - run: node tools/extra-check.mjs\n      - run: |\n          node scripts/other-check.mjs --strict\n          echo hello\n          npm ci\n')
    const hint = run('sync.mjs', ['--target', cm])
    for (const cmd of ['node tools/extra-check.mjs', 'node scripts/other-check.mjs --strict']) {
      if (!hint.stdout.includes(`NOTE ci-mirror: .github/workflows/extra.yml runs "${cmd}" — the run's final gate does not; add it to orchestrator.ciMirror in kit.config.json to run it there`)) fail(`sync: no NOTE ci-mirror line for ${cmd}: ${hint.stdout.trim().split('\n').slice(-3).join(' | ')}`)
    }
    if (/NOTE ci-mirror: .*(echo hello|npm ci)/.test(hint.stdout)) fail('sync: a NOTE ci-mirror line for a command that is not an allowed check shape')
    writeFileSync(join(cm, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, orchestrator: { ciMirror: ['node tools/extra-check.mjs'] } }))
    const covered = run('sync.mjs', ['--target', cm, '--apply'])
    if (covered.status !== 0 || covered.stdout.includes('runs "node tools/extra-check.mjs"') || !covered.stdout.includes('runs "node scripts/other-check.mjs --strict"')) fail(`sync with ciMirror set: exit ${covered.status}, a covered command is still hinted or the other is not`)
    else if (!read(cm, '.claude/workflows/orchestrate.js').includes('const CI_MIRROR = ["node tools/extra-check.mjs"]')) fail('orchestrator: orchestrate.js does not render the project ciMirror')
  }
  rmSync(cm, { recursive: true, force: true })
}

// models.* (docs/agent/model-routing.md): the tiers render into the agent and forked-skill frontmatter; no inline
// command carries a `model:` (a model switch breaks the prompt cache); all tiers inherit = routing off; a value that is
// not a model alias or a claude- id is refused like a bad ci.* mode.
{
  const modelLines = (dir) => files(dir).filter((f) => f.startsWith('.claude/')).flatMap((f) =>
    [...read(dir, f).matchAll(/^model:\s*(\S+)\s*$/gm)].map((m) => [f, m[1]]))
  const expect = (dir, label, want) => {
    for (const [f, tier] of Object.entries(want)) {
      const got = modelLines(dir).filter(([g]) => g === f).map(([, v]) => v)
      if (got.length !== 1 || got[0] !== tier) fail(`${label}: ${f} should carry model: ${tier}, got ${JSON.stringify(got)}`)
    }
  }
  // The role agents (docs/agent/agent-roles.md) and their default tiers.
  const ORCH_DEFAULTS = {
    '.claude/agents/orch-builder.md': 'sonnet', '.claude/agents/orch-readiness.md': 'inherit',
    '.claude/agents/orch-gate.md': 'haiku', '.claude/agents/orch-report.md': 'haiku',
    '.claude/agents/orch-check-plan.md': 'sonnet', '.claude/agents/orch-check-bugs.md': 'sonnet', '.claude/agents/orch-check-rules.md': 'sonnet',
    '.claude/agents/orch-verify.md': 'sonnet', '.claude/agents/orch-security.md': 'sonnet', '.claude/agents/orch-ui.md': 'sonnet',
    '.claude/agents/orch-merge.md': 'sonnet', '.claude/agents/skill-judge.md': 'sonnet',
  }
  // Every agent file pins model: and effort: and has no empty tools:; the builder cannot start agents or message
  // anyone; no role agent names a deny-listed command.
  const agentContract = (dir, label) => {
    const agents = files(dir).filter((f) => /^\.claude\/agents\/[^/]+\.md$/.test(f))
    for (const f of agents) {
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(dir, f))?.[1] ?? ''
      if (!/^model:\s*\S+\s*$/m.test(fm) || !/^effort:\s*\S+\s*$/m.test(fm)) fail(`${label}: ${f} must pin model: and effort: in its frontmatter`)
      if (/^tools:\s*$/m.test(fm)) fail(`${label}: ${f} has an empty tools:`)
    }
    const tools = (/^tools:\s*(.*)$/m.exec(read(dir, '.claude/agents/orch-builder.md'))?.[1] ?? '').split(',').map((t) => t.trim())
    if (tools.includes('Agent') || tools.includes('SendMessage')) fail(`${label}: orch-builder tools must not include Agent or SendMessage (${tools.join(', ')})`)
    const deny = /reset --hard|push --force|push -f\b|\brm -rf?\b/
    for (const f of agents.filter((x) => x.startsWith('.claude/agents/orch-'))) if (deny.test(read(dir, f))) fail(`${label}: ${f} names a deny-listed command (${deny.exec(read(dir, f))[0]})`)
  }
  const md = tmp('models')
  writeFileSync(join(md, 'kit.config.json'), JSON.stringify(CORE_CFG))
  const d = run('install.mjs', ['--target', md])
  if (d.status !== 0) fail(`install with default models: exit ${d.status}, ${(d.stdout + d.stderr).trim().split('\n').pop()}`)
  else {
    expect(md, 'default models', {
      '.claude/agents/kit-runner.md': 'haiku', '.claude/agents/git-agent.md': 'haiku', '.claude/agents/kit-prevalidate.md': 'sonnet',
      '.claude/skills/github-sync/SKILL.md': 'haiku', '.claude/skills/techdebt/SKILL.md': 'sonnet',
      ...ORCH_DEFAULTS,
    })
    agentContract(md, 'default models')
    const inline = modelLines(md).filter(([f]) => f.startsWith('.claude/commands/'))
    if (inline.length) fail(`an inline command carries model: (cache break): ${inline.map(([f]) => f).join(', ')}`)
    const inlineSkills = modelLines(md).filter(([f]) => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(f) && !/^context:\s*fork\s*$/m.test(read(md, f)))
    if (inlineSkills.length) fail(`a skill carries model: without context: fork (cache break): ${inlineSkills.map(([f]) => f).join(', ')}`)
    // SessionStart names an environment variable that overrides the agent files' models, and says nothing otherwise.
    spawnSync('git', ['init', '-q'], { cwd: md })
    const hook = (env) => spawnSync('bash', ['scripts/session-startup.sh'], { cwd: md, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } }).stdout
    if (/MODEL_ROUTING:/.test(hook({}))) fail('SessionStart prints MODEL_ROUTING with no override variable set')
    if (!hook({ CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' }).includes("MODEL_ROUTING: CLAUDE_CODE_SUBAGENT_MODEL=haiku overrides the kit's agent models")) fail('SessionStart does not warn about CLAUDE_CODE_SUBAGENT_MODEL')
    if (!hook({ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }).includes('MODEL_ROUTING: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 makes Claude Code ignore')) fail('SessionStart does not warn about CLAUDE_CODE_SUBAGENT_MODEL_FORCE')
    if (/MODEL_ROUTING:/.test(hook({ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '0' }))) fail('SessionStart warns about CLAUDE_CODE_SUBAGENT_MODEL_FORCE=0')
    if (!read(md, '.claude/commands/docs-refresh.md').includes('model: "sonnet"') && read(md, '.claude/commands/docs-refresh.md').includes('Agent(')) fail('docs-refresh: the Agent call does not pass the analysis tier')
    if (!read(md, 'docs/agent/model-routing.md').includes('| `mechanical` | `haiku` |')) fail('model-routing.md does not name the project tier values')
    if (!read(md, 'docs/agent/model-routing.md').includes('| `build` | `sonnet` |')) fail('model-routing.md does not name the build tier value')
  }
  rmSync(md, { recursive: true, force: true })

  const mi = tmp('models-inherit')
  writeFileSync(join(mi, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, models: { mechanical: 'inherit', analysis: 'inherit', judgment: 'inherit', build: 'inherit' } }))
  const i = run('install.mjs', ['--target', mi])
  const notInherit = i.status === 0 ? modelLines(mi).filter(([, v]) => v !== 'inherit') : []
  if (i.status !== 0 || !modelLines(mi).length || notInherit.length) fail(`all tiers inherit must render only model: inherit (routing off): exit ${i.status}, others ${JSON.stringify(notInherit)}`)
  rmSync(mi, { recursive: true, force: true })

  const mp = tmp('models-project')
  writeFileSync(join(mp, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, models: { mechanical: 'claude-haiku-5-5' } }))
  const p = run('install.mjs', ['--target', mp])
  if (p.status !== 0) fail(`install with models.mechanical claude-haiku-5-5: exit ${p.status}`)
  else expect(mp, 'project model id', { '.claude/agents/kit-runner.md': 'claude-haiku-5-5', '.claude/agents/kit-prevalidate.md': 'sonnet' })
  rmSync(mp, { recursive: true, force: true })

  // models.build: one key sets the builder's model; every other role agent keeps its tier.
  const mbp = tmp('models-build')
  writeFileSync(join(mbp, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, models: { build: 'opus' } }))
  const bp = run('install.mjs', ['--target', mbp])
  if (bp.status !== 0) fail(`install with models.build opus: exit ${bp.status}`)
  else {
    expect(mbp, 'project models.build', { ...ORCH_DEFAULTS, '.claude/agents/orch-builder.md': 'opus' })
    agentContract(mbp, 'project models.build')
  }
  rmSync(mbp, { recursive: true, force: true })

  const mbb = tmp('models-build-bad')
  writeFileSync(join(mbb, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, models: { build: 'gpt-4' } }))
  const bb = run('install.mjs', ['--target', mbb])
  if (bb.status !== 2 || !bb.stderr.includes('models.build is "gpt-4" — allowed: "haiku", "sonnet", "opus", "fable", "inherit" or a full model id starting "claude-"') || files(mbb).length !== 1) fail(`install with models.build gpt-4: exit ${bb.status}, ${bb.stderr.trim().split('\n')[0]}`)
  rmSync(mbb, { recursive: true, force: true })

  const mb = tmp('models-bad')
  writeFileSync(join(mb, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, models: { analysis: 'gpt-4' } }))
  const b = run('install.mjs', ['--target', mb])
  if (b.status !== 2 || !b.stderr.includes('models.analysis is "gpt-4" — allowed: "haiku", "sonnet", "opus", "fable", "inherit" or a full model id starting "claude-"') || files(mb).length !== 1) fail(`install with models.analysis gpt-4: exit ${b.status}, ${b.stderr.trim().split('\n')[0]}`)
  rmSync(mb, { recursive: true, force: true })

  // models.review (plan 021): the validating agents never run on Haiku — install refuses it, naming the key, and
  // writes nothing; a cheaper models.analysis never moves a checker.
  for (const haiku of ['haiku', 'claude-haiku-4-5', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307']) {
    const mr = tmp('models-review-haiku')
    writeFileSync(join(mr, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, models: { review: haiku } }))
    const r = run('install.mjs', ['--target', mr])
    if (r.status !== 2 || !r.stderr.includes(`models.review is "${haiku}" — validating agents never run on Haiku`) || files(mr).length !== 1) fail(`install with models.review ${haiku}: exit ${r.status}, ${r.stderr.trim().split('\n')[0]}`)
    rmSync(mr, { recursive: true, force: true })
  }
  const ma = tmp('models-analysis-haiku')
  writeFileSync(join(ma, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, models: { analysis: 'haiku' } }))
  const a = run('install.mjs', ['--target', ma])
  if (a.status !== 0) fail(`install with models.analysis haiku: exit ${a.status}`)
  else {
    expect(ma, 'models.analysis haiku keeps validators on review', {
      '.claude/agents/orch-check-plan.md': 'sonnet', '.claude/agents/orch-check-bugs.md': 'sonnet', '.claude/agents/orch-check-rules.md': 'sonnet',
      '.claude/agents/orch-verify.md': 'sonnet', '.claude/agents/orch-security.md': 'sonnet', '.claude/agents/orch-ui.md': 'sonnet', '.claude/agents/skill-judge.md': 'sonnet',
      '.claude/agents/orch-merge.md': 'haiku', '.claude/agents/kit-prevalidate.md': 'haiku',
    })
    if (!/^omitClaudeMd: true$/m.test(read(ma, '.claude/agents/git-agent.md'))) fail('git-agent.md does not set omitClaudeMd: true')
  }
  rmSync(ma, { recursive: true, force: true })

  // A project that set models.analysis before models.review existed keeps its validators on that model.
  const mo = tmp('models-analysis-opus')
  writeFileSync(join(mo, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, models: { analysis: 'opus' } }))
  const o = run('install.mjs', ['--target', mo])
  if (o.status !== 0) fail(`install with models.analysis opus: exit ${o.status}`)
  else expect(mo, 'models.analysis opus keeps validators on opus', {
    '.claude/agents/orch-check-plan.md': 'opus', '.claude/agents/orch-check-bugs.md': 'opus', '.claude/agents/orch-check-rules.md': 'opus',
    '.claude/agents/orch-verify.md': 'opus', '.claude/agents/orch-security.md': 'opus', '.claude/agents/orch-ui.md': 'opus', '.claude/agents/skill-judge.md': 'opus',
  })
  rmSync(mo, { recursive: true, force: true })
  const mos = tmp('models-analysis-opus-review-sonnet')
  writeFileSync(join(mos, 'kit.config.json'), JSON.stringify({ ...CORE_CFG, models: { analysis: 'opus', review: 'sonnet' } }))
  const os = run('install.mjs', ['--target', mos])
  if (os.status !== 0) fail(`install with models.analysis opus + review sonnet: exit ${os.status}`)
  else expect(mos, 'an explicit models.review wins over models.analysis', { '.claude/agents/orch-verify.md': 'sonnet', '.claude/agents/kit-prevalidate.md': 'opus' })
  rmSync(mos, { recursive: true, force: true })
}

// Skill improver (plan 035): the judge is a review-tier agent that is never Haiku in any rendered tree; the scheduler
// script never catches up a missed night; the runner has the reusable lib/ core and refuses an unknown target.
{
  const judge = readFileSync(join(kit, 'core', '.claude', 'agents', 'skill-judge.md'), 'utf8')
  if (!/^model: \{\{models\.review\}\}$/m.test(judge)) fail('skill-judge.md must carry model: {{models.review}} (the review tier, never Haiku)')
  const jd = tmp('skill-judge')
  writeFileSync(join(jd, 'kit.config.json'), JSON.stringify(CORE_CFG))
  const ji = run('install.mjs', ['--target', jd])
  if (ji.status !== 0) fail(`install for skill-judge: exit ${ji.status}`)
  else {
    const m = /^model:\s*(\S+)\s*$/m.exec(read(jd, '.claude/agents/skill-judge.md'))?.[1] ?? ''
    if (!m || /haiku/i.test(m)) fail(`the rendered skill-judge.md model is "${m}" — it must not be Haiku`)
    if (!files(jd).includes('.claude/commands/improve-skill.md')) fail('install did not render .claude/commands/improve-skill.md')
  }
  rmSync(jd, { recursive: true, force: true })
  const ps = readFileSync(join(kit, 'kit-skill-improver.ps1'), 'utf8')
  for (const s of ['StartWhenAvailable = $false', "[string]$Time = '02:10'", 'DisallowStartIfOnBatteries = $true', '--target skill']) {
    if (!ps.includes(s)) fail(`kit-skill-improver.ps1 does not contain: ${s}`)
  }
  for (const f of ['budget', 'worktree', 'guards', 'pr', 'log']) {
    if (!existsSync(join(kit, 'tools', 'skill-improver', 'lib', `${f}.mjs`))) fail(`tools/skill-improver/lib/${f}.mjs is missing`)
  }
  const unk = spawnSync(process.execPath, [join(kit, 'tools', 'skill-improver', 'run.mjs'), '--target', 'agent'], { encoding: 'utf8' })
  if (unk.status !== 2 || !unk.stderr.includes('unknown target agent')) fail(`run.mjs --target agent: exit ${unk.status}, ${unk.stderr.trim()}`)
}

// sync --apply that updates the kit-managed scripts/package.json refreshes the project's scripts/package-lock.json
// (npm install inside scripts/). Offline with an empty npm cache the install fails: sync names the command to run.
// Without a lockfile, sync runs nothing.
{
  const lk = tmp('scripts-lock')
  const cache = tmp('npm-cache')
  writeFileSync(join(lk, 'kit.config.json'), JSON.stringify(CORE_CFG))
  run('install.mjs', ['--target', lk])
  const instPath = join(lk, '.kit/install.json')
  const older = '{ "name": "workflow-scripts", "private": true, "dependencies": {} }\n'
  const asOlderKit = () => {
    writeFileSync(join(lk, 'scripts/package.json'), older)
    const inst = JSON.parse(readFileSync(instPath, 'utf8'))
    inst.files['scripts/package.json'].sha256 = createHash('sha256').update(older).digest('hex')
    writeFileSync(instPath, JSON.stringify(inst, null, 2))
  }
  const env = { ...process.env, npm_config_offline: 'true', npm_config_cache: cache, npm_config_update_notifier: 'false' }
  const sync = () => spawnSync(process.execPath, [join(kit, 'tools', 'sync.mjs'), '--target', lk, '--apply'], { encoding: 'utf8', env })
  asOlderKit()
  const none = sync()
  if (/npm install inside scripts/.test(none.stdout) || read(lk, 'scripts/package.json') === older) fail(`sync without scripts/package-lock.json: ${none.stdout.trim().split('\n').pop()}`)
  asOlderKit()
  writeFileSync(join(lk, 'scripts/package-lock.json'), JSON.stringify({ name: 'workflow-scripts', lockfileVersion: 3, requires: true, packages: { '': { name: 'workflow-scripts', dependencies: {} } } }, null, 2))
  const s = sync()
  if (read(lk, 'scripts/package.json') === older || !s.stdout.includes('NOTE scripts/package.json changed but npm install inside scripts/ failed') || !s.stdout.includes('cd scripts && npm install --no-audit --no-fund')) fail(`sync --apply with scripts/package-lock.json did not try npm install inside scripts/ (or did not name the command): ${s.stdout.trim().split('\n').slice(-3).join(' | ')}`)
  rmSync(lk, { recursive: true, force: true })
  rmSync(cache, { recursive: true, force: true })
}

// Stack detection: with no --packs and no stack.packs, install proposes the packs and layers from the project (with a
// reason each) and writes nothing until --yes; --yes installs only the matching packs and records them; nothing matching
// is refused; an explicit --packs or stack.packs is never second-guessed.
{
  const det = (name, files, remote) => {
    const d = tmp(`detect-${name}`)
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(join(d, f, '..'), { recursive: true })
      writeFileSync(join(d, f), typeof text === 'string' ? text : JSON.stringify(text))
    }
    if (remote) {
      g(['init', '-q'], d)
      g(['remote', 'add', 'upstream', 'https://example.invalid/upstream.git'], d)
    }
    return d
  }
  const cfg = { project: { name: 'detected-app' }, hooks: { shellPath: 'bash' } }
  const ngApp = det('ng', { 'kit.config.json': cfg, 'package.json': { dependencies: { '@angular/core': '19.0.0' } }, 'server/package.json': { dependencies: { express: '4.0.0' } } })
  const rvApp = det('rv', { 'kit.config.json': cfg, 'package.json': { dependencies: { react: '18.3.1' }, devDependencies: { vite: '5.4.0' } }, 'supabase/config.toml': '' })
  const upApp = det('up', { 'package.json': { dependencies: { react: '18.3.1', vite: '5.4.0' } } }, true)
  // An Angular SSR app lists express in the root package.json: that is no backend (no node-express pack).
  const ssrApp = det('ssr', { 'kit.config.json': cfg, 'package.json': { dependencies: { '@angular/core': '19.0.0', express: '4.0.0' } } })
  const none = det('none', { 'kit.config.json': cfg, 'package.json': { dependencies: { lodash: '4.0.0' } } })
  const count = (d) => files(d).filter((f) => !f.startsWith('.git/')).length
  const cases = [
    [ngApp, 'KIT_INSTALL: detected packs=[angular, node-express] layers=[]', ['angular — package.json has @angular/core', 'node-express — server/package.json has express']],
    [rvApp, 'KIT_INSTALL: detected packs=[react-vite] layers=[supabase]', ['react-vite — package.json has vite + react', 'supabase — supabase/ exists']],
    // An `upstream` remote (every fork clone has one) only suggests the upstream-owned layer.
    [upApp, 'KIT_INSTALL: detected packs=[react-vite] layers=[]', ['suggested layer upstream-owned — git remote "upstream" exists; not included: if it applies, add --layers upstream-owned']],
    [ssrApp, 'KIT_INSTALL: detected packs=[angular] layers=[]', ['angular — package.json has @angular/core']],
  ]
  for (const [d, line, whys] of cases) {
    const before = count(d)
    const dry = run('install.mjs', ['--target', d, '--dry-run'])
    if (dry.status !== 2 || !dry.stdout.includes(line) || whys.some((w) => !dry.stdout.includes(w)) || !dry.stderr.includes('re-run with --yes') || count(d) !== before) fail(`detection dry-run: exit ${dry.status}, wrote ${count(d) - before} files: ${(dry.stdout + dry.stderr).trim().replace(/\s*\n\s*/g, ' | ')}`)
    const plain = run('install.mjs', ['--target', d])
    if (plain.status !== 2 || count(d) !== before) fail(`detection without --yes must write nothing: exit ${plain.status}, wrote ${count(d) - before} files`)
  }
  const ngYes = run('install.mjs', ['--target', ngApp, '--yes'])
  const ngFiles = files(ngApp)
  const ngCfg = JSON.parse(read(ngApp, 'kit.config.json'))
  if (ngYes.status !== 0 || JSON.stringify(ngCfg.stack?.packs) !== '["angular","node-express"]' || JSON.stringify(ngCfg.stack?.layers) !== '[]') fail(`detection --yes (angular): exit ${ngYes.status}, stack ${JSON.stringify(ngCfg.stack)}: ${ngYes.stdout.trim().split('\n').pop()}`)
  if (!ngFiles.includes('docs/agent/standards-angular.md') || ngFiles.some((f) => /standards-react|react-component-structure|standards-supabase|pull-copy/.test(f))) fail('an angular install must contain no react-vite or layer file')
  if (ngCfg.project?.name !== 'detected-app') fail('recording the detected stack lost the project config')
  const again = run('install.mjs', ['--target', ngApp, '--dry-run'])
  if (again.status !== 0 || again.stdout.includes('detected')) fail(`after --yes, stack.packs is explicit: no detection again (${again.stdout.trim().split('\n').pop()})`)
  const rvYes = run('install.mjs', ['--target', rvApp, '--yes'])
  const rvFiles = files(rvApp)
  if (rvYes.status !== 0 || !rvFiles.includes('docs/agent/standards-react.md') || !rvFiles.includes('docs/agent/standards-supabase.md') || rvFiles.some((f) => /standards-angular|angularComponentStructure|breadcrumbs|standards-backend\.md|pull-copy/.test(f))) fail(`detection --yes (react): exit ${rvYes.status}; a react-vite install must contain no angular / node-express file`)
  if (JSON.stringify(JSON.parse(read(rvApp, 'kit.config.json')).stack) !== '{"packs":["react-vite"],"layers":["supabase"]}') fail(`detection --yes (react) recorded ${read(rvApp, 'kit.config.json')}`)
  if (JSON.stringify(JSON.parse(read(rvApp, '.kit/install.json')).layers) !== '["supabase"]') fail('install.json does not record the layers')
  const noMatch = run('install.mjs', ['--target', none, '--yes'])
  if (noMatch.status !== 2 || !noMatch.stderr.includes('no stack pack matches this project') || files(none).length !== 2) fail(`nothing detected must exit 2 and write nothing: exit ${noMatch.status}, ${files(none).length} files`)
  const explicit = run('install.mjs', ['--target', none, '--packs', '', '--allow-unfilled', '--dry-run'])
  if (explicit.status !== 0 || explicit.stdout.includes('detected')) fail(`--packs "" (core only) must not detect: exit ${explicit.status}`)
  const wins = det('wins', { 'kit.config.json': { ...cfg, stack: { packs: ['node-express'] } }, 'package.json': { dependencies: { react: '18.3.1', vite: '5.4.0' } } })
  const w = run('install.mjs', ['--target', wins, '--dry-run', '--allow-unfilled'])
  if (w.status !== 0 || w.stdout.includes('detected') || !/packs=\[node-express\]/.test(w.stdout)) fail(`stack.packs must win over detection: ${w.stdout.trim().split('\n').pop()}`)
  const flag = run('install.mjs', ['--target', rvApp, '--packs', 'angular', '--dry-run'])
  if (flag.stdout.includes('detected') || !/packs=\[angular\]/.test(flag.stdout)) fail(`--packs must win over detection: ${flag.stdout.trim().split('\n').pop()}`)
  // A pack and a layer added to an installed core-only project: sync --packs / --layers (dry-run, then recorded by --apply).
  writeFileSync(join(none, 'kit.config.json'), JSON.stringify(CORE_CFG))
  run('install.mjs', ['--target', none])
  const addDry = run('sync.mjs', ['--target', none, '--packs', 'react-vite', '--layers', 'supabase'])
  if (!addDry.stdout.includes('NOTE stack packs=[] layers=[] -> packs=[react-vite] layers=[supabase] (recorded on --apply)') || !addDry.stdout.includes('new              docs/agent/standards-react.md') || existsSync(join(none, 'docs/agent/standards-react.md'))) fail(`sync --packs dry-run: ${addDry.stdout.trim().split('\n').pop()}`)
  run('sync.mjs', ['--target', none, '--packs', 'react-vite', '--layers', 'supabase', '--apply'])
  const added = JSON.parse(read(none, '.kit/install.json'))
  if (JSON.stringify(JSON.parse(read(none, 'kit.config.json')).stack) !== '{"packs":["react-vite"],"layers":["supabase"]}') fail(`sync --packs --apply must record the stack in kit.config.json too: ${read(none, 'kit.config.json')}`)
  const reinstall = run('install.mjs', ['--target', none, '--dry-run'])
  if (reinstall.status !== 0 || !reinstall.stdout.includes('packs=[react-vite], layers=[supabase]')) fail(`a re-install after sync --packs keeps the stack: ${(reinstall.stdout + reinstall.stderr).trim().split('\n').pop()}`)
  const addDrift = run('drift-check.mjs', ['--target', none])
  if (JSON.stringify([added.packs, added.layers]) !== '[["react-vite"],["supabase"]]' || !existsSync(join(none, 'docs/agent/standards-supabase.md')) || addDrift.status !== 0) fail(`sync --packs --apply: recorded ${JSON.stringify([added.packs, added.layers])}, drift ${addDrift.stdout.trim().split('\n').pop()}`)
  // --yes installs the detected stack only: the suggested upstream-owned layer stays out until named.
  writeFileSync(join(upApp, 'kit.config.json'), JSON.stringify(cfg))
  const upYes = run('install.mjs', ['--target', upApp, '--yes'])
  if (upYes.status !== 0 || JSON.stringify(JSON.parse(read(upApp, 'kit.config.json')).stack) !== '{"packs":["react-vite"],"layers":[]}' || existsSync(join(upApp, '.claude/commands/pull-copy.md'))) fail(`detection --yes must not include a suggested layer: ${upYes.stdout.trim().split('\n').pop()}`)
  // The config and the install record disagree (a hand-edited stack.packs): install stops, nothing written.
  const ssrYes = run('install.mjs', ['--target', ssrApp, '--yes'])
  if (ssrYes.status !== 0 || files(ssrApp).some((f) => /standards-backend\.md/.test(f))) fail(`an Angular app with express in the root package.json must not get node-express: ${ssrYes.stdout.trim().split('\n').pop()}`)
  const ssrCfg = JSON.parse(read(ssrApp, 'kit.config.json'))
  writeFileSync(join(ssrApp, 'kit.config.json'), JSON.stringify({ ...ssrCfg, stack: { ...ssrCfg.stack, packs: [] } }))
  const before = read(ssrApp, '.kit/install.json')
  const mism = run('install.mjs', ['--target', ssrApp])
  if (mism.status !== 2 || !mism.stderr.includes('kit.config.json stack.packs [] and .kit/install.json packs [angular] disagree') || read(ssrApp, '.kit/install.json') !== before) fail(`config / record stack mismatch must stop: exit ${mism.status}, ${mism.stderr.trim().split('\n')[0]}`)
  const rep = spawnSync(process.execPath, [join(kit, 'tools', 'adoption-report.mjs'), '--target', ssrApp], { encoding: 'utf8' })
  if (!/^stack record\s+warn\s+kit\.config\.json stack\.packs \[\] ≠ \.kit\/install\.json packs \[angular\]/m.test(rep.stdout)) fail(`adoption-report must flag the stack mismatch: ${rep.stdout.split('\n').find((l) => l.startsWith('stack record'))}`)
  // ownership.upstreamPaths outside the shared glob subset is refused (the kit and the scope guard would disagree).
  writeFileSync(join(ssrApp, 'kit.config.json'), JSON.stringify({ ...ssrCfg, ownership: { upstreamPaths: ['src/**/*.{ts,tsx}'] } }))
  const brace = run('install.mjs', ['--target', ssrApp, '--dry-run'])
  if (brace.status !== 2 || !brace.stderr.includes('ownership.upstreamPaths "src/**/*.{ts,tsx}" — brace lists')) fail(`a brace glob in ownership.upstreamPaths must be refused: exit ${brace.status}`)
  for (const d of [ngApp, rvApp, upApp, none, wins, ssrApp]) rmSync(d, { recursive: true, force: true })
}

// The upstream-owned layer: the project keeps .gitignore, package.json and AGENTS.md (ownership.upstreamPaths, the layer's
// default list), so install writes none of them, the kit rules go to AGENTS.workflow.md, /pull-copy is installed, CI
// lints changed files and reports app advisories, the rendered scope guard knows the paths, and sync / drift-check see
// no undeclared difference with an empty `overrides` list.
{
  const up = tmp('upstream-owned')
  const own = { '.gitignore': 'node_modules/\ndist/\n', 'AGENTS.md': '# AGENTS.md — the upstream owner\'s rules\n', 'package.json': '{ "name": "copy-app", "scripts": { "build": "vite build", "lint": "eslint .", "test": "vitest run", "dev": "vite" } }\n' }
  for (const [f, text] of Object.entries(own)) writeFileSync(join(up, f), text)
  writeFileSync(join(up, 'kit.config.json'), JSON.stringify({ project: { name: 'copy-app' }, hooks: { shellPath: 'bash' } }))
  const r = run('install.mjs', ['--target', up, '--packs', 'react-vite', '--layers', 'supabase,upstream-owned'])
  if (r.status !== 0 || !r.stdout.includes('SKIP-OVERRIDE .gitignore')) fail(`upstream-owned install: exit ${r.status}: ${(r.stdout + r.stderr).trim().split('\n').pop()}`)
  for (const [f, text] of Object.entries(own)) if (read(up, f) !== text) fail(`upstream-owned install wrote the upstream-owned ${f}`)
  const wf = existsSync(join(up, 'AGENTS.workflow.md')) ? read(up, 'AGENTS.workflow.md') : ''
  if (!wf.includes('Never edit an upstream-owned path') || !/^@AGENTS\.workflow\.md$/m.test(read(up, 'CLAUDE.md'))) fail('upstream-owned: AGENTS.workflow.md lacks the layer rule, or CLAUDE.md does not import it')
  if (!existsSync(join(up, '.claude/commands/pull-copy.md'))) fail('upstream-owned: /pull-copy not installed')
  for (const p of ciProblems(up, { args: ['--packs', 'react-vite'], cfg: {}, ci: { install: 'npm install --no-audit --no-fund', lintScope: 'changed', appAuditMode: 'report' } })) fail(`upstream-owned: ${p}`)
  for (const p of linkProblems(up)) fail(`upstream-owned: link check: ${p.file}:${p.line}: ${p.what}`)
  try {
    const ups = evalBlock(read(up, 'scripts/scope-check.mjs'), 'const UPSTREAM = ', '  .map((p) =>', 'UPSTREAM')
    if (JSON.stringify(ups) !== '[".gitignore","AGENTS.md","package.json","package-lock.json"]') fail(`upstream-owned: scope-check UPSTREAM is ${JSON.stringify(ups)}`)
  } catch (e) {
    fail(`upstream-owned: could not evaluate scope-check UPSTREAM: ${e.message}`)
  }
  const s = run('sync.mjs', ['--target', up])
  if (!/dry-run — 0 new, 0 kit-update, 0 conflicts/.test(s.stdout) || /NOTE override .* is not a file this kit ships/.test(s.stdout)) fail(`upstream-owned: sync right after install: ${s.stdout.trim().split('\n').pop()}`)
  const d = run('drift-check.mjs', ['--target', up, '--verbose'])
  const ovRows = d.stdout.split('\n').filter((l) => l.startsWith('override '))
  if (d.status !== 0 || ovRows.some((l) => !l.includes('upstream-owned (ownership.upstreamPaths)')) || JSON.parse(read(up, 'kit.config.json')).overrides?.length) fail(`upstream-owned: drift-check must be ok with only upstream-owned overrides: ${d.stdout.trim().split('\n').pop()}`)
  // A project list replaces the layer default; a kit file it names becomes an override (never written).
  const cfgPath = join(up, 'kit.config.json')
  writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(read(up, 'kit.config.json')), ownership: { upstreamPaths: ['.gitignore', 'AGENTS.md', 'package.json', '.vscode/'] } }))
  run('sync.mjs', ['--target', up, '--apply']) // the scope guard renders the new list
  const v = run('drift-check.mjs', ['--target', up, '--verbose'])
  if (v.status !== 0 || !v.stdout.includes('override  .vscode/settings.json — upstream-owned (ownership.upstreamPaths)')) fail(`upstream-owned: a folder glob in ownership.upstreamPaths must make its kit files overrides: ${v.stdout.trim().split('\n').slice(-2).join(' | ')}`)
  rmSync(up, { recursive: true, force: true })
}

// plan-name-similarity (the rendered core script). Without the review's flags its output is v1.3.0's, line for line (the
// expected text below is what v1.3.0 prints on this fixture): save-plan and plan-write-guard.sh read it. --stem matches
// by stem ("favourite" = "favorites"); --related finds a closed plan whose text covers the request though its title does
// not; --scope lists an open plan sharing files (a bare folder counts as the folder), and only with --scope.
if (core) {
  const sim = tmp('sim')
  cpSync(join(core, 'scripts'), join(sim, 'scripts'), { recursive: true })
  mkdirSync(join(sim, 'plans', '1-100'), { recursive: true })
  writeFileSync(join(sim, 'plans', '1-100', '012-favorites-button-on-item-list.plan.md'), '# Plan 012 — Favorites Button on the Item List\n\nStatus: done\n\n## Problem Statement\nUsers mark items as favorites; a "Favorites only" toggle joins the filter sidebar.\n')
  writeFileSync(join(sim, 'plans', '1-100', '013-order-export.plan.md'), '# Plan 013 — Order Export\n\nStatus: done\n\n## Problem Statement\nExport orders to a spreadsheet.\n')
  writeFileSync(join(sim, 'plans', '020-item-list-paging.plan.md'), '# Plan 020 — Item List Paging\n\nStatus: active\n\n## Read-Write Scope\n\n```scope\nsrc/app/items/**\n```\n')
  const sn = (...a) => spawnSync(process.execPath, [join(sim, 'scripts', 'plan-name-similarity.mjs'), ...a], { encoding: 'utf8' }).stdout.replace(/\r\n/g, '\n')
  const v130 = {
    'Favourite button on item lists': 'PLAN_SIMILARITY: no similar plans for "Favourite button on item lists" - safe to save as new.\n',
    'Item list paging': 'PLAN_SIMILARITY: 1 similar plan(s) for "Item list paging" - confirm with Human before write.\n- plans/020-item-list-paging.plan.md\n  title: Item List Paging\n  why: similar because name shares: item, list, paging (score 1) | Status: active\nAsk Human: rewrite existing / save as new / cancel\n',
    'Item lists paging': 'PLAN_SIMILARITY: no similar plans for "Item lists paging" - safe to save as new.\n',
  }
  for (const [q, want] of Object.entries(v130)) {
    const got = sn(`--name=${q}`)
    if (got !== want) fail(`plan-name-similarity default output for "${q}" differs from v1.3.0: ${JSON.stringify(got)}`)
  }
  const title = sn('--name=Favourite button on item lists', '--stem')
  if (!/PLAN_SIMILARITY: 1 similar plan/.test(title) || !title.includes('plans/1-100/012-favorites-button-on-item-list.plan.md')) fail(`plan-name-similarity --stem: "Favourite button on item lists" must match "Favorites Button on the Item List": ${title.trim().split('\n')[0]}`)
  const rel = sn('--name=favourite items filter', '--related')
  if (!/PLAN_SIMILARITY: no similar plans/.test(rel) || !/PLAN_RELATED: 1 plan\(s\)/.test(rel) || !rel.includes('- plans/1-100/012-favorites-button-on-item-list.plan.md (closed)')) fail(`plan-name-similarity --related: the closed favourites plan must be found by its text: ${rel.trim().split('\n').slice(0, 3).join(' | ')}`)
  const scopeCases = [
    ['src/app/items/badge.ts,docs/x.md', true], ['src/app/items', true], ['src/app/items/', true], ['src/**', true],
    ['src/app/*.ts', false], ['*.md', false], ['server/routes/x.js', false], ['src/app/items-old/**', false],
  ]
  for (const [globs, meets] of scopeCases) {
    const out = sn('--name=item badges', `--scope=${globs}`)
    const listed = /PLAN_SCOPE_OVERLAP: 1 open plan/.test(out) && out.includes('plans/020-item-list-paging.plan.md (Status: active)')
    if (listed !== meets || (!meets && !/PLAN_SCOPE_OVERLAP: none/.test(out))) fail(`plan-name-similarity --scope=${globs} vs src/app/items/**: must ${meets ? '' : 'not '}overlap: ${out.trim().split('\n').pop()}`)
  }
  const fileOnly = sn('--file=plans/020-item-list-paging.plan.md')
  if (/PLAN_SCOPE_OVERLAP|PLAN_RELATED/.test(fileOnly)) fail(`plan-name-similarity --file without --scope must not print the scope search: ${fileOnly.trim().split('\n').pop()}`)
  rmSync(sim, { recursive: true, force: true })
}

// The PowerShell wrappers (Windows PowerShell 5) resolve -Target and -Config as PowerShell does: relative, absolute,
// with a trailing slash (tab completion; the argument after it, -Apply, must still arrive), in a folder with a space,
// drive-relative (C:name) and root-relative (\path).
const powershell = process.platform === 'win32' && spawnSync('powershell.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0
if (powershell) {
  const BS = String.fromCharCode(92) // a trailing backslash, as tab completion writes it
  const ps = (cwd, script, ...a) => {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(kit, script), ...a], { cwd, encoding: 'utf8' })
    return { status: r.status, out: `${r.stdout}${r.stderr}` }
  }
  const psDir = mkdtempSync(join(tmpdir(), 'kit ps target-'))
  const psCfg = join(tmp('ps-config'), 'my.config.json')
  writeFileSync(psCfg, JSON.stringify({ ...CORE_CFG, project: { name: 'ps-app' } }))
  const inst = ps(tmpdir(), 'kit-install.ps1', '-Target', psDir + BS, '-Config', psCfg)
  if (inst.status !== 0 || !/KIT_INSTALL: ok/.test(inst.out) || !inst.out.split(/\r?\n/).includes(`kit-install target: ${psDir}`)) fail(`kit-install.ps1 with an absolute -Target (trailing slash, a space) and -Config: exit ${inst.status}: ${inst.out.trim().split('\n').pop()}`)
  writeFileSync(join(psDir, 'kit.config.json'), readFileSync(psCfg, 'utf8'))
  const parent = join(psDir, '..')
  const name = relative(parent, psDir)
  const drive = psDir.slice(0, 2) // e.g. C:
  const forms = [
    ['relative', parent, name], ['relative with a trailing slash', parent, name + BS], ['absolute', kit, psDir],
    ['drive-relative', parent, `${drive}${name}`], ['root-relative', kit, psDir.slice(2)],
  ]
  for (const [what, cwd, target] of forms) {
    const d = ps(cwd, 'kit-drift.ps1', '-Target', target)
    if (d.status !== 0 || !/KIT_DRIFT: ok/.test(d.out) || !d.out.split(/\r?\n/).includes(`kit-drift target: ${psDir}`)) fail(`kit-drift.ps1 with a ${what} -Target (${target}): exit ${d.status}: ${d.out.trim().split('\n').slice(0, 2).join(' | ')}`)
  }
  const absSync = ps(kit, 'kit-sync.ps1', '-Target', psDir)
  if (absSync.status !== 0 || !/KIT_SYNC: dry-run/.test(absSync.out)) fail(`kit-sync.ps1 with an absolute -Target: exit ${absSync.status}: ${absSync.out.trim().split('\n').pop()}`)
  const slashApply = ps(parent, 'kit-sync.ps1', '-Target', name + BS, '-Apply')
  if (slashApply.status !== 0 || !/KIT_SYNC: applied/.test(slashApply.out)) fail(`kit-sync.ps1 -Target <folder>\\ -Apply: -Apply must still arrive: exit ${slashApply.status}: ${slashApply.out.trim().split('\n').pop()}`)
  for (const d of [psDir, join(psCfg, '..')]) rmSync(d, { recursive: true, force: true })
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
console.log(`INSTALL_CHECK: ok — ${fixtures.length} fixtures, ${haveActionlint ? `actionlint on ${actionlinted} rendered workflows` : 'actionlint not installed (skipped)'}, CI renders (ci.testMode run / if-present / skip), link check, re-install no-op, sync dry-run/apply/prune, overrides, drift-check, adopt, promoted seeds, /plan load paths, Planner docs, plan-name-similarity (default = v1.3.0, --stem, --related, --scope), ${powershell ? 'PowerShell wrappers (relative, absolute, trailing slash, drive- and root-relative)' : 'PowerShell wrappers skipped (no Windows PowerShell)'}, local + github sources, stack detection, upstream-owned layer, .kit/config.json, self-install (local:.), 0 problems`)
