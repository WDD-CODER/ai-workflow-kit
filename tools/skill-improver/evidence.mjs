/**
 * Evidence (0 tokens): scan local Claude Code transcripts and count, per skill, how it fared.
 * Counts only — no transcript text is stored or printed. Output stays local:
 *   ~/.claude/skill-improver/evidence-<date>.json
 *
 *   node tools/skill-improver/evidence.mjs [--kit <kit root>] [--days 30] [--since <iso>]
 *
 * Signals per skill: fired, corrections (user turns that push back within 3 user turns after it fired),
 * failures (tool errors within 6 events after it fired), shouldHaveFired (user turns with a trigger phrase from the
 * skill description in a session that never called it), sizeBytes (SKILL.md), fired30 (fires in the window).
 */
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve, basename, dirname } from 'path'
import { fileURLToPath } from 'url'
import { stateDir, today, readJson } from './lib/log.mjs'

const CORRECTION = /\b(no[,.! ]|wrong|that'?s not|don'?t|do not|stop|instead|revert|undo|not what i|why did you|actually)\b/i

/** Skills the kit ships: core/.claude/skills/* and every pack's .claude/skills/*. */
export function listSkills(kitRoot) {
  const out = []
  const roots = [join(kitRoot, 'core', '.claude', 'skills')]
  const packs = join(kitRoot, 'packs')
  if (existsSync(packs)) for (const p of readdirSync(packs)) roots.push(join(packs, p, '.claude', 'skills'))
  for (const r of roots) {
    if (!existsSync(r)) continue
    for (const name of readdirSync(r)) {
      const file = join(r, name, 'SKILL.md')
      if (!existsSync(file)) continue
      const md = readFileSync(file, 'utf8')
      out.push({ name, dir: join(r, name), sizeBytes: Buffer.byteLength(md), triggers: triggersOf(md) })
    }
  }
  return out
}

/** Trigger phrases from the description: quoted strings. */
export function triggersOf(md) {
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
  const desc = fm.match(/description:\s*([\s\S]*?)(?:\r?\n\w[\w-]*:|$)/)?.[1] ?? ''
  const found = [...desc.matchAll(/["“']([^"”'\n]{4,60})["”']/g)].map((m) => m[1].toLowerCase())
  return [...new Set(found)]
}

const userText = (e) => {
  if (e.type !== 'user') return null
  const c = e.message?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    const t = c.filter((x) => x.type === 'text').map((x) => x.text).join(' ')
    // Skill bodies are injected as user text; they are not the person talking.
    return t && !t.startsWith('Base directory for this skill') ? t : null
  }
  return null
}

export function scanSession(events, skills, sinceMs, acc) {
  const fired = new Set()
  events.forEach((e, i) => {
    const ts = e.timestamp ? Date.parse(e.timestamp) : Infinity
    const calls = Array.isArray(e.message?.content) ? e.message.content.filter((c) => c.type === 'tool_use' && c.name === 'Skill') : []
    for (const c of calls) {
      const name = String(c.input?.skill ?? '').split(':').pop()
      if (!acc[name]) continue
      fired.add(name)
      acc[name].fired30++
      if (ts < sinceMs) continue
      acc[name].fired++
      let users = 0
      for (let j = i + 1; j < events.length && users < 3; j++) {
        const t = userText(events[j])
        if (t === null) continue
        users++
        if (CORRECTION.test(t.slice(0, 400))) acc[name].corrections++
      }
      for (let j = i + 1; j < Math.min(events.length, i + 7); j++) {
        const r = events[j].message?.content
        if (Array.isArray(r) && r.some((x) => x.type === 'tool_result' && x.is_error)) acc[name].failures++
      }
    }
  })
  for (const e of events) {
    const t = userText(e)
    if (!t || (e.timestamp && Date.parse(e.timestamp) < sinceMs)) continue
    const low = t.toLowerCase()
    for (const s of skills) if (!fired.has(s.name) && s.triggers.some((p) => low.includes(p))) acc[s.name].shouldHaveFired++
  }
}

export function collect({ kitRoot, days = 30, since, projectsDir = process.env.SKILL_IMPROVER_PROJECTS || join(homedir(), '.claude', 'projects') }) {
  const skills = listSkills(kitRoot)
  const acc = Object.fromEntries(
    skills.map((s) => [s.name, { fired: 0, fired30: 0, corrections: 0, failures: 0, shouldHaveFired: 0, sizeBytes: s.sizeBytes }]),
  )
  const windowMs = Date.now() - days * 86400000
  const sinceMs = Math.max(since ? Date.parse(since) : 0, windowMs)
  let sessions = 0
  if (existsSync(projectsDir)) {
    for (const proj of readdirSync(projectsDir)) {
      const pd = join(projectsDir, proj)
      if (!statSync(pd).isDirectory()) continue
      for (const f of readdirSync(pd).filter((x) => x.endsWith('.jsonl'))) {
        const fp = join(pd, f)
        let raw
        try {
          if (statSync(fp).mtimeMs < windowMs) continue
          raw = readFileSync(fp, 'utf8')
        } catch {
          continue // a live session file can vanish or be locked mid-scan
        }
        const events = []
        for (const line of raw.split('\n')) {
          if (!line) continue
          try {
            events.push(JSON.parse(line))
          } catch {}
        }
        sessions++
        scanSession(events, skills, sinceMs, acc)
      }
    }
  }
  for (const a of Object.values(acc)) a.score = a.corrections * 3 + a.failures + Math.min(a.shouldHaveFired, 20) * 2 + Math.round(a.sizeBytes / 5000)
  return { date: today(), sessions, skills: acc }
}

/** Write the evidence file and return it. */
export function writeEvidence(opts) {
  const ev = collect(opts)
  const file = join(stateDir(), `evidence-${ev.date}.json`)
  writeFileSync(file, JSON.stringify(ev, null, 2))
  return { ev, file }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
  const kitRoot = resolve(arg('--kit', join(dirname(fileURLToPath(import.meta.url)), '..', '..')))
  const state = readJson(join(stateDir(), 'state.json'), {})
  const { ev, file } = writeEvidence({ kitRoot, days: Number(arg('--days', 30)), since: arg('--since', state.lastRun) })
  console.log(`SKILL_IMPROVER: evidence ${basename(file)} (${ev.sessions} sessions, ${Object.keys(ev.skills).length} skills)`)
}
