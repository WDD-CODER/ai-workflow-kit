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

// ---- plan 041: grade, stats, follow-ups --------------------------------------------------------------------------
const TRIAGED = [
  { id: 'D1', plan: '451', text: 'behaviour: no dialog on leave — reverse: add one', verdict: 'accept', kind: 'no-dialog', confidence: 90, rec: 'Keep it' },
  { id: 'D2', plan: '451', text: 'seen: src/a.ts:12 — NaN at 100 %', verdict: 'follow-up', kind: 'nan', confidence: 80 },
  { id: 'D3', plan: '452', text: 'seen: src/b.ts:5 — a comment typo', verdict: 'noise', kind: '-', confidence: 70 },
  { id: 'D4', plan: '452', text: 'behaviour: saved on blur', verdict: 'ask', kind: 'save-on-blur', confidence: 60 },
  { id: 'D5', plan: '452', text: 'behaviour: a retry loop — reverse: remove it', verdict: 'follow-up', kind: 'retry', confidence: 75 },
  { id: 'D6', plan: '452', text: 'behaviour: untriaged choice', verdict: 'none' },
]
const gradeSetup = () => {
  const s = scratch()
  writeFileSync(s.list, JSON.stringify(TRIAGED))
  mkdirSync(join(s.dir, '.kit'), { recursive: true })
  writeFileSync(join(s.dir, '.kit', 'install.json'), JSON.stringify({ kit: { version: '9.9.9' } }))
  return { ...s, grades: join(s.dir, 'docs', 'brain', 'decision-grades.jsonl'), follow: join(s.dir, 'docs', 'brain', 'follow-ups.md') }
}
const grade = (s, reply, runName = 'run-1') => run(['grade', '--dir', s.dir, '--run', runName, '--reply', reply, '--decisions', s.list, '--date', '2026-10-30'])
const jsonLines = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const followIds = (s) => readFileSync(s.follow, 'utf8').split('\n').filter((l) => /^\| 2026/.test(l)).map((l) => l.split('|')[4].trim())

test('grade: one JSON line per item, ok ones too, with the 13 fields; never twice for one run and id', () => {
  const s = gradeSetup()
  try {
    const r = grade(s, 'decisions: ok')
    assert.equal(r.status, 0, r.stderr)
    const rows = jsonLines(s.grades)
    assert.equal(rows.length, 6)
    assert.deepEqual(Object.keys(rows[0]), ['date', 'run', 'plan', 'id', 'type', 'kind', 'text', 'triageVerdict', 'triageRecommendation', 'confidence', 'humanVerdict', 'humanChoice', 'kitVersion'])
    assert.deepEqual([rows[0].type, rows[0].triageVerdict, rows[0].triageRecommendation, rows[0].confidence, rows[0].humanVerdict, rows[0].humanChoice, rows[0].kitVersion], ['behaviour', 'accept', 'Keep it', 90, 'ok', '', '9.9.9'])
    assert.deepEqual([rows[5].triageVerdict, rows[5].confidence, rows[5].kind], ['none', null, '-'])
    assert.match(grade(s, 'decisions: ok').stdout, /graded 0 item/, 'a second reply for the same run writes nothing')
    assert.equal(grade(s, 'D1 ✗ ask me first').status, 0)
    assert.equal(jsonLines(s.grades).length, 6, 'D1 of run-1 is already graded')
    rmSync(s.grades)
    const y = grade(s, 'D1 ✗ ask me first, D4 ✗ save on submit')
    assert.match(y.stdout, /graded 6 item\(s\) \(2 ✗\) → docs\/brain\/decision-grades\.jsonl; \d+ follow-up\(s\) → docs\/brain\/follow-ups\.md/)
    assert.deepEqual(jsonLines(s.grades).filter((x) => x.humanVerdict === '✗').map((x) => [x.id, x.humanChoice]), [['D1', 'ask me first'], ['D4', 'save on submit']])
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('grade: a malformed reply or an unknown id exits 2 and writes nothing', () => {
  const s = gradeSetup()
  try {
    for (const reply of ['looks fine', 'D1 ✗', 'D9 ✗ x', 'D1 ✗ a, D1 ✗ b']) assert.equal(grade(s, reply).status, 2, reply)
    assert.equal(existsSync(s.grades), false)
    assert.equal(existsSync(s.follow), false)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('grade: follow-up rows — every seen: item except an ok noise, and a behaviour: item triage called follow-up and the Human left ok', () => {
  const s = gradeSetup()
  try {
    assert.equal(grade(s, 'D2 ✗ not a defect, D5 ✗ keep it').status, 0)
    assert.match(readFileSync(s.follow, 'utf8'), /\| Date \| Run \| Plan \| Id \| File:line \| Decision \| Human \|/)
    // D2: seen, Human ✗ → kept. D3: seen, triage noise, Human ok → left out. D5: behaviour follow-up but a ✗ → left out.
    assert.deepEqual(followIds(s), ['D2'])
    assert.match(readFileSync(s.follow, 'utf8'), /\| src\/a\.ts:12 \|.*✗ not a defect/)
    rmSync(s.grades)
    rmSync(s.follow)
    grade(s, 'decisions: ok')
    assert.deepEqual(followIds(s), ['D2', 'D5'], 'ok: the seen follow-up and the behaviour follow-up; the noise is left out')
    rmSync(s.grades)
    grade(s, 'decisions: ok')
    assert.equal(followIds(s).length, 2, 'never twice')
    assert.equal(grade(s, 'D3 ✗ it is real', 'run-2').status, 0)
    assert.ok(readFileSync(s.follow, 'utf8').includes('| run-2 | 452 | D3 |'), 'a seen: noise the Human graded wrong is kept')
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('stats: agreement per kind (an ask agrees with ✗, the rest with ok; none left out) and the calibration file within its caps', () => {
  const s = gradeSetup()
  try {
    const rows = []
    let i = 0
    const row = (kind, triageVerdict, humanVerdict) => rows.push(JSON.stringify({ date: `2026-10-0${i % 9 + 1}`, run: 'r', plan: '1', id: `D${++i}`, type: 'behaviour', kind, text: `behaviour: item ${i} ${'x'.repeat(150)}`, triageVerdict, triageRecommendation: '', confidence: 80, humanVerdict, humanChoice: humanVerdict === '✗' ? 'my choice' : '', kitVersion: '1' }))
    for (let n = 0; n < 8; n++) row('a', 'accept', 'ok')
    row('a', 'accept', '✗')
    row('a', 'ask', '✗')
    row('b', 'ask', 'ok')
    row('b', 'none', '✗')
    for (let n = 0; n < 40; n++) row('c', 'accept', '✗')
    writeFileSync(s.grades, `${rows.join('\n')}\n`)
    const r = run(['stats', '--dir', s.dir])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /^STATS a graded=10 agreement=90%$/m)
    assert.match(r.stdout, /^STATS b graded=1 agreement=0%$/m, 'the none row is not counted')
    assert.match(r.stdout, /^STATS c graded=40 agreement=0%$/m)
    assert.match(r.stdout, /^STATS all last=50 agreement=\d+%$/m)
    assert.equal(run(['stats', '--dir', s.dir, '--kind', 'a']).stdout.match(/^STATS /gm).length, 2, 'one kind plus the total')
    assert.match(run(['stats', '--dir', s.dir, '--last', '10']).stdout, /^STATS all last=10 agreement=0%$/m)
    const w = run(['stats', '--dir', s.dir, '--write'])
    assert.equal(w.status, 0, w.stderr)
    const cal = readFileSync(join(s.dir, 'docs', 'brain', 'triage-calibration.md'), 'utf8')
    assert.ok(cal.split('\n').length <= 40 && cal.length <= 3000, `${cal.split('\n').length} lines / ${cal.length} characters`)
    assert.match(cal, /\| a \| 10 \| 90% \|/)
    assert.match(cal, /Where the Human disagreed/)
    assert.ok(!/x{101}/.test(cal), 'an example text is cut to 100 characters')
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('stats: no grade rows gives n/a, and --write still writes a short file', () => {
  const s = gradeSetup()
  try {
    assert.match(run(['stats', '--dir', s.dir]).stdout, /^STATS all last=50 agreement=n\/a$/m)
    assert.equal(run(['stats', '--dir', s.dir, '--write']).status, 0)
    assert.ok(existsSync(join(s.dir, 'docs', 'brain', 'triage-calibration.md')))
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('follow-ups --open: rows for the given files that no plan has taken', () => {
  const s = gradeSetup()
  try {
    grade(s, 'decisions: ok')
    let r = run(['follow-ups', '--open', '--dir', s.dir, '--files', 'src/a.ts,src/zzz.ts'])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /^FOLLOW_UP run-1 D2 src\/a\.ts:12 — seen: src\/a\.ts:12 — NaN at 100 %$/m)
    assert.ok(!/D3/.test(r.stdout), 'another file')
    assert.ok(/D2/.test(run(['follow-ups', '--open', '--dir', s.dir]).stdout), 'no --files = every open row')
    mkdirSync(join(s.dir, 'plans', 'done'), { recursive: true })
    writeFileSync(join(s.dir, 'plans', 'done', '099-x.plan.md'), '## Execution Notes\n- follow-up: run-1 D2\n')
    r = run(['follow-ups', '--open', '--dir', s.dir, '--files', 'src/a.ts'])
    assert.match(r.stdout, /FOLLOW_UPS: none/, 'taken by a plan under plans/')
    assert.equal(run(['follow-ups', '--dir', s.dir]).status, 2, '--open is required')
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('the follow-ups seed has its table header and an empty table', () => {
  const t = readFileSync(join(kit, 'templates', 'docs', 'brain', 'follow-ups.md'), 'utf8')
  assert.match(t, /\| Date \| Run \| Plan \| Id \| File:line \| Decision \| Human \|/)
  assert.equal(t.split('\n').filter((l) => /^\| 2/.test(l)).length, 0)
})

// ---- plan 030: lessons files, rules per role, pending rules, eval-case scaffold ----------------------------------------
const lessonsFile = (s, role) => join(s.dir, 'docs', 'brain', 'agent-lessons', `${role}.md`)
const addLesson = (s, role, text, more = []) => run(['lessons', '--add', '--role', role, '--text', text, '--dir', s.dir, '--date', '2026-10-30', '--run', 'r1', ...more])

test('lessons --add: a two-line header, then "- <date> <run>: <lesson>" lines, newest last; the same lesson twice adds nothing', () => {
  const s = scratch()
  try {
    assert.match(run(['lessons', '--check', '--dir', s.dir]).stdout, /no files yet/)
    assert.equal(addLesson(s, 'check-bugs', 'missed: src/a.ts:12 off by one').status, 0)
    assert.equal(addLesson(s, 'check-bugs', 'second lesson', ['--date', '2026-10-31']).status, 0)
    const text = readFileSync(lessonsFile(s, 'check-bugs'), 'utf8')
    const lines = text.split('\n')
    assert.equal(lines[0], '# Lessons — check-bugs')
    assert.match(lines[1], /^Facts from earlier runs/)
    assert.deepEqual(lines.slice(2).filter(Boolean), ['- 2026-10-30 r1: missed: src/a.ts:12 off by one', '- 2026-10-31 r1: second lesson'])
    assert.match(addLesson(s, 'check-bugs', 'second lesson').stdout, /already in/)
    assert.equal(readFileSync(lessonsFile(s, 'check-bugs'), 'utf8'), text, 'a repeat writes nothing')
    assert.equal(run(['lessons', '--add', '--role', 'nobody', '--text', 'x', '--dir', s.dir]).status, 2, 'unknown role')
    assert.equal(run(['lessons', '--add', '--role', 'ui', '--dir', s.dir]).status, 2, 'text is required')
    assert.equal(run(['lessons', '--dir', s.dir]).status, 2, '--check or --add is required')
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('lessons --add: past 40 lines or 3,000 characters the oldest lines go first and are printed; --check fails a file over the cap', () => {
  const s = scratch()
  try {
    for (let i = 1; i <= 40; i++) assert.equal(addLesson(s, 'builder', `lesson number ${i}`).status, 0)
    assert.equal(run(['lessons', '--check', '--dir', s.dir]).status, 0)
    const r = addLesson(s, 'builder', 'lesson number 41')
    assert.match(r.stdout, /dropped the oldest 1 line\(s\)/)
    assert.match(r.stdout, /lesson number 1$/m)
    const body = readFileSync(lessonsFile(s, 'builder'), 'utf8').split('\n').slice(2).filter(Boolean)
    assert.equal(body.length, 40)
    assert.match(body[0], /lesson number 2$/)
    assert.match(body.at(-1), /lesson number 41$/)
    // characters: lines of ~300 characters fit 3,000 only for about 10 of them
    for (let i = 1; i <= 12; i++) addLesson(s, 'gate', `${i} ${'x'.repeat(280)}`)
    const gate = readFileSync(lessonsFile(s, 'gate'), 'utf8').split('\n').slice(2).filter(Boolean)
    assert.ok(gate.length < 12 && gate.join('\n').length + 1 <= 3000, `${gate.length} lines`)
    assert.match(gate.at(-1), /12 x{280}$/)
    writeFileSync(lessonsFile(s, 'ui'), `# Lessons — ui\nheader\n${Array.from({ length: 41 }, (_, i) => `- 2026-10-30 r1: l${i}`).join('\n')}\n`)
    const bad = run(['lessons', '--check', '--dir', s.dir])
    assert.equal(bad.status, 1)
    assert.match(bad.stderr, /agent-lessons\/ui\.md is 41 lines/)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('the shipped seeds: ten lessons files with a two-line header and no lesson, passing --check; a run-log table; the rules seed with its sections', () => {
  const brain = join(kit, 'templates', 'docs', 'brain')
  const roles = ['readiness', 'builder', 'check-plan', 'check-bugs', 'check-rules', 'security', 'verify', 'ui', 'gate', 'planner']
  const dir = mkdtempSync(join(tmpdir(), 'lessons-seed-'))
  try {
    mkdirSync(join(dir, 'docs', 'brain', 'agent-lessons'), { recursive: true })
    for (const role of roles) {
      const t = readFileSync(join(brain, 'agent-lessons', `${role}.md`), 'utf8')
      assert.equal(t.split('\n').filter(Boolean).length, 2, `${role}: two header lines`)
      assert.match(t, new RegExp(`^# Lessons — ${role}\\n`))
      writeFileSync(join(dir, 'docs', 'brain', 'agent-lessons', `${role}.md`), t)
    }
    assert.equal(run(['lessons', '--check', '--dir', dir]).status, 0)
    // a lesson added to a seed lands under its header and keeps the seed's two lines
    assert.equal(run(['lessons', '--add', '--role', 'planner', '--text', 'plan 41 had to be asked: x', '--dir', dir, '--run', 'r1']).status, 0)
    assert.equal(readFileSync(join(dir, 'docs', 'brain', 'agent-lessons', 'planner.md'), 'utf8').split('\n').slice(0, 2).join('\n'), readFileSync(join(brain, 'agent-lessons', 'planner.md'), 'utf8').trimEnd())
  } finally { rmSync(dir, { recursive: true, force: true }) }
  const runLog = readFileSync(join(brain, 'run-log.md'), 'utf8')
  assert.match(runLog, /\| Date \| Run \| Plans \| Merged \| Parked \| Parked reasons \| Fix rounds \| Escalations \| Gate fails \| Final gate \| ✗ \| Checker misses \| ✗ per plan \|/)
  const rules = readFileSync(join(brain, 'agent-rules.md'), 'utf8')
  for (const h of ['## builder', '## checkers', '## readiness', '## ui', '## enforce candidates']) assert.ok(rules.includes(`\n${h}\n`), h)
  assert.match(readFileSync(join(brain, 'index.md'), 'utf8'), /agent-lessons\//)
})

test('rules: the cap is per section (30 lines / 2,400 characters); --check names the section; --add --section; a v1.7.0 file without sections counts as builder', () => {
  const s = scratch()
  try {
    const seed = readFileSync(join(kit, 'templates', 'docs', 'brain', 'agent-rules.md'), 'utf8')
    writeFileSync(s.rules, seed)
    assert.equal(run(['rules', '--check', '--dir', s.dir]).status, 0)
    // 30 rules in checkers fit; the 31st is refused and names the section; builder is untouched by it
    for (let i = 0; i < 30; i++) assert.equal(run(['rules', '--add', `checker rule ${i}`, '--section', 'checkers', '--dir', s.dir]).status, 0, `rule ${i}`)
    const full = run(['rules', '--add', 'one more', '--section', 'checkers', '--dir', s.dir])
    assert.equal(full.status, 1)
    assert.match(full.stderr, /section "checkers" would be 31 lines/)
    assert.equal(run(['rules', '--add', 'a builder rule', '--dir', s.dir]).status, 0, 'builder has its own room')
    assert.equal(run(['rules', '--add', 'x', '--section', 'nobody', '--dir', s.dir]).status, 2, 'unknown section')
    const text = readFileSync(s.rules, 'utf8')
    assert.match(text, /## checkers\n\n- checker rule 0\n/)
    assert.match(text, /- a builder rule\n\n## checkers/)
    // edited by hand past the cap: --check reports the section
    writeFileSync(s.rules, text.replace('## readiness\n', `## readiness\n\n${Array.from({ length: 31 }, (_, i) => `- r${i}`).join('\n')}\n`))
    const bad = run(['rules', '--check', '--dir', s.dir])
    assert.equal(bad.status, 1)
    assert.match(bad.stderr, /section "readiness" would be 31 lines/)
    // a file with no sections: the whole file is the builder's, and a rule for another section opens that section
    writeFileSync(s.rules, '# Agent rules\n\n- first\n')
    assert.equal(run(['rules', '--add', 'for the checkers', '--section', 'checkers', '--dir', s.dir]).status, 0)
    assert.equal(readFileSync(s.rules, 'utf8'), '# Agent rules\n\n- first\n\n## checkers\n\n- for the checkers\n')
    assert.equal(run(['rules', '--check', '--dir', s.dir]).status, 0)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('rules: an enforce: line goes to "## enforce candidates" (cap 10 lines), is listed by --enforce, and is not a section any role reads', () => {
  const s = scratch()
  try {
    writeFileSync(s.rules, readFileSync(join(kit, 'templates', 'docs', 'brain', 'agent-rules.md'), 'utf8'))
    assert.match(run(['rules', '--enforce', '--dir', s.dir]).stdout, /ENFORCE: none/)
    assert.equal(run(['rules', '--add', 'enforce: a lint rule that bans window.confirm', '--dir', s.dir]).status, 0)
    const text = readFileSync(s.rules, 'utf8')
    assert.match(text, /## enforce candidates\n\n- a lint rule that bans window\.confirm\n$/)
    assert.doesNotMatch(text.split('## enforce candidates')[0], /window\.confirm/, 'not under any role')
    assert.match(run(['rules', '--enforce', '--dir', s.dir]).stdout, /^ENFORCE a lint rule that bans window\.confirm$/m)
    for (let i = 1; i < 10; i++) assert.equal(run(['rules', '--add', `enforce: candidate ${i}`, '--dir', s.dir]).status, 0)
    const full = run(['rules', '--add', 'enforce: the eleventh', '--dir', s.dir])
    assert.equal(full.status, 1)
    assert.match(full.stderr, /section "enforce candidates" would be 11 lines.*cap is 10 lines/)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('a rule starts at the first ✗ of a kind (pending — seen once); the second ✗ of that kind promotes it; --check counts both', () => {
  const s = scratch()
  try {
    writeFileSync(s.rules, readFileSync(join(kit, 'templates', 'docs', 'brain', 'agent-rules.md'), 'utf8'))
    const first = add(s, 'D1 ✗ no dialog', ['--kinds', 'D1=confirm-dialog-on-leave', '--checker-miss', 'D1=yes'])
    assert.equal(first.status, 0, first.stderr)
    assert.match(first.stdout, /RULE_PROPOSAL D1 confirm-dialog-on-leave pending/)
    const json = JSON.parse(/DECISION_LOG_JSON (.*)/.exec(first.stdout)[1])
    assert.deepEqual([json[0].ruleState, json[0].sections], ['pending', ['builder', 'checkers']])
    assert.equal(run(['rules', '--add', 'Never ask before leaving a screen.', '--pending', '--kind', 'confirm-dialog-on-leave', '--dir', s.dir]).status, 0)
    assert.equal(run(['rules', '--add', 'Do not accept a dialog the plan does not describe.', '--section', 'checkers', '--pending', '--kind', 'confirm-dialog-on-leave', '--dir', s.dir]).status, 0)
    assert.equal(run(['rules', '--add', 'x', '--pending', '--dir', s.dir]).status, 2, '--pending needs --kind')
    let text = readFileSync(s.rules, 'utf8')
    assert.match(text, /- \[confirm-dialog-on-leave\] Never ask before leaving a screen\. \(pending — seen once\)/)
    assert.match(run(['rules', '--check', '--dir', s.dir]).stdout, /builder 2/, 'a pending line counts toward the cap')
    assert.match(run(['repeats', '--dir', s.dir]).stdout, /REPEATS: none/, 'one row: nothing repeats, nothing is promoted')
    assert.match(readFileSync(s.rules, 'utf8'), /pending — seen once/)
    // an unrelated ✗ of another kind leaves it alone; the second ✗ of the kind promotes both lines
    const other = add(s, 'D2 ✗ nan', ['--kinds', 'D2=nan-at-100'])
    assert.match(other.stdout, /RULE_PROPOSAL D2 nan-at-100 pending/)
    const second = add(s, 'D3 ✗ same again', ['--kinds', 'D3=confirm-dialog-on-leave'])
    assert.equal(JSON.parse(/DECISION_LOG_JSON (.*)/.exec(second.stdout)[1])[0].ruleState, 'repeat')
    assert.doesNotMatch(second.stdout, /RULE_PROPOSAL/)
    const rep = run(['repeats', '--dir', s.dir])
    assert.match(rep.stdout, /REPEAT confirm-dialog-on-leave x2/)
    assert.match(rep.stdout, /promoted 2 pending rule/)
    text = readFileSync(s.rules, 'utf8')
    assert.match(text, /\n- Never ask before leaving a screen\.\n/)
    assert.match(text, /\n- Do not accept a dialog the plan does not describe\.\n/)
    assert.doesNotMatch(text.split('\n').filter((l) => l.startsWith('- ')).join('\n'), /pending|\[confirm-dialog-on-leave\]/)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

// The case scaffold: a scratch git repository with a merged plan 451 whose change has a hunk at src/a.ts:12.
function caseRepo() {
  const s = scratch()
  const git = (...a) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: s.dir, encoding: 'utf8' })
    assert.equal(r.status, 0, `${a.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  git('init', '-q', '-b', 'main')
  mkdirSync(join(s.dir, 'src'), { recursive: true })
  mkdirSync(join(s.dir, 'plans'), { recursive: true })
  const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)
  writeFileSync(join(s.dir, 'src', 'a.ts'), `${before.join('\n')}\n`)
  writeFileSync(join(s.dir, 'plans', '451-save-form.plan.md'), '# Plan 451 — save form\n\nGoal: save.\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  git('switch', '-q', '-c', 'feat/451-save-form')
  before[11] = 'if (!form.dirty) return // changed by the plan'
  writeFileSync(join(s.dir, 'src', 'a.ts'), `${before.join('\n')}\n`)
  git('commit', '-qam', 'plan 451')
  git('switch', '-q', 'main')
  git('merge', '-q', '--no-ff', '-m', 'Merge feat/451-save-form into orch/r1 (plan 451)', 'feat/451-save-form')
  git('branch', '-q', '-D', 'feat/451-save-form')
  const status = join(s.dir, '.claude', 'orchestrator-runs', 'r1')
  mkdirSync(status, { recursive: true })
  writeFileSync(join(status, 'status.json'), JSON.stringify({ decisions: [{ id: 'D3', plan: '451', text: 'seen: src/a.ts:12 — a form that is not dirty returns without saving' }] }))
  return { ...s, git }
}

test('case: a checker miss becomes an eval case in the harness shape with no model call', async () => {
  const s = caseRepo()
  try {
    const decisions = join(s.dir, 'list.json')
    writeFileSync(decisions, JSON.stringify([{ id: 'D3', plan: '451', text: 'seen: src/a.ts:12 — a form that is not dirty returns without saving' }]))
    assert.equal(run(['add', '--dir', s.dir, '--reply', 'D3 ✗ the checker should have caught this', '--decisions', decisions, '--date', '2026-10-30', '--kinds', 'D3=silent-return', '--checker-miss', 'D3=yes']).status, 0)
    const r = run(['case', '--from', 'D3', '--run', 'r1', '--dir', s.dir])
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /case written — docs\/agent-evals\/cases\/orch-check-bugs\/2026-10-30-silent-return/)
    const dir = join(s.dir, 'docs', 'agent-evals', 'cases', 'orch-check-bugs', '2026-10-30-silent-return')
    const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'))
    assert.match(expected.note, /^human-verdict 2026-10-30: the checker should have caught this$/)
    assert.deepEqual(expected.findings.map((f) => [f.file, f.line, f.severity]), [['src/a.ts', 12, 'major']])
    assert.ok(expected.findings[0].rule.includes('silent-return'))
    assert.match(readFileSync(join(dir, 'input', 'plan.md'), 'utf8'), /Plan 451/)
    const patch = readFileSync(join(dir, 'input', 'diff.patch'), 'utf8')
    assert.match(patch, /^diff --git a\/src\/a\.ts b\/src\/a\.ts/m)
    assert.match(patch, /\+if \(!form\.dirty\) return/)
    assert.match(readFileSync(join(dir, 'input', 'src', 'a.ts'), 'utf8'), /form\.dirty/)
    assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /orch-check-bugs/)
    // the harness accepts it: findCases lists it and it is a findings case
    const { findCases } = await import(pathToFileURL(join(kit, 'tools', 'lib', 'agent-eval', 'run.mjs')).href)
    const { caseKind } = await import(pathToFileURL(join(kit, 'tools', 'lib', 'agent-eval', 'compare.mjs')).href)
    const cases = findCases(join(s.dir, 'docs', 'agent-evals', 'cases'), 'orch-check-bugs')
    assert.deepEqual(cases.map((c) => c.name), ['2026-10-30-silent-return'])
    assert.equal(caseKind(cases[0].expected), 'findings')
    assert.match(run(['case', '--from', 'D3', '--run', 'r1', '--dir', s.dir]).stdout, /case exists/, 'a second call writes nothing')
    // refusals: an unknown decision, a bad checker, a missing decision id
    assert.equal(run(['case', '--from', 'D9', '--run', 'r1', '--dir', s.dir]).status, 1)
    assert.equal(run(['case', '--from', 'D3', '--run', 'r1', '--checker', 'orch-gate', '--dir', s.dir]).status, 2)
    assert.equal(run(['case', '--run', 'r1', '--dir', s.dir]).status, 2)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})
