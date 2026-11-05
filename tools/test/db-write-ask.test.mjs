// Plan 083 D1: a database write the plan does not list is asked about before it runs — only in an orchestrator
// builder's worktree (its marker in the worktree's git dir); a Human session or a Worker slot is judged as before.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath, pathToFileURL } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit
const { dbWriteKind, dbWriteAsk, dbWrites } = await import(pathToFileURL(join(root, 'scripts', 'lib', 'db-write.mjs')).href)
const { decide, worktreeOf } = await import(pathToFileURL(join(root, 'scripts', 'lib', 'guard.mjs')).href)

test('dbWriteKind names the kind of each command in the plan table, and null for read-only and other commands', () => {
  const cases = {
    migrate: ['npx prisma migrate dev', 'prisma migrate deploy', 'prisma db push', 'npx drizzle-kit push', 'drizzle-kit migrate', 'knex migrate:latest', 'npx typeorm migration:run', 'npm run migrate', 'pnpm run db:migrate', 'npm run db:push'],
    seed: ['npm run seed', 'pnpm run db:seed', 'npx prisma db seed', 'node scripts/seed.mjs', 'node seed-users.js --all'],
    'raw-write': ['psql -c "INSERT INTO users VALUES (1)"', 'psql $DATABASE_URL -c "drop table x"', 'mongosh app --eval "db.users.deleteMany({})"', 'sqlite3 app.db "UPDATE t SET a=1"'],
  }
  for (const [kind, cmds] of Object.entries(cases)) for (const c of cmds) assert.equal(dbWriteKind(c), kind, c)
  for (const c of ['prisma migrate status', 'knex migrate:status', 'psql -c "SELECT * FROM users"', 'npm run test', 'node scripts/reseed-docs.mjs', 'node --test tools/test/seed.test.mjs','npm run seeds-report', 'git status', '']) {
    assert.equal(dbWriteKind(c), null, c)
  }
  // a client fed a script it does not show counts as a write; a write hidden behind a quoted `;` is still found
  assert.equal(dbWriteKind('psql -f seed.sql'), 'raw-write')
  assert.equal(dbWriteKind('sqlite3 app.db < fixtures.sql'), 'raw-write')
  assert.deepEqual(dbWrites('psql -c "SELECT 1; DROP TABLE x"'), ['psql -c "SELECT 1; DROP TABLE x"'])
  assert.deepEqual(dbWrites('npm ci && npm run seed'), ['npm run seed'])
  // a client name or a write word inside a commit message, a search or a package name is not a database write
  for (const c of ['git commit -m "feat: add sqlite3 create-table helper"', 'git commit -m "docs: psql update steps"', 'rg -n sqlite3 src -e drop', 'npm install sqlite3 && node a.js < in.json', 'git commit -m "npm run seed fixed"', 'node --test tools/test/seed-parser.test.mjs']) {
    assert.deepEqual(dbWrites(c), [], c)
  }
  // a wrapper or a shell around the command still counts (fail closed)
  assert.equal(dbWriteKind('bash -c "npm run seed"'), 'seed')
  assert.equal(dbWriteKind('yarn prisma migrate dev'), 'migrate')
  assert.equal(dbWriteKind('nohup psql -c "DROP TABLE x"'), 'raw-write')
  assert.equal(dbWriteKind('timeout 60 npm run seed'), 'seed')
  assert.equal(dbWriteKind('eval "sqlite3 app.db \'DELETE FROM t\'"'), 'raw-write')
  // a safe tool is safe only as its own command, with nothing in it that runs code
  assert.equal(dbWriteKind('git commit -m "$(npm run seed)"'), 'seed')
  assert.equal(dbWriteKind('xargs -I x git commit -m "npm run seed"'), 'seed')
  assert.equal(dbWriteKind('rg --pre "psql -c \'DROP TABLE x\'" .'), 'raw-write')
  // prefixes before the command word still count
  assert.equal(dbWriteKind('DATABASE_URL=x npx prisma migrate deploy'), 'migrate')
  assert.equal(dbWriteKind('sudo -u postgres psql -c "DROP TABLE x"'), 'raw-write')
  // a listed segment does not hide a client write split across quoted segments
  assert.deepEqual(dbWrites('npm run seed && psql -c "SELECT 1; DROP TABLE x"'), ['npm run seed', 'npm run seed && psql -c "SELECT 1; DROP TABLE x"'])
})

const sh = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

// A repository with a plan, a builder worktree (marker in its git dir) and a plain worktree (a Worker slot).
function setup(planBody) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'db-write-')))
  const main = join(parent, 'main')
  mkdirSync(join(main, 'plans'), { recursive: true })
  sh(main, 'init', '-q', '-b', 'main')
  sh(main, 'config', 'user.email', 't@t')
  sh(main, 'config', 'user.name', 't')
  writeFileSync(join(main, 'plans', '001-x.plan.md'), `# Plan 001 — X\n\nStatus: active\n\n${planBody}\n`)
  sh(main, 'add', '-A')
  sh(main, 'commit', '-q', '-m', 'plan')
  const builder = join(parent, 'main-orch-r-001')
  sh(main, 'worktree', 'add', '-q', '-b', 'feat/001-x', builder)
  const gitDir = sh(builder, 'rev-parse', '--absolute-git-dir')
  writeFileSync(join(gitDir, 'orch-builder.json'), JSON.stringify({ run: 'r', plan: '001', planPath: 'plans/001-x.plan.md', branch: 'feat/001-x', planRef: sh(main, 'rev-parse', 'main') }))
  const plain = join(parent, 'main-wt-1')
  sh(main, 'worktree', 'add', '-q', '-b', 'feat/001-y', plain)
  return { parent, main, builder, plain, gitDir }
}
const bash = (command, cwd, here) => decide('scope', JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }), worktreeOf(here))

test('the same unlisted "npm run seed" is asked about in a builder worktree and runs untouched in a plain worktree', () => {
  const t = setup('The plan never touches a database.')
  try {
    const asked = bash('npm run seed', t.builder, t.builder)
    assert.equal(asked.decision, 'deny')
    assert.match(asked.msg, /^ESCALATE: db-write npm run seed — a seed command plan 001 does not list/)
    // the session started elsewhere (the main folder) and cds into the builder worktree: still asked
    assert.equal(bash(`cd "${t.builder}" && npm run seed`, t.main, t.main).decision, 'deny')
    // a plain worktree (a Worker slot, a Human session): exactly as before
    const plain = bash('npm run seed', t.plain, t.plain)
    assert.equal(plain.decision, 'allow')
    assert.equal(plain.msg, '')
    assert.equal(bash('npm run seed', t.main, t.main).decision, 'allow')
    // a read-only or unrelated command in the builder worktree is not asked about
    assert.equal(bash('npm run test', t.builder, t.builder).decision, 'allow')
    // a marker naming another branch (a slot given back, then reused) counts as none
    writeFileSync(join(t.gitDir, 'orch-builder.json'), JSON.stringify({ run: 'r', plan: '001', planPath: 'plans/001-x.plan.md', branch: 'feat/001-old' }))
    assert.equal(dbWriteAsk('npm run seed', t.builder), null)
  } finally {
    rmSync(t.parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('a database write the plan lists as written runs in the builder worktree', () => {
  const t = setup('Step 3: run `npm run seed` to load the demo rows.\n\n```bash\npsql -c "INSERT INTO t VALUES (1)"\n```')
  try {
    assert.equal(bash('npm run seed', t.builder, t.builder).decision, 'allow')
    assert.equal(dbWriteAsk('npm run seed', t.builder), null)
    assert.equal(dbWriteAsk('psql -c "INSERT INTO t VALUES (1)"', t.builder), null, 'a fenced block line lists it too')
    // a different, unlisted write in the same worktree is still asked about; so is a longer variant of a listed one
    assert.match(dbWriteAsk('npx prisma migrate dev', t.builder), /^ESCALATE: db-write npx prisma migrate dev — a migrate command/)
    assert.match(dbWriteAsk('npm run seed -- --reset', t.builder), /^ESCALATE: db-write npm run seed -- --reset/)
  } finally {
    rmSync(t.parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('the plan is read from the run branch: prose does not list a command, and the builder cannot list one by editing its copy', () => {
  const t = setup('Never run npm run seed against the shared database.')
  try {
    assert.match(dbWriteAsk('npm run seed', t.builder), /^ESCALATE: db-write npm run seed/, 'prose is not a listing')
    writeFileSync(join(t.builder, 'plans', '001-x.plan.md'), '# Plan 001\n\nRun `npm run seed`.\n')
    sh(t.builder, 'commit', '-qam', 'builder edits its plan')
    assert.match(dbWriteAsk('npm run seed', t.builder), /^ESCALATE: db-write npm run seed/, 'the run branch copy decides')
  } finally {
    rmSync(t.parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

// The workflow: a builder that returns the guard's ESCALATE line stops its plan with an ask; the stub harness of
// tools/test/orchestrator-env-retry.test.mjs (copied: that file is not this plan's).
const wfSource = readFileSync(join(root, '.claude', 'workflows', 'orchestrate.js'), 'utf8')
async function runFlow(args, builderResult) {
  const plansIn = args.plans.map(String)
  const words = (cmd) => [...cmd.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2])
  const task = (prompt) => Object.fromEntries(String(prompt).split('\n').map((l) => /^([A-Z_]+): (.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]))
  const calls = []
  const state = (w) => {
    const cmd = w[2]
    const f = Object.fromEntries(w.slice(3).map((x) => /^--([\w-]+)=(.*)$/.exec(x)).filter(Boolean).map((m) => [m[1], m[2]]))
    if (cmd === 'init') return { ok: true, mergeFolder: '/merge', startedAt: '2026-01-01T00:00:00.000Z' }
    if (cmd === 'order') return { ok: true, waves: [plansIn], waveLocks: [], skipped: [], plans: Object.fromEntries(plansIn.map((p) => [p, { path: `plans/${p}-x.plan.md` }])) }
    if (cmd === 'plan-info') return { ok: true, path: `plans/${f.plan}-x.plan.md`, branch: `feat/${f.plan}-x`, startTier: 'build', invariants: [], npmScripts: [], uiItems: [] }
    if (cmd === 'worktree') return { ok: true, path: `/wt/${f.plan}` }
    if (cmd === 'finish') return { ok: true, merged: [], parked: [], report: 'r', local: 'l', reportCommitted: true }
    if (cmd === 'diff') return { ok: true, files: [], sensitive: false }
    return { ok: true }
  }
  async function agent(prompt, opts = {}) {
    const t = task(prompt)
    const type = opts.agentType ?? (/orch-builder\.md/.test(prompt) ? 'orch-builder' : undefined)
    calls.push({ type, task: t })
    if (type === 'kit-runner') {
      const w = words(t.COMMAND)
      return { exitCode: 0, output: `ORCH_JSON ${JSON.stringify(w[1] === 'scripts/orch-state.mjs' ? state(w) : { ok: true })}` }
    }
    const base = { role: type, model: 'stub', effort: 'low' }
    if (type === 'orch-builder') return { ...base, branch: t.BRANCH, ...builderResult }
    if (type === 'orch-gate') return { ...base, results: JSON.parse(t.COMMANDS).map((c) => ({ command: c, status: 'pass' })) }
    if (['orch-check-plan', 'orch-check-bugs', 'orch-check-rules', 'orch-security'].includes(type)) return { ...base, problems: [] }
    if (type === 'orch-verify') return { ...base, verdicts: [] }
    if (type === 'orch-merge') return { ...base, merged: true, sha: 'def5678' }
    if (type === 'orch-triage') return { ...base, items: t.DECISIONS ? JSON.parse(t.DECISIONS).map((d) => ({ id: d.id, verdict: 'accept', confidence: 95 })) : [] }
    throw new Error(`stub: no agent for ${type} (${opts.label})`)
  }
  const parallel = (thunks) => Promise.all(thunks.map((th) => Promise.resolve().then(th)))
  const AsyncFunction = (async () => {}).constructor
  const src = wfSource.replace(/^export const meta\s*=/m, 'const meta =')
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', 'require', 'process', src)
  const result = await fn(agent, parallel, undefined, () => {}, () => {}, { mode: 'run', run: 'r1', root: '/main', pilot: false, ...args }, {}, undefined, undefined, undefined)
  return { result, calls }
}

test('a builder stopped by the db-write ask parks its plan with an ask, not a fix round; the triage cannot accept it', async () => {
  const line = 'ESCALATE: db-write npm run seed — a seed command plan 101 does not list. Do not run it: stop and return status ESCALATE with this line as the blocker; the run asks the Human.'
  const r = await runFlow({ plans: ['101'] }, { status: 'ESCALATE', blocker: line, summary: 's', evidence: [], notDone: ['T2'], planChange: { needed: false, why: '-' } })
  const o = r.result.outcomes[0]
  assert.equal(o.state, 'parked')
  assert.match(o.reason, /^ask: ESCALATE: db-write npm run seed — /)
  assert.equal(r.calls.filter((c) => c.type === 'orch-builder').length, 1, 'no fix round, no escalation builder')
  const d = r.result.decisions.find((x) => /db-write npm run seed/.test(x.text))
  assert.ok(d, JSON.stringify(r.result.decisions))
  assert.equal(d.verdict, 'ask', 'the stub triage said accept; the ask stands')
})
