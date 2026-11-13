// scripts/styleqa/pages.mjs + run.mjs (core/scripts/styleqa): page words resolve to slugs, an unknown word stops the run
// with every valid name, --list prints the pages with their states, and a bad page map is refused naming the field.
//   node --test tools/test/styleqa-pages.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const fixture = join(kit, 'tools', 'fixtures', 'styleqa')
const engine = join(kit, 'scripts', 'styleqa')
const { pageMapProblems, resolvePages, STEP_ACTIONS } = await import(pathToFileURL(join(engine, 'pages.mjs')).href)
const map = JSON.parse(readFileSync(join(fixture, 'docs', 'qa', 'styleqa-pages.json'), 'utf8'))
// An output folder that must never be created: in the temp folder, so no run can leave it beside the fixture.
const neverWritten = join(tmpdir(), `styleqa-never-written-${process.pid}`)
const cli = (root, ...args) => {
  const r = spawnSync(process.execPath, [join(engine, 'run.mjs'), `--root=${root}`, `--settings=${join(fixture, 'settings.json')}`, `--out=${neverWritten}`, ...args], { encoding: 'utf8' })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

test('--pages=dashboard and an alias resolve to the slug', () => {
  assert.deepEqual(pageMapProblems(map), [])
  assert.deepEqual(resolvePages(map, ['dashboard']).pages.map((p) => p.slug), ['dashboard'])
  assert.deepEqual(resolvePages(map, [' home ']).pages.map((p) => p.slug), ['dashboard'], 'trimmed, exact')
  assert.deepEqual(resolvePages(map, ['панель']).pages.map((p) => p.slug), ['dashboard'], 'an alias in any language')
  assert.deepEqual(resolvePages(map, ['prefs', 'dashboard', 'home']).pages.map((p) => p.slug), ['dashboard', 'settings'], 'each page once, map order')
  assert.deepEqual(resolvePages(map, []).pages.length, 2, 'no words = every page')
  assert.deepEqual(resolvePages(map, ['Home']).unknown, ['Home'], 'matching is exact')
})

test('--pages=nope exits 1 and prints every valid slug and alias, before anything runs', () => {
  const r = cli(fixture, '--pages=nope')
  assert.equal(r.status, 1)
  assert.match(r.out, /unknown page "nope"/)
  for (const name of ['dashboard', 'home', 'панель', 'settings', 'prefs']) assert.ok(r.out.includes(name), `lists ${name}`)
  assert.ok(!existsSync(neverWritten), 'nothing was written')
  // A known alias gets past page resolution. What the sweep does next depends on whether Playwright is installed here
  // (exit 2 "not installed", or a failed sweep against an origin that does not answer), so only resolution is
  // asserted, and the run writes into its own temp folder, never next to the fixture.
  const out = mkdtempSync(join(tmpdir(), 'styleqa-pages-'))
  try {
    const r2 = spawnSync(process.execPath, [join(engine, 'run.mjs'), `--root=${fixture}`, `--settings=${join(fixture, 'settings.json')}`, `--out=${out}`, '--pages=home', '--layers=sweep', '--app=http://127.0.0.1:9'], { encoding: 'utf8' })
    const ok = `${r2.stdout}${r2.stderr}`
    assert.notEqual(r2.status, 0, ok)
    assert.doesNotMatch(ok, /unknown page/)
    assert.match(ok, /sweep layer not installed|failed/i, ok)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('--list prints the pages with their states', () => {
  const r = cli(fixture, '--list')
  assert.equal(r.status, 0, r.out)
  const lines = r.out.trim().split(/\r?\n/)
  assert.equal(lines.length, 2)
  assert.match(lines[0], /^dashboard — Dashboard .*aliases: home, панель .*routes: \/dashboard .*states: default, menu-open$/)
  assert.match(lines[1], /^settings — Settings .*states: default, editing$/)
})

test('an empty page map prints "no pages" and exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'styleqa-pages-'))
  try {
    mkdirSync(join(dir, 'docs', 'qa'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'qa', 'styleqa-pages.json'), readFileSync(join(kit, 'templates', 'docs', 'qa', 'styleqa-pages.json')))
    const r = cli(dir)
    assert.equal(r.status, 0)
    assert.match(r.out, /no pages in docs\/qa\/styleqa-pages\.json/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a duplicate slug or alias, or a step outside the allowed actions, is refused with the field named', () => {
  assert.deepEqual(STEP_ACTIONS, ['click', 'hover', 'fill', 'press', 'waitFor', 'scrollTo'])
  const clone = () => JSON.parse(JSON.stringify(map))
  const dupSlug = clone()
  dupSlug.pages[1].slug = 'dashboard'
  assert.match(pageMapProblems(dupSlug).join('\n'), /pages\[1\]\.slug "dashboard" is already used by pages\[0\]\.slug/)
  const dupAlias = clone()
  dupAlias.pages[1].aliases = ['home']
  assert.match(pageMapProblems(dupAlias).join('\n'), /pages\[1\]\.aliases\[0\] "home" is already used by pages\[0\]\.aliases\[0\]/)
  const aliasIsSlug = clone()
  aliasIsSlug.pages[1].aliases = ['dashboard']
  assert.match(pageMapProblems(aliasIsSlug).join('\n'), /pages\[1\]\.aliases\[0\] "dashboard" is already used/)
  const badStep = clone()
  badStep.pages[0].states[0].steps[0].action = 'drag'
  assert.match(pageMapProblems(badStep).join('\n'), /pages\[0\]\.states\[0\]\.steps\[0\]\.action "drag" — allowed: click \| hover \| fill \| press \| waitFor \| scrollTo/)
  // The CLI refuses the bad map, naming the field.
  const dir = mkdtempSync(join(tmpdir(), 'styleqa-pages-'))
  try {
    mkdirSync(join(dir, 'docs', 'qa'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'qa', 'styleqa-pages.json'), JSON.stringify(badStep))
    const r = cli(dir, '--list')
    assert.equal(r.status, 1)
    assert.match(r.out, /refused:[\s\S]*pages\[0\]\.states\[0\]\.steps\[0\]\.action "drag"/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
