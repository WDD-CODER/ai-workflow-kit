// A scratch project for scripts/run-plans.mjs (tools/test/run-plans.test.mjs, tools/orchestrator-e2e.mjs): the kit
// installed into a fresh git repository with a local bare origin, toy plans, and the fake `claude`
// (tools/test/fixtures/fake-claude.mjs). Nothing reaches GitHub and no model is called.
//
//   const p = makeProject({ kit })            // install, first commit, push
//   p.addPlans({ 451: toyPlan(451) })          // plans committed on main and pushed
//   const r = p.runPlans(['--run', 'x', '--plans', '451'], { scenario: { 451: { builder: [{ gate: 'fail' }] } } })
//   // r = { status, out, json, calls }  (calls: the fake's log lines of this run)
//
// The project's test script fails while any gate/<NNN>.txt holds "fail" (the fake builder writes it). The scripts'
// package (picomatch) sits next to the project folder (<root>/node_modules) and in scripts/node_modules, so the builder
// folders and the merge folder find it without an install; scripts/package.json is not committed (no install runs).
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, realpathSync, cpSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'

export const FAKE = (kit) => join(kit, 'tools', 'test', 'fixtures', 'fake-claude.mjs')

/** A toy plan: one sub-task, its own two files in scope, an optional dependency and Critical Question. */
export function toyPlan(nnn, { deps = 'none', question = null, title = `Toy ${nnn}` } = {}) {
  return [
    `# Plan ${nnn} — ${title}`,
    '',
    'Status: draft',
    `Depends-on: ${deps}`,
    '',
    '## Goals & Success Criteria',
    `- [auto] \`node scripts/toy-check.mjs ${nnn}\` exits 0`,
    '',
    '## Read-Write Scope',
    '',
    '```scope',
    `src/${nnn}.txt`,
    `gate/${nnn}.txt`,
    '```',
    '',
    '## Architecture Impact',
    '- none',
    '',
    '## Atomic Sub-tasks',
    '',
    `- [ ] T1: write the toy file — src/${nnn}.txt`,
    '',
    '## Critical Questions',
    question ? `- Q: ${question} A: open` : '- Q: anything open? A: no',
    '',
    '## Execution Notes',
    '- the builder writes here; the reviewer never sees this line',
    '',
  ].join('\n')
}
export const toyFile = (nnn, title = `Toy ${nnn}`) => `plans/${nnn}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.plan.md`

export function makeProject({ kit, name = 'rp-app', depsFrom = null, config = {} }) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'kit-rp-')))
  const proj = join(root, name)
  const origin = join(root, 'origin.git')
  const log = join(root, 'fake-claude.log')
  const scenarioFile = join(root, 'scenario.json')
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'kit-rp', GIT_AUTHOR_EMAIL: 'kit-rp@example.invalid',
    GIT_COMMITTER_NAME: 'kit-rp', GIT_COMMITTER_EMAIL: 'kit-rp@example.invalid',
    GIT_TERMINAL_PROMPT: '0', RUN_PLANS_CLAUDE: FAKE(kit), FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_SCENARIO: scenarioFile,
    // A question parks its plan after a short wait in a test run, not after ASK_WAIT_MIN.
    RUN_PLANS_ASK_WAIT_MS: '1', RUN_PLANS_ASK_POLL_MS: '50',
  }
  for (const k of ['ORCH_FREE_GB', 'ORCH_UI_LOGIN_URL', 'ORCH_UI_API_URL', 'DB_PORT']) delete env[k]
  const sh = (cmd, args, cwd = proj) => {
    const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, stdout: String(r.stdout ?? '') }
  }
  const git = (cwd, ...a) => sh('git', a, cwd)
  const must = (r, what) => {
    if (r.status !== 0) throw new Error(`${what}: exit ${r.status}: ${r.out.trim().split('\n').slice(-3).join(' | ')}`)
    return r
  }
  must(git(root, 'init', '-q', '--bare', '-b', 'main', origin), 'git init origin')
  must(git(root, 'init', '-q', '-b', 'main', proj), 'git init project')
  git(proj, 'config', 'user.name', 'kit-rp')
  git(proj, 'config', 'user.email', 'kit-rp@example.invalid')
  git(proj, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(proj, 'package.json'), `${JSON.stringify({ name, private: true, scripts: { build: 'node -e ""', lint: 'node -e ""', test: 'node gate-check.mjs' } }, null, 2)}\n`)
  // The project's tests: fail while a gate/<NNN>.txt says "fail" (its next lines are the failing output).
  writeFileSync(join(proj, 'gate-check.mjs'), [
    "import { readdirSync, readFileSync, existsSync } from 'node:fs'",
    "const bad = existsSync('gate') ? readdirSync('gate').filter((f) => readFileSync(`gate/${f}`, 'utf8').startsWith('fail')) : []",
    "for (const f of bad) console.log(readFileSync(`gate/${f}`, 'utf8').trim().split('\\n').slice(1).join('\\n') || `FAIL ${f}`)",
    'process.exit(bad.length ? 1 : 0)',
    '',
  ].join('\n'))
  writeFileSync(join(proj, 'kit.config.json'), `${JSON.stringify({
    project: { name, repoName: name }, stack: { packs: [] },
    commands: { build: 'build', lint: 'lint', test: 'test' }, hooks: { shellPath: 'bash' },
    models: { judgment: 'opus' },
    orchestrator: { minFreeDiskGb: 0, useSlots: false, rateLimitWaitMin: 0, ...config },
  }, null, 2)}\n`)
  must(sh(process.execPath, [join(kit, 'tools', 'install.mjs'), '--target', proj, '--source', kit]), 'install the kit')
  const deps = [depsFrom, join(kit, 'scripts', 'node_modules')].find((d) => d && existsSync(join(d, 'picomatch')))
  if (!deps) throw new Error('no scripts/node_modules with picomatch to copy (run npm install inside scripts/)')
  cpSync(deps, join(proj, 'scripts', 'node_modules'), { recursive: true })
  cpSync(deps, join(root, 'node_modules'), { recursive: true })
  for (const f of ['package.json', 'package-lock.json']) rmSync(join(proj, 'scripts', f), { force: true })
  // The plans' own [auto] check: a project script that exits 0.
  writeFileSync(join(proj, 'scripts', 'toy-check.mjs'), 'process.exit(0)\n')
  appendFileSync(join(proj, '.git', 'info', 'exclude'), '\nnode_modules\n')
  mkdirSync(join(proj, 'plans'), { recursive: true })
  mkdirSync(join(proj, 'gate'), { recursive: true })
  writeFileSync(join(proj, 'gate', '000.txt'), 'pass\n')
  must(git(proj, 'add', '-A'), 'git add')
  must(git(proj, 'commit', '-q', '-m', 'chore: install the kit'), 'first commit')
  must(git(proj, 'remote', 'add', 'origin', origin), 'remote')
  must(git(proj, 'push', '-q', '-u', 'origin', 'main'), 'first push')

  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  const parse = (out) => {
    const line = String(out).split(/\r?\n/).reverse().find((l) => l.startsWith('RUN_PLANS_JSON '))
    return line ? JSON.parse(line.slice('RUN_PLANS_JSON '.length)) : null
  }
  return {
    root, proj, origin, env, log, sh, git, calls,
    addPlans(plans) {
      for (const [nnn, p] of Object.entries(plans)) {
        const { text, title } = typeof p === 'string' ? { text: p, title: `Toy ${nnn}` } : p
        writeFileSync(join(proj, toyFile(nnn, title)), text)
      }
      must(git(proj, 'add', '-A', 'plans'), 'git add plans')
      must(git(proj, 'commit', '-q', '-m', `plans ${Object.keys(plans).join(', ')}`), 'commit plans')
      must(git(proj, 'push', '-q', 'origin', 'main'), 'push plans')
    },
    /** Run run-plans.mjs to the end: { status, out, json, calls } (calls: this run's fake log lines). */
    runPlans(args, { scenario = {} } = {}) {
      writeFileSync(scenarioFile, JSON.stringify(scenario))
      const before = calls().length
      const r = sh(process.execPath, [join(proj, 'scripts', 'run-plans.mjs'), ...args])
      return { status: r.status, out: r.out, json: parse(r.stdout), calls: calls().slice(before) }
    },
    /** Start run-plans.mjs in the background: { child, done: Promise<{ status, out, json, calls }> }. */
    startPlans(args, { scenario = {} } = {}) {
      writeFileSync(scenarioFile, JSON.stringify(scenario))
      const before = calls().length
      const child = spawn(process.execPath, [join(proj, 'scripts', 'run-plans.mjs'), ...args], { cwd: proj, env })
      let out = ''
      child.stdout.on('data', (d) => { out += d })
      child.stderr.on('data', (d) => { out += d })
      const done = new Promise((res) => child.on('close', (status) => res({ status, out, json: parse(out), calls: calls().slice(before) })))
      return { child, done }
    },
    state(...a) {
      const r = sh(process.execPath, [join(proj, 'scripts', 'orch-state.mjs'), ...a])
      const line = r.stdout.split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
      return { status: r.status, out: r.out, json: line ? JSON.parse(line.slice('ORCH_JSON '.length)) : null }
    },
    status(run) {
      return JSON.parse(readFileSync(join(proj, '.claude', 'orchestrator-runs', run, 'status.json'), 'utf8'))
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
    },
  }
}

/** True when two [start, end] spans overlap. */
export const overlaps = (a, b) => a.start < b.end && b.start < a.end
export { resolve }
