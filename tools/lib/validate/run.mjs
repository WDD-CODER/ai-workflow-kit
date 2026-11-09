// The case runner of tools/validate-orchestrator.mjs: one case at a time, each with a time limit, its sandboxes removed
// after it (unless keep), its processes stopped. A case decides PASS or FAIL itself from the sandbox's files; the
// runner only turns a time-out, an error or a missing verdict into FAIL — never into PASS.
import { cpSync, mkdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { killTree } from './common.mjs'

export const CASE_IDS = ['V1', 'V2', 'V3', 'V4', 'V5']

/** The cases a `--cases V2,V4` filter keeps, in their own order; an unknown id is an error. */
export function selectCases(all, filter) {
  if (!filter) return all
  const want = String(filter).split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)
  const unknown = want.filter((id) => !all.some((c) => c.id === id))
  if (unknown.length) throw new Error(`unknown case(s): ${unknown.join(', ')} (known: ${all.map((c) => c.id).join(', ')})`)
  return all.filter((c) => want.includes(c.id))
}

/**
 * Runs `cases` one after another. opts: mode, kit, kitRef, keep, timeoutMs (per case), maxInputTokens (real mode, for
 * the whole run), logsDir (a failing case's run files are copied there), log (progress lines).
 * Returns one row per case: { id, title, plan, verdict, why, evidence, seconds, tokens, kept, logs }.
 */
export async function runCases(cases, { mode = 'fake', kit, kitRef = null, keep = false, timeoutMs = 300_000, maxInputTokens = Infinity, logsDir = null, log = () => {} } = {}) {
  const rows = []
  let used = 0
  for (const c of cases) {
    const t0 = Date.now()
    const ac = new AbortController()
    const sandboxes = []
    const pids = []
    const files = []
    let caseTokens = () => 0
    const ctx = {
      mode, kit, kitRef, signal: ac.signal, log,
      sandbox: (p) => sandboxes.push(p),
      track: (pid) => pid && pids.push(pid),
      // keepFiles(() => [paths]): read when the case ends, so a timed-out case's run files are kept too
      keepFiles: (fn) => files.push(fn),
      tokens: (fn) => { caseTokens = fn },
      overCap: () => (used + caseTokens() >= maxInputTokens ? `token cap reached: ${used + caseTokens()} of ${maxInputTokens} input tokens` : null),
    }
    log(`VALIDATE: ${c.id} ${c.title} …`)
    let row
    let timer = null
    const limit = new Promise((res) => {
      timer = setTimeout(() => {
        ac.abort()
        res({ verdict: 'FAIL', why: `timed out after ${Math.round(timeoutMs / 1000)} s`, evidence: [] })
      }, timeoutMs)
    })
    const work = Promise.resolve().then(() => c.run(ctx))
    work.catch(() => {})
    try {
      row = await Promise.race([work, limit])
    } catch (e) {
      row = { verdict: 'FAIL', why: `error: ${String(e?.message ?? e).split('\n')[0].slice(0, 300)}`, evidence: [] }
    } finally {
      clearTimeout(timer)
      ac.abort()
    }
    // A timed-out case is stopped: its processes killed, then a short wait for its own code to notice the abort.
    for (const pid of pids) killTree(pid)
    await Promise.race([work.catch(() => {}), new Promise((r) => setTimeout(r, 5000))])
    // Only an explicit PASS is a PASS.
    if (!row || row.verdict !== 'PASS') row = { ...(row ?? {}), verdict: 'FAIL', why: row?.why || 'the case returned no verdict' }
    let tokens = 0
    try {
      tokens = caseTokens()
    } catch { /* no calls.csv */ }
    used += tokens
    for (const pid of pids) killTree(pid)
    let logs = null
    if (row.verdict !== 'PASS' && logsDir && files.length) {
      logs = join(logsDir, c.id)
      mkdirSync(logs, { recursive: true })
      for (const fn of files) {
        let list = []
        try {
          list = fn()
        } catch { /* the sandbox was never made */ }
        for (const f of list) if (existsSync(f)) cpSync(f, join(logs, basename(f)))
      }
    }
    const kept = []
    for (const p of sandboxes) {
      if (keep) {
        kept.push(p.root)
        continue
      }
      try {
        p.cleanup()
      } catch {
        kept.push(`${p.root} (could not be removed)`)
      }
    }
    const out = { id: c.id, title: c.title, plan: c.plan, verdict: row.verdict, why: row.why ?? '', evidence: row.evidence ?? [], seconds: Math.round((Date.now() - t0) / 1000), tokens, kept, logs }
    log(`VALIDATE: ${c.id} ${out.verdict} (${out.seconds} s) — ${out.why}`)
    rows.push(out)
  }
  return rows
}
