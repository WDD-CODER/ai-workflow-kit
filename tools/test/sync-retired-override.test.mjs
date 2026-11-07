// Plan 094: sync --apply --prune removes a project override of a file the kit retired (tools/retired-files.json);
// an override of a path the kit never shipped stays a NOTE and is never touched.
//   node --test tools/test/sync-retired-override.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { removeOverrideEntry } from '../lib/kit.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const CFG = { project: { name: 'core-only' }, stack: { packs: [] }, commands: { build: 'build', lint: 'lint', test: 'test' }, hooks: { shellPath: 'bash' } }
const RETIRED = '.claude/commands/auto-solve.md'
const KEPT = '.gitignore'
const TYPO = '.claude/commands/not-a-kit-file.md'
const entry = (path) => `    {\n      "path": "${path}",\n      "reason": "test: the project keeps its own copy"\n    }`
const sha = (t) => createHash('sha256').update(t).digest('hex')
const node = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd })

/** A project installed from the kit whose config lists the given overrides; returns { dir, cfgFile, text(path) }. */
function project(paths) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sync-retired-')))
  writeFileSync(join(dir, 'kit.config.json'), JSON.stringify(CFG, null, 2))
  const inst = node(join(kit, 'tools', 'install.mjs'), ['--target', dir, '--allow-unfilled'])
  assert.equal(inst.status, 0, inst.stdout + inst.stderr)
  const head = JSON.stringify(CFG, null, 2).replace(/\n\}$/, '')
  const cfg = `${head},\n  "overrides": [\n${paths.map(entry).join(',\n')}\n  ]\n}\n`
  writeFileSync(join(dir, 'kit.config.json'), cfg)
  return { dir, cfg }
}
const put = (dir, p, text) => {
  mkdirSync(join(dir, p, '..'), { recursive: true })
  writeFileSync(join(dir, p), text)
}
const sync = (dir, extra = []) => node(join(kit, 'tools', 'sync.mjs'), ['--target', dir, '--source', kit, ...extra], dir)
const readCfg = (dir) => readFileSync(join(dir, 'kit.config.json'), 'utf8')

test('retired + unchanged: dry run shows the row, --apply alone keeps it, --apply --prune deletes the file and the entry', () => {
  const { dir, cfg } = project([KEPT, RETIRED])
  try {
    put(dir, RETIRED, 'the last shipped copy\n')
    // The project's install record of the last shipped copy: the file still matches it.
    const instFile = join(dir, '.kit', 'install.json')
    const inst = JSON.parse(readFileSync(instFile, 'utf8'))
    inst.files[RETIRED] = { sha256: sha('the last shipped copy\n'), kind: 'managed', source: 'core/x' }
    writeFileSync(instFile, JSON.stringify(inst, null, 2))

    const dry = sync(dir)
    assert.match(dry.stdout, new RegExp(`pruned-override\\s+${RETIRED.replace(/[.]/g, '\\.')} — override of a file the kit retired \\(on --apply --prune\\)`))
    assert.doesNotMatch(dry.stdout, /NOTE override \.claude\/commands\/auto-solve\.md/)
    assert.equal(readCfg(dir), cfg)
    assert.ok(existsSync(join(dir, RETIRED)))

    const applied = sync(dir, ['--apply'])
    assert.match(applied.stdout, /\(needs --prune\)/)
    assert.equal(readCfg(dir), cfg)
    assert.ok(existsSync(join(dir, RETIRED)))

    const pruned = sync(dir, ['--apply', '--prune'])
    assert.equal(pruned.status, 0, pruned.stdout + pruned.stderr)
    assert.match(pruned.stdout, /1 pruned-override/)
    assert.equal(existsSync(join(dir, RETIRED)), false)
    assert.equal(existsSync(join(dir, '.kit', 'pruned', RETIRED)), false)
    // Every other byte of the config is unchanged: the file equals the original minus the one entry.
    assert.equal(readCfg(dir), cfg.replace(`,\n${entry(RETIRED)}`, ''))
    assert.equal(JSON.parse(readCfg(dir)).overrides.length, 1)
    // A second run has nothing left to do.
    assert.doesNotMatch(sync(dir, ['--apply', '--prune']).stdout, /pruned-override/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('retired + changed by the project: the file moves to .kit/pruned/<path>, the entry goes, the others stay', () => {
  const { dir, cfg } = project([RETIRED, KEPT])
  try {
    put(dir, RETIRED, 'my own edits\n')
    const pruned = sync(dir, ['--apply', '--prune'])
    assert.equal(pruned.status, 0, pruned.stdout + pruned.stderr)
    assert.match(pruned.stdout, /file moved to \.kit\/pruned\/\.claude\/commands\/auto-solve\.md/)
    assert.equal(existsSync(join(dir, RETIRED)), false)
    assert.equal(readFileSync(join(dir, '.kit', 'pruned', RETIRED), 'utf8'), 'my own edits\n')
    // First entry removed: the file equals the original minus that entry and its comma.
    assert.equal(readCfg(dir), cfg.replace(`${entry(RETIRED)},\n`, ''))
    assert.deepEqual(JSON.parse(readCfg(dir)).overrides.map((o) => o.path), [KEPT])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('never shipped (a typo or a project-only file): the NOTE stays and nothing is deleted or edited', () => {
  const { dir, cfg } = project([TYPO])
  try {
    put(dir, TYPO, 'project-only command\n')
    for (const extra of [[], ['--apply', '--prune']]) {
      const r = sync(dir, extra)
      assert.equal(r.status, 0, r.stdout + r.stderr)
      assert.match(r.stdout, /NOTE override \.claude\/commands\/not-a-kit-file\.md is not a file this kit ships/)
      assert.doesNotMatch(r.stdout, /pruned-override/)
    }
    assert.equal(readCfg(dir), cfg)
    assert.equal(readFileSync(join(dir, TYPO), 'utf8'), 'project-only command\n')
    assert.equal(existsSync(join(dir, '.kit', 'pruned')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('removeOverrideEntry: only that entry goes; text it cannot edit safely returns null', () => {
  const cfg = `{\n  "a": 1,\n  "overrides": [\n${entry('x')},\n${entry('y')},\n${entry('z')}\n  ],\n  "b": 2\n}\n`
  assert.equal(removeOverrideEntry(cfg, 'y'), cfg.replace(`${entry('y')},\n`, ''))
  assert.equal(removeOverrideEntry(cfg, 'z'), cfg.replace(`,\n${entry('z')}`, ''))
  assert.equal(removeOverrideEntry(`{ "overrides": [ { "path": "x", "reason": "r" } ] }`, 'x'), '{ "overrides": [] }')
  assert.equal(removeOverrideEntry(cfg, 'missing'), null)
  assert.equal(removeOverrideEntry('{ "a": 1 }', 'x'), null)
  assert.equal(removeOverrideEntry('{ "overrides": ["x"] }', 'x'), null)
})
