// scripts/kit-feedback.mjs (core/scripts): a lesson leaves the project only when it is general. Each refusal exits 2 with
// nothing pushed (no gh call is made before the checks); --dry-run prints the entry and the gh calls and pushes nothing.
//   node --test tools/test/kit-feedback.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
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

// ---- plan 030: the same lesson from a second project is a seen-in line, not a second file (gh stubbed) ----------------------
const { inboxMatch, bumpSeen } = await import(pathToFileURL(script).href)

// A stand-in for `gh` (a node script, KIT_FEEDBACK_GH): the kit's inbox holds one entry; every call is logged.
function stubGh(scratch, inbox, content = '# Ask before inventing a leave dialog\n\nSent 2026-10-01 from a project using the kit.\n') {
  const log = join(scratch, 'gh.log')
  const file = join(scratch, 'gh-stub.mjs')
  writeFileSync(file, `import { appendFileSync } from 'node:fs'
const a = process.argv.slice(2)
appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n')
const j = a.join(' ')
if (/contents\\/feedback\\/inbox --jq/.test(j)) console.log(${JSON.stringify(inbox.join('\n'))})
else if (/--jq \\.default_branch/.test(j)) console.log('main')
else if (/--jq \\.object\\.sha/.test(j)) console.log('basesha')
else if (/--jq \\.sha/.test(j)) console.log('filesha')
else if (/--jq \\.content/.test(j)) console.log(${JSON.stringify(Buffer.from(content).toString('base64'))})
else if (a[0] === 'pr') console.log('https://github.com/acme/ai-workflow-kit/pull/9')
`)
  return { file, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) }
}
const sendWith = (dir, gh, args) => spawnSync(process.execPath, [script, '--root', dir, ...args], { encoding: 'utf8', env: { ...process.env, KIT_FEEDBACK_GH: gh } })
const LESSON = ['--title', 'Ask before inventing a leave dialog', '--text', 'A builder added a confirmation on leaving a screen that no plan described.']

test('inboxMatch and bumpSeen: the slug picks the open file; the seen-in line starts at 2 and counts up', () => {
  assert.equal(inboxMatch(['2026-10-01-other.md', '2026-10-01-ask-before-inventing-a-leave-dialog.md'], 'ask-before-inventing-a-leave-dialog'), '2026-10-01-ask-before-inventing-a-leave-dialog.md')
  assert.equal(inboxMatch(['2026-10-01-ask-before-inventing-a-leave-dialog-too.md', 'README.md'], 'ask-before-inventing-a-leave-dialog'), null)
  assert.deepEqual(bumpSeen('# T\n\nbody\n'), { n: 2, text: '# T\n\nseen-in: 2\n\nbody\n' })
  assert.equal(bumpSeen('# T\n\nseen-in: 2\n\nbody\n').text, '# T\n\nseen-in: 3\n\nbody\n')
})

test('a matching open inbox file gets a seen-in line in a pull request, not a new file; --dry-run names the path', () => {
  const dir = project()
  const scratch = mkdtempSync(join(tmpdir(), 'kitfb-gh-'))
  try {
    const gh = stubGh(scratch, ['README.md', '2026-10-01-ask-before-inventing-a-leave-dialog.md'])
    const dry = sendWith(dir, gh.file, [...LESSON, '--dry-run'])
    assert.equal(dry.status, 0, dry.stderr)
    assert.match(dry.stdout, /^path: seen-in: feedback\/inbox\/2026-10-01-ask-before-inventing-a-leave-dialog\.md gets a seen-in line \(no new file\)$/m)
    assert.ok(gh.calls().every((c) => c[0] === 'api' && !c.includes('-X')), 'a dry run only lists the inbox')
    const real = sendWith(dir, gh.file, LESSON)
    assert.equal(real.status, 0, real.stdout + real.stderr)
    assert.match(real.stdout, /seen-in: 2 on feedback\/inbox\/2026-10-01-ask-before-inventing-a-leave-dialog\.md/)
    const put = gh.calls().find((c) => c.includes('PUT'))
    assert.ok(put.some((x) => x.endsWith('contents/feedback/inbox/2026-10-01-ask-before-inventing-a-leave-dialog.md')), 'the existing file is updated')
    assert.ok(put.includes('sha=filesha'))
    const content = Buffer.from(put.find((x) => x.startsWith('content=')).slice('content='.length), 'base64').toString('utf8')
    assert.match(content, /^seen-in: 2$/m)
    assert.equal(gh.calls().filter((c) => c.includes('PUT')).length, 1, 'one file, no second entry')
    assert.ok(gh.calls().some((c) => c[0] === 'pr' && c.some((x) => /seen-in: 2/.test(x))))
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('no matching inbox file (or an inbox that cannot be listed): the new-file path, as before', () => {
  const dir = project()
  const scratch = mkdtempSync(join(tmpdir(), 'kitfb-gh-'))
  try {
    const gh = stubGh(scratch, ['README.md', '2026-10-01-something-else.md'])
    const dry = sendWith(dir, gh.file, [...LESSON, '--dry-run'])
    assert.match(dry.stdout, /^path: new file$/m)
    const real = sendWith(dir, gh.file, LESSON)
    assert.equal(real.status, 0, real.stdout + real.stderr)
    const put = gh.calls().find((c) => c.includes('PUT'))
    assert.ok(put.some((x) => /contents\/feedback\/inbox\/\d{4}-\d{2}-\d{2}-ask-before-inventing-a-leave-dialog\.md$/.test(x)))
    assert.ok(!put.some((x) => x.startsWith('sha=')), 'a new file has no sha')
    assert.match(send(dir, [...LESSON, '--dry-run']).stdout, /^path: new file \(the inbox could not be listed\)$/m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(scratch, { recursive: true, force: true })
  }
})
