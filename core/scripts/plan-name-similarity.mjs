/**
 * Name/slug similarity check for plans/ - shared by Claude Code and Cursor.
 *
 * Compares an incoming plan name (or proposed filename) against existing
 * plans/ tree (*.plan.md, open and closed) filenames + H1 / YAML name titles, plus plan
 * headings in the last two `.claude/todo-archive/NNN.md` volumes.
 * Words are compared by their stem: "favourites", "favorite" and "favorited" are one word,
 * "recipes" and "recipe" too.
 *
 * --related (the Architect + PM review's overlap check) also searches the full text of every
 * plan, open and closed: a plan whose text holds the name's words - its rare words weigh most -
 * is listed under PLAN_RELATED. --scope="glob,glob" (or the scope block of --file) lists the
 * open plans whose Read-Write Scope shares a file or folder with those globs (PLAN_SCOPE_OVERLAP).
 *
 * Usage:
 *   node scripts/plan-name-similarity.mjs --name="Project Memory Bank"
 *   node scripts/plan-name-similarity.mjs --file=plans/290-project-memory-bank.plan.md
 *   node scripts/plan-name-similarity.mjs --name="foo" --exclude=plans/290-foo.plan.md
 *   node scripts/plan-name-similarity.mjs --name="foo" --json
 *   node scripts/plan-name-similarity.mjs --name="foo" --related --scope="src/app/foo/**,server/routes/foo.js"
 *
 * Exit: 0 always (advisory). Hits printed to stdout; empty title hits = safe to save new.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { resolve, dirname, join, relative, basename } from 'path'
import { fileURLToPath } from 'url'
import { isOpenPlanPath, listOpenPlans } from './lib/plan-paths.mjs'
import { extractScopeGlobs } from './lib/plan-scope.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const plansDir = join(repoRoot, 'plans')
const archiveDir = join(repoRoot, '.claude', 'todo-archive')

const STOP_WORDS = [
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'via', 'with', 'as', 'is', 'by', 'at', 'from', 'into',
  'plan', 'brief', 'fix', 'add', 'update', 'remove', 'refactor', 'r'
]

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/)
    if (!m) return [arg, true]
    return [m[1], m[2] ?? true]
  })
)

function usage() {
  console.error(
    'Usage: node scripts/plan-name-similarity.mjs --name="Title" | --file=plans/NNN-slug.plan.md [--exclude=path] [--json] [--min-score=0.8] [--related] [--scope="glob,glob"]'
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
  const m = text.match(/^#\s+Plan\s+\d{3}(?:-R)?\s*[—–\-:]\s*(.+)$/m)
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
    /^###\s+Plan\s+\d{3}(?:-R)?(?:\s*\+\s*\d{3})?\s*[—–\-:]\s*(.+)$/i
  )
  if (!m) return heading.replace(/^###\s+/, '').trim()
  return m[1]
    .replace(/\(`.+?`\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * One stem per spelling and word form, so a title and a request that word the same thing differently still meet:
 * British "-our" -> "-or" (favourite/favorite, colour/color), plural and -ing/-ed endings, a final "e"
 * (recipes/recipe -> recip, favorites/favorited -> favorit, shopping -> shop). Crude on purpose: both sides are
 * stemmed the same way, so only the match matters, not the stem.
 */
function stem(word) {
  let s = word
  if (s.length <= 3 || /[^a-z0-9]/.test(s)) return s
  if (s.length >= 6) s = s.replace(/our(?=(?:ite|ites|ed|ing|s)?$)/, 'or')
  if (s.length > 4 && s.endsWith('ies')) s = `${s.slice(0, -3)}y`
  else if (/(?:x|ch|sh|ss|z)es$/.test(s)) s = s.slice(0, -2)
  else if (s.length > 3 && s.endsWith('s') && !/(?:ss|us|is)$/.test(s)) s = s.slice(0, -1)
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3)
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2)
  if (/([bdgmnprt])\1$/.test(s)) s = s.slice(0, -1)
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1)
  return s
}

const STOP = new Set([...STOP_WORDS, ...STOP_WORDS.map(stem)])

function tokenize(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[`"'()[\]{}]/g, ' ')
    .split(/[^a-z0-9֐-׿]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t))
    .map(stem)
    .filter(t => !STOP.has(t))
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

/** The first body line that holds `token` (a stem), shortened. */
function lineWith(text, token, max = 120) {
  const line = text
    .split('\n')
    .map(l => l.trim())
    .find(l => l && !l.startsWith('#') && tokenize(l).includes(token))
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

// --- globs: does one plan's scope share a file or folder with another's? -------------------------
const isGlob = (g) => /[*?[\]{}]/.test(g)
const globBase = (g) => g.split('/').filter((part, i, all) => !all.slice(0, i + 1).some(isGlob)).join('/')
function globRe(g) {
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*' && g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++ }
    else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}
const norm = (g) => g.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '/**')
/** True when the two scope globs can name the same file. */
function globsMeet(a, b) {
  const [x, y] = [norm(a), norm(b)]
  if (x === y) return true
  if (!isGlob(x) && globRe(y).test(x)) return true
  if (!isGlob(y) && globRe(x).test(y)) return true
  if (isGlob(x) && isGlob(y)) {
    const [bx, by] = [globBase(x), globBase(y)]
    return bx === by || bx.startsWith(`${by}/`) || by.startsWith(`${bx}/`) || !bx || !by
  }
  return false
}

const inputName = resolveInputName()
if (!inputName) {
  usage()
  process.exit(0)
}

// Default 0.8 = strong name match (e.g. 3/4 tokens). Avoids flooding on shared domain words.
const minScore = Number(args['min-score'] ?? 0.8)
const relatedMin = Number(args['related-min-score'] ?? 0.75)
const excludeRaw = args.exclude && args.exclude !== true ? String(args.exclude) : null
const excludeFull = excludeRaw ? resolve(repoRoot, excludeRaw) : null
const inputFile = args.file && args.file !== true ? resolve(repoRoot, String(args.file)) : null

const queryTokens = tokenize(inputName)
const queryFromSlug = tokenize(slugFromFilename(inputName.replace(/\s+/g, '-') + '.plan.md'))
const qTokens = [...new Set([...queryTokens, ...queryFromSlug])]
const qOnly = tokenize(inputName)

const hits = []
const docs = [] // every plan's text, for --related
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
  if (!inputFile || resolve(full) !== inputFile) docs.push({ rel, title, body })
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

// Last two archive volumes — heading titles only
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

// --related: the plans whose full text holds the name's words. A word few plans use weighs more than one most
// plans use (inverse document frequency), so "favourite" in "favourite recipes filter" decides, not "recipe".
const related = []
if (args.related) {
  const qset = [...new Set(qOnly.length ? qOnly : qTokens)]
  const counted = docs.map(d => {
    const tf = new Map()
    for (const t of tokenize(d.body)) tf.set(t, (tf.get(t) ?? 0) + 1)
    return { ...d, tf }
  })
  const N = counted.length
  const idf = new Map(qset.map(t => [t, Math.log((N + 1) / (counted.filter(d => d.tf.has(t)).length + 0.5))]))
  const total = qset.reduce((s, t) => s + idf.get(t), 0)
  const titled = new Set(hits.map(h => h.path))
  for (const d of counted) {
    if (titled.has(d.rel) || !total) continue
    const shared = qset.filter(t => d.tf.has(t))
    if (shared.length < Math.min(2, qset.length)) continue
    const coverage = shared.reduce((s, t) => s + idf.get(t), 0) / total
    if (coverage < relatedMin) continue
    const weight = shared.reduce((s, t) => s + idf.get(t) * Math.log(1 + d.tf.get(t)), 0)
    const rarest = [...shared].sort((a, b) => idf.get(b) - idf.get(a))[0]
    related.push({
      path: d.rel,
      title: d.title,
      state: isOpenPlanPath(d.rel) ? 'open' : 'closed',
      coverage: Math.round(coverage * 100) / 100,
      weight,
      shared,
      excerpt: lineWith(d.body, rarest)
    })
  }
  related.sort((a, b) => b.coverage - a.coverage || b.weight - a.weight)
}

// --scope / the scope block of --file: open plans whose Read-Write Scope shares a file or folder with it.
let scopeGlobs = null
if (args.scope && args.scope !== true) scopeGlobs = String(args.scope).split(',').map(s => s.trim()).filter(Boolean)
else if (inputFile && existsSync(inputFile)) scopeGlobs = extractScopeGlobs(readFileSync(inputFile, 'utf8'))
const scopeOverlap = []
if (scopeGlobs?.length) {
  for (const rel of listOpenPlans(repoRoot)) {
    const full = join(repoRoot, rel)
    if ((inputFile && resolve(full) === inputFile) || (excludeFull && resolve(full) === excludeFull)) continue
    const text = readFileSync(full, 'utf8')
    const theirs = extractScopeGlobs(text) ?? []
    const pairs = []
    for (const mine of scopeGlobs) for (const other of theirs) if (globsMeet(mine, other)) pairs.push(mine === other ? mine : `${mine} ~ ${other}`)
    if (pairs.length) {
      const status = (text.match(/^Status:\s*(\S+)/m) || [])[1] ?? 'unknown'
      scopeOverlap.push({ path: rel, title: titleFromPlan(text, slugFromFilename(rel)), status, shared: [...new Set(pairs)] })
    }
  }
}

const archiveVolumesScanned = listLastArchiveVolumes(2).map(v => v.name)

const payload = {
  query: inputName,
  tokens: qTokens,
  minScore,
  archiveVolumesScanned,
  plansScanned: docs.length,
  hitCount: hits.length,
  hits: hits.slice(0, 8),
  ...(args.related ? { related: related.slice(0, 5).map(({ weight, ...r }) => r) } : {}),
  ...(scopeGlobs ? { scope: scopeGlobs, scopeOverlap } : {})
}

if (args.json) {
  console.log(JSON.stringify(payload, null, 2))
  process.exit(0)
}
if (hits.length === 0) {
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
if (args.related) {
  if (!related.length) console.log(`PLAN_RELATED: none - no other plan's text covers "${inputName}" (${docs.length} plans searched).`)
  else {
    console.log(`PLAN_RELATED: ${related.length} plan(s) whose text covers "${inputName}"${related.length > 5 ? ' (the 5 closest below)' : ''} - check each is not the same work:`)
    for (const r of related.slice(0, 5)) {
      console.log(`- ${r.path} (${r.state})`)
      console.log(`  title: ${r.title}`)
      console.log(`  why: text has ${r.shared.join(', ')} (coverage ${r.coverage})${r.excerpt ? ` | ${r.excerpt}` : ''}`)
    }
  }
}
if (scopeGlobs) {
  if (!scopeOverlap.length) console.log('PLAN_SCOPE_OVERLAP: none - no open plan\'s Read-Write Scope shares a file with this scope.')
  else {
    console.log(`PLAN_SCOPE_OVERLAP: ${scopeOverlap.length} open plan(s) share files with this scope:`)
    for (const o of scopeOverlap) {
      const more = o.shared.length > 4 ? ` (+${o.shared.length - 4} more)` : ''
      console.log(`- ${o.path} (Status: ${o.status}) — ${o.title}: ${o.shared.slice(0, 4).join(', ')}${more}`)
    }
  }
}

process.exit(0)
