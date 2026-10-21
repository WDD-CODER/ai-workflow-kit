import type { EngineInterface, Register } from 'claude-code'

// ---------------------------------------------------------------------------
// quick-reply (part of fleet; mods are capped at three): a small [ ⏎ ] button
// inline, right after each reply the answer marks on purpose. The model is told
// (one short system-prompt section) to write a reply the person can send to this
// session as `text` ⏎ — say `go` ⏎ to start, or run `/reload-plugins` ⏎. Nothing
// else becomes a button: no guessing from words like "say" or "reply". A press puts
// the exact text in the prompt box (unsent), on its own line after what is there;
// pressing it again takes it out. Without the mod the marker reads as plain text.
// ---------------------------------------------------------------------------

const MAX_REPLY = 120
/** At most this many buttons in one answer; a reply already offered is not offered again. */
const MAX_BUTTONS = 6
const BULLET_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/
const RECOMMENDED_RE = /\(recommended\)|★/i
const FENCE_RE = /^\s*(```|~~~)/
/** A marked reply: a code span followed by ⏎ (one optional space between). */
const MARKED_RE = /`([^`\n]+)` ?⏎/g

/** What the model is told, once per session (cached with the rest of the system prompt). */
export const REPLY_RULE = [
  'Reply buttons: when the person can act on this session by sending exact text, write that text in backticks followed by ⏎, inline in your sentence.',
  'Examples: say `go` ⏎ to start · reply `approved: src/x.ts` ⏎ · run `/reload-plugins` ⏎. Mark the recommended option with (recommended) on its line.',
  'The interface turns each into a button that fills their prompt box. Use it only for text they would send to this session (a reply you are waiting for, an option, a slash command to run here);',
  'never for shell or PowerShell commands, file paths, code names, or words you only mention.',
].join(' ')

type Edit = { start: number; end: number; reply: string }

/** A line with its ⏎ markers removed, and where each marked reply sits in the cleaned line. */
export function markedEdits(line: string): { line: string; edits: Edit[] } {
  const edits: Edit[] = []
  let out = ''
  let at = 0
  for (const m of line.matchAll(MARKED_RE)) {
    const reply = (m[1] ?? '').trim()
    out += line.slice(at, m.index)
    const start = out.length
    out += `\`${m[1]}\``
    if (reply && reply.length <= MAX_REPLY) edits.push({ start, end: out.length, reply })
    at = m.index + m[0].length
  }
  out += line.slice(at)
  return { line: out, edits }
}

/** The replies an answer marks, in order, each once. */
export function repliesOf(markdown: string): string[] {
  const seen: string[] = []
  let fenced = false
  for (const l of markdown.split('\n')) {
    if (FENCE_RE.test(l)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    for (const e of markedEdits(l).edits) if (!seen.includes(e.reply)) seen.push(e.reply)
  }
  return seen
}

// -- inline layout ---------------------------------------------------------------
// Lines with no reply stay markdown, drawn as the engine draws a reply. A line with
// replies flows word by word (bold and code kept) with a small button right after
// each reply, so the person reads, presses, and reads on.

export type Run = { text: string; bold?: boolean; code?: boolean }
export type Piece = { kind: 'text'; run: Run } | { kind: 'button'; reply: string; recommended: boolean }
export type Block = { kind: 'markdown'; text: string; gap: boolean } | { kind: 'line'; pieces: Piece[]; gap: boolean }

const INLINE_RE = /\*\*(.+?)\*\*|`([^`\n]+)`|\[([^\]\n]*)\]\([^)\n]*\)/g

/** Inline markdown as styled runs: **bold**, `code`, [link](…) as its text. */
export function runsOf(s: string): Run[] {
  const runs: Run[] = []
  let at = 0
  for (const m of s.matchAll(INLINE_RE)) {
    if (m.index > at) runs.push({ text: s.slice(at, m.index) })
    if (m[1] !== undefined) runs.push({ text: m[1], bold: true })
    else if (m[2] !== undefined) runs.push({ text: m[2], code: true })
    else runs.push({ text: m[3] ?? '' })
    at = m.index + m[0].length
  }
  if (at < s.length) runs.push({ text: s.slice(at) })
  return runs
}

/** One run per word (its trailing space kept), so a row that wraps flows like text. */
const words = (run: Run): Run[] =>
  run.text
    .split(/(?<=\s)/)
    .filter(w => w !== '')
    .map(w => ({ ...run, text: w.replace(/\s+$/, ' ') }))

/** A line's pieces: its words, with a button after each reply span. */
export function piecesOf(line: string, edits: Edit[], recommendedLine: boolean): Piece[] {
  const bullet = BULLET_RE.exec(line)
  let offset = 0
  const pieces: Piece[] = []
  if (bullet) {
    offset = line.length - (bullet[2] ?? '').length
    pieces.push({ kind: 'text', run: { text: `${' '.repeat((bullet[1] ?? '').length)}• ` } })
  } else {
    const h = /^\s*#{1,6}\s+/.exec(line)
    if (h) offset = h[0].length
  }
  const ends = [...edits].sort((a, b) => a.end - b.end)
  let at = offset
  const push = (s: string) => {
    for (const r of runsOf(s)) for (const w of words(r)) pieces.push({ kind: 'text', run: w })
  }
  for (const e of ends) {
    const end = Math.max(e.end, at)
    // keep a closing quote or bracket of the span with the words before the button
    let stop = end
    while (stop < line.length && /["”')\]]/.test(line[stop] ?? '')) stop += 1
    push(line.slice(at, stop))
    const last = pieces[pieces.length - 1]
    if (last?.kind === 'text') last.run = { ...last.run, text: last.run.text.replace(/\s+$/, '') }
    pieces.push({ kind: 'button', reply: e.reply, recommended: recommendedLine })
    at = stop
  }
  push(line.slice(at))
  return pieces
}

/** The answer as blocks: markdown runs between the lines that carry replies. */
export function blocksOf(markdown: string): { blocks: Block[]; count: number } {
  const lines = markdown.split('\n')
  const inFence: boolean[] = []
  let fenced = false
  for (const l of lines) {
    if (FENCE_RE.test(l)) {
      inFence.push(true)
      fenced = !fenced
    } else inFence.push(fenced)
  }
  const blocks: Block[] = []
  let pending: string[] = []
  let gap = false
  let count = 0
  const flush = () => {
    const lead = pending.findIndex(l => l.trim() !== '')
    if (lead >= 0) {
      const text = pending.slice(lead).join('\n').replace(/\s+$/, '')
      blocks.push({ kind: 'markdown', text, gap: gap || lead > 0 })
      gap = pending[pending.length - 1]?.trim() === ''
    } else if (pending.length > 0) gap = true
    pending = []
  }
  const seen = new Set<string>()
  lines.forEach((raw, n) => {
    if (inFence[n]) {
      pending.push(raw)
      return
    }
    const { line, edits: found } = markedEdits(raw)
    const edits = found.filter(e => {
      if (seen.has(e.reply) || seen.size >= MAX_BUTTONS) return false
      seen.add(e.reply)
      return true
    })
    if (edits.length === 0) {
      pending.push(line)
      return
    }
    flush()
    blocks.push({ kind: 'line', pieces: piecesOf(line, edits, RECOMMENDED_RE.test(line)), gap })
    gap = false
    count += edits.length
  })
  flush()
  return { blocks, count }
}

export function toggleDraft(draft: string, reply: string): string {
  const lines = draft.split('\n')
  const at = lines.findIndex(l => l.trim() === reply)
  if (at >= 0) {
    lines.splice(at, 1)
    return lines.join('\n').replace(/\s+$/, '')
  }
  const kept = draft.replace(/\s+$/, '')
  return kept ? `${kept}\n${reply}` : reply
}

async function press($: EngineInterface, reply: string): Promise<void> {
  const { text } = await $.prompt.read()
  const filled = await $.prompt.fill({ text: toggleDraft(text, reply), mode: 'replace' })
  if (!filled.isFilled) $.ui.toast(`quick-reply: the prompt box is busy; type "${reply}"`)
}

/** Called from fleet's register. */
export const registerQuickReply: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    return { sections: [...out.sections, { id: 'fleet:quick-reply', text: REPLY_RULE, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const { blocks, count } = blocksOf(e.props.text)
    if (count === 0) return next(e)
    const { Box, Text, Markdown, Button } = $.ui.resolve(e)
    let n = 0
    const body = blocks.map((b, i) => {
      if (b.kind === 'markdown') {
        return (
          <Box key={`qr-b${i}`} marginTop={b.gap ? 1 : 0}>
            <Markdown text={b.text} />
          </Box>
        )
      }
      return (
        <Box key={`qr-b${i}`} flexDirection="row" flexWrap="wrap" marginTop={b.gap ? 1 : 0}>
          {b.pieces.map(p => {
            if (p.kind === 'text') {
              return (
                <Text bold={p.run.bold} color={p.run.code ? 'permission' : undefined}>
                  {p.run.text}
                </Text>
              )
            }
            const key = `quick-reply:${n++}`
            return (
              <Box>
                <Text> </Text>
                <Button
                  key={key}
                  label="⏎"
                  variant={p.recommended ? 'primary' : 'secondary'}
                  onPress={() => void press($, p.reply)}
                />
                <Text> </Text>
              </Box>
            )
          })}
        </Box>
      )
    })
    return (
      <Box flexDirection="row" marginTop={1}>
        <Box minWidth={2}>
          <Text>{e.props.isFirstOfReply ? '● ' : '  '}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {body}
        </Box>
      </Box>
    )
  })
}
