// The builder's streamed call (plan 112 C1): the stream's result event reads exactly as the JSON mode's whole output,
// each event reaches onEvent in order, and words in a tool result never count as a rate limit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { runAgent, claudeArgs } from '../../core/scripts/lib/claude-run.mjs'
import { runGate } from '../../core/scripts/lib/plan-gate.mjs'
import { createLive, builderAfter, toolTarget, liveFile } from '../../core/scripts/lib/run-live.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const fixtures = join(kit, 'tools', 'test', 'fixtures')
const OK_JSON = join(fixtures, 'claude-p-ok.json')
const STREAM = join(fixtures, 'claude-p-stream.jsonl')

/** A fake claude that prints PRINT_FILE and exits PRINT_EXIT. */
function printer() {
  const dir = mkdtempSync(join(tmpdir(), 'kit-stream-'))
  const bin = join(dir, 'printer.mjs')
  writeFileSync(bin, "import { readFileSync } from 'node:fs'\nprocess.stdin.resume()\nprocess.stdin.on('end', () => { process.stdout.write(readFileSync(process.env.PRINT_FILE, 'utf8')); process.exit(Number(process.env.PRINT_EXIT || 0)) })\n")
  const agent = { name: 'toy', model: 'sonnet', tools: [], body: '# toy\n', file: join(dir, 'agents', 'toy.md') }
  const call = (file, { exit = 0, stream = null } = {}) => runAgent({ agent, cwd: dir, prompt: 'hi', timeoutMs: 20_000, bin, env: { ...process.env, PRINT_FILE: file, PRINT_EXIT: String(exit) }, stream })
  return { dir, call, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const fields = (r) => ({ text: r.text, usage: r.usage, tokens: r.tokens, costUsd: r.costUsd, ok: r.ok, error: r.error, rateLimited: r.rateLimited })

test('claudeArgs asks for stream-json with --verbose only when streaming', () => {
  const agent = { name: 'toy', tools: [], body: '' }
  const plain = claudeArgs({ agent, model: 'sonnet', systemPromptFile: 's.md' })
  assert.deepEqual(plain.slice(0, 3), ['-p', '--output-format', 'json'])
  assert.ok(!plain.includes('--verbose'))
  const s = claudeArgs({ agent, model: 'sonnet', systemPromptFile: 's.md', stream: true })
  assert.deepEqual(s.slice(0, 4), ['-p', '--output-format', 'stream-json', '--verbose'])
})

test('a stream whose result event is the JSON answer returns the same fields as the JSON mode', async () => {
  const p = printer()
  try {
    const plain = await p.call(OK_JSON)
    const events = []
    const streamed = await p.call(STREAM, { stream: { onEvent: (e) => events.push(e.type) } })
    assert.equal(plain.ok, true, plain.error)
    assert.deepEqual(fields(streamed), fields(plain))
    const expected = readFileSync(STREAM, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).type)
    assert.deepEqual(events, expected, 'every event, in order, including the one after the result')
  } finally {
    p.cleanup()
  }
})

test('a failed streamed call is not a rate limit because a tool result says "rate limit" or 429', async () => {
  const p = printer()
  try {
    const r = await p.call(STREAM, { exit: 1, stream: {} })
    assert.equal(r.ok, false)
    assert.equal(r.rateLimited, false, r.error)
    // A rejected rate_limit_event is a limit.
    const rejected = join(p.dir, 'rejected.jsonl')
    writeFileSync(rejected, `${JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } })}\n`)
    const r2 = await p.call(rejected, { exit: 1, stream: {} })
    assert.equal(r2.rateLimited, true)
    // No result event at all: a plain error, not a crash.
    const r3 = await p.call(rejected, { exit: 0, stream: {} })
    assert.match(r3.error, /no result event/)
  } finally {
    p.cleanup()
  }
})

test('the gate reports each check before it runs, numbered from 1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-gate-'))
  try {
    const seen = []
    const g = await runGate({ folder: dir, commands: ['node -e ""', 'node -e "process.exit(0)"'], receipt: false, onStart: (s) => seen.push(s) })
    assert.equal(g.results.length, 2)
    assert.deepEqual(seen, [{ command: 'node -e ""', index: 1, total: 2 }, { command: 'node -e "process.exit(0)"', index: 2, total: 2 }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the builder line counts tools, keeps the last target and counts each message usage once', () => {
  const events = readFileSync(STREAM, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const usage = new Map()
  let b = null
  for (const e of events) b = builderAfter(b, e, usage, 'T')
  assert.equal(b.tools, 2)
  assert.equal(b.lastTool, 'Bash')
  assert.equal(b.lastTarget.length, 60)
  assert.ok(b.lastTarget.endsWith('…'))
  assert.equal(b.tokensIn, 2 + 19836 + 16741 + 2 + 1135 + 36577 + 2 + 37712)
  assert.equal(b.tokensOut, 40 + 30 + 4)
  // The same message again (stream-json repeats usage per content block) adds no tokens.
  const again = builderAfter(b, { type: 'assistant', message: { id: undefined, content: [], usage: { input_tokens: 0, output_tokens: 0 } } }, new Map(usage), 'T')
  assert.equal(again.tools, 2)
  assert.equal(toolTarget({ file_path: 'src/a.ts' }), 'src/a.ts')
  assert.equal(toolTarget({ pattern: 'foo' }), 'foo')
  // A tool input is model text: terminal escapes and line breaks never reach the live file.
  assert.equal(toolTarget({ file_path: 'a\u001b[2Jb\u009bc\nd' }), 'a [2Jb c d')
  const evil = builderAfter(null, { type: 'assistant', message: { id: 'x', content: [{ type: 'tool_use', name: 'Ed\u001bit', input: {} }] } }, new Map(), 'T')
  assert.equal(evil.lastTool, 'Ed it')
})

test('the live file writes a step change at once, throttles builder updates, and clears old lines on a new step', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-live-'))
  try {
    let now = 1_000_000
    const live = createLive(dir, { throttleMs: 2000, clock: () => now })
    const read = () => JSON.parse(readFileSync(liveFile(dir, '531'), 'utf8'))
    live.step('531', 'building')
    assert.equal(read().step, 'building')
    const ev = (id) => ({ type: 'assistant', message: { id, content: [{ type: 'tool_use', name: 'Edit', input: { file_path: `f${id}.ts` } }], usage: { input_tokens: 10, output_tokens: 1 } } })
    now += 2500
    live.builderEvent('531', ev('a'))
    assert.equal(read().builder.tools, 1, 'first event after the throttle window: written')
    now += 100
    live.builderEvent('531', ev('b'))
    assert.equal(read().builder.tools, 1, 'second event inside the window: not yet written')
    live.flush('531')
    assert.equal(read().builder.tools, 2)
    assert.equal(read().builder.lastTarget, 'fb.ts')
    live.gate('531', { command: 'npm run test', index: 3, total: 9 })
    live.step('531', 'gate')
    assert.equal(read().builder, undefined, 'a new step clears the builder line')
    assert.equal(read().gate, undefined, 'and the gate line of the step before')
    live.gate('531', { command: 'npm run test', index: 3, total: 9 })
    assert.deepEqual({ ...read().gate, startedAt: 'x' }, { index: 3, total: 9, command: 'npm run test', startedAt: 'x' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
