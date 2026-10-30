// tools/kit-inbox.mjs (kit-only): inbox entries are grouped by slug similarity and each group gets a draft plan block.
//   node --test tools/test/kit-inbox.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const script = join(kit, 'tools', 'kit-inbox.mjs')
const { parseEntry, groupInbox, draftBlock } = await import(pathToFileURL(script).href)

const entry = (file, title, extra = '') => parseEntry(file, `# ${title}\n\nSent 2026-10-01 from a project using the kit. One lesson.\n${extra}\nThe lesson body for ${title}.\n`)

test('entries with similar slugs are one group; a seen-in line or a second entry makes it a priority and sorts it first', () => {
  const a = entry('2026-10-01-ask-before-inventing-a-leave-dialog.md', 'Ask before inventing a leave dialog')
  const b = entry('2026-10-05-inventing-leave-dialogs.md', 'Inventing leave dialogs', 'seen-in: 2\n')
  const c = entry('2026-10-02-gate-timeouts-need-a-cap.md', 'Gate timeouts need a cap')
  assert.equal(b.seenIn, 2)
  assert.equal(a.seenIn, 1)
  const groups = groupInbox([c, a, b])
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0].entries.map((e) => e.file), [a.file, b.file])
  assert.equal(groups[0].priority, true)
  assert.equal(groups[1].priority, false)
  assert.equal(groupInbox([a, c]).length, 2, 'unrelated slugs stay apart')
  assert.equal(parseEntry('README.md', '# x'), null)
  const block = draftBlock(groups[0], 1)
  assert.match(block, /^GROUP 1 \[priority\] — Ask before inventing a leave dialog \(2 entries, seen-in 3\)/)
  assert.match(block, /--- draft plan block \(paste into \/plan\) ---/)
  assert.match(block, /feedback\/inbox\/2026-10-05-inventing-leave-dialogs\.md, seen-in: 2/)
})

test('the command prints one block per group, and "empty" for an empty inbox; it is kit-only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-inbox-'))
  try {
    const empty = spawnSync(process.execPath, [script, '--inbox', dir], { encoding: 'utf8' })
    assert.equal(empty.status, 0)
    assert.match(empty.stdout, /KIT_INBOX: empty/)
    writeFileSync(join(dir, '2026-10-01-ask-before-inventing-a-leave-dialog.md'), '# Ask before inventing a leave dialog\n\nA builder added a dialog.\n')
    writeFileSync(join(dir, '2026-10-02-gate-timeouts-need-a-cap.md'), '# Gate timeouts need a cap\n\nA gate ran forever.\n')
    writeFileSync(join(dir, 'README.md'), '# not an entry\n')
    const r = spawnSync(process.execPath, [script, '--inbox', dir], { encoding: 'utf8' })
    assert.match(r.stdout, /KIT_INBOX: 2 entries in 2 group\(s\)/)
    assert.equal((r.stdout.match(/^GROUP \d/gm) ?? []).length, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
  // never installed: the tool lives under tools/, the command outside core/
  assert.ok(existsSync(join(kit, '.claude', 'commands', 'kit-inbox.md')))
  assert.ok(!existsSync(join(kit, 'core', '.claude', 'commands', 'kit-inbox.md')), 'not under core/: never rendered into a project')
})
