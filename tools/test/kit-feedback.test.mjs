// scripts/kit-feedback.mjs (core/scripts): a lesson leaves the project only when it is general. Each refusal exits 2 with
// nothing pushed (no gh call is made before the checks); --dry-run prints the entry and the gh calls and pushes nothing.
//   node --test tools/test/kit-feedback.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
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
const send = (dir, args) => spawnSync(process.execPath, [script, '--root', dir, ...args], { encoding: 'utf8', env: { ...process.env, PATH: '' } })

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

test('privacyProblem and repoOf in isolation', () => {
  assert.equal(privacyProblem('a general lesson', { project: { name: 'Pineapple Pantry' } }, 'some-folder'), null)
  assert.match(privacyProblem('about some-folder', {}, 'some-folder'), /some-folder/)
  assert.equal(repoOf('github:owner/repo'), 'owner/repo')
  assert.equal(repoOf('local:.'), null)
  assert.equal(repoOf('github:owner'), null)
})
