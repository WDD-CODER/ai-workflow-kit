/**
 * End-to-end proof — installs this kit into a fresh project and runs one plan through the whole
 * Planner-Worker cycle, the way a project uses it. Run from the kit root:
 *
 *   node tools/e2e-check.mjs [--keep]
 *
 * A local bare repository stands in for GitHub and a plain clone of it plays the server (it merges the
 * PR and runs the todo-sync Action's scripts). Needs git, bash, python and npm (network for the
 * devDependencies). --keep leaves the temp folder for inspection.
 *
 * Cases: install + first push; Planner saves plan 001 (number, similarity, first todo.md, arch gate,
 * push to main); pre-push refuses code on main; branch guard denies code on main and allows the plan;
 * slot claim (take-plan, REALITY: clean); a second claim of the same plan is refused; scope guard allows
 * in-scope and denies out-of-scope; ship-prep scope ok; Worker push; server merge; ledger sync, plan
 * close-out, archive and slot release; drift-check ok and a no-op kit-sync afterwards.
 * Exit 0 = every case passed, 1 = failures (one line per case).
 */
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('..', import.meta.url)))
const keep = process.argv.includes('--keep')
// Long path: on Windows tmpdir() can be an 8.3 short name (RUNNER~1) while git reports the long one.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'kit-e2e-')))
const proj = join(root, 'e2e-app')
const slot = join(root, 'e2e-app-wt-1')
const slot2 = join(root, 'e2e-app-wt-2')
const origin = join(root, 'origin.git')
const server = join(root, 'server')
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'kit-e2e', GIT_AUTHOR_EMAIL: 'kit-e2e@example.invalid',
  GIT_COMMITTER_NAME: 'kit-e2e', GIT_COMMITTER_EMAIL: 'kit-e2e@example.invalid',
  GIT_TERMINAL_PROMPT: '0',
}

const results = []
let failed = 0
const sh = (cmd, args, cwd, input) => {
  const r = spawnSync(cmd, args, { cwd, env, input, encoding: 'utf8', shell: false })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}` }
}
const git = (cwd, ...args) => sh('git', args, cwd)
const node = (cwd, ...args) => sh(process.execPath, args, cwd)
const npm = (cwd, cmd) => spawnSync(cmd, { cwd, env, encoding: 'utf8', shell: true })
const tail = (s) => s.trim().split(/\r?\n/).slice(-3).join(' | ')
function check(name, ok, evidence) {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${evidence}`}`)
  if (!ok) failed++
  return ok
}
// A PreToolUse hook call, as Claude Code makes it: JSON on stdin, decision JSON on stdout.
const hook = (cwd, script, file) => {
  const r = sh('bash', [join(cwd, 'scripts', script)], cwd, JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(cwd, file) } }))
  const m = r.out.match(/"permission":"(allow|deny)"/)
  return { decision: m ? m[1] : `unparsed (${tail(r.out)})`, out: r.out }
}

function main() {
  // 1. Install the kit into a fresh project, set up hooks, first push to an empty remote.
  sh('git', ['init', '-q', '--bare', '-b', 'main', origin], root)
  sh('git', ['init', '-q', '-b', 'main', proj], root)
  writeFileSync(join(proj, 'package.json'), JSON.stringify({
    name: 'e2e-app', version: '0.0.0', private: true, type: 'module',
    scripts: { build: 'node -e "console.log(\'build ok\')"', lint: 'node -e ""', test: 'node -e ""', prepare: 'husky' },
  }, null, 2) + '\n')
  writeFileSync(join(proj, 'kit.config.json'), JSON.stringify({
    project: { name: 'e2e-app', repoName: 'e2e-app' },
    commands: { build: 'build', lint: 'lint', test: 'test' },
    hooks: { shellPath: 'bash' },
  }, null, 2) + '\n')
  const inst = node(proj, join(kit, 'tools', 'install.mjs'), '--target', proj, '--source', kit, '--install-deps')
  if (!check('install from the kit into a fresh project', inst.status === 0 && /KIT_INSTALL: ok/.test(inst.out), tail(inst.out))) return
  check('install lists no Node built-in as a devDependency', !/npm install -D [^\n]*\bnet\b/.test(inst.out), tail(inst.out))
  npm(proj, 'npm run -s prepare')
  git(proj, 'add', '-A')
  const c0 = git(proj, 'commit', '-q', '-m', 'chore: install the workflow kit')
  git(proj, 'remote', 'add', 'origin', origin)
  const p0 = git(proj, 'push', '-u', 'origin', 'main')
  check('first commit (hooks run) and first push to an empty remote', c0.status === 0 && p0.status === 0 && !/fatal/.test(p0.out), tail(c0.out + p0.out))

  // 2. Planner: save plan 001 the way save-plan does.
  const num = node(proj, 'scripts/next-plan-number.mjs')
  check('next-plan-number gives 001', num.out.trim().split(/\r?\n/).pop() === '001', tail(num.out))
  const sim = node(proj, 'scripts/plan-name-similarity.mjs', '--name=Hello Script')
  check('name-similarity finds nothing in a fresh project', sim.status === 0, tail(sim.out))
  const snap = git(proj, 'rev-parse', 'origin/main').out.trim()
  const planRel = 'plans/001-hello-script.plan.md'
  const task = '- [ ] H1: Add a hello script — `scripts/hello.mjs` prints `hello e2e`; npm script `hello` — `scripts/hello.mjs`, `package.json`'
  const plan = [
    '# Plan 001 — Hello Script', '', 'Status: draft', 'Track: code — here (not design)', `Snapshot: ${snap}`, '',
    '## Problem Statement', 'End-to-end proof of the workflow kit.', '',
    '## Goals & Success Criteria', '- [auto] `npm run -s hello` prints `hello e2e`.', '',
    '## Read-Write Scope', '', '```scope', 'scripts/hello.mjs', 'package.json', '```', '',
    '## Architecture Impact', '', '- INV-none: preserves — a new standalone script.', '',
    '## Atomic Sub-tasks', task, '',
  ].join('\n')
  const bg = hook(proj, 'branch-guard.sh', 'src/x.mjs')
  check('branch guard denies code on main in the Planner folder', bg.decision === 'deny', bg.decision)
  const bgPlan = hook(proj, 'branch-guard.sh', planRel)
  check('branch guard allows a plan file on main', bgPlan.decision === 'allow', bgPlan.decision)
  mkdirSync(join(proj, 'plans'), { recursive: true })
  writeFileSync(join(proj, planRel), plan)
  const sec = join(root, 'section.md')
  writeFileSync(sec, `### Plan 001 — Hello Script (\`${planRel}\`)\n\n${task}\n`)
  const ap = node(proj, 'scripts/todo-query.mjs', 'append', '--from', sec)
  check('todo-query append starts .claude/todo.md', ap.status === 0 && existsSync(join(proj, '.claude/todo.md')), tail(ap.out))
  const arch = node(proj, 'scripts/scope-check.mjs', '--arch', `--plan=${planRel}`)
  check('architecture gate passes INV-none', arch.status === 0 && /ARCH: (ok|skipped)/.test(arch.out), tail(arch.out))
  git(proj, 'add', planRel, '.claude/todo.md')
  const cp = git(proj, 'commit', '-q', '-m', 'plan(001): hello script')
  const pp = git(proj, 'push', 'origin', 'main')
  check('Planner commits and pushes the plan to main', cp.status === 0 && pp.status === 0, tail(cp.out + pp.out))

  // 3. pre-push refuses code on main.
  writeFileSync(join(proj, 'README.md'), '# e2e-app\n')
  git(proj, 'add', 'README.md')
  git(proj, 'commit', '-q', '-m', 'docs: readme on main')
  const bad = git(proj, 'push', 'origin', 'main')
  check('pre-push refuses a code change on main', bad.status !== 0 && /PRE_PUSH: refusing/.test(bad.out), tail(bad.out))
  git(proj, 'reset', '-q', '--hard', 'origin/main')

  // 4. Worker: slot, claim, guards, ship-prep, push.
  git(proj, 'worktree', 'add', '-q', '--detach', slot, 'origin/main')
  npm(slot, 'npm install --prefer-offline --no-audit --no-fund')
  writeFileSync(join(slot, '.worktree-root'), proj)
  writeFileSync(join(slot, '.worktree-port'), '4201')
  const tp = node(slot, 'scripts/take-plan.mjs', '001')
  check('take-plan 001 claims slot wt-1 with REALITY: clean', tp.status === 0 && /OK plan=001 branch=feat\/001-hello-script/.test(tp.out) && /REALITY: clean/.test(tp.out), tail(tp.out))

  git(proj, 'worktree', 'add', '-q', '--detach', slot2, 'origin/main')
  writeFileSync(join(slot2, '.worktree-root'), proj)
  writeFileSync(join(slot2, '.worktree-port'), '4202')
  npm(slot2, 'npm install --prefer-offline --no-audit --no-fund')
  const tp2 = node(slot2, 'scripts/take-plan.mjs', '001')
  check('a second slot cannot take a plan that is already active', tp2.status !== 0 && git(slot2, 'branch', '--show-current').out.trim() === '', tail(tp2.out))

  const inScope = hook(slot, 'scope-guard.sh', 'scripts/hello.mjs')
  check('scope guard allows a file in the plan scope', inScope.decision === 'allow' && !/check failed/.test(inScope.out), tail(inScope.out))
  const outScope = hook(slot, 'scope-guard.sh', 'README.md')
  check('scope guard denies a file outside the plan scope', outScope.decision === 'deny' && /outside this plan's Read-Write Scope/.test(outScope.out), tail(outScope.out))

  writeFileSync(join(slot, 'scripts/hello.mjs'), "console.log('hello e2e')\n")
  const pkg = JSON.parse(readFileSync(join(slot, 'package.json'), 'utf8'))
  pkg.scripts.hello = 'node scripts/hello.mjs'
  writeFileSync(join(slot, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  writeFileSync(join(slot, planRel), readFileSync(join(slot, planRel), 'utf8').replace('- [ ] H1:', '- [x] H1:'))
  const hello = npm(slot, 'npm run -s hello')
  check('Done-when: npm run -s hello prints hello e2e', (hello.stdout ?? '').trim() === 'hello e2e', `${hello.stdout}${hello.stderr}`)
  const prep = node(slot, 'scripts/ship-prep.mjs')
  check('ship-prep classifies the lane and reports scope: ok', /Lane: /.test(prep.out) && /scope: ok/.test(prep.out), tail(prep.out))
  const base = node(slot, 'scripts/ship-prep.mjs', '--check-baseline')
  check('ship-prep --check-baseline OK', /status: OK/.test(base.out) && /scope: ok/.test(base.out), tail(base.out))
  const build = npm(slot, 'npm run -s build')
  const ledger = node(slot, 'scripts/plan-ledger-check.mjs')
  check('build gate and plan ledger pass', build.status === 0 && ledger.status === 0, tail(`${build.stdout}${ledger.out}`))
  git(slot, 'add', 'scripts/hello.mjs', 'package.json', planRel)
  const wc = git(slot, 'commit', '-q', '-m', 'feat(001): hello script')
  const ss = node(slot, 'scripts/write-session-state.mjs', '--summary', 'plan 001 done', '--next', 'none')
  git(slot, 'add', 'docs')
  git(slot, 'commit', '-q', '--amend', '--no-edit')
  const wp = git(slot, 'push', '-q', '-u', 'origin', 'HEAD')
  check('Worker commits (hooks run), writes session state and pushes the branch', wc.status === 0 && ss.status === 0 && wp.status === 0, tail(wc.out + ss.out + wp.out))

  // 5. Server: merge the PR, then run the todo-sync Action's scripts.
  sh('git', ['clone', '-q', '-b', 'main', origin, server], root)
  const mg = git(server, 'merge', '-q', '--no-ff', 'origin/feat/001-hello-script', '-m', 'Merge feat/001-hello-script')
  const ms = git(server, 'push', '-q', 'origin', 'main')
  check('server merges the PR', mg.status === 0 && ms.status === 0, tail(mg.out + ms.out))
  const sync = node(server, 'scripts/todo-query.mjs', 'sync', '--merged')
  const arc = node(server, 'scripts/todo-archive.mjs')
  const close = node(server, 'scripts/plan-close.mjs')
  git(server, 'add', '-A', '.claude/todo.md', '.claude/todo-archive', 'plans')
  git(server, 'commit', '-q', '-m', 'chore(todo): sync ledger and close finished plans')
  git(server, 'push', '-q', 'origin', 'main')
  const closed = existsSync(join(server, 'plans/1-100/001-hello-script.plan.md')) && !existsSync(join(server, planRel))
  const archived = existsSync(join(server, '.claude/todo-archive')) && readdirSync(join(server, '.claude/todo-archive')).length > 0
  check('after merge: ledger synced, plan closed to plans/1-100/, section archived', sync.status === 0 && closed && archived, tail(sync.out + arc.out + close.out))

  // 6. Planner pulls; the slot is released; the project still matches the kit.
  git(proj, 'pull', '-q', '--ff-only')
  const free = node(proj, 'scripts/free-merged-slots.mjs')
  const list = node(proj, 'scripts/lib/slot.mjs', '--list')
  check('free-merged-slots releases wt-1 to idle', /wt-1: freed/.test(free.out) && /wt-1: detached idle/.test(list.out), tail(free.out + list.out))
  const drift = node(proj, join(kit, 'tools', 'drift-check.mjs'), '--target', proj)
  check('drift-check ok after the full cycle', drift.status === 0 && /KIT_DRIFT: ok/.test(drift.out), tail(drift.out))
  const ks = node(proj, join(kit, 'tools', 'sync.mjs'), '--target', proj)
  check('kit-sync dry-run is a no-op', /0 new, 0 kit-update, 0 conflicts/.test(ks.out), tail(ks.out))
}

try {
  main()
} catch (e) {
  check('e2e run', false, e.stack ?? String(e))
}
console.log(results.join('\n'))
if (keep) console.log(`E2E: kept ${root}`)
else {
  git(proj, 'worktree', 'remove', '--force', slot)
  git(proj, 'worktree', 'remove', '--force', slot2)
  try { rmSync(root, { recursive: true, force: true }) } catch { /* Windows may hold a file briefly */ }
}
const total = results.length
console.log(failed ? `E2E_CHECK: FAIL — ${failed} of ${total} cases failed` : `E2E_CHECK: ok — ${total} cases passed`)
process.exit(failed ? 1 : 0)
