// Kit-owned lessons (plan 046): tools/kit-lessons.mjs adds, updates, retires and checks lines by id, never rewrites a line it
// was not asked to, and holds each role file to 2,000 characters of live lines.
//   node --test tools/test/kit-lessons.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const tool = join(kit, 'tools', 'kit-lessons.mjs')
const L = await import(pathToFileURL(join(kit, 'tools', 'lib', 'kit-learn', 'lessons.mjs')).href)
const ROLES = ['readiness', 'builder', 'check-plan', 'check-bugs', 'check-rules', 'security', 'verify', 'ui', 'gate', 'planner']

const line = (n, text = `lesson ${n}`) => `- K${n}: ${text} — why: reason ${n} (issue I${n}, since v1.13.0)`
const roleFile = (live = [], retired = []) => `# Kit lessons — builder\nLessons true for every project.\n${live.join('\n')}${live.length ? '\n' : ''}\n## Retired\n${retired.join('\n')}${retired.length ? '\n' : ''}`

/** A scratch lessons folder holding every role, `builder` with the given lines. */
function folder(live = [], retired = []) {
  const dir = mkdtempSync(join(tmpdir(), 'kit-lessons-'))
  for (const r of ROLES) writeFileSync(join(dir, `${r}.md`), r === 'builder' ? roleFile(live, retired) : L.roleFileSeed(r))
  return dir
}
const run = (dir, args) => spawnSync(process.execPath, [tool, ...args, '--dir', dir], { encoding: 'utf8' })
const text = (dir, role = 'builder') => readFileSync(join(dir, `${role}.md`), 'utf8')
const gone = (d) => rmSync(d, { recursive: true, force: true })

test('add: a new line with the next id, the reason, the issue and the next release; the cap holds', () => {
  const dir = folder()
  try {
    const r = run(dir, ['add', '--role', 'builder', '--text', 'a main-folder check that reads slot state cannot pass', '--why', 'it parked run 500', '--issue', 'I7'])
    assert.equal(r.status, 0, r.stderr)
    const expected = /^- K1: a main-folder check that reads slot state cannot pass — why: it parked run 500 \(issue I7, since v\d+\.\d+\.0\)$/m
    assert.match(text(dir), expected)
    const second = run(dir, ['add', '--role', 'gate', '--text', 'time out a hung command', '--why', 'a gate hung for an hour', '--issue', 'I8', '--since', '1.14.0'])
    assert.equal(second.status, 0, second.stderr)
    assert.match(text(dir, 'gate'), /^- K2: time out a hung command — why: a gate hung for an hour \(issue I8, since v1\.14\.0\)$/m, 'ids run across the role files')
    assert.equal(run(dir, ['check']).status, 0)
    // the cap: 2,000 characters of live lines
    const big = 'x'.repeat(400)
    let refused = null
    for (let n = 0; n < 8 && !refused; n++) {
      const a = run(dir, ['add', '--role', 'builder', '--text', big, '--why', 'because', '--issue', `I${10 + n}`])
      if (a.status !== 0) refused = a
    }
    assert.ok(refused, 'the sixth long line is refused')
    assert.match(refused.stderr, /characters of live lines \(cap 2000\)/)
    assert.equal(L.parseFile(text(dir)).live.length <= 6, true)
    assert.equal(run(dir, ['check']).status, 0, 'a refused add left the file within the cap')
  } finally { gone(dir) }
})

test('add refuses bad input without touching a file', () => {
  const dir = folder([line(1)])
  const before = ROLES.map((r) => text(dir, r))
  try {
    for (const args of [
      ['add', '--role', 'wizard', '--text', 'x', '--why', 'y', '--issue', 'I1'],
      ['add', '--role', 'builder', '--text', 'two\nlines', '--why', 'y', '--issue', 'I1'],
      ['add', '--role', 'builder', '--text', 'a {{placeholder}}', '--why', 'y', '--issue', 'I1'],
      ['add', '--role', 'builder', '--text', 'x', '--why', 'y', '--issue', 'seven'],
      ['add', '--role', 'builder', '--text', 'x — why: y', '--why', 'y', '--issue', 'I1'],
    ]) assert.equal(run(dir, args).status, 1, args.join(' '))
    assert.equal(run(dir, ['add', '--role', 'builder']).status, 2, 'missing flags are a usage error')
    assert.deepEqual(ROLES.map((r) => text(dir, r)), before)
  } finally { gone(dir) }
})

test('update changes the one line asked for: a file of 5 lines, one update, 4 lines byte-identical', () => {
  const live = [1, 2, 3, 4, 5].map((n) => line(n))
  const dir = folder(live)
  try {
    const before = text(dir).split('\n')
    const r = run(dir, ['update', 'K3', '--text', 'the new wording'])
    assert.equal(r.status, 0, r.stderr)
    const after = text(dir).split('\n')
    assert.equal(after.length, before.length)
    const changed = after.map((l, i) => i).filter((i) => after[i] !== before[i])
    assert.deepEqual(changed, [before.indexOf(line(3))], 'one line differs')
    assert.equal(after[changed[0]], '- K3: the new wording — why: reason 3 (issue I3, since v1.13.0)', 'its reason, issue and release are kept')
    for (const i of [0, 1, 2, 3, 4, 5, 6]) if (!changed.includes(i)) assert.equal(after[i], before[i])
    assert.equal(run(dir, ['update', 'K9', '--text', 'x']).status, 1, 'an unknown id')
    assert.equal(run(dir, ['update', 'K3']).status, 2, 'nothing to change')
  } finally { gone(dir) }
})

test('update and retire keep a CRLF file CRLF and touch only their line', () => {
  const dir = folder()
  try {
    writeFileSync(join(dir, 'builder.md'), roleFile([line(1), line(2)]).replace(/\n/g, '\r\n'))
    assert.equal(run(dir, ['update', 'K1', '--why', 'a better reason']).status, 0)
    assert.equal(text(dir), roleFile([`- K1: lesson 1 — why: a better reason (issue I1, since v1.13.0)`, line(2)]).replace(/\n/g, '\r\n'))
  } finally { gone(dir) }
})

test('retire: the line moves to ## Retired with its reason; only enforced:<path> or gone:<why> is a reason; a safety line needs --human', () => {
  const live = [line(1), line(2), `- K3: never print a token — why: a secret leaked into a log (issue I3, since v1.13.0)`]
  const dir = folder(live)
  try {
    assert.equal(run(dir, ['retire', 'K1', '--reason', 'tired']).status, 1, 'no positive reason')
    assert.equal(run(dir, ['retire', 'K1']).status, 2)
    const r = run(dir, ['retire', 'K1', '--reason', 'enforced:tools/test/gate.test.mjs'])
    assert.equal(r.status, 0, r.stderr)
    const t = text(dir)
    const parsed = L.parseFile(t)
    assert.deepEqual(parsed.live.map((l) => l.id), ['K2', 'K3'])
    assert.deepEqual(parsed.retired.map((l) => [l.id, l.retired]), [['K1', 'enforced:tools/test/gate.test.mjs']])
    assert.ok(t.indexOf('- K1:') > t.indexOf('## Retired'))
    assert.equal(run(dir, ['retire', 'K1', '--reason', 'gone:x']).status, 1, 'already retired')
    const safety = run(dir, ['retire', 'K3', '--reason', 'gone:never happens'])
    assert.equal(safety.status, 1)
    assert.match(safety.stderr, /safety lesson .* needs --human/)
    assert.equal(run(dir, ['retire', 'K3', '--reason', 'gone:never happens', '--human']).status, 0)
    assert.equal(run(dir, ['check']).status, 0)
    // the next id never reuses a retired one
    assert.match(run(dir, ['add', '--role', 'builder', '--text', 'new', '--why', 'w', '--issue', 'I9']).stdout, /K4/)
  } finally { gone(dir) }
})

test('check fails a role file over 2,000 characters of live lines, a line in the wrong shape, and a reused id', () => {
  const dir = folder()
  try {
    assert.equal(run(dir, ['check']).status, 0)
    writeFileSync(join(dir, 'builder.md'), roleFile(Array.from({ length: 12 }, (_, n) => line(n + 1, 'x'.repeat(190)))))
    const over = run(dir, ['check'])
    assert.equal(over.status, 1)
    assert.match(over.stderr, /builder\.md holds \d+ characters of live lines \(cap 2000\)/)
    writeFileSync(join(dir, 'builder.md'), roleFile(['- K1: no reason here']))
    assert.match(run(dir, ['check']).stderr, /builder\.md line 3 is not "- K<n>/)
    writeFileSync(join(dir, 'builder.md'), roleFile([line(1)]))
    writeFileSync(join(dir, 'gate.md'), roleFile([line(1)]).replace('builder', 'gate'))
    assert.match(run(dir, ['check']).stderr, /K1 is used in builder\.md and gate\.md/)
    rmSync(join(dir, 'ui.md'))
    assert.match(run(dir, ['check']).stderr, /ui\.md is missing/)
  } finally { gone(dir) }
})

test('the kit\'s own role files: all ten exist, are valid and are rendered into projects as docs/agent/kit-lessons/', () => {
  const src = join(kit, 'core', 'docs', 'agent', 'kit-lessons')
  assert.equal(run(src, ['check']).status, 0)
  for (const r of ROLES) {
    assert.ok(existsSync(join(src, `${r}.md`)), r)
    assert.match(readFileSync(join(src, `${r}.md`), 'utf8'), new RegExp(`^# Kit lessons — ${r}\\n`))
    assert.ok(!/\{\{/.test(readFileSync(join(src, `${r}.md`), 'utf8')), 'no render placeholder in a lesson file')
  }
  assert.deepEqual(readdirSync(src).filter((f) => !ROLES.includes(f.replace(/\.md$/, ''))), ['triage-calibration.md'])
  // the installed copy in the kit's own root is the rendered source
  for (const r of ROLES) assert.equal(readFileSync(join(kit, 'docs', 'agent', 'kit-lessons', `${r}.md`), 'utf8'), readFileSync(join(src, `${r}.md`), 'utf8'), `${r}.md is rendered`)
})

test('list prints each role with its size and the safety marker', () => {
  const dir = folder([line(1), `- K2: never print a secret — why: it leaked (issue I2, since v1.13.0)`])
  try {
    const r = run(dir, ['list'])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^builder: 2 live line\(s\), \d+ of 2000 characters, 0 retired$/m)
    assert.match(r.stdout, /K2 \[safety\] never print a secret/)
    assert.ok(!/K1 \[safety\]/.test(r.stdout))
  } finally { gone(dir) }
})
