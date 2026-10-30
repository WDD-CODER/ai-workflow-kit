// scripts/scout/render.mjs + pr.mjs (core/scripts/scout): the scout's JSON report becomes one self-contained page and
// a pull request body; a bad report or a secret-looking line is refused with nothing written; no new items = no page.
//   node --test tools/test/scout-render.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const dir = join(kit, 'core', 'scripts', 'scout')
const renderJs = join(dir, 'render.mjs')
const prJs = join(dir, 'pr.mjs')
const R = await import(pathToFileURL(renderJs).href)
const P = await import(pathToFileURL(prJs).href)
const template = readFileSync(join(dir, 'page-template.html'), 'utf8')

const item = (n, extra = {}) => ({
  category: 'Adopt',
  headline: `Tip number ${n} saves time`,
  hook: `Hook ${n}`,
  why: `Why ${n} helps this project.`,
  file: `.claude/commands/ship.md`,
  effort: 'S',
  source: { name: 'Claude Code CHANGELOG', url: 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md' },
  ...extra,
})
const report = (items, extra = {}) => ({
  date: '2026-11-02',
  claudeCode: { from: '2.1.40', to: '2.1.50' },
  sources: [{ id: 'claude-code-changelog', cursor: '2.1.50', items: items.length }, { id: 'superpowers', cursor: 'v6.1.0' }],
  items,
  ...extra,
})

function project() {
  const root = mkdtempSync(join(tmpdir(), 'scout-'))
  mkdirSync(join(root, 'docs', 'scout'), { recursive: true })
  copyFileSync(join(kit, 'templates', 'docs', 'scout', 'sources.json'), join(root, 'docs', 'scout', 'sources.json'))
  return root
}
const run = (script, root, file, args = []) =>
  spawnSync(process.execPath, [script, '--report', file, '--root', root, ...args], { encoding: 'utf8', env: { ...process.env, PATH: '' } })

test('a bad report is refused with the field named', () => {
  const cases = [
    [{ ...report([item(1)]), date: 'Nov 2' }, /date must be YYYY-MM-DD/],
    [report([item(1, { category: 'Maybe' })]), /items\[0\]\.category/],
    [report([item(1, { headline: 'one two three four five six seven eight nine' })]), /headline must be 1-8 words/],
    [report([item(1, { file: 'C:/x/y.md' })]), /project-relative path/],
    [report([item(1, { file: '../outside.md' })]), /project-relative path/],
    [report([item(1, { source: { name: 'x', url: 'javascript:alert(1)' } })]), /http\(s\) url/],
    [report([item(1, { community: { license: 'MIT', stars: 'many', lastCommit: '2026-10-01' } })]), /community needs/],
  ]
  for (const [r, re] of cases) assert.throws(() => R.validateReport(r), re)
})

test('caps cut the report and mark the budget', () => {
  const r = report(Array.from({ length: 7 }, (_, i) => item(i + 1)))
  const { report: out, budgetReached } = R.validateReport(r, { maxItems: 4, maxSources: 1 })
  assert.equal(out.items.length, 4)
  assert.equal(out.sources.length, 1)
  assert.equal(budgetReached, true)
  assert.match(R.renderPage(out, template), /SCOUT: budget reached/)
  assert.equal(R.validateReport(report([item(1)])).budgetReached, false)
})

test('sections: top 5 skips Parked; callouts, community picks and the rest', () => {
  const items = [
    item(1, { category: 'Parked' }),
    ...[2, 3, 4, 5, 6].map((n) => item(n)),
    item(7, { replaces: 'the /ship lint step' }),
    item(8, { community: { license: 'MIT', stars: 1200, lastCommit: '2026-10-20' } }),
    item(9),
  ]
  const s = R.sections(items, 5)
  assert.deepEqual(s.top.map((i) => i.hook), ['Hook 2', 'Hook 3', 'Hook 4', 'Hook 5', 'Hook 6'])
  assert.deepEqual(s.replaces.map((i) => i.hook), ['Hook 7'])
  assert.deepEqual(s.community.map((i) => i.hook), ['Hook 8'])
  assert.deepEqual(s.also.map((i) => i.hook), ['Hook 1', 'Hook 9'])
})

test('the page is self-contained, escaped, light and dark, with every section', () => {
  const items = [
    item(1, { hook: '<script>alert(1)</script>' }),
    item(2, { replaces: 'custom hook X' }),
    item(3), item(4), item(5), item(6),
    item(7, { community: { license: 'Apache-2.0', stars: 45370, lastCommit: '2026-10-30' } }),
  ]
  const page = R.renderPage(R.validateReport(report(items)).report, template)
  assert.doesNotMatch(page, /<script/i)
  assert.match(page, /&lt;script&gt;/)
  assert.doesNotMatch(page, /<link[^>]+stylesheet|src="http/i)
  assert.match(page, /prefers-color-scheme: dark/)
  assert.doesNotMatch(page, /<!--SCOUT:/)
  assert.match(page, /Top 5 to adopt/)
  assert.match(page, /Native now: Tip number 2/)
  assert.match(page, /Replaces your custom <strong>custom hook X<\/strong>/)
  assert.match(page, /Community picks/)
  assert.match(page, /Apache-2\.0 · ★ 45,370 · last commit 2026-10-30/)
  assert.match(page, /Claude Code 2\.1\.40 → 2\.1\.50/)
  assert.match(page, /<code>superpowers<\/code>/)
})

test('privacy: secrets, .env values, machine paths and transcript text are refused; a plain setting is not', () => {
  for (const bad of ['ghp_' + 'a'.repeat(36), 'sk-ant-' + 'x'.repeat(20), 'API_TOKEN=' + 'b'.repeat(24), 'C:\\Users\\someone\\x', '/home/dev/project/', '{"role": "user"}', '\nHuman: hi']) {
    assert.ok(R.privacyProblem(bad), bad)
  }
  assert.equal(R.privacyProblem('Set BASH_DEFAULT_TIMEOUT_MS=600000 for longer runs.'), null)
})

test('privacy: any drive path is refused; an https source url still passes', () => {
  const page = (it) => R.renderPage(R.validateReport(report([it])).report, template)
  assert.match(R.privacyProblem(page(item(1, { hook: 'Lives in C:\\coding projects\\x' }))), /a machine path/)
  assert.match(R.privacyProblem('see d:/work/repo'), /a machine path/)
  assert.equal(R.privacyProblem(page(item(1, { source: { name: 'Docs', url: 'https://code.claude.com/docs/en/overview' } }))), null)
})

test('CLI: writes the page and state; a second run with nothing new writes nothing and says so', () => {
  const root = project()
  try {
    const f = join(root, 'r1.json')
    writeFileSync(f, JSON.stringify(report([item(1), item(2)])))
    const a = run(renderJs, root, f)
    assert.equal(a.status, 0, a.stderr)
    assert.match(a.stdout, /SCOUT: page docs\/scout\/2026-11-02\.html \(2 items\)/)
    const state = JSON.parse(readFileSync(join(root, 'docs', 'scout', 'state.json'), 'utf8'))
    assert.deepEqual(state, { claudeCodeVersion: '2.1.50', lastRun: '2026-11-02', cursors: { 'claude-code-changelog': '2.1.50', superpowers: 'v6.1.0' } })

    const g = join(root, 'r2.json')
    writeFileSync(g, JSON.stringify({ ...report([]), date: '2026-11-09' }))
    const b = run(renderJs, root, g)
    assert.equal(b.status, 0, b.stderr)
    assert.equal(b.stdout.trim(), 'SCOUT: nothing new since 2.1.50')
    assert.equal(existsSync(join(root, 'docs', 'scout', '2026-11-09.html')), false)
    const p = run(prJs, root, g, ['--repo', 'acme/app', '--dry-run'])
    assert.equal(p.status, 0, p.stderr)
    assert.match(p.stdout, /SCOUT: no page for 2026-11-09 — no pull request/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CLI: a refused report exits 2 and writes nothing', () => {
  const root = project()
  try {
    const f = join(root, 'bad.json')
    writeFileSync(f, JSON.stringify(report([item(1, { why: 'token sk-ant-' + 'z'.repeat(20) })])))
    const r = run(renderJs, root, f)
    assert.equal(r.status, 2)
    assert.match(r.stderr, /SCOUT: page refused — it contains an Anthropic key/)
    assert.equal(existsSync(join(root, 'docs', 'scout', 'state.json')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// A git project on `main` with the seed committed; the report lives outside the tree. git needs the real PATH; --repo
// and --base keep gh out of it.
function gitProject() {
  const root = project()
  const git = (...a) => {
    const r = spawnSync('git', a, { cwd: root, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout
  }
  git('init', '-q', '-b', 'main')
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'add', '.')
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'seed')
  return { root, git }
}
const reportFile = (r) => {
  const f = join(mkdtempSync(join(tmpdir(), 'scout-report-')), 'r.json')
  writeFileSync(f, JSON.stringify(r))
  return f
}
const runPr = (root, file, args) => spawnSync(process.execPath, [prJs, '--report', file, '--root', root, '--repo', 'acme/app', '--base', 'main', ...args], { encoding: 'utf8' })

test('pr: refuses off the default branch or with other changes in the tree — also in a dry run', () => {
  const { root, git } = gitProject()
  try {
    const f = reportFile(report([item(1)]))
    assert.equal(run(renderJs, root, f).status, 0)
    assert.equal(runPr(root, f, ['--dry-run']).status, 0)

    writeFileSync(join(root, 'stray.txt'), 'x')
    git('add', 'stray.txt')
    const dirty = runPr(root, f, ['--dry-run'])
    assert.equal(dirty.status, 2)
    assert.match(dirty.stderr, /SCOUT: the working tree has other changes \(stray\.txt\) — they would ride along/)
    git('rm', '-q', '--cached', 'stray.txt')
    rmSync(join(root, 'stray.txt'))

    git('switch', '-q', '-c', 'feature')
    const off = runPr(root, f, ['--dry-run'])
    assert.equal(off.status, 2)
    assert.match(off.stderr, /SCOUT: on branch feature, not the default branch main/)
    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'feature', 'nothing switched')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('treeProblem reads porcelain lines with a leading space', () => {
  assert.equal(P.treeProblem('main', 'main', '?? docs/scout/2026-11-02.html\n M docs/scout/state.json\n', 'docs/scout/2026-11-02.html'), null)
  assert.match(P.treeProblem('main', 'main', ' M README.md\n', 'docs/scout/2026-11-02.html'), /README\.md/)
})

test('pr: body has the top 5 as text, the page link and the useful checkboxes; dry run calls nothing', () => {
  const { root } = gitProject()
  try {
    const items = [1, 2, 3, 4, 5, 6].map((n) => item(n))
    const f = reportFile(report(items))
    assert.equal(run(renderJs, root, f).status, 0)
    const r = runPr(root, f, ['--dry-run'])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /branch: chore\/scout-2026-11-02/)
    assert.match(r.stdout, /## Top 5\n\n1\. \*\*Tip number 1 saves time\*\* — Hook 1 \(`\.claude\/commands\/ship\.md`\)/)
    assert.match(r.stdout, /https:\/\/github\.com\/acme\/app\/blob\/chore\/scout-2026-11-02\/docs\/scout\/2026-11-02\.html/)
    assert.equal((r.stdout.match(/^- \[ \] /gm) ?? []).length, 6)
    assert.match(r.stdout, /gh api -X POST repos\/acme\/app\/pulls/)
    assert.doesNotMatch(r.stdout, /gh pr create/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('repoFromRemote reads https and ssh GitHub remotes', () => {
  assert.equal(P.repoFromRemote('https://github.com/acme/app.git'), 'acme/app')
  assert.equal(P.repoFromRemote('git@github.com:acme/app.git'), 'acme/app')
  assert.equal(P.repoFromRemote('https://gitlab.com/acme/app'), null)
})

test('the seed sources.json is valid and names only public sources', () => {
  const s = JSON.parse(readFileSync(join(kit, 'templates', 'docs', 'scout', 'sources.json'), 'utf8'))
  assert.ok(s.caps.maxSources > 0 && s.caps.maxItemsPerSource > 0 && s.caps.maxItems > 0 && s.caps.topN === 5)
  const ids = s.sources.map((x) => x.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const x of s.sources) {
    assert.ok(['github-file', 'github-commits', 'github-releases', 'web', 'template-only'].includes(x.type), x.id)
    assert.ok(x.type === 'web' ? /^https:\/\//.test(x.url) : /^[\w.-]+\/[\w.-]+$/.test(x.repo), x.id)
  }
  assert.ok(s.sources.some((x) => !/^anthropics\//.test(x.repo ?? 'anthropic') && x.type !== 'template-only'), 'a non-Anthropic source')
})
