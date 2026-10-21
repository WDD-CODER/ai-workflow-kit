// The PreToolUse guards (plan 017), run through the real hook scripts on a scratch repo with a wt-1 slot.
//   node --test tools/test/guards.test.mjs
// Runs the installed scripts of the kit repo (scripts/, after `node tools/sync.mjs --target . --apply` and
// `npm ci` inside scripts/). GUARDS_ROOT=<project> runs another installed copy instead (tools/e2e-check.mjs points it
// at its fresh e2e project). The scripts are copied into the scratch repo, because a guard judges its own folder.
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

let base, main, slot, merge, orch, free
after(() => {
  if (!base || process.env.GUARDS_KEEP) return
  // Worktrees first, so git does not keep stale entries; then the folder.
  for (const d of [slot, merge, orch, free]) spawnSync('git', ['worktree', 'remove', '--force', d], { cwd: main })
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
  writeFileSync(join(main, 'README.md'), '# scratch\n')
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
  const r = write(main, 'scope-guard.sh', join(slot, 'README.md'))
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
  for (const cmd of writes('README.md')) {
    const r = bash(main, 'scope-guard.sh', cmd, { cwd: slot })
    assert.equal(r.decision, 'deny', `${cmd}\n${r.out}`)
    assert.match(r.out, /SCOPE_GUARD:/)
  }
  // An absolute path into the slot, from a session in the main folder.
  const abs = bash(main, 'scope-guard.sh', `echo x > "${join(slot, 'README.md').replace(/\\/g, '/')}"`)
  assert.equal(abs.decision, 'deny', abs.out)
  // sed -i, cp and mv targets.
  for (const cmd of ['sed -i s/a/b/ README.md', 'cp src/a.js README.md', 'mv src/a.js notes.md']) {
    const r = bash(main, 'scope-guard.sh', cmd, { cwd: slot })
    assert.equal(r.decision, 'deny', `${cmd}\n${r.out}`)
  }
})

test('(5) read-only and in-scope Bash commands are allowed', () => {
  for (const cmd of ['cat README.md', 'git status', 'ls -la src 2>&1 | head -5', 'node -e "1" > /dev/null 2>&1', 'grep -n x README.md >&2']) {
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
  const out = write(merge, 'scope-guard.sh', join(merge, 'README.md'))
  assert.equal(out.decision, 'deny', out.out)
  assert.match(out.out, /SCOPE_GUARD:/)
  assert.match(out.out, /approved: /)
  const inside = write(merge, 'scope-guard.sh', join(merge, 'src', 'b.js'))
  assert.equal(inside.decision, 'allow', inside.out)
  const fromMain = write(main, 'scope-guard.sh', join(merge, 'README.md'))
  assert.equal(fromMain.decision, 'deny', fromMain.out)
})

test('merge folder on orch/<run> naming its plan in .worktree-plan: plan scope applies', () => {
  const out = write(orch, 'scope-guard.sh', join(orch, 'README.md'))
  assert.equal(out.decision, 'deny', out.out)
  assert.match(out.out, /SCOPE_GUARD:/)
  const inside = write(orch, 'scope-guard.sh', join(orch, 'src', 'b.js'))
  assert.equal(inside.decision, 'allow', inside.out)
})

test('a branch that names no plan has no plan scope; main still refuses', () => {
  const r = write(free, 'scope-guard.sh', join(free, 'README.md'))
  assert.equal(r.decision, 'allow', r.out)
  const onMain = write(main, 'branch-guard.sh', join(main, 'README.md'))
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
  const f = write(free, 'scope-guard.sh', join(free, 'README.md'), { env: { KIT_GUARD_TRACE: '1' } })
  assert.equal(f.decision, 'allow', f.out)
  assert.ok(f.ms < LIMIT_MS, `scope-guard in a no-plan folder took ${f.ms} ms`)
  assert.ok(Number((f.stderr.match(/GUARD_GIT_CALLS: (\d+)/) || [])[1] ?? 99) <= 1, f.stderr)
})

test('a shell target the guard cannot resolve ($VAR, $(...)) is refused where a write needs a check (fail closed)', () => {
  const onMain = bash(main, 'branch-guard.sh', 'echo x > "$OUT_FILE"')
  assert.equal(onMain.decision, 'deny', onMain.out)
  assert.match(onMain.out, /cannot tell which file/)
  const inSlot = bash(main, 'scope-guard.sh', 'echo x > $(pwd)/README.md', { cwd: slot })
  assert.equal(inSlot.decision, 'deny', inSlot.out)
  const free_ = bash(free, 'scope-guard.sh', 'echo x > "$OUT_FILE"')
  assert.equal(free_.decision, 'allow', free_.out)
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
  assert.deepEqual(paths('cd "$WT" && echo x > README.md'), ['?README.md'])
  assert.deepEqual(paths('cd $(git rev-parse --show-toplevel)/../x && echo x > f.txt && tee g.txt'), ['?f.txt', '?g.txt'])
  assert.deepEqual(paths('cd "$WT" && bash -c "echo x > h.txt"'), ['?h.txt'])
  assert.deepEqual(paths(`cd "$WT" && cd "${cwd.split(sep).join('/')}" && echo x > k.txt`), ['k.txt'])
})
