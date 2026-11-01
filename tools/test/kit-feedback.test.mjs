// scripts/kit-feedback.mjs (core/scripts): a lesson leaves the project only when it is general. Each refusal exits 2 with
// nothing pushed (no gh call is made before the checks); --dry-run prints the entry and the gh calls and pushes nothing.
//   node --test tools/test/kit-feedback.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const script = join(kit, 'core', 'scripts', 'kit-feedback.mjs')
const { privacyProblem, repoOf } = await import(pathToFileURL(script).href)
const FENCE = '`'.repeat(3)

function project(source = 'github:acme/ai-workflow-kit') {
  const dir = mkdtempSync(join(tmpdir(), 'kit-feedback-'))
  mkdirSync(join(dir, '.kit'), { recursive: true })
  writeFileSync(join(dir, 'kit.config.json'), JSON.stringify({ project: { name: 'Pineapple Pantry', repoName: 'pineapple-app' }, paths: { srcRoot: 'client/src/', serverRoot: 'api/' } }))
  writeFileSync(join(dir, '.kit', 'install.json'), JSON.stringify({ source, files: {} }))
  return dir
}
// PATH is emptied so a refusal that wrongly reached `gh` would fail with ENOENT instead of touching a network.
// KIT_BRAIN_* is removed: a machine set up for the kit brain would otherwise take the brain path instead of the gh path.
const noBrain = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('KIT_BRAIN_')))
const send = (dir, args, env = {}) => spawnSync(process.execPath, [script, '--root', dir, ...args], { encoding: 'utf8', env: { ...noBrain(), PATH: '', ...env } })

test('each refusal: exit 2, a reason on stderr, nothing sent', () => {
  const dir = project()
  try {
    const cases = [
      ['the project name', 'A save dialog on Pineapple Pantry screens surprised the user'],
      ['the project name in another case', 'pineapple pantry users never wanted it'],
      ['the repo name', 'See pineapple-app for the screen'],
      ['a source path', 'The fix is in client/src/app/form.ts'],
      ['a server path', 'The handler in api/save.ts was changed'],
      ['a code fence', `Do this:\n${FENCE}\nconst x = 1\n${FENCE}`],
    ]
    for (const [name, text] of cases) {
      const r = send(dir, ['--title', 'A lesson', '--text', text, '--dry-run'])
      assert.equal(r.status, 2, `${name}: exit ${r.status} ${r.stdout}${r.stderr}`)
      assert.match(r.stderr, /KIT_FEEDBACK: refused/, name)
      assert.equal(r.stdout, '', `${name}: printed an entry`)
    }
    const real = send(dir, ['--title', 'A lesson', '--text', 'Pineapple Pantry only'])
    assert.equal(real.status, 2, 'a refusal also stops a real send before gh')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a source that is not a GitHub repository is refused', () => {
  const dir = project('local:.')
  try {
    const r = send(dir, ['--title', 'A lesson', '--text', 'A general lesson about leaving a screen.', '--dry-run'])
    assert.equal(r.status, 2)
    assert.match(r.stderr, /needs github:<owner>\/<repo>/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('dry run: prints the entry, the branch feedback/<date>-<slug>, the inbox file and the gh calls; pushes nothing', () => {
  const dir = project()
  try {
    const r = send(dir, ['--title', 'Ask before inventing a leave dialog', '--text', 'A builder added a confirmation on leaving an editable screen that no plan described. Prefer doing nothing extra.', '--dry-run'])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /KIT_FEEDBACK: dry run — nothing pushed/)
    assert.match(r.stdout, /repository: acme\/ai-workflow-kit/)
    assert.match(r.stdout, /branch: feedback\/\d{4}-\d{2}-\d{2}-ask-before-inventing-a-leave-dialog/)
    assert.match(r.stdout, /file: feedback\/inbox\/\d{4}-\d{2}-\d{2}-ask-before-inventing-a-leave-dialog\.md/)
    assert.match(r.stdout, /# Ask before inventing a leave dialog/)
    assert.match(r.stdout, /gh api -X PUT repos\/acme\/ai-workflow-kit\/contents\/feedback\/inbox\//)
    assert.match(r.stdout, /gh pr create --repo acme\/ai-workflow-kit --head feedback\//)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('with KIT_BRAIN_URI set the lesson goes to the kit brain (lessonsIn), after the same refusals, and no pull request is opened', () => {
  const dir = project('local:.') // not a GitHub source: the brain path does not need one
  const home = mkdtempSync(join(tmpdir(), 'kitfb-home-'))
  const log = join(home, 'stub.log')
  const stub = join(kit, 'tools', 'fixtures', 'orchestrator', 'brain', 'stub-driver.mjs')
  const brain = { KIT_BRAIN_URI: `mongodb${'+srv'}://writer:pw@cluster.example.net/kitbrain`, KIT_BRAIN_HOME: home, KIT_BRAIN_DRIVER: stub, KIT_STUB_LOG: log }
  try {
    const refused = send(dir, ['--title', 'A lesson', '--text', 'It happened on Pineapple Pantry screens'], brain)
    assert.equal(refused.status, 2, 'the same refusal checks run first')
    assert.match(refused.stderr, /KIT_FEEDBACK: refused/)
    assert.equal(existsSync(log), false, 'a refused lesson reaches no driver')
    const dry = send(dir, ['--title', 'Read the receipt', '--text', 'A general lesson about receipts.', '--role', 'builder', '--dry-run'], brain)
    assert.equal(dry.status, 0, dry.stderr)
    assert.match(dry.stdout, /dry run — would send to the kit brain/)
    assert.equal(existsSync(log), false, 'a dry run sends nothing')
    const r = send(dir, ['--title', 'Read the receipt', '--text', 'A general lesson about receipts.', '--role', 'builder', '--why', 'it repeated'], brain)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(r.stdout.trim(), 'KIT_FEEDBACK: sent to the kit brain')
    const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    const ins = calls.find((c) => c.op === 'insertMany')
    assert.equal(ins.collection, 'lessonsIn')
    assert.equal(ins.ids.length, 1)
    // A store that does not answer: queued, still exit 0, still no pull request (PATH is empty, a gh call would fail).
    const down = send(dir, ['--title', 'Read the receipt again', '--text', 'Another general lesson.'], { ...brain, KIT_STUB_MODE: 'throw' })
    assert.equal(down.status, 0, down.stdout + down.stderr)
    assert.match(down.stdout, /^KIT_FEEDBACK: queued for the kit brain \(connection refused\); the queue retries/)
    // Without the connection string, today's path: a local source is refused for the gh route.
    const pr = send(dir, ['--title', 'Read the receipt', '--text', 'A general lesson about receipts.', '--dry-run'])
    assert.equal(pr.status, 2)
    assert.match(pr.stderr, /needs github:<owner>\/<repo>/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('privacyProblem and repoOf in isolation', () => {
  assert.equal(privacyProblem('a general lesson', { project: { name: 'Pineapple Pantry' } }, 'some-folder'), null)
  assert.match(privacyProblem('about some-folder', {}, 'some-folder'), /some-folder/)
  assert.equal(repoOf('github:owner/repo'), 'owner/repo')
  assert.equal(repoOf('local:.'), null)
  assert.equal(repoOf('github:owner'), null)
})

test('--text-file reads only a scratch file: a dotfile, a ".." path and a file elsewhere are refused', () => {
  const dir = project()
  const scratch = mkdtempSync(join(tmpdir(), 'kitfb-'))
  try {
    writeFileSync(join(scratch, 'lesson.md'), 'A general lesson about confirmations on leaving a screen.')
    writeFileSync(join(scratch, '.env'), 'A general lesson hidden in a dotfile.')
    const refused = [
      ['a dotfile', join(scratch, '.env')],
      ['a ".." path', `${scratch}/../${scratch.split(/[\\/]/).pop()}/lesson.md`],
      ['a file outside the temp folder', join(kit, 'CHANGELOG.md')],
    ]
    for (const [name, file] of refused) {
      const r = send(dir, ['--title', 'A lesson', '--text-file', file, '--dry-run'])
      assert.equal(r.status, 2, `${name}: exit ${r.status} ${r.stdout}${r.stderr}`)
      assert.match(r.stderr, /--text-file refused/, name)
      assert.equal(r.stdout, '', `${name}: printed an entry`)
    }
    const ok = send(dir, ['--title', 'A lesson', '--text-file', join(scratch, 'lesson.md'), '--dry-run'])
    assert.equal(ok.status, 0, `${ok.stdout}${ok.stderr}`)
    assert.match(ok.stdout, /general lesson about confirmations/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(scratch, { recursive: true, force: true })
  }
})
