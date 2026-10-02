/**
 * Name/slug similarity check for plans/ - shared by Claude Code and Cursor.
 *
 * Compares an incoming plan name (or proposed filename) against existing
 * plans/ tree (*.plan.md) filenames + H1 / YAML name titles, plus plan
 * headings in the last two `.claude/todo-archive/NNN.md` volumes.
 * Token overlap only - no body-text matching.
 *
 * Usage:
 *   node scripts/plan-name-similarity.mjs --name="Project Memory Bank"
 *   node scripts/plan-name-similarity.mjs --file=plans/290-project-memory-bank.plan.md
 *   node scripts/plan-name-similarity.mjs --name="foo" --exclude=plans/290-foo.plan.md
 *   node scripts/plan-name-similarity.mjs --name="foo" --json
 *
 * Exit: 0 always (advisory). Hits printed to stdout; empty hits = safe to save new.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { resolve, dirname, join, relative, basename } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const plansDir = join(repoRoot, 'plans')
const archiveDir = join(repoRoot, '.claude', 'todo-archive')

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'via', 'with',
  'plan', 'brief', 'fix', 'add', 'update', 'remove', 'refactor', 'r'
])

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/)
    if (!m) return [arg, true]
    return [m[1], m[2] ?? true]
  })
)

function usage() {
  console.error(
    'Usage: node scripts/plan-name-similarity.mjs --name="Title" | --file=plans/NNN-slug.plan.md [--exclude=path] [--json] [--min-score=0.8]'
  )
}

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

/** Last two numbered archive volumes (NNN.md), newest last. */
function listLastArchiveVolumes(limit = 2) {
  if (!existsSync(archiveDir)) return []
  return readdirSync(archiveDir)
    .filter(name => /^\d{3}\.md$/.test(name))
    .map(name => ({ name, n: Number(name.slice(0, 3)), path: join(archiveDir, name) }))
    .sort((a, b) => a.n - b.n)
    .slice(-limit)
}

/** Strip NNN / NNN-R prefix and .plan.md; keep slug tokens. */
function slugFromFilename(name) {
  const base = basename(name).replace(/\.plan\.md$/i, '')
  return base.replace(/^\d{3}(?:-R)?-/i, '')
}

function titleFromPlan(text, slug) {
  const yamlName = text.match(/^name:\s*(.+)$/m)
  if (yamlName) return yamlName[1].trim()
  // Em-dash / en-dash / hyphen / colon after "Plan NNN"
  const m = text.match(/^#\s+Plan\s+\d{3}(?:-R)?\s*[\u2014\u2013\-:]\s*(.+)$/m)
  if (m) {
    return m[1].replace(/\(`.+?`\)\s*$/, '').replace(/\([^)]*\)\s*$/, '').trim()
  }
  const h1 = text.match(/^#\s+(.+)$/m)
  if (h1 && !/^(goal|overview|problem|atomic)/i.test(h1[1])) return h1[1].trim()
  return slug.replace(/-/g, ' ')
}

/** Title from a todo/archive `### Plan NNN — Title` heading line. */
function titleFromArchiveHeading(heading) {
  const m = heading.match(
    /^###\s+Plan\s+\d{3}(?:-R)?(?:\s*\+\s*\d{3})?\s*[\u2014\u2013\-:]\s*(.+)$/i
  )
  if (!m) return heading.replace(/^###\s+/, '').trim()
  return m[1]
    .replace(/\(`.+?`\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[`"'()[\]{}]/g, ' ')
    .split(/[^a-z0-9\u0590-\u05ff]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t))
}

function scoreOverlap(queryTokens, candidateTokens) {
  if (!queryTokens.length || !candidateTokens.length) return 0
  const cand = new Set(candidateTokens)
  const uniqueHits = [...new Set(queryTokens.filter(t => cand.has(t)))]
  return uniqueHits.length / queryTokens.length
}

function shortExcerpt(text, max = 120) {
  const line = text
    .split('\n')
    .map(l => l.trim())
    .find(l => l && !l.startsWith('#') && !l.startsWith('---') && !l.startsWith('- ['))
  if (!line) return ''
  return line.length > max ? `${line.slice(0, max - 1)}...` : line
}

function resolveInputName() {
  if (args.name && args.name !== true) return String(args.name)
  if (args.file && args.file !== true) {
    const full = resolve(repoRoot, String(args.file))
    const fromName = slugFromFilename(full).replace(/-/g, ' ')
    if (existsSync(full)) {
      try {
        const h1 = titleFromPlan(readFileSync(full, 'utf8'), slugFromFilename(full))
        if (h1) return h1
      } catch { /* fall through */ }
    }
    return fromName
  }
  return null
}

function considerHit(hits, { path, title, body, qTokens, qOnly, minScore, source }) {
  const candTokens = [...new Set([...tokenize(title)])]
  const score = Math.max(
    scoreOverlap(qTokens, candTokens),
    scoreOverlap(qOnly.length ? qOnly : qTokens, candTokens)
  )
  const uniqueShared = [...new Set(qTokens.filter(t => candTokens.includes(t)))]
  if (score < minScore) return
  if (qTokens.length >= 2 && uniqueShared.length < 2) return
  hits.push({
    path,
    title,
    source,
    score: Math.round(score * 100) / 100,
    why: uniqueShared.length
      ? `similar because name shares: ${uniqueShared.join(', ')}`
      : `name/slug overlap (score ${score.toFixed(2)})`,
    excerpt: shortExcerpt(body)
  })
}

const inputName = resolveInputName()
if (!inputName) {
  usage()
  process.exit(0)
}

// Default 0.8 = strong name match (e.g. 3/4 tokens). Avoids flooding on shared domain words.
const minScore = Number(args['min-score'] ?? 0.8)
const excludeRaw = args.exclude && args.exclude !== true ? String(args.exclude) : null
const excludeFull = excludeRaw ? resolve(repoRoot, excludeRaw) : null

const queryTokens = tokenize(inputName)
const queryFromSlug = tokenize(slugFromFilename(inputName.replace(/\s+/g, '-') + '.plan.md'))
const qTokens = [...new Set([...queryTokens, ...queryFromSlug])]
const qOnly = tokenize(inputName)

const hits = []
for (const full of listPlanFiles(plansDir)) {
  if (excludeFull && resolve(full) === excludeFull) continue
  let body = ''
  try {
    body = readFileSync(full, 'utf8')
  } catch {
    continue
  }
  const rel = relative(repoRoot, full).replace(/\\/g, '/')
  const slug = slugFromFilename(full)
  const title = titleFromPlan(body, slug)
  const candTokens = [...new Set([...tokenize(slug.replace(/-/g, ' ')), ...tokenize(title)])]
  const score = Math.max(
    scoreOverlap(qTokens, candTokens),
    scoreOverlap(qOnly.length ? qOnly : qTokens, candTokens)
  )
  const uniqueShared = [...new Set(qTokens.filter(t => candTokens.includes(t)))]
  if (score < minScore) continue
  if (qTokens.length >= 2 && uniqueShared.length < 2) continue
  hits.push({
    path: rel,
    title,
    source: 'plans',
    score: Math.round(score * 100) / 100,
    why: uniqueShared.length
      ? `similar because name shares: ${uniqueShared.join(', ')}`
      : `name/slug overlap (score ${score.toFixed(2)})`,
    excerpt: shortExcerpt(body)
  })
}

// Last two archive volumes — heading titles only (Plan 292)
for (const vol of listLastArchiveVolumes(2)) {
  let body = ''
  try {
    body = readFileSync(vol.path, 'utf8')
  } catch {
    continue
  }
  const rel = relative(repoRoot, vol.path).replace(/\\/g, '/')
  const headings = body.split(/\r?\n/).filter(l => /^### Plan\b/.test(l))
  for (const heading of headings) {
    const title = titleFromArchiveHeading(heading)
    const idx = body.indexOf(heading)
    const rest = idx >= 0 ? body.slice(idx) : heading
    const nextBreak = rest.search(/\n(?=### Plan\b)/)
    const section = nextBreak > 0 ? rest.slice(0, nextBreak) : rest.slice(0, 400)
    considerHit(hits, {
      path: rel,
      title: title || heading,
      body: section,
      qTokens,
      qOnly,
      minScore,
      source: 'todo-archive'
    })
  }
}

hits.sort((a, b) => b.score - a.score)

const archiveVolumesScanned = listLastArchiveVolumes(2).map(v => v.name)

const payload = {
  query: inputName,
  tokens: qTokens,
  minScore,
  archiveVolumesScanned,
  hitCount: hits.length,
  hits: hits.slice(0, 8)
}

if (args.json) {
  console.log(JSON.stringify(payload, null, 2))
} else if (hits.length === 0) {
  console.log(`PLAN_SIMILARITY: no similar plans for "${inputName}" - safe to save as new.`)
  if (archiveVolumesScanned.length) {
    console.log(`  (also scanned archive volumes: ${archiveVolumesScanned.join(', ')})`)
  }
} else {
  console.log(`PLAN_SIMILARITY: ${hits.length} similar plan(s) for "${inputName}" - confirm with Human before write.`)
  for (const h of hits.slice(0, 8)) {
    const ex = h.excerpt ? ` | ${h.excerpt}` : ''
    const src = h.source === 'todo-archive' ? ' [archive]' : ''
    console.log(`- ${h.path}${src}`)
    console.log(`  title: ${h.title}`)
    console.log(`  why: ${h.why} (score ${h.score})${ex}`)
  }
  console.log('Ask Human: rewrite existing / save as new / cancel')
}

process.exit(0)
