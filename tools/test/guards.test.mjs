// The PreToolUse guards (plan 017), run through the real hook scripts on a scratch repo with a wt-1 slot.
//   node --test tools/test/guards.test.mjs
// Runs the installed scripts of the kit repo (scripts/, after `node tools/sync.mjs --target . --apply` and
// `npm ci` inside scripts/). GUARDS_ROOT=<project> runs another installed copy instead (tools/e2e-check.mjs points it
// at its fresh e2e project). The scripts are copied into the scratch repo, because a guard judges its own folder.
// The out-of-scope file is NOTES.md, never README.md or CHANGELOG.md: those are the kit repo's own hotspots
// (paths.hotspots), which every plan may append to.
//
// Folders of the scratch repo (all worktrees of one repository):
//   proj/        the main (Planner) folder, branch main
//   proj-wt-1/   a slot (.worktree-port + .worktree-plan), branch feat/001-alpha, plan 001 scope src/**
//   proj-merge/  not a slot, branch feat/001-merge (a run's merge folder named after plan 001)
//   proj-orch/   not a slot, branch orch/run-1, .worktree-plan names plan 001
//   proj-free/   not a slot, branch chore/free (names no plan)
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, existsSync, realpathSync } from 'node:fs'
import { join, resolve, basename, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const project = process.env.GUARDS_ROOT ? resolve(process.env.GUARDS_ROOT) : kit
// The time a guard run may take on a no-op input (the hook limit is 10 s; Git Bash start-up on Windows is slow).
const LIMIT_MS = Number(process.env.GUARDS_LIMIT_MS || 2000)

let base, main, slot, merge, orch, free, master, broken, nocheck, solo
after(() => {
  if (!base || process.env.GUARDS_KEEP) return
  // Worktrees first, so git does not keep stale entries; then the folder.
  for (const d of [slot, merge, orch, free, master, broken, nocheck]) spawnSync('git', ['worktree', 'remove', '--force', d], { cwd: main })
  rmSync(base, { recursive: true, force: true })
})

function gitIn(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=guards-test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}

const plan = (nnn, slug, scope) => [
  `# Plan ${nnn} — ${slug}`, '', 'Status: active', 'Depends-on: none', '',
  '## Read-Write Scope', '', '```scope', ...scope, '```', '',
  '## Atomic Sub-tasks', '- [ ] T1: Do it — src', '',
].join('\n')

// The installed scripts, without node_modules (committed to the scratch repo).
function addScripts(dir) {
  cpSync(join(project, 'scripts'), join(dir, 'scripts'), { recursive: true, filter: (src) => basename(src) !== 'node_modules' })
}
// The scripts' own dependencies (picomatch), copied into each worktree — never linked: removing the scratch folder
// recursively would follow a link and empty the real scripts/node_modules.
function linkModules(dir) {
  const mods = join(project, 'scripts', 'node_modules')
  if (existsSync(mods) && !existsSync(join(dir, 'scripts', 'node_modules'))) cpSync(mods, join(dir, 'scripts', 'node_modules'), { recursive: true, dereference: true })
}

before(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'guards-')))
  main = join(base, 'proj')
  slot = join(base, 'proj-wt-1')
  merge = join(base, 'proj-merge')
  orch = join(base, 'proj-orch')
  free = join(base, 'proj-free')
  mkdirSync(main)
  gitIn(main, 'init', '-q', '-b', 'main')
  addScripts(main)
  mkdirSync(join(main, 'plans'))
  mkdirSync(join(main, 'src'))
  writeFileSync(join(main, 'plans', '001-alpha.plan.md'), plan('001', 'alpha', ['src/**']))
  writeFileSync(join(main, 'src', 'a.js'), 'export const a = 1\n')
  writeFileSync(join(main, 'NOTES.md'), '# scratch\n')
  writeFileSync(join(main, '.gitignore'), ['scripts/node_modules/', '.worktree-*', '.claude/sessions/', '.claude/.session-state-path', ''].join('\n'))
  gitIn(main, 'add', '-A')
  gitIn(main, 'commit', '-q', '-m', 'scratch')
  linkModules(main)

  gitIn(main, 'worktree', 'add', '-q', '-b', 'feat/001-alpha', slot)
  writeFileSync(join(slot, '.worktree-port'), '5191')
  writeFileSync(join(slot, '.worktree-root'), main)
  writeFileSync(join(slot, '.worktree-plan'), 'plans/001-alpha.plan.md')
  linkModules(slot)

  gitIn(main, 'worktree', 'add', '-q', '-b', 'feat/001-merge', merge)
  linkModules(merge)
  gitIn(main, 'worktree', 'add', '-q', '-b', 'orch/run-1', orch)
  writeFileSync(join(orch, '.worktree-plan'), 'plans/001-alpha.plan.md')
  linkModules(orch)
  gitIn(main, 'worktree', 'add', '-q', '-b', 'chore/free', free)
  linkModules(free)

  // Fail-closed fixtures: a guarded folder (branch master) and a plan folder whose own guard answers nothing, a plan
  // folder whose scope check crashes, and a separate repository with no guarded folder at all.
  master = join(base, 'proj-master')
  broken = join(base, 'proj-broken')
  nocheck = join(base, 'proj-nocheck')
  solo = join(base, 'solo')
  gitIn(main, 'worktree', 'add', '-q', '-b', 'master', master)
  gitIn(main, 'worktree', 'add', '-q', '-b', 'feat/001-broken', broken)
  gitIn(main, 'worktree', 'add', '-q', '-b', 'feat/001-nocheck', nocheck)
  for (const d of [master, broken]) writeFileSync(join(d, 'scripts', 'lib', 'guard.mjs'), 'process.exit(0)\n')
  linkModules(nocheck)
  writeFileSync(join(nocheck, 'scripts', 'scope-check.mjs'), 'process.exit(3)\n')
  mkdirSync(solo)
  gitIn(solo, 'init', '-q', '-b', 'chore/solo')
  addScripts(solo)
  writeFileSync(join(solo, 'NOTES.md'), '# solo\n')
  gitIn(solo, 'add', '-A')
  gitIn(solo, 'commit', '-q', '-m', 'solo')
  linkModules(solo)
})

// A PreToolUse hook call as Claude Code makes it: JSON on stdin (tool_name, tool_input, cwd), decision JSON on stdout.
// `from` is the folder whose scripts run (CLAUDE_PROJECT_DIR) and the session cwd unless `cwd` is given.
function hook(from, script, toolInput, { tool = 'Write', cwd = from, env = {} } = {}) {
  const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput, cwd })
  const t0 = Date.now()
  const r = spawnSync('bash', [join(from, 'scripts', script)], { cwd, input, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30000 })
  const ms = Date.now() - t0
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const m = (r.stdout ?? '').match(/"permission":"(allow|deny)"/)
  return { decision: m ? m[1] : `unparsed (${out.trim().slice(-300)})`, out, stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status, ms }
}
const write = (from, script, file, opts) => hook(from, script, { file_path: file, content: 'x\n' }, opts)
const bash = (from, script, command, opts) => hook(from, script, { command }, { tool: 'Bash', ...opts })

// (1) + (2): an agent whose session runs in the main folder writes into the slot.
test('(1) a main-folder session writing into wt-1 outside the plan scope is denied with SCOPE_GUARD:', () => {
  const r = write(main, 'scope-guard.sh', join(slot, 'NOTES.md'))
  assert.equal(r.decision, 'deny', r.out)
  assert.match(r.out, /SCOPE_GUARD:/)
})

test('(2) the same write inside the plan scope is allowed', () => {
  const r = write(main, 'scope-guard.sh', join(slot, 'src', 'b.js'))
  assert.equal(r.decision, 'allow', r.out)
  assert.equal(r.status, 0)
  assert.doesNotMatch(r.out, /check failed/)
})

test('(3) a write on main outside plans/*.plan.md and .claude/todo.md is refused with BRANCH_GUARD:', () => {
  const r = write(main, 'branch-guard.sh', join(main, 'src', 'a.js'))
  assert.equal(r.decision, 'deny', r.out)
  assert.match(r.out, /BRANCH_GUARD:/)
  const planOk = write(main, 'branch-guard.sh', join(main, 'plans', '002-beta.plan.md'))
  assert.equal(planOk.decision, 'allow', planOk.out)
  const todoOk = write(main, 'branch-guard.sh', join(main, '.claude', 'todo.md'))
  assert.equal(todoOk.decision, 'allow', todoOk.out)
})

test('(4) a runtime file (.claude/sessions/**, .claude/.session-state-path) on main is allowed', () => {
  for (const f of [join(main, '.claude', 'sessions', 'x', 'y.md'), join(main, '.claude', '.session-state-path')]) {
    const r = write(main, 'branch-guard.sh', f)
    assert.equal(r.decision, 'allow', r.out)
    assert.equal(r.status, 0)
  }
})

test('(5) a Bash command that writes into a guarded path is denied: on main and outside the slot scope', () => {
  const writes = (p) => [`cat > ${p} <<'EOF'\nhello\nEOF`, `echo x >> ${p}`, `printf 'x' | tee ${p}`]
  for (const cmd of writes('src/new.js')) {
    const r = bash(main, 'branch-guard.sh', cmd)
    assert.equal(r.decision, 'deny', `${cmd}\n${r.out}`)
    assert.match(r.out, /BRANCH_GUARD:/)
  }
  for (const cmd of writes('NOTES.md')) {
    const r = bash(main, 'scope-guard.sh', cmd, { cwd: slot })
    assert.equal(r.decision, 'deny', `${cmd}\n${r.out}`)
    assert.match(r.out, /SCOPE_GUARD:/)
  }
  // An absolute path into the slot, from a session in the main folder.
  const abs = bash(main, 'scope-guard.sh', `echo x > "${join(slot, 'NOTES.md').replace(/\\/g, '/')}"`)
  assert.equal(abs.decision, 'deny', abs.out)
  // sed -i, cp and mv targets.
  for (const cmd of ['sed -i s/a/b/ NOTES.md', 'cp src/a.js NOTES.md', 'mv src/a.js notes.md']) {
    const r = bash(main, 'scope-guard.sh', cmd, { cwd: slot })
    assert.equal(r.decision, 'deny', `${cmd}\n${r.out}`)
  }
})

test('(5) read-only and in-scope Bash commands are allowed', () => {
  for (const cmd of ['cat NOTES.md', 'git status', 'ls -la src 2>&1 | head -5', 'node -e "1" > /dev/null 2>&1', 'grep -n x NOTES.md >&2']) {
    const r = bash(main, 'branch-guard.sh', cmd)
    assert.equal(r.decision, 'allow', `${cmd}\n${r.out}`)
    const s = bash(main, 'scope-guard.sh', cmd, { cwd: slot })
    assert.equal(s.decision, 'allow', `${cmd}\n${s.out}`)
  }
  const inScope = bash(main, 'scope-guard.sh', `echo x > src/c.js`, { cwd: slot })
  assert.equal(inScope.decision, 'allow', inScope.out)
  const tmp = bash(main, 'branch-guard.sh', `echo x > "${join(base, 'outside.log').replace(/\\/g, '/')}"`)
  assert.equal(tmp.decision, 'allow', tmp.out)
  const planOnMain = bash(main, 'branch-guard.sh', `cat > plans/003-gamma.plan.md <<'EOF'\n# x\nEOF`)
  assert.equal(planOnMain.decision, 'allow', planOnMain.out)
})

test('merge folder on feat/NNN-slug (not a slot): plan NNN scope applies', () => {
  const out = write(merge, 'scope-guard.sh', join(merge, 'NOTES.md'))
  assert.equal(out.decision, 'deny', out.out)
  assert.match(out.out, /SCOPE_GUARD:/)
  assert.match(out.out, /approved: /)
  const inside = write(merge, 'scope-guard.sh', join(merge, 'src', 'b.js'))
  assert.equal(inside.decision, 'allow', inside.out)
  const fromMain = write(main, 'scope-guard.sh', join(merge, 'NOTES.md'))
  assert.equal(fromMain.decision, 'deny', fromMain.out)
})

test('merge folder on orch/<run> naming its plan in .worktree-plan: plan scope applies', () => {
  const out = write(orch, 'scope-guard.sh', join(orch, 'NOTES.md'))
  assert.equal(out.decision, 'deny', out.out)
  assert.match(out.out, /SCOPE_GUARD:/)
  const inside = write(orch, 'scope-guard.sh', join(orch, 'src', 'b.js'))
  assert.equal(inside.decision, 'allow', inside.out)
})

test('a branch that names no plan has no plan scope; main still refuses', () => {
  const r = write(free, 'scope-guard.sh', join(free, 'NOTES.md'))
  assert.equal(r.decision, 'allow', r.out)
  const onMain = write(main, 'branch-guard.sh', join(main, 'NOTES.md'))
  assert.equal(onMain.decision, 'deny', onMain.out)
})

test('scopedPlanPath (the /ship scope gate) names the plan an orch merge folder .worktree-plan holds, and agrees with the hook on a missing one', async () => {
  const scoped = (dir) => spawnSync(process.execPath, [join(dir, 'scripts', 'lib', 'slot.mjs'), '--scoped-plan'], { cwd: dir, encoding: 'utf8' })
  const r = scoped(orch)
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
  assert.match(r.stdout, /^plans\/001-alpha\.plan\.md$/m)
  assert.equal(scoped(free).stdout.trim(), '')
  // A stale .worktree-plan (its file is gone) on orch/<run>: neither /ship nor the hook applies a plan.
  const { scopedPlan } = await import(pathToFileURL(join(orch, 'scripts', 'lib', 'guard.mjs')).href)
  const marker = join(orch, '.worktree-plan')
  const saved = readFileSync(marker, 'utf8')
  writeFileSync(marker, 'plans/099-gone.plan.md')
  try {
    assert.equal(scoped(orch).stdout.trim(), '')
    assert.equal(scopedPlan(orch, 'orch/run-1'), null)
  } finally {
    writeFileSync(marker, saved)
  }
})

test(`each guard run on a no-op input takes under ${LIMIT_MS} ms and makes at most one git call on the allow path`, () => {
  const noop = join(base, 'elsewhere', 'x.txt') // outside every worktree: nothing to guard
  for (const script of ['branch-guard.sh', 'scope-guard.sh', 'plan-write-guard.sh']) {
    write(main, script, noop) // warm the file cache once
    const r = write(main, script, noop, { env: { KIT_GUARD_TRACE: '1' } })
    assert.equal(r.decision, 'allow', `${script}: ${r.out}`)
    assert.ok(r.ms < LIMIT_MS, `${script} took ${r.ms} ms`)
    if (script !== 'plan-write-guard.sh') {
      const m = r.stderr.match(/GUARD_GIT_CALLS: (\d+)/)
      assert.ok(m, `${script} reports GUARD_GIT_CALLS under KIT_GUARD_TRACE=1: ${r.stderr}`)
      assert.ok(Number(m[1]) <= 1, `${script} made ${m[1]} git calls`)
    }
  }
  // A non-guarded file inside the repo: a plan on main (branch guard) and a file in a folder with no plan (scope guard).
  const p = write(main, 'branch-guard.sh', join(main, 'plans', '001-alpha.plan.md'), { env: { KIT_GUARD_TRACE: '1' } })
  assert.equal(p.decision, 'allow', p.out)
  assert.ok(p.ms < LIMIT_MS, `branch-guard on a plan took ${p.ms} ms`)
  assert.ok(Number((p.stderr.match(/GUARD_GIT_CALLS: (\d+)/) || [])[1] ?? 99) <= 1, p.stderr)
  const f = write(free, 'scope-guard.sh', join(free, 'NOTES.md'), { env: { KIT_GUARD_TRACE: '1' } })
  assert.equal(f.decision, 'allow', f.out)
  assert.ok(f.ms < LIMIT_MS, `scope-guard in a no-plan folder took ${f.ms} ms`)
  assert.ok(Number((f.stderr.match(/GUARD_GIT_CALLS: (\d+)/) || [])[1] ?? 99) <= 1, f.stderr)
})

test('a shell target the guard cannot resolve ($VAR, $(...)) is refused where a write needs a check (fail closed)', () => {
  const onMain = bash(main, 'branch-guard.sh', 'echo x > "$OUT_FILE"')
  assert.equal(onMain.decision, 'deny', onMain.out)
  assert.match(onMain.out, /cannot tell which file/)
  const inSlot = bash(main, 'scope-guard.sh', 'echo x > $(pwd)/NOTES.md', { cwd: slot })
  assert.equal(inSlot.decision, 'deny', inSlot.out)
  // From a folder with no plan: a sibling worktree of the repository holds a plan, and the target may be there.
  const free_ = bash(free, 'scope-guard.sh', 'echo x > "$OUT_FILE"')
  assert.equal(free_.decision, 'deny', free_.out)
  assert.match(free_.out, /SCOPE_GUARD:/)
  // From a feature branch: the main folder on main is a guarded sibling.
  const freeBranch = bash(free, 'branch-guard.sh', 'echo x > "$OUT_FILE"')
  assert.equal(freeBranch.decision, 'deny', freeBranch.out)
  assert.match(freeBranch.out, /BRANCH_GUARD:/)
  // The shell's folder after a cd into a guarded worktree counts, even when the session folder is not guarded.
  const cdMain = bash(free, 'branch-guard.sh', `cd "${main.replace(/\\/g, '/')}" && echo x > "$OUT_FILE"`)
  assert.equal(cdMain.decision, 'deny', cdMain.out)
  // A repository with no guarded folder at all: nothing to protect, allowed.
  for (const script of ['branch-guard.sh', 'scope-guard.sh']) {
    const r = bash(solo, script, 'echo x > "$OUT_FILE"')
    assert.equal(r.decision, 'allow', `${script}: ${r.out}`)
  }
})

// A hook call with raw stdin (not built from a tool input).
function raw(from, script, input) {
  const r = spawnSync('bash', [join(from, 'scripts', script)], { cwd: from, input, encoding: 'utf8', timeout: 30000 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const m = (r.stdout ?? '').match(/"permission":"(allow|deny)"/)
  return { decision: m ? m[1] : `unparsed (${out.trim().slice(-300)})`, out, status: r.status }
}

test('branch guard fails closed on a guarded folder: empty or unparseable input, or a Write with no path', () => {
  for (const input of ['', 'not json {', JSON.stringify({ tool_name: 'Write', tool_input: { content: 'x' }, cwd: main })]) {
    const r = raw(main, 'branch-guard.sh', input)
    assert.equal(r.decision, 'deny', `${JSON.stringify(input)}: ${r.out}`)
    assert.match(r.out, /BRANCH_GUARD:/)
    assert.equal(r.status, 0)
    // The same input in a folder that is not guarded (a feature branch) is allowed, as before.
    const ok = raw(free, 'branch-guard.sh', input)
    assert.equal(ok.decision, 'allow', `${JSON.stringify(input)}: ${ok.out}`)
  }
  // Plans, the todo list and runtime files stay writable on main.
  for (const f of [join(main, 'plans', '004-delta.plan.md'), join(main, '.claude', 'todo.md'), join(main, '.claude', 'sessions', 'a.md'), join(main, '.claude', '.session-state-path'), join(main, '.claude', '.plan-write-ack')]) {
    const r = write(main, 'branch-guard.sh', f)
    assert.equal(r.decision, 'allow', `${f}: ${r.out}`)
  }
})

test('scope guard fails closed on a plan folder: unparseable input, and a scope check that crashes', () => {
  const r = raw(slot, 'scope-guard.sh', 'not json {')
  assert.equal(r.decision, 'deny', r.out)
  assert.match(r.out, /SCOPE_GUARD:/)
  assert.equal(raw(free, 'scope-guard.sh', 'not json {').decision, 'allow')
  const crash = write(nocheck, 'scope-guard.sh', join(nocheck, 'src', 'b.js'))
  assert.equal(crash.decision, 'deny', crash.out)
  assert.match(crash.out, /SCOPE_GUARD: the scope check failed/)
})

test('a sibling worktree whose own guard gives no answer is judged by the local rule (fail closed)', () => {
  // master is a guarded branch folder; its guard prints nothing.
  const b = write(free, 'branch-guard.sh', join(master, 'src', 'a.js'))
  assert.equal(b.decision, 'deny', b.out)
  assert.match(b.out, /BRANCH_GUARD:/)
  const plan = write(free, 'branch-guard.sh', join(master, 'plans', '005-eps.plan.md'))
  assert.equal(plan.decision, 'allow', plan.out)
  // broken holds plan 001 (scope); its guard prints nothing.
  const s = write(free, 'scope-guard.sh', join(broken, 'src', 'b.js'))
  assert.equal(s.decision, 'deny', s.out)
  assert.match(s.out, /SCOPE_GUARD:/)
  // broken is on a feature branch: no branch rule, allowed.
  assert.equal(write(free, 'branch-guard.sh', join(broken, 'src', 'b.js')).decision, 'allow')
})

test('bashWrites: redirects, heredocs, tee, sed -i, cp/mv, cd and bash -c; quotes and fd duplication are not targets', async () => {
  const { bashWrites } = await import(pathToFileURL(join(project, 'scripts', 'lib', 'guard.mjs')).href)
  const cwd = main
  const paths = (cmd) => bashWrites(cmd, cwd).map((t) => (t.path ? relative(cwd, t.path).split(sep).join('/') : `?${t.unresolved}`))
  assert.deepEqual(paths("echo 'a > b' \"c > d\""), [])
  assert.deepEqual(paths('node x.mjs 2>&1 | tail -3 >&2'), [])
  assert.deepEqual(paths('cmd > /dev/null 2>/dev/null'), [])
  assert.deepEqual(paths("cat > out.md <<'EOF'\nline > not-a-target\nEOF\necho done >> log.txt"), ['out.md', 'log.txt'])
  assert.deepEqual(paths('printf x | tee -a a.txt b.txt'), ['a.txt', 'b.txt'])
  assert.deepEqual(paths("sed -i 's/a/b/' f1 f2"), ['f1', 'f2'])
  assert.deepEqual(paths("sed -n 's/a/b/p' f1"), [])
  assert.deepEqual(paths('cd src && echo x > y.js'), ['src/y.js'])
  assert.deepEqual(paths('bash -c "echo x > z.txt"'), ['z.txt'])
  assert.deepEqual(paths('mv a.js b.js'), ['b.js', 'a.js'])
  assert.deepEqual(paths('[[ 2 > 1 ]] && echo ok'), [])
  // A commit message in a heredoc inside "$(...)": quotes, parens and arrows in the body are data.
  assert.deepEqual(paths(`git commit -m "$(cat <<'EOF'\nfeat: a -> b "quoted" (open\n\nmore > text\nEOF\n)" && git push`), [])
  assert.deepEqual(paths('echo "$(date) > not-a-file" > real.txt'), ['real.txt'])
  if (process.platform === 'win32') {
    // Git Bash reports its cwd as /c/...: the same folder.
    const posixCwd = `/${cwd[0].toLowerCase()}${cwd.slice(2).replace(/\\/g, '/')}`
    assert.deepEqual(bashWrites('echo x > y.txt', posixCwd).map((t) => t.path.toLowerCase()), [join(cwd, 'y.txt').toLowerCase()])
  }
  assert.deepEqual(paths('echo x > "$HOME_NOT_KNOWN/x"'), ['?$HOME_NOT_KNOWN/x'])
  // A cd the guard cannot follow makes the folder unknown: later relative targets fail closed until a resolvable cd.
  assert.deepEqual(paths('cd "$WT" && echo x > NOTES.md'), ['?NOTES.md'])
  assert.deepEqual(paths('cd $(git rev-parse --show-toplevel)/../x && echo x > f.txt && tee g.txt'), ['?f.txt', '?g.txt'])
  assert.deepEqual(paths('cd "$WT" && bash -c "echo x > h.txt"'), ['?h.txt'])
  assert.deepEqual(paths(`cd "$WT" && cd "${cwd.split(sep).join('/')}" && echo x > k.txt`), ['k.txt'])
})

test('bashWrites: a write inside $( … ) or backticks counts; > in [[ … ]] and (( … )) is a comparison', async () => {
  const { bashWrites } = await import(pathToFileURL(join(project, 'scripts', 'lib', 'guard.mjs')).href)
  const cwd = main
  const paths = (cmd) => bashWrites(cmd, cwd).map((t) => (t.path ? relative(cwd, t.path).split(sep).join('/') : `?${t.unresolved}`))
  assert.deepEqual(paths(`x=$(cat > NOTES.md <<'EOF'\nhello\nEOF\n)`), ['NOTES.md'])
  assert.deepEqual(paths('echo "$(echo x > a.txt)"'), ['a.txt'])
  assert.deepEqual(paths('y=`tee b.txt < /dev/null`'), ['b.txt'])
  assert.deepEqual(paths('echo $(cd src && echo x > c.js)'), ['src/c.js'])
  assert.deepEqual(paths('if [[ $a > $b ]]; then :; fi'), [])
  assert.deepEqual(paths('while [[ "$x" > "$y" && $z < $w ]]; do :; done'), [])
  assert.deepEqual(paths('(( a > b )) && echo ok'), [])
  assert.deepEqual(paths('for ((i = 0; i < 3; i++)); do echo $i; done'), [])
  assert.deepEqual(paths('echo $(( 4 > 2 ))'), [])
  // After the test, a real redirect still counts; a reserved word before a command does not hide it.
  assert.deepEqual(paths('if [[ $a > $b ]]; then echo x > d.txt; fi'), ['d.txt'])
  assert.deepEqual(paths('if cp a.js e.js; then :; fi'), ['e.js'])
  // Nested subshells that only look like (( … )) are commands.
  assert.deepEqual(paths('((echo x > f.txt) )'), ['f.txt'])
})

test('a write hidden in $( … ) on a guarded folder is denied; an [[ … ]] comparison is allowed', () => {
  const sub = `x=$(cat > NOTES.md <<'EOF'\nhello\nEOF\n)`
  const onMain = bash(main, 'branch-guard.sh', sub)
  assert.equal(onMain.decision, 'deny', onMain.out)
  assert.match(onMain.out, /BRANCH_GUARD:/)
  const inSlot = bash(main, 'scope-guard.sh', sub, { cwd: slot })
  assert.equal(inSlot.decision, 'deny', inSlot.out)
  assert.match(inSlot.out, /SCOPE_GUARD:/)
  for (const script of ['branch-guard.sh', 'scope-guard.sh']) {
    const r = bash(main, script, 'if [[ $a > $b ]]; then :; fi', { cwd: script === 'scope-guard.sh' ? slot : main })
    assert.equal(r.decision, 'allow', `${script}: ${r.out}`)
  }
})

test('bashWrites: a quoted or escaped [[ is a word, an unclosed [[ fails closed, (( … )) substitutions count', async () => {
  const { bashWrites } = await import(pathToFileURL(join(project, 'scripts', 'lib', 'guard.mjs')).href)
  const cwd = main
  const paths = (cmd) => bashWrites(cmd, cwd).map((t) => (t.path ? relative(cwd, t.path).split(sep).join('/') : `?${t.unresolved}`))
  assert.deepEqual(paths("echo '[[' > g1.txt"), ['g1.txt'])
  assert.deepEqual(paths('echo "[[" > g2.txt'), ['g2.txt'])
  assert.deepEqual(paths('echo \\[\\[ > g3.txt'), ['g3.txt'])
  assert.deepEqual(paths("'[[' x > g4.txt"), ['g4.txt'])
  assert.deepEqual(paths('[[ x > g5.txt'), ['g5.txt'])
  assert.deepEqual(paths('[[ x > g6.txt; echo ok'), ['g6.txt'])
  assert.deepEqual(paths("[[ a > b ']]' > g7.txt"), ['b', 'g7.txt'])
  assert.deepEqual(paths('(( $(cat > g8.txt <<<x) ))'), ['g8.txt'])
  assert.deepEqual(paths('echo $(( `tee g9.txt < /dev/null` + 1 ))'), ['g9.txt'])
  assert.deepEqual(paths('echo "$(( $(( $(echo x > g10.txt) )) ))"'), ['g10.txt'])
  // Still comparisons.
  assert.deepEqual(paths('if [[ $a > $b ]]; then :; fi'), [])
  assert.deepEqual(paths('(( a > b ))'), [])
  assert.deepEqual(paths('echo $(( 4 > 2 ))'), [])
})

test('a quoted [[, an unclosed [[ or a substitution inside (( … )) cannot hide a write on main', () => {
  for (const cmd of [
    "echo '[[' > NOTES.md",
    'echo \\[\\[ > NOTES.md',
    '[[ x > NOTES.md',
    '(( $(cat > NOTES.md <<<x) ))',
    'echo $(( `tee NOTES.md < /dev/null` ))',
  ]) {
    const r = bash(main, 'branch-guard.sh', cmd)
    assert.equal(r.decision, 'deny', `${cmd}: ${r.out}`)
    assert.match(r.out, /BRANCH_GUARD:/)
  }
  for (const cmd of ['if [[ $a > $b ]]; then :; fi', '(( a > b ))']) {
    const r = bash(main, 'branch-guard.sh', cmd)
    assert.equal(r.decision, 'allow', `${cmd}: ${r.out}`)
  }
})

test('the Bash matcher runs the plan-file guard: a shell command writing a new, name-similar plan is denied', () => {
  const settings = JSON.parse(readFileSync(join(project, '.claude', 'settings.json'), 'utf8'))
  const bashHooks = settings.hooks.PreToolUse.find((h) => h.matcher === 'Bash').hooks.map((h) => h.command).join('\n')
  assert.match(bashHooks, /scripts\/lib\/guard\.mjs" plan/)
  assert.match(bashHooks, /branch-guard\.sh/)
  assert.match(bashHooks, /scope-guard\.sh/)
  const planGuard = (command) => {
    const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: main })
    const r = spawnSync(process.execPath, [join(main, 'scripts', 'lib', 'guard.mjs'), 'plan'], { cwd: main, input, encoding: 'utf8', timeout: 30000 })
    const m = (r.stdout ?? '').match(/"permission":"(allow|deny)"/)
    return { decision: m ? m[1] : `unparsed (${r.stdout}${r.stderr})`, out: `${r.stdout}${r.stderr}` }
  }
  // plans/001-alpha.plan.md exists: 009-alpha is name-similar.
  const similar = planGuard(`cat > plans/009-alpha.plan.md <<'EOF'\n# Plan 009 — alpha\nEOF`)
  assert.equal(similar.decision, 'deny', similar.out)
  assert.match(similar.out, /PLAN_WRITE_GUARD: blocked new plan write/)
  // An existing plan, a command that only names a plan, and an unrelated write are allowed.
  for (const cmd of ['echo x >> plans/001-alpha.plan.md', 'cat plans/009-alpha.plan.md', 'node scripts/plan-name-similarity.mjs --file=plans/009-alpha.plan.md', 'echo x > notes.txt']) {
    const r = planGuard(cmd)
    assert.equal(r.decision, 'allow', `${cmd}: ${r.out}`)
  }
  // The ack names the new plan: allowed once, and the ack is consumed.
  mkdirSync(join(main, '.claude'), { recursive: true })
  writeFileSync(join(main, '.claude', '.plan-write-ack'), 'plans/009-alpha.plan.md')
  const acked = planGuard(`echo x > plans/009-alpha.plan.md`)
  assert.equal(acked.decision, 'allow', acked.out)
  assert.equal(existsSync(join(main, '.claude', '.plan-write-ack')), false)
})

// /review-it round 1 (plan 020): three ways a write hid from the reader, and a plain mv of a plan.
test('bashWrites: a redirection before [[ makes it a word; <( … ) / >( … ) and ${ … } substitutions are read for writes', async () => {
  const { bashWrites } = await import(pathToFileURL(join(project, 'scripts', 'lib', 'guard.mjs')).href)
  const cwd = main
  const paths = (cmd) => bashWrites(cmd, cwd).map((t) => (t.path ? relative(cwd, t.path).split(sep).join('/') : `?${t.unresolved}`))
  // bash: `[[` is the keyword only at the start of a simple command — after a redirection it is a command name.
  assert.deepEqual(paths('2>/dev/null [[ a > README.md ]]'), ['README.md'])
  assert.deepEqual(paths('</dev/null [[ a > r1.md ]]'), ['r1.md'])
  // `<((…))` / `>((…))` are process substitutions holding a subshell, never arithmetic.
  assert.deepEqual(paths('cat <((echo x > README.md))'), ['README.md'])
  assert.deepEqual(paths('tee >((cat > README.md))'), ['README.md'])
  assert.deepEqual(paths('diff <(echo x > r2.md) <(sort b)'), ['r2.md'])
  // A process substitution is no file target; a real file next to it still is.
  assert.deepEqual(paths('tee >(grep x) out.txt'), ['out.txt'])
  // Substitutions inside an unquoted `${…}` run (nested `${…}` too).
  assert.deepEqual(paths('echo ${x:-$(cat > README.md)}'), ['README.md'])
  assert.deepEqual(paths('echo ${x:-`cat > README.md`}'), ['README.md'])
  assert.deepEqual(paths('echo ${x:-${y:-$(tee r3.md)}}'), ['r3.md'])
  // Still comparisons / no writes.
  assert.deepEqual(paths('if [[ $a > $b ]]; then :; fi'), [])
  assert.deepEqual(paths('[[ $a > $b ]] && echo ${x:-y}'), [])
  assert.deepEqual(paths('for ((i = 0; i < (3); i++)); do :; done'), [])
})

test('a redirect before [[, a process substitution or a ${ … } substitution cannot hide a write on main', () => {
  for (const cmd of ['2>/dev/null [[ a > NOTES.md ]]', 'cat <((echo x > NOTES.md))', 'tee >((cat > NOTES.md))', 'echo ${x:-$(cat > NOTES.md)}', 'echo ${x:-`cat > NOTES.md`}']) {
    const r = bash(main, 'branch-guard.sh', cmd)
    assert.equal(r.decision, 'deny', `${cmd}: ${r.out}`)
    assert.match(r.out, /BRANCH_GUARD:/)
  }
  const r = bash(main, 'branch-guard.sh', 'if [[ $a > $b ]]; then :; fi')
  assert.equal(r.decision, 'allow', r.out)
})

// Security review round 3 (plan 020): an escaped `\${` or a `$${` does not nest, an unclosed `${` and a word that
// mixes a process substitution with other text fail closed.
test('bashWrites: \\${ and $${ do not nest a ${ … }; an unclosed ${ or a word mixing text and <( … ) is unresolved', async () => {
  const { bashWrites } = await import(pathToFileURL(join(project, 'scripts', 'lib', 'guard.mjs')).href)
  const cwd = main
  const paths = (cmd) => bashWrites(cmd, cwd).map((t) => (t.path ? relative(cwd, t.path).split(sep).join('/') : `?${t.unresolved}`))
  // bash: `${x:-\${}` ends at the first `}` — the commands after it run.
  assert.deepEqual(paths('echo ${x:-\\${}; cat > README.md; echo }'), ['README.md'])
  assert.deepEqual(paths('echo ${x:-$${}; cat > r4.md; echo }'), ['r4.md'])
  assert.deepEqual(paths('echo ${x:-$$${y}}; cat > r5.md'), ['r5.md'])
  // No closing `}`: where the word ends is unknown.
  assert.deepEqual(paths('echo ${x; cat > README.md'), ['?${x; cat > README.md'])
  assert.deepEqual(paths('echo ${x:-$(cat > README.md)'), ['?${x:-$(cat > README.md)', 'README.md'])
  // A process substitution glued to other text is no lone /dev/fd/N: an unresolved target.
  assert.deepEqual(paths('tee out<(true)'), ['?out<(true)'])
  assert.deepEqual(paths('tee x>(cat)y'), ['?x>(cat)y'])
  assert.deepEqual(paths('echo hi > out<(true)'), ['?out<(true)'])
  assert.deepEqual(paths('tee <(true)<(true)'), ['?<(true)<(true)'])
  // A lone process substitution is still no target; its body is still read.
  assert.deepEqual(paths('tee >(grep x) out.txt'), ['out.txt'])
  assert.deepEqual(paths('tee x>(cat > r6.md)'), ['r6.md', '?x>(cat > r6.md)'])
  assert.deepEqual(paths('diff <(sort a) <(sort b)'), [])
  assert.deepEqual(paths('echo ${x:-\\$} ${a}${b}'), [])
})

test('an escaped \\${, an unclosed ${ or a process substitution glued to a word cannot hide a write on main', () => {
  for (const cmd of ['echo ${x:-\\${}; cat > NOTES.md; echo }', 'echo ${x; cat > NOTES.md', 'echo ${x:-$(cat > NOTES.md)', 'tee out<(true)', 'tee x>(cat)y']) {
    const r = bash(main, 'branch-guard.sh', cmd)
    assert.equal(r.decision, 'deny', `${cmd}: ${r.out}`)
    assert.match(r.out, /BRANCH_GUARD:/)
  }
  for (const cmd of ['diff <(sort a) <(sort b)', 'tee >(grep x) /dev/null']) {
    const r = bash(main, 'branch-guard.sh', cmd)
    assert.equal(r.decision, 'allow', `${cmd}: ${r.out}`)
  }
})

test('plan-file guard: a plain mv of an existing plan into plans/done/ is a move, not a new plan', () => {
  const planGuard = (command) => {
    const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: main })
    const r = spawnSync(process.execPath, [join(main, 'scripts', 'lib', 'guard.mjs'), 'plan'], { cwd: main, input, encoding: 'utf8', timeout: 30000 })
    const m = (r.stdout ?? '').match(/"permission":"(allow|deny)"/)
    return { decision: m ? m[1] : `unparsed (${r.stdout}${r.stderr})`, out: `${r.stdout}${r.stderr}` }
  }
  assert.ok(existsSync(join(main, 'plans', '001-alpha.plan.md')))
  const moved = planGuard('mv plans/001-alpha.plan.md plans/done/001-alpha.plan.md')
  assert.equal(moved.decision, 'allow', moved.out)
  // A copy, or a mv under a new name, still writes a new name-similar plan.
  for (const cmd of ['cp plans/001-alpha.plan.md plans/done/001-alpha.plan.md', 'mv plans/001-alpha.plan.md plans/009-alpha.plan.md']) {
    const r = planGuard(cmd)
    assert.equal(r.decision, 'deny', `${cmd}: ${r.out}`)
    assert.match(r.out, /PLAN_WRITE_GUARD: blocked new plan write/)
  }
})
