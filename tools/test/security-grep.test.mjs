// Plan 083: the pack's pre-commit security guard (packs/angular/scripts/pre-commit-security-grep.mjs) as a function —
// a raw value logged through a variable is caught, and a deliberate exception is one line with a written reason.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync, symlinkSync } from 'fs'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { pathToFileURL, fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const guardPath = join(kit, 'packs', 'angular', 'scripts', 'pre-commit-security-grep.mjs')
const { scanGuardText, GUARD_RULES } = await import(pathToFileURL(guardPath).href)
const lines = (hits) => hits.map((h) => h.line)

test('guard: a raw PII value logged through a variable assigned earlier in the file is reported', () => {
  const text = ['const t = user.token', 'doWork()', 'console.log(t)', 'console.log(other)'].join('\n')
  const hits = scanGuardText(text, 'src/app/a.ts')
  assert.deepEqual(lines(hits), [3])
  assert.equal(hits[0].rule, 'log call references likely-PII name')
  assert.match(hits[0].text, /console\.log\(t\)/)
  // a reassignment from a PII value counts too; an unrelated variable of a similar name does not
  assert.deepEqual(lines(scanGuardText('let x = 1\nx = form.password\nlogger.log("x", x)\nconst xy = 2\nconsole.log(xy)', 'b.ts')), [3])
  // the direct case is still caught
  assert.deepEqual(lines(scanGuardText('console.log(user.email)', 'c.ts')), [1])
})

test('guard: the allow marker with a reason of at least 10 characters excuses that line only', () => {
  const marked = 'console.log(user.email) // security-grep-allow: masked by the logger before output'
  assert.deepEqual(scanGuardText(marked, 'a.ts'), [])
  // the next line is still checked
  assert.deepEqual(lines(scanGuardText(`${marked}\nconsole.log(user.email)`, 'a.ts')), [2])
  // an empty or short reason does not count
  assert.deepEqual(lines(scanGuardText('console.log(user.email) // security-grep-allow:', 'a.ts')), [1])
  assert.deepEqual(lines(scanGuardText('console.log(user.email) // security-grep-allow: ok', 'a.ts')), [1])
  // a marker on the line above does not excuse the line below
  assert.deepEqual(lines(scanGuardText('// security-grep-allow: masked by the logger before output\nconsole.log(user.email)', 'a.ts')), [2])
  // the marker excuses a PII log only, never an unsanitized innerHTML
  assert.deepEqual(lines(scanGuardText('<div [innerHTML]="x"></div> <!-- security-grep-allow: x is a static trusted template -->', 'a.html')), [1])
  // the marker counts only inside a comment, never inside a string literal
  assert.deepEqual(lines(scanGuardText('console.log(user.token, "security-grep-allow: some long reason")', 'a.ts')), [1])
  assert.deepEqual(scanGuardText('console.log(user.email) /* security-grep-allow: masked by the logger before output */', 'a.ts'), [])
})

test('guard: run through a junction or symlink to its folder, the script still checks the staged files', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sec-grep-')))
  try {
    const git = (...a) => assert.equal(spawnSync('git', a, { cwd: dir, encoding: 'utf8' }).status, 0, a.join(' '))
    git('init', '-q')
    writeFileSync(join(dir, 'a.ts'), 'console.log(password)\n')
    git('add', 'a.ts')
    const link = join(dir, 'guard-link')
    symlinkSync(join(kit, 'packs', 'angular', 'scripts'), link, process.platform === 'win32' ? 'junction' : 'dir')
    for (const script of [guardPath, join(link, 'pre-commit-security-grep.mjs')]) {
      const r = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' })
      assert.equal(r.status, 1, `${script}: ${r.stdout}${r.stderr}`)
      assert.match(r.stderr, /log call references likely-PII name/)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('guard: an arrow function parameter is not a variable holding PII', () => {
  assert.deepEqual(scanGuardText('const ids = items.map(t => t.token)\nconsole.log(t)', 'a.ts'), [])
})

test('guard: no option, path or folder turns it off', () => {
  const bad = 'console.log(user.email)'
  for (const file of ['vendor/lib/a.ts', 'src/legacy/a.ts', 'e2e/a.ts', 'a.spec.ts', 'node_modules/x/a.js']) {
    assert.deepEqual(lines(scanGuardText(bad, file)), [1], file)
  }
  assert.equal(scanGuardText.length, 2, 'the function takes the text and the file name only — no options')
  const src = readFileSync(guardPath, 'utf8')
  assert.doesNotMatch(src, /process\.env\.[A-Z_]*(SKIP|ALLOW|DISABLE|IGNORE)/, 'no environment switch')
  assert.doesNotMatch(src, /\.filter\(\s*f\s*=>\s*!f\.startsWith/, 'no folder exemption')
})

test('guard: each hit names the rule and the line of the guard script that holds it', () => {
  const src = readFileSync(guardPath, 'utf8').split(/\r?\n/)
  const hit = scanGuardText('console.log(user.email)', 'a.ts')[0]
  assert.ok(hit.ruleLine > 0)
  assert.match(src[hit.ruleLine - 1], /RULE pii-log/)
  const inner = scanGuardText('el.innerHTML = value', 'a.ts')[0]
  assert.match(src[inner.ruleLine - 1], /RULE inner-html/)
  assert.deepEqual(GUARD_RULES.map((r) => r.id), ['inner-html', 'pii-log'])
})
