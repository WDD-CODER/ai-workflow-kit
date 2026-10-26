// scripts/decision-log.mjs (core/scripts): graded replies are logged (only ✗ rows), a malformed reply is refused with a
// usage line and writes nothing, repeated kinds are found, and agent-rules.md is held to 30 lines / 2,400 characters.
//   node --test tools/test/decision-log.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const script = join(kit, 'core', 'scripts', 'decision-log.mjs')
const { parseReply } = await import(pathToFileURL(script).href)

const LIST = [
  { id: 'D1', plan: '451', text: 'behaviour: no dialog on leave — reverse: add one' },
  { id: 'D2', plan: '451', text: 'seen: src/a.ts:12 — NaN at 100 %' },
  { id: 'D3', plan: '452', text: 'behaviour: saved on blur | not on submit' },
]

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'decision-log-'))
  mkdirSync(join(dir, 'docs', 'brain'), { recursive: true })
  const list = join(dir, 'list.json')
  writeFileSync(list, JSON.stringify(LIST))
  return { dir, list, log: join(dir, 'docs', 'brain', 'decision-log.md'), rules: join(dir, 'docs', 'brain', 'agent-rules.md') }
}
const run = (args, extra = {}) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', ...extra })
const add = (s, reply, more = []) => run(['add', '--dir', s.dir, '--reply', reply, '--decisions', s.list, '--date', '2026-10-25', ...more])
const dataRows = (s) => readFileSync(s.log, 'utf8').split('\n').filter((l) => /^\| 2026/.test(l))

test('ok: nothing is written', () => {
  const s = scratch()
  try {
    const r = add(s, 'decisions: ok')
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /all ok — nothing written/)
    assert.equal(existsSync(s.log), false)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('one ✗: one row with the date, plan, decision, verdict, the Human\'s line and checker-miss', () => {
  const s = scratch()
  try {
    const r = add(s, 'D1 ✗ ask before leaving only when a field changed', ['--kinds', 'D1=confirm-dialog-on-leave', '--checker-miss', 'D1=yes'])
    assert.equal(r.status, 0, r.stderr)
    const rows = dataRows(s)
    assert.equal(rows.length, 1)
    assert.equal(rows[0], '| 2026-10-25 | 451 | behaviour: no dialog on leave — reverse: add one | ✗ | ask before leaving only when a field changed | confirm-dialog-on-leave | yes |')
    assert.match(readFileSync(s.log, 'utf8'), /^# Decision log/)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('several ✗ on one line (commas inside a note stay in the note); a pipe in a cell cannot break the table', () => {
  const s = scratch()
  try {
    const r = add(s, 'D1 ✗ no dialog, ever, D3 ✗ save on submit only')
    assert.equal(r.status, 0, r.stderr)
    const rows = dataRows(s)
    assert.equal(rows.length, 2)
    assert.match(rows[0], /\| no dialog, ever \| - \| no \|$/)
    assert.match(rows[1], /saved on blur \/ not on submit/)
    assert.equal(rows[1].split('|').length, 9)
    // a second add appends under the first
    assert.equal(add(s, 'D2 ✗ report it in the plan').status, 0)
    assert.equal(dataRows(s).length, 3)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('malformed replies are refused with a usage line and nothing is written', () => {
  const s = scratch()
  try {
    for (const bad of ['D1 ✗', 'D9 ✗ nothing there', 'D1 ✗ a D1 ✗ b', 'looks fine to me', 'D1 x no dialog', 'decisions: ok D1 ✗ a', 'before D1 ✗ a', '']) {
      const r = add(s, bad)
      assert.equal(r.status, 2, `${JSON.stringify(bad)} → ${r.status}`)
      assert.match(r.stderr, /usage: decision-log\.mjs add/, bad)
      assert.equal(existsSync(s.log), false, `${JSON.stringify(bad)} wrote the log`)
    }
    assert.equal(parseReply('D1 ✗ a', ['D1']).items[0].note, 'a')
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('learn: a ✗ or a failed: reply is recorded, anything else costs nothing', () => {
  assert.match(run(['learn', '--reply', 'Y, D2 ✗ no dialog']).stdout, /^LEARNING: record/)
  assert.match(run(['learn', '--reply', 'failed: 3 saw an error']).stdout, /^LEARNING: record/)
  for (const quiet of ['decisions: ok', 'done Y', 'ok: 1,2']) assert.equal(run(['learn', '--reply', quiet]).stdout.trim(), 'LEARNING: nothing to record')
})

test('repeats: a kind logged twice is named; "-" kinds and single kinds are not', () => {
  const s = scratch()
  try {
    assert.match(run(['repeats', '--dir', s.dir]).stdout, /REPEATS: none/)
    add(s, 'D1 ✗ none', ['--kinds', 'D1=confirm-dialog-on-leave'])
    add(s, 'D3 ✗ none', ['--kinds', 'D3=confirm-dialog-on-leave'])
    add(s, 'D2 ✗ none')
    const out = run(['repeats', '--dir', s.dir]).stdout
    assert.match(out, /REPEAT confirm-dialog-on-leave x2/)
    assert.doesNotMatch(out, /REPEAT -/)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('rules: the cap is 30 lines and 2,400 characters; --add refuses a rule that would pass it', () => {
  const s = scratch()
  try {
    assert.equal(run(['rules', '--check', '--dir', s.dir]).status, 1, 'a missing file fails')
    writeFileSync(s.rules, `${Array.from({ length: 30 }, (_, i) => `- rule ${i}`).join('\n')}\n`)
    assert.equal(run(['rules', '--check', '--dir', s.dir]).status, 0)
    const full = run(['rules', '--add', 'one more', '--dir', s.dir])
    assert.equal(full.status, 1)
    assert.match(full.stderr, /cap is 30 lines \/ 2400 characters/)
    assert.equal(readFileSync(s.rules, 'utf8').split('\n').filter(Boolean).length, 30, 'refused add left the file alone')
    writeFileSync(s.rules, `${Array.from({ length: 31 }, (_, i) => `- rule ${i}`).join('\n')}\n`)
    assert.equal(run(['rules', '--check', '--dir', s.dir]).status, 1, '31 lines fails')
    writeFileSync(s.rules, `- ${'x'.repeat(2401)}\n`)
    assert.equal(run(['rules', '--check', '--dir', s.dir]).status, 1, '2,400+ characters fails')
    writeFileSync(s.rules, '# Agent rules\n\n- first\n')
    assert.equal(run(['rules', '--add', 'second rule', '--dir', s.dir]).status, 0)
    assert.match(readFileSync(s.rules, 'utf8'), /- first\n- second rule\n$/)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('the shipped seeds: the log has its table header, the rules seed passes its own cap', () => {
  assert.match(readFileSync(join(kit, 'templates', 'docs', 'brain', 'decision-log.md'), 'utf8'), /\| Date \| Plan \| Decision \| Verdict \| Human \| Kind \| Checker miss \|/)
  const dir = mkdtempSync(join(tmpdir(), 'decision-log-seed-'))
  try {
    mkdirSync(join(dir, 'docs', 'brain'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'brain', 'agent-rules.md'), readFileSync(join(kit, 'templates', 'docs', 'brain', 'agent-rules.md')))
    assert.equal(run(['rules', '--check', '--dir', dir]).status, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
