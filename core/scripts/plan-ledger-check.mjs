/**
 * Ledger integrity check for plans/ vs .claude/todo.md + session briefs.
 *
 * Hard failure (exit 1): any plans/*.plan.md path referenced in todo.md Plan
 * sections or brief Parent plan lines that does not resolve on disk.
 * Advisory (exit 0 if no hard failures): duplicate NNN prefixes, unnumbered
 * / legacy stray filenames under plans/.
 *
 * Usage:
 *   node scripts/plan-ledger-check.mjs
 *   node scripts/plan-ledger-check.mjs --json
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { resolve, dirname, join, relative, basename } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const plansDir = join(repoRoot, 'plans')
const todoPath = join(repoRoot, '.claude', 'todo.md')
const sessionsDir = join(repoRoot, '.claude', 'sessions')

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/)
    if (!m) return [arg, true]
    return [m[1], m[2] ?? true]
  })
)

const PLAN_PATH_RE = /plans\/(?:[\w./-]+\/)?[\w.-]+\.plan\.md/g
const CANONICAL_NAME_RE = /^\d{3}(?:-R)?-.+\.plan\.md$/i
const NNN_PREFIX_RE = /^(\d{3})(?:-R)?-/i

function listPlanFiles(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listPlanFiles(full))
    else if (entry.endsWith('.plan.md')) out.push(full)
  }
  return out
}

function listBriefFiles(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listBriefFiles(full))
    else if (entry === 'brief.md') out.push(full)
  }
  return out
}

/** Normalize a plans/… path to repo-relative forward-slash form. */
function normalizePlanRef(raw) {
  return String(raw)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
}

/**
 * Resolve a plans/… ref. Prefer the exact path; if missing, search recursively
 * under plans/ by basename (covers plans/1-100/, plans/100-200/, etc.).
 */
function resolvePlanRef(ref, planFilesByBase) {
  const norm = normalizePlanRef(ref)
  const abs = join(repoRoot, ...norm.split('/'))
  if (existsSync(abs)) return { norm, abs, exists: true, resolved: norm }

  const base = basename(norm)
  const alt = planFilesByBase.get(base)
  if (alt) {
    const resolved = relative(repoRoot, alt).replace(/\\/g, '/')
    return { norm, abs: alt, exists: true, resolved }
  }
  return { norm, abs, exists: false, resolved: null }
}

/**
 * Split todo.md into ### Plan NNN sections; collect every plans/*.plan.md ref
 * under each section (heading + body).
 */
function collectTodoPlanRefs(todoText) {
  const lines = todoText.split(/\r?\n/)
  const refs = []
  let currentHeading = null
  let sectionStart = -1

  const flush = (endLine) => {
    if (!currentHeading || sectionStart < 0) return
    const section = lines.slice(sectionStart, endLine).join('\n')
    const matches = section.match(PLAN_PATH_RE) || []
    for (const raw of matches) {
      refs.push({
        source: 'todo.md',
        heading: currentHeading,
        path: normalizePlanRef(raw)
      })
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^###\s+Plan\b/i.test(line)) {
      flush(i)
      currentHeading = line.replace(/^###\s+/, '').trim()
      sectionStart = i
    }
  }
  flush(lines.length)

  // Dedupe by path+heading while preserving first occurrence order
  const seen = new Set()
  const out = []
  for (const r of refs) {
    const key = `${r.heading}::${r.path}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

function collectBriefParentRefs(briefFiles) {
  const refs = []
  for (const file of briefFiles) {
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const rel = relative(repoRoot, file).replace(/\\/g, '/')
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (!/^##\s+Parent plan\b/i.test(lines[i])) continue
      // Value may be same line after heading, or the next non-empty line
      let value = lines[i].replace(/^##\s+Parent plan\s*:?\s*/i, '').trim()
      if (!value) {
        for (let j = i + 1; j < lines.length; j++) {
          const next = lines[j].trim()
          if (!next) continue
          if (/^##\s+/.test(next)) break
          value = next
          break
        }
      }
      value = value.replace(/^`+|`+$/g, '').trim()
      if (!value) continue
      if (/^none\b/i.test(value) || /\(ad-hoc\)/i.test(value)) continue
      const planMatch = value.match(PLAN_PATH_RE)
      if (planMatch) {
        for (const raw of planMatch) {
          refs.push({ source: rel, heading: 'Parent plan', path: normalizePlanRef(raw) })
        }
      } else if (value.includes('plans/') || value.endsWith('.plan.md')) {
        refs.push({ source: rel, heading: 'Parent plan', path: normalizePlanRef(value) })
      }
    }
  }
  return refs
}

function findDuplicatesAndStrays(planFiles) {
  const byNnn = new Map()
  const strays = []

  for (const full of planFiles) {
    const name = basename(full)
    const rel = relative(repoRoot, full).replace(/\\/g, '/')
    if (!CANONICAL_NAME_RE.test(name)) {
      strays.push(rel)
      continue
    }
    const m = name.match(NNN_PREFIX_RE)
    if (!m) {
      strays.push(rel)
      continue
    }
    const nnn = m[1]
    if (!byNnn.has(nnn)) byNnn.set(nnn, [])
    byNnn.get(nnn).push(rel)
  }

  const duplicates = [...byNnn.entries()]
    .filter(([, files]) => files.length >= 2)
    .map(([nnn, files]) => ({ nnn, files: files.sort() }))
    .sort((a, b) => Number(a.nnn) - Number(b.nnn))

  return { duplicates, strays: strays.sort() }
}

// --- main ---

if (!existsSync(todoPath)) {
  console.error('PLAN_LEDGER: .claude/todo.md not found')
  process.exit(1)
}

const todoText = readFileSync(todoPath, 'utf8')
const todoRefs = collectTodoPlanRefs(todoText)
const briefRefs = collectBriefParentRefs(listBriefFiles(sessionsDir))
const allRefs = [...todoRefs, ...briefRefs]

const planFiles = listPlanFiles(plansDir)
const planFilesByBase = new Map()
for (const full of planFiles) {
  const base = basename(full)
  // First wins; duplicates by basename are rare and flagged separately via NNN
  if (!planFilesByBase.has(base)) planFilesByBase.set(base, full)
}

const missing = []
const checked = []
const seenPath = new Set()

for (const ref of allRefs) {
  const { norm, exists, resolved } = resolvePlanRef(ref.path, planFilesByBase)
  checked.push({ ...ref, path: norm, exists, resolved })
  if (!exists) {
    missing.push({ ...ref, path: norm })
  }
  seenPath.add(norm)
}

const { duplicates, strays } = findDuplicatesAndStrays(planFiles)

const payload = {
  missingCount: missing.length,
  missing,
  checkedCount: checked.length,
  uniquePathsChecked: seenPath.size,
  duplicateNnnCount: duplicates.length,
  duplicates,
  strayCount: strays.length,
  strays,
  hardFailure: missing.length > 0
}

if (args.json) {
  console.log(JSON.stringify(payload, null, 2))
} else {
  console.log('PLAN_LEDGER: integrity check')
  console.log(`  refs checked: ${checked.length} (${seenPath.size} unique paths)`)
  if (missing.length === 0) {
    console.log('  missing plans: none (hard checks passed)')
  } else {
    console.log(`  missing plans: ${missing.length} (HARD FAILURE)`)
    for (const m of missing) {
      console.log(`  - MISSING ${m.path}`)
      console.log(`      from ${m.source} / ${m.heading}`)
    }
  }

  if (duplicates.length === 0) {
    console.log('  duplicate NNNs: none')
  } else {
    console.log(`  duplicate NNNs: ${duplicates.length} (advisory)`)
    for (const d of duplicates) {
      console.log(`  - NNN ${d.nnn} used by ${d.files.length} files:`)
      for (const f of d.files) console.log(`      ${f}`)
    }
  }

  if (strays.length === 0) {
    console.log('  stray names: none')
  } else {
    console.log(`  stray names: ${strays.length} (advisory)`)
    for (const s of strays) console.log(`  - ${s}`)
  }

  if (payload.hardFailure) {
    console.log('PLAN_LEDGER: FAIL — fix missing plan refs (or reconstruct via save-plan / M7)')
  } else {
    console.log('PLAN_LEDGER: OK — no missing refs (duplicates/strays advisory only)')
  }
}

process.exit(payload.hardFailure ? 1 : 0)
