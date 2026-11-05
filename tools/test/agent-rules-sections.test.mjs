// A project's own docs/brain/agent-rules.md needs one section per role that reads it (builder, checkers, readiness, ui):
// install-check --target names each missing one, and sync --apply appends the empty headers without touching a line.
//   node --test tools/test/agent-rules-sections.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const CFG = { project: { name: 'core-only' }, stack: { packs: [] }, commands: { build: 'build', lint: 'lint', test: 'test' }, hooks: { shellPath: 'bash' } }
const node = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd })
const RULES = join('docs', 'brain', 'agent-rules.md')

test('install-check --target names each missing rule section; sync --apply adds the empty headers once and keeps every line', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rules-sections-')))
  try {
    writeFileSync(join(dir, 'kit.config.json'), JSON.stringify(CFG, null, 2))
    const inst = node(join(kit, 'tools', 'install.mjs'), ['--target', dir, '--allow-unfilled'])
    assert.equal(inst.status, 0, inst.stdout + inst.stderr)
    const check = () => node(join(kit, 'tools', 'install-check.mjs'), ['--target', dir], dir)
    const ok = check()
    assert.equal(ok.status, 0, ok.stdout + ok.stderr)
    assert.doesNotMatch(ok.stdout, /RULES_SECTION_MISSING/, 'the seed has every section')
    // a project's own file without the checkers and ui sections (as one project had)
    const own = '# Agent rules\n\n## builder\n- [r1] keep the builder honest\n\n## readiness\n- [r2] ask early\n'
    writeFileSync(join(dir, RULES), own)
    const bad = check()
    assert.equal(bad.status, 1)
    const lines = bad.stdout.split('\n').filter((l) => /^RULES_SECTION_MISSING/.test(l))
    assert.equal(lines.length, 2, bad.stdout)
    assert.match(lines[0], /"## checkers"/)
    assert.match(lines[1], /"## ui"/)
    // sync: the dry run writes nothing, --apply appends the headers
    const dry = node(join(kit, 'tools', 'sync.mjs'), ['--target', dir, '--source', kit], dir)
    assert.match(dry.stdout, /RULES_SECTION_MISSING: docs\/brain\/agent-rules\.md has no "## checkers" section — added on --apply/)
    assert.equal(readFileSync(join(dir, RULES), 'utf8'), own, 'the dry run writes nothing')
    const apply = node(join(kit, 'tools', 'sync.mjs'), ['--target', dir, '--source', kit, '--apply'], dir)
    assert.equal(apply.status, 0, apply.stdout + apply.stderr)
    const after = readFileSync(join(dir, RULES), 'utf8')
    assert.ok(after.startsWith(own), 'no existing line is rewritten')
    assert.equal(after, `${own}\n## checkers\n\n## ui\n`)
    assert.equal(check().status, 0)
    const again = node(join(kit, 'tools', 'sync.mjs'), ['--target', dir, '--source', kit, '--apply'], dir)
    assert.equal(again.status, 0)
    assert.doesNotMatch(again.stdout, /RULES_SECTION_MISSING/)
    assert.equal(readFileSync(join(dir, RULES), 'utf8'), after, 'a second apply changes nothing')
    // headings are read as the rules reader reads them: any case, extra spaces
    const loose = '# Agent rules\n\n## Builder\n\n##  checkers\n\n## READINESS  \n\n## ui\n'
    writeFileSync(join(dir, RULES), loose)
    assert.equal(check().status, 0, 'a "## Builder" heading counts')
    node(join(kit, 'tools', 'sync.mjs'), ['--target', dir, '--source', kit, '--apply'], dir)
    assert.equal(readFileSync(join(dir, RULES), 'utf8'), loose, 'no second header is added')
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
