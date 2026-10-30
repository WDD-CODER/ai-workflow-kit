import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Meter, billingMode } from '../skill-improver/lib/budget.mjs'
import { body } from '../skill-improver/lib/claude.mjs'
import { outOfScope, skillAllowed, leakGuard } from '../skill-improver/lib/guards.mjs'
import { buildBody } from '../skill-improver/lib/pr.mjs'
import { judgeModel } from '../skill-improver/run.mjs'
import { pick } from '../skill-improver/pick.mjs'
import { scanSession, triggersOf } from '../skill-improver/evidence.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const kit = resolve(here, '..', '..')
const RUN = join(kit, 'tools', 'skill-improver', 'run.mjs')

test('meter counts a message once and ignores cache reads', () => {
  const m = new Meter(100)
  m.add('a', { input_tokens: 2, cache_creation_input_tokens: 10, output_tokens: 8, cache_read_input_tokens: 9999 })
  m.add('a', { input_tokens: 2, cache_creation_input_tokens: 10, output_tokens: 8 })
  assert.equal(m.total, 20)
  assert.equal(m.over(), false)
})

test('path guard allows only the skill folder, its rendered copy and .kit/install.json', () => {
  assert.equal(outOfScope(['packs/x/.claude/skills/demo/SKILL.md', 'core/.claude/skills/demo/evals/evals.json', '.claude/skills/demo/SKILL.md', '.kit/install.json'], skillAllowed('demo')), null)
  assert.equal(outOfScope(['docs/.claude/skills/demo/SKILL.md'], skillAllowed('demo')), 'docs/.claude/skills/demo/SKILL.md')
  assert.equal(outOfScope(['.kit/config.json'], skillAllowed('demo')), '.kit/config.json')
  assert.equal(outOfScope(['.claude/skills/demo2/SKILL.md'], skillAllowed('demo')), '.claude/skills/demo2/SKILL.md')
  assert.equal(outOfScope(['core/.claude/skills/demo/SKILL.md', 'README.md'], skillAllowed('demo')), 'README.md')
  assert.equal(outOfScope(['core/.claude/skills/demo2/SKILL.md'], skillAllowed('demo')), 'core/.claude/skills/demo2/SKILL.md')
})

test('picker: highest score, tie by least recent, skips open PR, pauses at 3', () => {
  const s = { a: { score: 5 }, b: { score: 9 }, c: { score: 9 } }
  assert.equal(pick(s, { b: '2026-10-01' }, []).skill, 'c')
  assert.equal(pick(s, {}, ['chore/skill-improve-b-2026-10-28']).skill, 'c')
  assert.equal(pick(s, {}, ['chore/skill-improve-b-1', 'chore/skill-improve-c-1']).skill, 'a')
  assert.equal(pick(s, {}, ['chore/skill-improve-a-1', 'chore/skill-improve-b-1', 'chore/skill-improve-c-1']).skill, null)
})

test('evidence counts corrections, failures and should-have-fired without storing text', () => {
  const skills = [{ name: 'demo', triggers: triggersOf('---\nname: demo\ndescription: Use for "make a widget" requests\n---\n') }]
  const acc = { demo: { fired: 0, fired30: 0, corrections: 0, failures: 0, shouldHaveFired: 0, sizeBytes: 1 } }
  const u = (text) => ({ type: 'user', message: { content: text } })
  const events = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'demo' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', is_error: true }] } },
    u('no, that is wrong'),
  ]
  scanSession(events, skills, 0, acc)
  assert.deepEqual([acc.demo.fired, acc.demo.corrections, acc.demo.failures, acc.demo.shouldHaveFired], [1, 1, 1, 0])
  const acc2 = { demo: { fired: 0, fired30: 0, corrections: 0, failures: 0, shouldHaveFired: 0, sizeBytes: 1 } }
  scanSession([u('please make a widget now')], skills, 0, acc2)
  assert.equal(acc2.demo.shouldHaveFired, 1)
})

test('PR body has evidence, scores and a 3-step validation', () => {
  const evidence = { fired: 4, fired30: 4, corrections: 2, failures: 1, shouldHaveFired: 0, sizeBytes: 900 }
  const b = buildBody({ skill: 'demo', evidence, diffStat: ' 1 file changed', before: 0.4, after: 0.8, evalCount: 3, generatedEvals: false, unused30: false })
  assert.match(b, /before: 40%/)
  assert.match(b, /after: 80%/)
  assert.match(b, /## How to validate\n1\. .*\n2\. .*\n3\. /)
  assert.match(b, /corrections within 3 turns after it fired: 2/)
})

test('leak guard rejects a project name in the PR body', () => {
  assert.equal(leakGuard({ files: [join(kit, 'README.md')], bodyText: 'clean text', projectOnly: true }).ok, true)
  assert.equal(leakGuard({ files: [join(kit, 'README.md')], bodyText: 'from FoodVibe sessions', projectOnly: true }).ok, false)
})

test('judge and editor files carry no front-matter in the prompt body', () => {
  const md = readFileSync(join(kit, 'core', '.claude', 'agents', 'skill-judge.md'), 'utf8')
  assert.ok(!body(md).startsWith('---'))
  assert.match(body(md), /"results"/)
})

// End-to-end with a scripted fake `claude` and `gh`, in a throwaway kit repo.
function sandboxKit() {
  const root = mkdtempSync(join(tmpdir(), 'si-e2e-'))
  const origin = join(root, 'origin.git')
  const repo = join(root, 'repo')
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' })
  g(root, 'init', '-q', '--bare', '-b', 'main', origin)
  g(root, 'clone', '-q', origin, repo)
  g(repo, 'config', 'user.email', 't@example.com')
  g(repo, 'config', 'user.name', 't')
  // A real kit installed into itself (core, tools, .kit config and hashes), so the runner's sync + drift-check run for real.
  const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: kit, encoding: 'utf8' }).split('\0').filter(Boolean)
  for (const f of tracked) {
    if (/^(plans|tools\/test|node_modules)\//.test(f) || !existsSync(join(kit, f))) continue
    mkdirSync(dirname(join(repo, f)), { recursive: true })
    copyFileSync(join(kit, f), join(repo, f))
  }
  mkdirSync(join(repo, 'core', '.claude', 'skills', 'preflight', 'evals'), { recursive: true })
  writeFileSync(join(repo, 'core', '.claude', 'skills', 'preflight', 'evals', 'evals.json'), JSON.stringify({ skill_name: 'preflight', evals: [{ id: 1, prompt: 'do it', expected_output: 'x', files: [], assertions: ['says IMPROVED'] }] }))
  const sy = spawnSync(process.execPath, ['tools/sync.mjs', '--target', '.', '--apply'], { cwd: repo, encoding: 'utf8' })
  assert.equal(sy.status, 0, sy.stdout + sy.stderr)
  g(repo, 'add', '-A')
  g(repo, 'commit', '-q', '-m', 'init')
  g(repo, 'push', '-q', 'origin', 'main')
  const fake = join(root, 'fake-claude.mjs')
  writeFileSync(
    fake,
    `
import { readFileSync, writeFileSync, appendFileSync } from 'fs'
const argv = process.argv.slice(2)
const sys = argv.includes('--append-system-prompt') ? argv[argv.indexOf('--append-system-prompt') + 1] : ''
const prompt = readFileSync(0, 'utf8')
const mode = process.env.FAKE_MODE
const out = (text, tokens) => {
  console.log(JSON.stringify({ type: 'assistant', message: { id: 'm' + Math.random(), usage: { input_tokens: 1, output_tokens: tokens } } }))
  console.log(JSON.stringify({ type: 'result', result: text, total_cost_usd: 0.01 }))
}
if (sys.includes('improve-skill') || sys.includes('Edit only files inside')) {
  const m = prompt.match(/Skill folder: (.*)/)[1]
  if (mode === 'outofscope') writeFileSync(m + '/../../../../README.md', 'oops')
  else if (mode !== 'nochange') appendFileSync(m + '/SKILL.md', 'IMPROVED\\n')
  out('changed', 10)
} else if (sys.includes('grade the output')) {
  const answer = (prompt.split('Assistant final answer:')[1] || '').split('Files it produced:')[0]
  out('{"results": [' + (answer.includes('IMPROVED') ? 'true' : 'false') + ']}', 10)
} else {
  out(sys.includes('IMPROVED') ? 'IMPROVED' : 'plain', mode === 'budget' ? 50000 : 10)
}
`,
  )
  const fakeGh = join(root, 'fake-gh.mjs')
  writeFileSync(fakeGh, `const a = process.argv.slice(2); if (a[1] === 'list') console.log('[]'); else console.log('https://example.test/pr/1')`)
  return { root, repo, origin, fakeClaude: fake, fakeGh }
}

function runIt(env, extra = []) {
  const s = sandboxKit()
  const home = join(s.root, 'home')
  const r = spawnSync(process.execPath, [RUN, '--repo', s.repo, '--skill', 'preflight', '--once', ...extra], {
    encoding: 'utf8',
    env: { ...process.env, SKILL_IMPROVER_HOME: home, SKILL_IMPROVER_PROJECTS: join(s.root, 'no-transcripts'), SKILL_IMPROVER_CLAUDE: s.fakeClaude, SKILL_IMPROVER_GH: s.fakeGh, ...env },
  })
  const branches = execFileSync('git', ['branch', '-r'], { cwd: s.repo, encoding: 'utf8' })
  execFileSync('git', ['fetch', '-q', 'origin'], { cwd: s.repo })
  const remote = execFileSync('git', ['--git-dir', s.origin, 'branch'], { encoding: 'utf8' })
  const logFile = join(home, 'log.txt')
  const spendFile = join(home, 'spend.jsonl')
  return { r, remote, origin: s.origin, root: s.root, branches, log: existsSync(logFile) ? readFileSync(logFile, 'utf8') : '', spend: existsSync(spendFile) ? readFileSync(spendFile, 'utf8') : '' }
}

test('run: improved candidate beats the old skill, pushes a branch and opens a PR', () => {
  const { r, remote } = runIt({ FAKE_MODE: 'improve' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /SKILL_IMPROVER: pr https:\/\/example\.test\/pr\/1/)
  assert.match(remote, /chore\/skill-improve-preflight-/)
})

test('run: the PR commit holds exactly the core skill, its rendered copy and .kit/install.json, and drift-check passes', () => {
  const { r, remote, origin, root } = runIt({ FAKE_MODE: 'improve' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const branch = remote.split('\n').map((l) => l.replace('*', '').trim()).find((b) => b.startsWith('chore/skill-improve-preflight-'))
  assert.ok(branch, remote)
  const names = execFileSync('git', ['--git-dir', origin, 'diff', '--name-only', 'main', branch], { encoding: 'utf8' }).split('\n').filter(Boolean).sort()
  assert.deepEqual(names, ['.claude/skills/preflight/SKILL.md', '.kit/install.json', 'core/.claude/skills/preflight/SKILL.md'])
  const check = join(root, 'check')
  execFileSync('git', ['clone', '-q', '--branch', branch, origin, check])
  const d = spawnSync(process.execPath, ['tools/drift-check.mjs', '--target', '.'], { cwd: check, encoding: 'utf8' })
  assert.equal(d.status, 0, d.stdout + d.stderr)
  assert.match(d.stdout, /KIT_DRIFT: ok/)
})

test('run: a candidate that does not beat the old one opens no PR and logs no-change', () => {
  const { r, remote, log } = runIt({ FAKE_MODE: 'nochange' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.doesNotMatch(remote, /skill-improve/)
  assert.match(log, /no-change preflight/)
})

test('run: --budget stops, prints budget reached, pushes nothing', () => {
  const { r, remote } = runIt({ FAKE_MODE: 'budget' }, ['--budget', '20000'])
  assert.equal(r.status, 3, r.stdout + r.stderr)
  assert.match(r.stdout, /SKILL_IMPROVER: budget reached \(\d+\/20000\)/)
  assert.doesNotMatch(remote, /skill-improve/)
})

test('run: an edit outside the skill folder aborts with out-of-scope and pushes nothing', () => {
  const { r, remote } = runIt({ FAKE_MODE: 'outofscope' })
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stdout, /SKILL_IMPROVER: out-of-scope README\.md/)
  assert.doesNotMatch(remote, /skill-improve/)
})

test('run: prints the billing mode before the first call and appends one spend.jsonl line', () => {
  const { r, spend } = runIt({ FAKE_MODE: 'improve', ANTHROPIC_API_KEY: '' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /SKILL_IMPROVER: billing plan-limits/)
  assert.ok(r.stdout.indexOf('billing plan-limits') < r.stdout.indexOf('SKILL_IMPROVER: pr '), 'billing line comes first')
  const line = JSON.parse(spend.trim())
  assert.deepEqual(Object.keys(line), ['date', 'target', 'mode', 'usd', 'tokens', 'result'])
  assert.equal(line.target, 'skill')
  assert.equal(line.mode, 'plan-limits')
  assert.equal(line.result, 'pr')
  assert.ok(line.usd > 0 && line.tokens > 0)
  const k = runIt({ FAKE_MODE: 'improve', ANTHROPIC_API_KEY: 'sk-test-not-real' })
  assert.match(k.r.stdout, /SKILL_IMPROVER: billing api-key/)
  assert.equal(JSON.parse(k.spend.trim()).mode, 'api-key')
})

test('run: an unknown target exits 2 before doing anything', () => {
  const r = spawnSync(process.execPath, [RUN, '--target', 'agent'], { encoding: 'utf8' })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /unknown target agent/)
})

test('meter records dollars and the billing mode', () => {
  assert.equal(billingMode({}), 'plan-limits')
  assert.equal(billingMode({ ANTHROPIC_API_KEY: 'x' }), 'api-key')
  const m = new Meter(100, {})
  m.addUsd(0.5)
  m.addUsd(0.25)
  assert.equal(m.usd, 0.75)
})

test('judge model: the review tier, never Haiku', () => {
  assert.equal(judgeModel(kit, {}), 'sonnet')
  assert.equal(judgeModel(kit, { SKILL_IMPROVER_JUDGE_MODEL: 'opus' }), 'opus')
  assert.throws(() => judgeModel(kit, { SKILL_IMPROVER_JUDGE_MODEL: 'haiku' }), /never run on Haiku/)
  assert.throws(() => judgeModel(kit, { SKILL_IMPROVER_JUDGE_MODEL: 'claude-haiku-5-5' }), /never run on Haiku/)
  assert.match(readFileSync(join(kit, 'core', '.claude', 'agents', 'skill-judge.md'), 'utf8'), /^model: \{\{models\.review\}\}$/m)
})
