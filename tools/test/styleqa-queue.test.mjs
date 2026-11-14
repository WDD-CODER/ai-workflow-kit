// scripts/styleqa/queue.mjs: the bounded review queue. Uses the kit's own rendered copy of the engine.
//   node --test tools/test/styleqa-queue.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const fixture = join(kit, 'tools', 'fixtures', 'styleqa', 'review')
const { main } = await import(pathToFileURL(join(kit, 'scripts', 'styleqa', 'queue.mjs')).href)

/** A project folder with the fixture page map and these screenshots (names under out/styleqa/screens) and findings. */
function project(shots, findings = {}) {
  const root = mkdtempSync(join(tmpdir(), 'styleqa-queue-'))
  cpSync(join(fixture, 'docs'), join(root, 'docs'), { recursive: true })
  const screens = join(root, 'out', 'styleqa', 'screens')
  mkdirSync(screens, { recursive: true })
  for (const s of shots) writeFileSync(join(screens, s), 'png')
  writeFileSync(join(root, 'out', 'styleqa', 'known.json'), JSON.stringify({ version: 1, updated: 'd', findings }))
  return root
}
const run = (root, ...args) => main([`--root=${root}`, `--settings=${join(fixture, 'settings.json')}`, ...args])
const queue = (root, slug) => JSON.parse(readFileSync(join(root, 'out', 'styleqa', 'review', `queue-${slug}.json`), 'utf8'))
const S = (page, state, width, seg = 1) => `${page}-${state}-${width}-${seg}.png`

test('every segment at the smallest and largest width is queued for every state; a middle width is not', () => {
  const root = project([S('dash', 'default', 375), S('dash', 'default', 375, 2), S('dash', 'default', 620), S('dash', 'default', 1366), S('dash', 'menu', 375), S('dash', 'menu', 620), S('dash', 'menu', 1366)])
  const r = run(root, '--pages=dash')
  assert.equal(r.code, 0, r.lines.join('\n'))
  const q = queue(root, 'dash')
  assert.deepEqual(q.entries.map((e) => `${e.state}-${e.width}-${e.segment}`), ['default-375-1', 'default-375-2', 'default-1366-1', 'menu-375-1', 'menu-1366-1'])
  assert.deepEqual(q.skipped, [])
  assert.equal(q.reviewFile, 'out/styleqa/review/review-dash.json')
})

test('a middle width is queued only for a state x width with an S2/S3 finding, and each entry carries its measured findings', () => {
  const shot = (n) => `out/styleqa/screens/${n}`
  const findings = {
    'S2-aaaaaaaa': { id: 'S2-aaaaaaaa', layer: 'sweep', check: 'S2', page: 'dash', state: 'menu', widths: [620], status: 'new', message: 'colour literal', screenshots: [shot(S('dash', 'menu', 620))] },
    'L1-bbbbbbbb': { id: 'L1-bbbbbbbb', layer: 'sweep', check: 'L1', page: 'dash', state: 'default', widths: [620], status: 'new', message: 'overflow', screenshots: [shot(S('dash', 'default', 620))] },
    'L1-cccccccc': { id: 'L1-cccccccc', layer: 'sweep', check: 'L1', page: 'dash', state: 'default', widths: [375], status: 'known', message: 'wide row', screenshots: [shot(S('dash', 'default', 375))] },
  }
  const root = project([S('dash', 'default', 375), S('dash', 'default', 620), S('dash', 'default', 1366), S('dash', 'menu', 375), S('dash', 'menu', 620), S('dash', 'menu', 1366)], findings)
  run(root, '--pages=dash')
  const q = queue(root, 'dash')
  assert.deepEqual(q.entries.map((e) => `${e.state}-${e.width}`), ['default-375', 'default-1366', 'menu-375', 'menu-1366', 'menu-620'])
  assert.deepEqual(q.entries[0].measured, [{ id: 'L1-cccccccc', check: 'L1', message: 'wide row' }])
  assert.deepEqual(q.entries[4].measured.map((m) => m.id), ['S2-aaaaaaaa'])
  assert.deepEqual(q.entries[1].measured, [])
})

test('a page over 24 images lists the rest as skipped and the summary line says how many', () => {
  const shots = []
  for (let k = 1; k <= 20; k++) shots.push(S('dash', 'default', 375, k), S('dash', 'default', 1366, k))
  const root = project(shots)
  const r = run(root, '--pages=dash')
  const q = queue(root, 'dash')
  assert.equal(q.entries.length, 24)
  assert.equal(q.skipped.length, 16)
  assert.match(r.lines.join('\n'), /queue dash: 24 images, 16 skipped \(over 24\)/)
})

test('a page with no screenshots says so; an unknown page stops with the list', () => {
  const root = project([S('dash', 'default', 375)])
  assert.match(run(root, '--pages=other').lines.join('\n'), /queue other: no screenshots/)
  const bad = run(root, '--pages=nope')
  assert.equal(bad.code, 1)
  assert.match(bad.lines.join('\n'), /valid pages/)
})
