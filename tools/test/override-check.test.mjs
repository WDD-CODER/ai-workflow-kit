// Plan 031: a project's override of a kit workflow must keep the steps the kit marks `# KIT:required`.
// Each case installs the kit into a scratch project, then runs the installed scripts/override-check.mjs and tools/drift-check.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { requiredSteps, stepNames, missingSteps } from '../../core/scripts/lib/override-steps.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const CI = '.github/workflows/ci.yml'
const SEC = '.github/workflows/security.yml'
// Marker order = workflow order: the override check sits right after the scripts/ install (plan 031 O4), before the script tests.
const CI_STEPS = ['Install workflow script dependencies', 'Kit override check', 'Workflow script tests', 'Secret scan (gitleaks)', 'Require quality gates']
const SEC_STEPS = ['npm audit (workflow scripts, report only)', 'Semgrep OWASP Top Ten']
const STEP = 'Install workflow script dependencies'
const CFG = { project: { name: 'core-only' }, stack: { packs: [] }, commands: { build: 'build', lint: 'lint', test: 'test' }, hooks: { shellPath: 'bash' } }

const node = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd })
const read = (dir, p) => readFileSync(join(dir, p), 'utf8')
const readInstall = (dir) => JSON.parse(read(dir, '.kit/install.json'))

/** A project installed from the kit, with the given overrides declared in kit.config.json. */
function project(overrides = []) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'override-check-')))
  writeFileSync(join(dir, 'kit.config.json'), JSON.stringify(CFG, null, 2))
  const r = node(join(kit, 'tools', 'install.mjs'), ['--target', dir, '--allow-unfilled'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  // Declared after the install: install never writes an overridden path, so the project starts from the kit's copy.
  writeFileSync(join(dir, 'kit.config.json'), JSON.stringify({ ...CFG, overrides }, null, 2))
  return dir
}
const check = (dir, extra = []) => node(join(dir, 'scripts', 'override-check.mjs'), ['--root', dir, ...extra], dir)
const drift = (dir) => node(join(kit, 'tools', 'drift-check.mjs'), ['--target', dir, '--source', kit], dir)
const ovr = (path) => ({ path, reason: 'test: the project keeps its own copy' })
/** Drop the step's `- name:` line and the lines of its mapping, as a project refactor would. */
function dropStep(dir, dest, name) {
  const lines = read(dir, dest).split('\n')
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`)
  assert.ok(at >= 0, `${name} is in the rendered ${dest}`)
  let end = at + 1
  while (end < lines.length && (/^\s{8,}\S/.test(lines[end]) || !lines[end].trim())) end++
  lines.splice(at, end - at)
  writeFileSync(join(dir, dest), lines.join('\n'))
}

test('the install record lists the required steps of each workflow, in marker order', () => {
  const dir = project()
  const inst = readInstall(dir)
  assert.deepEqual(inst.required[CI], CI_STEPS)
  assert.deepEqual(inst.required[SEC], SEC_STEPS)
  for (const line of read(dir, CI).split('\n').filter((l) => /KIT:required/.test(l))) assert.equal(line, '# KIT:required — a project override must keep this step')
  const lines = read(dir, CI).split('\n')
  lines.forEach((l, i) => {
    if (/KIT:required/.test(l)) assert.match(lines[i + 1], /^\s+- name: /)
  })
})

test('a sync of an older install adds the required key', () => {
  const dir = project()
  const file = join(dir, '.kit', 'install.json')
  const inst = readInstall(dir)
  delete inst.required
  writeFileSync(file, JSON.stringify(inst, null, 2))
  const r = node(join(kit, 'tools', 'sync.mjs'), ['--target', dir, '--apply', '--source', kit], dir)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(readInstall(dir).required[CI], CI_STEPS)
})

test('a declared override that lost a required step fails by name', () => {
  const dir = project([ovr(CI)])
  dropStep(dir, CI, STEP)
  const r = check(dir)
  assert.equal(r.status, 1)
  assert.equal(
    r.stdout.trim(),
    `OVERRIDE_CHECK: FAIL — ${CI} lacks required step "${STEP}" (declared override; add the step back, or ask the kit to drop the requirement)`,
  )
})

test('every required step present is ok', () => {
  const dir = project([ovr(CI)])
  const r = check(dir)
  assert.equal(r.status, 0, r.stdout)
  assert.equal(r.stdout.trim(), 'OVERRIDE_CHECK: ok — 1 override(s) checked, 5 required step(s) found')
})

test('no override of a workflow checks nothing', () => {
  const dir = project()
  const r = check(dir)
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), 'OVERRIDE_CHECK: ok — 0 override(s) checked')
})

test('without .kit/install.json the check is skipped', () => {
  const dir = project([ovr(CI)])
  unlinkSync(join(dir, '.kit', 'install.json'))
  const r = check(dir)
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), 'OVERRIDE_CHECK: skipped — no .kit/install.json')
})

test('--list prints the steps an override must keep', () => {
  const dir = project()
  const r = check(dir, ['--list'])
  assert.equal(r.status, 0)
  for (const n of [...CI_STEPS, ...SEC_STEPS]) assert.ok(r.stdout.includes(`- ${n}`), n)
})

test('a name inside a comment or another key does not count as a step', () => {
  const text = [
    'jobs:',
    '  lint:',
    '    steps:',
    `      # - name: ${STEP}`,
    '      - name: Other',
    `        run: echo "name: ${STEP}"`,
    '      - name: Multi',
    '        run: |',
    `          - name: ${STEP}`,
  ].join('\n')
  assert.deepEqual(stepNames(text), ['Other', 'Multi'])
  assert.deepEqual(missingSteps(text, [STEP, 'Other']), [STEP])
})

test('stepNames reads quoted names and a name that is not the first key of the step', () => {
  const text = ['jobs:', '  a:', '    name: not a step', '    steps:', '      - id: x', '        name: "Quoted one"', "      - name: 'Single'", '  b:', '    runs-on: x'].join('\n')
  assert.deepEqual(stepNames(text), ['Quoted one', 'Single'])
})

test('a marker not directly above a "- name:" line is an error naming the file and line', () => {
  assert.throws(() => requiredSteps('a:\n# KIT:required — keep\n  run: x\n', 'ci.yml'), /ci\.yml:2: KIT:required marker is not directly above a "- name:" line/)
})

test('drift-check reports a stripped override step and passes when it is present', () => {
  const dir = project([ovr(CI)])
  const ok = drift(dir)
  assert.equal(ok.status, 0, ok.stdout)
  assert.match(ok.stdout, /KIT_DRIFT: ok/)
  dropStep(dir, CI, STEP)
  const bad = drift(dir)
  assert.equal(bad.status, 1)
  assert.ok(bad.stdout.includes(`override-missing-step ${CI}: "${STEP}"`), bad.stdout)
  assert.match(bad.stdout, /KIT_DRIFT: FAIL — 1 undeclared differences \(0 drift, 0 missing, 1 override-missing-step\), 1 overrides; /)
})

test("the kit's own checkout is not step-checked", () => {
  const r = node(join(kit, 'scripts', 'override-check.mjs'), [], kit)
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), "OVERRIDE_CHECK: skipped — the kit's own checkout")
  const d = node(join(kit, 'tools', 'drift-check.mjs'), ['--target', kit], kit)
  assert.equal(d.status, 0, d.stdout)
  assert.match(d.stdout, /KIT_DRIFT: ok/)
  assert.ok(!d.stdout.includes('override-missing-step'))
})
