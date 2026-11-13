// packs/angular/scripts/styleqa-routes.mjs: the angular route reader lists the routes of a routes file (nested children,
// lazy routes, :id params) and the engine's map check fails naming a route that is in neither `pages` nor `excluded`;
// without a route reader for the stack it prints `SKIP map check: no route reader for this stack`.
//   node --test tools/test/styleqa-routes-angular.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const fixture = join(kit, 'tools', 'fixtures', 'styleqa')
const engine = join(kit, 'scripts', 'styleqa')
const reader = join(kit, 'packs', 'angular', 'scripts', 'styleqa-routes.mjs')
const { readRoutes, locateComponent } = await import(pathToFileURL(reader).href)
const routesText = readFileSync(join(fixture, 'angular', 'app.routes.ts'), 'utf8')

test('the angular reader lists nested, lazy and :id routes, and leaves out redirects, wildcards and layouts', () => {
  const routes = readRoutes(routesText, 'src/app/app.routes.ts')
  assert.deepEqual(routes.map((r) => r.path), ['/dashboard', '/settings', '/settings/:id', '/admin/users', '/admin/users/:userId', '/reports', '/logout'])
  const by = Object.fromEntries(routes.map((r) => [r.path, r]))
  assert.equal(by['/reports'].lazy, true, 'loadChildren is lazy')
  assert.equal(by['/settings'].lazy, true, 'loadComponent is lazy')
  assert.equal(by['/dashboard'].lazy, false)
  assert.equal(by['/dashboard'].folder, 'src/app/pages/dashboard', 'a static component import gives its folder')
  assert.equal(by['/settings'].folder, 'src/app/pages/settings', 'a lazy import gives its folder')
  assert.equal(by['/admin/users/:userId'].folder, undefined)
})

test('a component folder is found by its selector', () => {
  const dir = mkdtempSync(join(tmpdir(), 'styleqa-loc-'))
  try {
    mkdirSync(join(dir, 'src', 'app', 'shared', 'app-header'), { recursive: true })
    writeFileSync(join(dir, 'src', 'app', 'shared', 'app-header', 'app-header.component.ts'), "@Component({ selector: 'app-header', template: '' })\nexport class AppHeaderComponent {}\n")
    assert.equal(locateComponent(dir, 'app-header'), 'src/app/shared/app-header')
    assert.equal(locateComponent(dir, 'app-footer'), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** A project folder with the fixture page map, the routes file and (optionally) the reader installed. */
function project(settingsOver, { withReader }) {
  const dir = mkdtempSync(join(tmpdir(), 'styleqa-routes-'))
  cpSync(join(fixture, 'docs'), join(dir, 'docs'), { recursive: true })
  cpSync(join(fixture, 'styles'), join(dir, 'styles'), { recursive: true })
  mkdirSync(join(dir, 'src', 'app'), { recursive: true })
  cpSync(join(fixture, 'angular', 'app.routes.ts'), join(dir, 'src', 'app', 'app.routes.ts'))
  if (withReader) {
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    cpSync(reader, join(dir, 'scripts', 'styleqa-routes.mjs'))
  }
  const settings = { ...JSON.parse(readFileSync(join(fixture, 'settings.json'), 'utf8')), ...settingsOver }
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings))
  return dir
}
const run = (dir, ...args) => {
  const r = spawnSync(process.execPath, [join(engine, 'run.mjs'), `--root=${dir}`, `--settings=${join(dir, 'settings.json')}`, `--out=${join(dir, 'out')}`, ...args], { encoding: 'utf8' })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

test('the map check fails naming every route that is in neither pages nor excluded', () => {
  const dir = project({ routesReader: 'scripts/styleqa-routes.mjs', routesFile: 'src/app/app.routes.ts' }, { withReader: true })
  try {
    const r = run(dir)
    assert.equal(r.status, 1, r.out)
    for (const route of ['/admin/users', '/admin/users/:userId', '/reports']) assert.ok(r.out.includes(`route ${route} is in neither pages nor excluded`), `${route}\n${r.out}`)
    assert.ok(!r.out.includes('route /logout is in neither'), 'an excluded route passes')
    assert.ok(!r.out.includes('route /settings/:id is'), 'a :id route matches whatever the param is called')
    // Cover them: the check passes.
    const mapFile = join(dir, 'docs', 'qa', 'styleqa-pages.json')
    const map = JSON.parse(readFileSync(mapFile, 'utf8'))
    map.excluded.push({ route: '/admin/users', why: 'x' }, { route: '/admin/users/:id', why: 'x' }, { route: '/reports', why: 'x' })
    map.pages[0].routes = ['/dashboard']
    writeFileSync(mapFile, JSON.stringify(map))
    const ok = run(dir)
    assert.equal(ok.status, 0, ok.out)
    assert.match(ok.out, /map check ok — 7 routes/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('with no route reader for the stack the map check prints a SKIP line and the run passes', () => {
  const dir = project({}, { withReader: false })
  try {
    const r = run(dir)
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /SKIP map check: no route reader for this stack/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
