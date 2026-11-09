/**
 * The live view of a run — one small file per plan, `.claude/orchestrator-runs/<run>/live-<NNN>.json`, for fleet's run
 * panel (docs/agent/orchestrator.md "Live view"). run-plans.mjs writes it in-process; nothing reads it back into a run.
 *
 *   { step, stepAt, gate: { index, total, command, startedAt } | null,
 *     builder: { tools, lastTool, lastTarget, tokensIn, tokensOut, at } | null }
 *
 * Best-effort: a write never throws and never waits (temp file + rename; at most one write per plan every
 * `throttleMs`, except a step change, which writes at once). Node built-ins only.
 */
import { writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const liveFile = (runDir, nnn) => join(runDir, `live-${nnn}.json`)

/** One plain line: control characters (terminal escapes among them) and line breaks become spaces. */
export const plainLine = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim()

/** The tool's target for a one-line view: the file, else the command's start, else the pattern. */
export function toolTarget(input) {
  if (!input || typeof input !== 'object') return ''
  const s = input.file_path ?? input.notebook_path ?? input.path ?? (typeof input.command === 'string' ? input.command : null) ?? input.pattern ?? input.url ?? ''
  const one = plainLine(s)
  return one.length > 60 ? `${one.slice(0, 59)}…` : one
}

/**
 * The builder line after one stream event. `usageById` (a Map, kept by the caller) holds each assistant message's
 * usage once: stream-json repeats a message's usage on every content block of it.
 */
export function builderAfter(prev, ev, usageById, at = new Date().toISOString()) {
  if (!ev || ev.type !== 'assistant' || !ev.message) return prev
  const b = { tools: 0, lastTool: '', lastTarget: '', tokensIn: 0, tokensOut: 0, ...(prev ?? {}) }
  for (const c of Array.isArray(ev.message.content) ? ev.message.content : []) {
    if (c?.type !== 'tool_use') continue
    b.tools += 1
    b.lastTool = plainLine(c.name).slice(0, 40)
    b.lastTarget = toolTarget(c.input)
  }
  const u = ev.message.usage
  if (u && typeof u === 'object') {
    usageById.set(ev.message.id ?? `#${usageById.size}`, u)
    const n = (x, k) => (Number.isFinite(x?.[k]) ? x[k] : 0)
    b.tokensIn = 0
    b.tokensOut = 0
    for (const x of usageById.values()) {
      b.tokensIn += n(x, 'input_tokens') + n(x, 'cache_creation_input_tokens') + n(x, 'cache_read_input_tokens')
      b.tokensOut += n(x, 'output_tokens')
    }
  }
  b.at = at
  return b
}

/** A live writer for one run folder. */
export function createLive(runDir, { throttleMs = 2000, clock = Date.now } = {}) {
  const plans = new Map()
  const of = (nnn) => {
    if (!plans.has(nnn)) plans.set(nnn, { data: {}, lastWrite: 0, timer: null, usage: new Map() })
    return plans.get(nnn)
  }
  const write = (nnn) => {
    const p = of(nnn)
    if (p.timer) clearTimeout(p.timer)
    p.timer = null
    p.lastWrite = clock()
    const file = liveFile(runDir, nnn)
    const text = `${JSON.stringify(p.data)}\n`
    try {
      mkdirSync(runDir, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, text)
      try {
        renameSync(tmp, file)
      } catch {
        // Windows refuses a rename over a file another process holds open: write it in place instead.
        writeFileSync(file, text)
      }
    } catch { /* the live view is best-effort */ }
  }
  /** Merge `patch` (a null value removes the field); `force` writes now. */
  const patch = (nnn, fields, { force = false } = {}) => {
    const p = of(nnn)
    for (const [k, v] of Object.entries(fields)) {
      if (v === null || v === undefined) delete p.data[k]
      else p.data[k] = v
    }
    const wait = throttleMs - (clock() - p.lastWrite)
    if (force || wait <= 0) write(nnn)
    else if (!p.timer) {
      p.timer = setTimeout(() => write(nnn), wait)
      p.timer.unref?.()
    }
  }
  return {
    patch,
    /** A new step clears the gate and builder lines and writes at once; the same step again changes nothing. */
    step(nnn, step) {
      const p = of(nnn)
      if (p.data.step === step) return
      p.usage = new Map()
      patch(nnn, { step, stepAt: new Date(clock()).toISOString(), gate: null, builder: null }, { force: true })
    },
    gate(nnn, { command, index, total }) {
      patch(nnn, { gate: { index, total, command: plainLine(command).slice(0, 160), startedAt: new Date(clock()).toISOString() } }, { force: true })
    },
    builderEvent(nnn, ev) {
      const p = of(nnn)
      const next = builderAfter(p.data.builder ?? null, ev, p.usage, new Date(clock()).toISOString())
      if (next !== (p.data.builder ?? null)) patch(nnn, { builder: next })
    },
    flush(nnn) {
      if (of(nnn).timer) write(nnn)
    },
  }
}
