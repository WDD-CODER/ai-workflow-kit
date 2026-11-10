// Every tracked path stays short enough to clone on Windows. Claude Code clones this repository for the mods
// marketplace under C:\Users\<name>\.claude\plugins\marketplaces\…, and Windows git stops at 260 characters
// ("Filename too long", then "unable to checkout working tree") unless core.longpaths is set. A 194-character plan
// path broke `claude plugin marketplace update` that way. 140 leaves 120 characters for the folder above the repo.
//   node --test tools/test/path-length.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const MAX = 140

test(`every tracked path is ${MAX} characters or fewer`, () => {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: kit, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const long = r.stdout.split('\0').filter((p) => p.length > MAX)
  assert.deepEqual(long.map((p) => `${p.length} ${p}`), [], 'shorten these names (a plan keeps its long title in its H1)')
})
