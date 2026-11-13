// The real browser sweep on a static fixture app: one page, then all pages. Needs @playwright/test and
// @axe-core/playwright (and Chromium); without them it prints `SKIP styleqa-browser: Playwright not installed` and passes.
//   npm i --no-save @playwright/test @axe-core/playwright && npx playwright install chromium
//   node --test tools/test/styleqa-browser.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve, extname } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, cpSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const fixture = join(kit, 'tools', 'fixtures', 'styleqa', 'browser')
const engine = join(kit, 'scripts', 'styleqa', 'run.mjs')
const need = ['@playwright/test', '@axe-core/playwright']
const have = (() => {
  const req = createRequire(join(kit, 'package.json'))
  try { need.forEach((n) => req.resolve(n)); return true } catch { return false }
})()

const serve = () => new Promise((ok) => {
  const server = createServer((req, res) => {
    const name = (req.url ?? '/').split('?')[0].replace(/^\/+/, '') || 'wide'
    const file = join(fixture, 'app', `${name}${extname(name) ? '' : '.html'}`)
    if (!file.startsWith(join(fixture, 'app')) || !existsSync(file)) { res.writeHead(404).end('not found'); return }
    res.writeHead(200, { 'content-type': 'text/html' }).end(readFileSync(file))
  })
  server.listen(0, '127.0.0.1', () => ok(server))
})
const run = (root, port, ...args) => new Promise((ok) => {
  const p = spawn(process.execPath, [engine, `--root=${root}`, `--settings=${join(fixture, 'settings.json')}`, '--layers=sweep', `--app=http://127.0.0.1:${port}`, `--api=http://127.0.0.1:${port}`, '--date=2026-11-13', ...args], { encoding: 'utf8' })
  let out = ''
  p.stdout.on('data', (d) => { out += d })
  p.stderr.on('data', (d) => { out += d })
  p.on('close', (status) => ok({ status, out }))
})

test('the sweep finds the planted L1, U1 and rail defects, with screenshots, and writes nothing to the server', { skip: !have && 'SKIP' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'styleqa-browser-'))
  const server = await serve()
  try {
    cpSync(join(fixture, 'docs'), join(root, 'docs'), { recursive: true })
    symlinkSync(join(kit, 'node_modules'), join(root, 'node_modules'), 'junction')
    const port = server.address().port
    const one = await run(root, port, '--pages=wide')
    assert.equal(one.status, 0, one.out)
    const store1 = JSON.parse(readFileSync(join(root, 'out', 'styleqa', 'known.json'), 'utf8'))
    const f1 = Object.values(store1.findings)
    assert.ok(f1.some((f) => f.check === 'L1' && f.page === 'wide' && f.widths.includes(375)), 'L1 at 375')
    assert.ok(!f1.some((f) => f.check === 'L1' && f.widths.includes(1366)), 'no L1 at 1366')
    assert.ok(f1.some((f) => f.check === 'U1' && /native/.test(f.selector)), 'U1 on the unstyled button')
    assert.ok(f1.every((f) => f.page === 'wide'), 'one page swept')
    for (const f of f1) for (const s of f.screenshots) assert.ok(existsSync(join(root, s)), `screenshot ${s}`)

    const all = await run(root, port)
    assert.equal(all.status, 0, all.out)
    const store2 = JSON.parse(readFileSync(join(root, 'out', 'styleqa', 'known.json'), 'utf8'))
    const rail = Object.values(store2.findings).filter((f) => f.check === 'L6' && f.page === 'rails')
    assert.ok(rail.some((f) => /sliver/.test(f.locator)), 'rail sliver')
    assert.ok(rail.some((f) => /no-snap/.test(f.locator)), 'rail with no scroll-snap')
    const report = readFileSync(join(root, 'out', 'styleqa', 'report.md'), 'utf8')
    assert.match(report, /## Rails[\s\S]*#rail/)
  } finally {
    server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

if (!have) console.log('SKIP styleqa-browser: Playwright not installed')

test('a sweep against an origin that does not answer fails with a status line, not a pass', { skip: !have && 'SKIP' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'styleqa-browser-'))
  try {
    cpSync(join(fixture, 'docs'), join(root, 'docs'), { recursive: true })
    symlinkSync(join(kit, 'node_modules'), join(root, 'node_modules'), 'junction')
    const r = await run(root, 1)
    assert.notEqual(r.status, 0)
    assert.match(r.out, /status: failed — the app origin/)
    assert.match(readFileSync(join(root, 'out', 'styleqa', 'report.md'), 'utf8'), /^Status: failed/m)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
