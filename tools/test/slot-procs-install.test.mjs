// installNeed (plan 010): when a slot needs `npm install` - the lockfile changed, or its packages are missing even
// though the lockfile hash still matches. Pure check on temp folders; npm never runs.
//   node --test tools/test/slot-procs-install.test.mjs
// Imports the installed copy (scripts/lib/slot-procs.mjs, after `node tools/sync.mjs --target . --apply`), since
// the core/ source carries template placeholders. SLOT_PROCS_ROOT=<project> tests another installed copy.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const project = process.env.SLOT_PROCS_ROOT ? resolve(process.env.SLOT_PROCS_ROOT) : kit
const { installNeed, installReason } = await import(pathToFileURL(join(project, 'scripts', 'lib', 'slot-procs.mjs')).href)

const scratch = []
after(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true })
})

const LOCK = '{"name":"fixture","lockfileVersion":3,"packages":{"":{"name":"fixture"},"node_modules/cross-env":{"version":"7.0.3"}}}\n'
const EMPTY_LOCK = '{"name":"fixture","lockfileVersion":3,"packages":{"":{"name":"fixture"}}}\n'
const sha = (s) => createHash('sha256').update(s).digest('hex')

/** A temp package folder: optional lockfile, hash file (matching or stale) and installed node_modules. */
function fixture({ lock = true, hash = 'match', modules = true, lockText = LOCK } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kit-installneed-'))
  scratch.push(root)
  const dir = join(root, 'server')
  mkdirSync(dir, { recursive: true })
  if (lock) writeFileSync(join(dir, 'package-lock.json'), lockText)
  const hashPath = join(root, '.claude', '.last-npm-install-hash-server')
  if (hash) {
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(hashPath, hash === 'match' ? sha(lockText) : sha('an older lockfile'))
  }
  if (modules) {
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', '.package-lock.json'), LOCK)
  }
  return { dir, hashPath }
}

test('hash unchanged but node_modules missing -> missing', () => {
  const { dir, hashPath } = fixture({ modules: false })
  assert.equal(installNeed(dir, hashPath), 'missing')
})

test('hash unchanged, node_modules present but incomplete (no .package-lock.json) -> missing', () => {
  const { dir, hashPath } = fixture({ modules: false })
  mkdirSync(join(dir, 'node_modules', 'cross-env'), { recursive: true })
  assert.equal(installNeed(dir, hashPath), 'missing')
})

test('hash unchanged and node_modules present -> no install', () => {
  const { dir, hashPath } = fixture()
  assert.equal(installNeed(dir, hashPath), null)
})

test('hash changed -> changed', () => {
  const { dir, hashPath } = fixture({ hash: 'stale' })
  assert.equal(installNeed(dir, hashPath), 'changed')
})

test('no hash file yet -> changed', () => {
  const { dir, hashPath } = fixture({ hash: null })
  assert.equal(installNeed(dir, hashPath), 'changed')
})

test('no lockfile -> no install', () => {
  const { dir, hashPath } = fixture({ lock: false, modules: false })
  assert.equal(installNeed(dir, hashPath), null)
})

test('lockfile with no dependencies, hash unchanged, no node_modules -> no install (npm never creates it)', () => {
  const { dir, hashPath } = fixture({ modules: false, lockText: EMPTY_LOCK })
  assert.equal(installNeed(dir, hashPath), null)
})

test('v1 lockfile with dependencies, hash unchanged, no node_modules -> missing', () => {
  const v1 = '{"name":"fixture","lockfileVersion":1,"dependencies":{"cross-env":{"version":"7.0.3"}}}\n'
  const { dir, hashPath } = fixture({ modules: false, lockText: v1 })
  assert.equal(installNeed(dir, hashPath), 'missing')
})

test('the reason words the messages print', () => {
  assert.equal(installReason('missing'), 'packages missing')
  assert.equal(installReason('changed'), 'lockfile changed')
})
