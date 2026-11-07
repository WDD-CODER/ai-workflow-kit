// tools/instruction-load.mjs: sums the five standing instruction files and exits 1 above the maximum.
//   node --test tools/test/instruction-load.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve, dirname } from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { LOAD_FILES, instructionLoad, lineCount } from '../instruction-load.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const tool = join(kit, 'tools', 'instruction-load.mjs')

function project(linesPer) {
  const root = mkdtempSync(join(tmpdir(), 'instruction-load-'))
  LOAD_FILES.forEach((p, i) => {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), Array.from({ length: linesPer[i] }, (_, n) => `line ${n}`).join('\n') + '\n')
  })
  return root
}

test('lineCount counts like wc -l (CRLF, a missing last newline, an empty file)', () => {
  assert.equal(lineCount(''), 0)
  assert.equal(lineCount('a\nb\n'), 2)
  assert.equal(lineCount('a\r\nb\r\n'), 2)
  assert.equal(lineCount('a\nb'), 2)
})

test('the five files are AGENTS.md, take-plan, ship, job-validation and standards-git', () => {
  assert.deepEqual(LOAD_FILES, ['AGENTS.md', '.claude/commands/take-plan.md', '.claude/commands/ship.md', 'docs/agent/job-validation.md', 'docs/agent/standards-git.md'])
})

test('at or under the maximum: prints the sum and exits 0; above it: exits 1; a missing file: exits 2', () => {
  const root = project([100, 100, 100, 100, 100])
  try {
    assert.equal(instructionLoad(root).total, 500)
    const ok = spawnSync(process.execPath, [tool, '--root', root], { encoding: 'utf8' })
    assert.equal(ok.status, 0, ok.stdout)
    assert.match(ok.stdout, /INSTRUCTION_LOAD: 500 lines \(max 600\) — ok/)
    const edge = spawnSync(process.execPath, [tool, '--root', root, '--max', '500'], { encoding: 'utf8' })
    assert.equal(edge.status, 0, 'exactly at the maximum passes')
    const over = spawnSync(process.execPath, [tool, '--root', root, '--max', '499'], { encoding: 'utf8' })
    assert.equal(over.status, 1)
    assert.match(over.stdout, /INSTRUCTION_LOAD: 500 lines \(max 499\) — over/)
    rmSync(join(root, 'AGENTS.md'))
    const missing = spawnSync(process.execPath, [tool, '--root', root], { encoding: 'utf8' })
    assert.equal(missing.status, 2)
    assert.match(missing.stdout, /MISSING AGENTS\.md/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
