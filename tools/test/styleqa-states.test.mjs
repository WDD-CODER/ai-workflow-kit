// scripts/styleqa/sweep.mjs (core/scripts/styleqa): the state safety rules — a step that touches a blocked word or
// selector is refused before the browser opens, the request guard aborts every non-GET request and answers list
// requests empty for the `empty` state, and screenshots are at most 4 viewport-high segments.
//   node --test tools/test/styleqa-states.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const fixture = join(kit, 'tools', 'fixtures', 'styleqa')
const engine = join(kit, 'scripts', 'styleqa')
const { blockedStepProblems, guardDecision, installGuard, segments, signInPath, firstId } = await import(pathToFileURL(join(engine, 'sweep.mjs')).href)
const { sweepStatesOf, mapCheck, changedPages } = await import(pathToFileURL(join(engine, 'pages.mjs')).href)

const pageWith = (steps) => ({ slug: 'dashboard', states: [{ name: 'menu-open', steps }] })
const blocked = { blockedSteps: { words: ['delete', 'Save'], selectors: ['[data-qa=logout]'] } }

test('a step whose target matches a blocked word or selector is refused, naming the step', () => {
  const p = blockedStepProblems([pageWith([{ action: 'click', target: '[data-qa=menu]' }, { action: 'click', target: 'button.Delete-all' }])], blocked)
  assert.equal(p.length, 1)
  assert.match(p[0], /pages\[dashboard\]\.states\[menu-open\]\.steps\[1\]/)
  assert.match(p[0], /"delete"/)
  assert.match(blockedStepProblems([pageWith([{ action: 'click', target: 'a[data-qa=logout] span' }])], blocked)[0], /selector "\[data-qa=logout\]"/)
  assert.match(blockedStepProblems([pageWith([{ action: 'fill', target: '#name', value: 'save me' }])], blocked)[0], /"save"/)
  assert.deepEqual(blockedStepProblems([pageWith([{ action: 'hover', target: '.card' }])], blocked), [])
})

test('the engine refuses a blocked step before it looks for the browser (exit 1, step named)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'styleqa-states-'))
  try {
    const base = JSON.parse(readFileSync(join(fixture, 'settings.json'), 'utf8'))
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ ...base, blockedSteps: { words: ['sample'], selectors: [] } }))
    const run = (settings) => spawnSync(process.execPath, [join(engine, 'run.mjs'), `--root=${fixture}`, `--settings=${settings}`, `--out=${join(dir, 'out')}`, '--layers=sweep', '--pages=settings'], { encoding: 'utf8' })
    const r = run(file)
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`)
    assert.match(r.stderr, /pages\[settings\]\.states\[editing\]\.steps\[0\] \(fill #name\) is refused/)
    assert.ok(!existsSync(join(dir, 'out')), 'nothing was written, no browser looked for')
    // Without the blocked word the same page is not refused (it stops later: no Playwright = 2, or no origin = 1).
    const ok = run(join(fixture, 'settings.json'))
    assert.doesNotMatch(ok.stderr, /is refused/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the request guard aborts every non-GET request, and answers list requests empty in the empty state', () => {
  const api = 'http://localhost:3000'
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) assert.equal(guardDecision({ method, url: `${api}/api/recipes`, resourceType: 'fetch' }, { apiOrigin: api }), 'abort', method)
  assert.equal(guardDecision({ method: 'GET', url: `${api}/api/recipes`, resourceType: 'fetch' }, { apiOrigin: api }), 'continue')
  assert.equal(guardDecision({ method: 'GET', url: `${api}/api/recipes`, resourceType: 'fetch' }, { apiOrigin: api, empty: true }), 'empty')
  assert.equal(guardDecision({ method: 'GET', url: `${api}/api/recipes/42`, resourceType: 'xhr' }, { apiOrigin: api, empty: true }), 'continue', 'a record request is not a list')
  assert.equal(guardDecision({ method: 'GET', url: 'http://localhost:4200/main.js', resourceType: 'script' }, { apiOrigin: api, empty: true }), 'continue')
  assert.equal(guardDecision({ method: 'GET', url: 'https://cdn.example.com/x', resourceType: 'fetch' }, { apiOrigin: api, empty: true }), 'continue', 'another origin is left alone')
})

test('installGuard routes real requests through that decision', async () => {
  let handler
  await installGuard({ route: async (_glob, fn) => { handler = fn } }, { empty: true }, 'http://localhost:3000')
  const run = async (method, url, resourceType) => {
    const seen = []
    await handler({ request: () => ({ method: () => method, url: () => url, resourceType: () => resourceType }), abort: async (why) => seen.push(['abort', why]), fulfill: async (o) => seen.push(['fulfill', o.body]), continue: async () => seen.push(['continue']) })
    return seen[0]
  }
  assert.deepEqual(await run('POST', 'http://localhost:3000/api/x', 'fetch'), ['abort', 'blockedbyclient'])
  assert.deepEqual(await run('GET', 'http://localhost:3000/api/x', 'fetch'), ['fulfill', '[]'])
  assert.deepEqual(await run('GET', 'http://localhost:4200/', 'document'), ['continue'])
})

test('screenshots: at most 4 viewport-high segments; a longer page is truncated', () => {
  assert.deepEqual(segments(500, 800), { segments: [{ y: 0, height: 500 }], truncated: false })
  const three = segments(2000, 800)
  assert.deepEqual(three.segments.map((s) => [s.y, s.height]), [[0, 800], [800, 800], [1600, 400]])
  assert.equal(three.truncated, false)
  const exactly = segments(3200, 800)
  assert.equal(exactly.segments.length, 4)
  assert.equal(exactly.truncated, false)
  const long = segments(9000, 800)
  assert.equal(long.segments.length, 4)
  assert.equal(long.truncated, true)
})

test('the sign-in module path stays inside the project; the first record id is read from a list', () => {
  assert.ok(signInPath('/proj', 'e2e/sign-in.mjs').replace(/\\/g, '/').endsWith('/proj/e2e/sign-in.mjs'))
  assert.equal(signInPath('/proj', ''), null)
  for (const bad of ['/etc/x.mjs', '../x.mjs', 'a/../../x.mjs', 'C:/x.mjs']) assert.throws(() => signInPath('/proj', bad), /inside the project/, bad)
  assert.equal(firstId([{ id: 7 }, { id: 8 }]), '7')
  assert.equal(firstId({ items: [{ id: 'abc' }] }), 'abc')
  assert.equal(firstId([]), null)
})

test('a page with idType also runs the empty state; a route with a query is a tab state', () => {
  assert.deepEqual(sweepStatesOf({ routes: ['/a'], states: [{ name: 'x' }] }), ['default', 'x'])
  assert.deepEqual(sweepStatesOf({ routes: ['/a', '/a?tab=Billing info'], idType: '/api/a', states: [{ name: 'x' }] }), ['default', 'empty', 'tab-billing-info', 'x'])
})

test('the map check and --changed work on route lists', () => {
  const map = { pages: [{ slug: 'a', routes: ['/a', '/a/:id'] }], excluded: [{ route: '/logout', why: 'x' }] }
  assert.deepEqual(mapCheck(map, [{ path: '/a' }, { path: '/a/:recipeId' }, { path: '/logout' }, { path: '/new' }]), ['/new'])
  assert.deepEqual(mapCheck(map, [{ path: '/a', lazy: true }, { path: '/b', lazy: true }]), ['/b'])
  const pages = [{ slug: 'settings', routes: ['/settings'] }, { slug: 'home', routes: ['/'] }]
  assert.deepEqual(changedPages(pages, ['src/app/pages/settings/x.ts'], []).map((p) => p.slug), ['settings'])
  assert.deepEqual(changedPages(pages, ['src/app/pages/settings/x.ts'], [{ path: '/settings', folder: 'src/app/other' }]).map((p) => p.slug), [])
  assert.deepEqual(changedPages(pages, ['README.md'], []), [])
})
