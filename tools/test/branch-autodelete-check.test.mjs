// Plan 037: scripts/branch-autodelete-check.mjs (installed) says whether the repo already deletes merged branches.
// `gh` and `git` are stubs on PATH: the node binary linked into a scratch folder under those names, with
// tools/fixtures/branch-autodelete/stub.cjs preloaded. PATH holds nothing else, so any other command would fail.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, linkSync, copyFileSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit
const script = join(root, 'scripts', 'branch-autodelete-check.mjs')
const exe = process.platform === 'win32' ? '.exe' : ''
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)))

/** A folder holding stub binaries with the given names, plus a copy of the stub module. */
function bin(names) {
  const dir = tmp('autodelete-bin-')
  copyFileSync(join(kit, 'tools', 'fixtures', 'branch-autodelete', 'stub.cjs'), join(dir, 'stub.cjs'))
  for (const n of names) {
    try {
      linkSync(process.execPath, join(dir, n + exe))
    } catch {
      copyFileSync(process.execPath, join(dir, n + exe))
    }
  }
  return dir
}
const full = bin(['gh', 'git'])
const noGh = bin(['git'])

/** Run the check in a scratch project with the given workflow files and stub answers. */
function check({ workflows = {}, path = full, origin = 'git@github.com:acme/widgets.git', gh = {} } = {}) {
  const dir = tmp('autodelete-proj-')
  if (Object.keys(workflows).length) mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
  for (const [f, text] of Object.entries(workflows)) writeFileSync(join(dir, '.github', 'workflows', f), text)
  const log = join(dir, 'calls.log')
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(path|node_options|stub_.*)$/i.test(k)))
  Object.assign(env, {
    PATH: path,
    NODE_OPTIONS: `--require "${join(path, 'stub.cjs').replace(/\\/g, '/')}"`,
    STUB_LOG: log,
    STUB_ORIGIN: origin,
    GITHUB_TOKEN: 'scoped-token',
  })
  if (gh.answer) env.STUB_GH_ANSWER = gh.answer
  if (gh.fail) env.STUB_GH_FAIL = gh.fail
  const r = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', env })
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  return { status: r.status, out: r.stdout.trim(), err: r.stderr, calls, dir }
}

const onPr = (body) => `on:\n  pull_request:\n    types: [closed]\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${body}\n`

test('repo setting on → auto (repo setting); gh is asked with GITHUB_TOKEN cleared', () => {
  const r = check({ gh: { answer: 'true' } })
  assert.equal(r.status, 0, r.err)
  assert.equal(r.out, 'AUTODELETE: auto (repo setting)')
  const gh = r.calls.find((c) => c.name === 'gh')
  assert.deepEqual(gh.argv, ['api', 'repos/acme/widgets', '--jq', '.delete_branch_on_merge'])
  assert.equal(gh.token, '')
})

test('setting off, a pull_request workflow deletes the branch → auto (workflow <file>)', () => {
  const r = check({ workflows: { 'cleanup.yml': onPr('git push origin --delete "${{ github.head_ref }}"') }, gh: { answer: 'false' } })
  assert.equal(r.out, 'AUTODELETE: auto (workflow cleanup.yml)')
  for (const body of ['gh api -X DELETE "repos/${{ github.repository }}/git/refs/heads/${{ github.head_ref }}"', 'echo delete-branch']) {
    assert.equal(check({ workflows: { 'w.yaml': onPr(body) }, gh: { answer: 'false' } }).out, 'AUTODELETE: auto (workflow w.yaml)')
  }
})

test('setting off and no deleting workflow → manual; a delete on push (todo-sync) does not count', () => {
  assert.equal(check({ gh: { answer: 'false' } }).out, 'AUTODELETE: manual')
  const pushOnly = 'on:\n  push:\n    branches: [main]\njobs:\n  x:\n    steps:\n      - run: git push origin --delete "$branch" || true\n'
  assert.equal(check({ workflows: { 'todo-sync.yml': pushOnly, 'ci.yml': onPr('npm test') }, gh: { answer: 'false' } }).out, 'AUTODELETE: manual')
})

test('gh absent, failing or no origin → unknown (<why>), exit 0', () => {
  const absent = check({ path: noGh })
  assert.equal(absent.status, 0)
  assert.equal(absent.out, 'AUTODELETE: unknown (gh not installed)')
  const failed = check({ gh: { fail: 'HTTP 404: Not Found (https://api.github.com/repos/acme/widgets)\nmore' } })
  assert.equal(failed.status, 0)
  assert.equal(failed.out, 'AUTODELETE: unknown (gh: HTTP 404: Not Found (https://api.github.com/repos/acme/widgets))')
  assert.equal(check({ origin: '' }).out, 'AUTODELETE: unknown (no origin remote)')
  assert.equal(check({ origin: 'https://github.com/acme/widgets' }).out, 'AUTODELETE: manual', 'https form parses')
})

test('hostile workflow text is only read: nothing but git and gh runs, and no shell sees it', () => {
  const hostile = onPr('echo $(touch PWNED1) `touch PWNED2`; touch PWNED3; git push origin --delete x')
  const r = check({ workflows: { 'evil;$(id).yml': hostile }, gh: { answer: 'false' } })
  assert.equal(r.status, 0, r.err)
  assert.equal(r.out, 'AUTODELETE: auto (workflow evil;$(id).yml)')
  for (const f of ['PWNED1', 'PWNED2', 'PWNED3']) assert.equal(existsSync(join(r.dir, f)), false, `${f} was created`)
  assert.deepEqual(r.calls.map((c) => c.name).sort(), ['gh', 'git', 'git'])
  assert.deepEqual(r.calls.find((c) => c.name === 'gh').argv, ['api', 'repos/acme/widgets', '--jq', '.delete_branch_on_merge'])
})
