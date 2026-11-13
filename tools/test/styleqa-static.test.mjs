// scripts/styleqa/static-checks.mjs + run.mjs (core/scripts/styleqa): S1 (a literal px width in a media query), S2 (a
// colour literal outside the token definitions) and S3 (a font-size literal) on the fixture stylesheets, with file and
// line; token definitions and a breakpoint-variable media query are not reported; no token prefixes = S2/S3 off; the
// static run writes one report whose IDs stay the same across runs.
//   node --test tools/test/styleqa-static.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const fixture = join(kit, 'tools', 'fixtures', 'styleqa')
const engine = join(kit, 'scripts', 'styleqa')
const { staticChecks, globToRegExp, parseStylesheet } = await import(pathToFileURL(join(engine, 'static-checks.mjs')).href)
const { loadSettings } = await import(pathToFileURL(join(engine, 'config.mjs')).href)
const settings = () => loadSettings(join(fixture, 'settings.json'))
const at = (fs) => fs.map((f) => `${f.check} ${f.file}:${f.line}`).sort()

test('S1, S2 and S3 are each found on the fixture stylesheets with file and line', () => {
  const { findings, notes, files } = staticChecks({ root: fixture, settings: settings() })
  assert.deepEqual(files, ['styles/app.css', 'styles/nav.css', 'styles/tokens.css'])
  assert.deepEqual(notes, [])
  assert.deepEqual(at(findings), [
    'S1 styles/app.css:9',
    'S2 styles/app.css:23',
    'S2 styles/app.css:5',
    'S2 styles/nav.css:6',
    'S3 styles/app.css:6',
    'S3 styles/nav.css:7',
  ].sort())
  const s1 = findings.find((f) => f.check === 'S1')
  assert.match(s1.message, /600px/)
  assert.equal(s1.locator, 'styles/app.css | @media (max-width: 600px) | @media')
  const s2 = findings.find((f) => f.check === 'S2' && f.line === 5)
  assert.equal(s2.selector, '.card')
  assert.equal(s2.property, 'background')
  assert.equal(s2.locator, 'styles/app.css | .card | background', 'a static locator is file + selector + property, never a line')
})

test('a token definition line, a tokens file and a breakpoint-variable media query are not reported', () => {
  const { findings } = staticChecks({ root: fixture, settings: settings() })
  assert.ok(!findings.some((f) => f.file === 'styles/tokens.css'), 'tokenFiles are never reported')
  assert.ok(!findings.some((f) => f.file === 'styles/app.css' && f.line === 3), '--color-accent: #00aa55 is a token definition')
  assert.ok(!findings.some((f) => /--bp-md/.test(f.selector)), 'the var(--bp-md) media query matches breakpointPattern')
  assert.ok(!findings.some((f) => /#123456/.test(f.value)), 'a colour in a comment is not a declaration')
  // Without breakpointPattern the literal-free variable query is still not S1 (no px in it).
  const noBp = staticChecks({ root: fixture, settings: { ...settings(), breakpointPattern: '' } })
  assert.equal(noBp.findings.filter((f) => f.check === 'S1').length, 1)
})

test('no token prefixes configured: S2/S3 off, and the result says so', () => {
  const r = staticChecks({ root: fixture, settings: { ...settings(), tokenPrefixes: { color: '', fontSize: '', radius: '' } } })
  assert.deepEqual(r.notes, ['S2/S3 off: no token prefixes configured'])
  assert.deepEqual(r.findings.map((f) => f.check), ['S1'])
  const onlyColor = staticChecks({ root: fixture, settings: { ...settings(), tokenPrefixes: { color: '--color-', fontSize: '', radius: '' } } })
  assert.deepEqual(onlyColor.notes, ['S3 off: no font-size token prefix configured'])
  assert.ok(!onlyColor.findings.some((f) => f.check === 'S3'))
})

test('the kit glob subset and the stylesheet parser', () => {
  assert.ok(globToRegExp('styles/**/*.css').test('styles/app.css'))
  assert.ok(globToRegExp('styles/**/*.css').test('styles/a/b.css'))
  assert.ok(!globToRegExp('styles/*.css').test('styles/a/b.css'))
  assert.ok(globToRegExp('src/').test('src/x/y.scss'))
  const items = parseStylesheet('.a {\n  // note: #fff\n  &:hover { color: #000; }\n  background: url("x;y.png");\n}\n')
  const decls = items.filter((i) => i.kind === 'decl')
  assert.deepEqual(decls.map((d) => [d.prop, d.line, d.stack.join(' / ')]), [['color', 3, '.a / &:hover'], ['background', 4, '.a']])
})

test('run.mjs --layers=static writes one report with the same IDs across runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'styleqa-static-'))
  try {
    cpSync(fixture, dir, { recursive: true })
    const run = () => spawnSync(process.execPath, [join(engine, 'run.mjs'), `--root=${dir}`, `--settings=${join(dir, 'settings.json')}`, '--layers=static', '--date=2026-01-02'], { encoding: 'utf8' })
    const a = run()
    assert.equal(a.status, 0, a.stderr)
    assert.match(a.stdout, /STYLEQA: report out\/styleqa\/report\.md — 6 open \(6 new, 0 known\), 0 gone/)
    const ids = (t) => [...t.matchAll(/\b(S[123]-[0-9a-f]{8})\b/g)].map((m) => m[1]).sort()
    const first = readFileSync(join(dir, 'out', 'styleqa', 'report.md'), 'utf8')
    assert.equal(new Set(ids(first)).size, 6)
    // An unrelated edit (a blank line on top moves every line) keeps the IDs.
    writeFileSync(join(dir, 'styles', 'app.css'), `\n\n${readFileSync(join(dir, 'styles', 'app.css'), 'utf8')}`)
    const b = run()
    assert.equal(b.status, 0, b.stderr)
    assert.match(b.stdout, /6 open \(0 new, 6 known\), 0 gone/)
    const second = readFileSync(join(dir, 'out', 'styleqa', 'report.md'), 'utf8')
    assert.deepEqual([...new Set(ids(second))], [...new Set(ids(first))])
    assert.ok(existsSync(join(dir, 'out', 'styleqa', 'known.json')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
