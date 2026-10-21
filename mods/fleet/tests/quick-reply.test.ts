import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { blocksOf, markedEdits, piecesOf, REPLY_RULE, repliesOf, toggleDraft } from '../hooks/quick-reply'

type Loose = (event: string, hook: (...args: never[]) => unknown) => unknown

const shown = (b: unknown) => {
  const line = b as { kind: string; pieces: { kind: string; run?: { text: string } }[] }
  if (line?.kind !== 'line') throw new Error('not a reply line')
  return line.pieces.map(p => (p.kind === 'button' ? '[⏎]' : p.run?.text ?? '')).join('')
}

test('only a code span followed by ⏎ is a reply; the marker is removed from the text', () => {
  expect(markedEdits('Say `go` ⏎ to start.')).toEqual({ line: 'Say `go` to start.', edits: [{ start: 4, end: 8, reply: 'go' }] })
  expect(markedEdits('Run `/reload-plugins`⏎ now.').edits.map(e => e.reply)).toEqual(['/reload-plugins'])
  expect(markedEdits('Reply `merge` or say "go".').edits).toEqual([])
})

test('guessing is gone: trigger words, quotes, bullets and unmarked slash commands make no button', () => {
  const md = [
    'Say "go" and I will start. Reply `approved: src/x.ts` to let me edit it.',
    'Decision for you:',
    '- **Fullscreen mode (recommended):** clicks work in place.',
    'Then run `/ship` when done.',
  ].join('\n')
  expect(repliesOf(md)).toEqual([])
  expect(blocksOf(md).count).toBe(0)
})

test('the button sits inline, right after the marked reply', () => {
  const { blocks, count } = blocksOf('Intro paragraph.\n\nRestart, or run `/reload-plugins` ⏎ in each checkout.\nPlain closing line.')
  expect(count).toBe(1)
  expect(blocks.map(b => b.kind)).toEqual(['markdown', 'line', 'markdown'])
  expect(shown(blocks[1])).toBe('Restart, or run /reload-plugins[⏎] in each checkout.')
})

test('several marked replies on one line; the (recommended) line is marked', () => {
  const line = blocksOf('- Fold it into fleet (recommended): reply `fold` ⏎, or `drop` ⏎ to remove it.').blocks[0]
  expect(shown(line)).toBe('• Fold it into fleet (recommended): reply fold[⏎], or drop[⏎] to remove it.')
  if (line?.kind !== 'line') throw new Error('no line')
  expect(line.pieces.filter(p => p.kind === 'button')).toEqual([
    { kind: 'button', reply: 'fold', recommended: true },
    { kind: 'button', reply: 'drop', recommended: true },
  ])
  expect(piecesOf('plain', [], false).length).toBe(1)
})

test('markers inside a code fence are left alone', () => {
  expect(repliesOf('```\nsay `go` ⏎\n```')).toEqual([])
})

test('no more than 6 buttons in one answer, and a repeated reply once', () => {
  const many = Array.from({ length: 9 }, (_, i) => `Say \`r${i}\` ⏎.`).join('\n') + '\nSay `r0` ⏎ again.'
  expect(blocksOf(many).count).toBe(6)
})

test('toggleDraft adds the reply on its own line and a second press removes it', () => {
  expect(toggleDraft('', 'go')).toBe('go')
  expect(toggleDraft('merge  ', 'go')).toBe('merge\ngo')
  expect(toggleDraft('merge\ngo', 'go')).toBe('merge')
})

const MESSAGE = (text: string) => ({ component: 'AssistantMessage', props: { text, isFirstOfReply: true } }) as const

const engine = (on: On) => {
  const o = on as unknown as Loose
  o('ui.render', () => ({ type: 'Text', props: {}, children: ['engine answer'] }))
}

test('a press fills the prompt box, unsent, and a second press clears it', async ($, on) => {
  const o = on as unknown as Loose
  engine(on)
  let draft = 'hello'
  o('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  o('prompt.fill', (...a: unknown[]) => {
    draft = (a[1] as { text: string }).text
    return { isFilled: true }
  })
  o('ui.toast', () => ({ value: undefined }))
  for (const surface of ['terminal', 'desktop'] as const) {
    draft = 'hello'
    const ui = await $.ui.mount({ plugin: 'fleet', surface, ...MESSAGE('Say `go` ⏎ or reply `approved: scripts/x.mjs` ⏎.') } as never)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
    await ui.press({ key: 'quick-reply:0' })
    expect(draft).toBe('hello\ngo')
    await ui.press({ key: 'quick-reply:1' })
    expect(draft).toBe('hello\ngo\napproved: scripts/x.mjs')
    await ui.press({ key: 'quick-reply:0' })
    expect(draft).toBe('hello\napproved: scripts/x.mjs')
    await ui.unmount()
  }
})

test('an answer with no marked reply is drawn by the engine alone', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ plugin: 'fleet', surface: 'terminal', ...MESSAGE('All done. Say "go" if you want more.') } as never)
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /engine answer/ })).toBeDefined()
  await ui.unmount()
})

// $.prompt.compose from a test runs every plugin's hook but the caller's own, so the
// compose hook itself is checked by `claude plugin validate` and live; here, the rule text.
test('the reply rule names the marker, the examples and what never gets one', () => {
  expect(REPLY_RULE).toMatch(/backticks followed by ⏎/)
  expect(REPLY_RULE).toMatch(/`\/reload-plugins` ⏎/)
  expect(REPLY_RULE).toMatch(/never for shell or PowerShell commands/)
  expect(REPLY_RULE.length).toBeLessThan(700)
})
