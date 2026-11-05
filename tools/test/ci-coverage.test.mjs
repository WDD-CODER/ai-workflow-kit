// Plan 075: CI runs every kit tool test once per pull request, and no test file can sit outside that run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

const kit = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const workflow = readFileSync(join(kit, '.github', 'workflows', 'leak-check.yml'), 'utf8')

/** The text of one top-level job of the workflow (from `  <name>:` to the next job or the end). */
function jobBlock(src, name) {
  const lines = src.split(/\r?\n/)
  const start = lines.findIndex((l) => l === `  ${name}:`)
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) if (/^ {2}[\w-]+:\s*$/.test(lines[i])) { end = i; break }
  return lines.slice(start, end).join('\n')
}

test('CI: the kit-tests job installs the scripts packages, then runs every tools/test file on Ubuntu, Node 22', () => {
  const job = jobBlock(workflow, 'kit-tests')
  assert.ok(job, 'leak-check.yml has a kit-tests job')
  assert.match(job, /runs-on: ubuntu-latest/)
  assert.match(job, /node-version: 22/)
  const install = job.indexOf('run: npm ci --prefix scripts')
  const step = job.indexOf('- name: Every kit tool test (node --test tools/test)')
  assert.ok(install > 0, 'a step runs npm ci --prefix scripts')
  assert.ok(step > install, 'the test step comes after the install step')
  assert.match(job.slice(step), /^\s+run: node --test "tools\/test\/\*\.test\.mjs"$/m)
  assert.doesNotMatch(job, /^\s+needs:/m, 'kit-tests runs beside leak-check, not after it')
})

test('CI: every test file under tools/test (fixtures aside) matches the *.test.mjs glob CI runs', () => {
  const dir = join(kit, 'tools', 'test')
  const outside = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) {
        if (name !== 'fixtures') walk(p)
        continue
      }
      const rel = relative(dir, p).replace(/\\/g, '/')
      const isTest = /\.test\.(c|m)?js$/.test(name)
      const inGlob = !rel.includes('/') && name.endsWith('.test.mjs')
      if (isTest && !inGlob) outside.push(rel)
    }
  }
  walk(dir)
  assert.deepEqual(outside, [], 'test files the CI glob does not run')
})

test('change loop: section 1 names the local checks and keeps the e2e checks in CI', () => {
  const doc = readFileSync(join(kit, 'docs', 'CHANGE-LOOP.md'), 'utf8')
  const s1 = doc.slice(doc.indexOf('## 1. Change the kit'), doc.indexOf('## 2.')).replace(/\s+/g, ' ')
  for (const c of ['npm run build', 'npm run lint', 'npm test', 'drift-check', 'node --test "tools/test/*.test.mjs"']) assert.ok(s1.includes(c), `section 1 names ${c}`)
  assert.match(s1, /`e2e-check` and `acceptance-check --e2e` run in CI on every PR/)
  assert.match(s1, /locally only to debug a CI failure/)
  assert.match(s1, /never run `orchestrator-e2e` and `e2e-check` both/)
})
