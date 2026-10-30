/**
 * Workflow scout — turns the scout's findings (a JSON report the model writes) into one self-contained HTML page and
 * updates the scout's state. The model never writes HTML: this script fills the fixed page-template.html.
 *
 *   node scripts/scout/render.mjs --report <file.json> [--root <dir>] [--date YYYY-MM-DD]
 *
 * Reads  docs/scout/sources.json (caps) and docs/scout/state.json (last Claude Code version, cursors).
 * Writes docs/scout/<date>.html and docs/scout/state.json — only when the report has something new.
 * Prints one line: `SCOUT: page docs/scout/<date>.html (<n> items)` or `SCOUT: nothing new since <version>`,
 * plus `SCOUT: budget reached` when a cap cut the report.
 * Exit 0 = page written or nothing new, 2 = report refused (the reason on stderr; nothing written).
 * Node built-ins only.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const CATEGORIES = ['Adopt', 'Improve', 'Remove', 'Security', 'Parked']
export const EFFORTS = ['S', 'M', 'L']
export const DEFAULT_CAPS = { maxSources: 10, maxItemsPerSource: 8, maxItems: 25, topN: 5 }

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const isHttpUrl = (u) => /^https?:\/\/[^\s"'<>]+$/.test(String(u ?? ''))
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length
const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max

/**
 * What must never reach a public page or pull request: secrets, `.env` lines, machine paths, transcript text.
 * Returns the first reason, or null.
 */
export function privacyProblem(text) {
  const t = String(text ?? '')
  const checks = [
    ['an AWS access key', /AKIA[0-9A-Z]{16}/],
    ['an API key or token', /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{16,}/i],
    ['a bearer token', /Bearer\s+[A-Za-z0-9\-_.]{20,}/],
    ['a private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
    ['an Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{10,}/],
    // A setting such as SOME_TIMEOUT_MS=600000 is fine; a long secret-looking value is not.
    ['a .env line', /\b[A-Z][A-Z0-9_]{2,}=['"]?[A-Za-z0-9_\-/+]{20,}/],
    ['a machine path', /[A-Za-z]:[\\/]+Users[\\/]+\w|\/(?:Users|home)\/[a-z][\w.-]*\//],
    ['transcript text', /"role"\s*:\s*"(?:user|assistant)"|^(?:Human|Assistant):\s/m],
  ]
  for (const [why, re] of checks) if (re.test(t)) return `it contains ${why}`
  return null
}

/** The first problem with one item, or null. */
function itemProblem(it, i) {
  const at = `items[${i}]`
  if (!it || typeof it !== 'object') return `${at} is not an object`
  if (!CATEGORIES.includes(it.category)) return `${at}.category must be one of ${CATEGORIES.join(', ')}`
  if (!str(it.headline, 80) || words(it.headline) > 8) return `${at}.headline must be 1-8 words`
  if (!str(it.hook, 200)) return `${at}.hook must be one line (up to 200 characters)`
  if (!str(it.why, 400)) return `${at}.why must say what it does for this project (up to 400 characters)`
  if (!str(it.file, 200) || /^[\\/]|^[A-Za-z]:|(^|[\\/])\.\.([\\/]|$)/.test(it.file)) return `${at}.file must be a project-relative path`
  if (!EFFORTS.includes(it.effort)) return `${at}.effort must be S, M or L`
  if (!it.source || !str(it.source.name, 100) || !isHttpUrl(it.source.url)) return `${at}.source needs a name and an http(s) url`
  if (it.replaces !== undefined && !str(it.replaces, 120)) return `${at}.replaces must name the custom part it replaces`
  if (it.community !== undefined) {
    const c = it.community
    if (!c || !str(c.license, 40) || !Number.isInteger(c.stars) || c.stars < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(String(c.lastCommit))) {
      return `${at}.community needs license, stars (a whole number) and lastCommit (YYYY-MM-DD)`
    }
  }
  return null
}

/**
 * Checks a report and applies the caps. Returns { report, budgetReached } or throws an Error with the reason.
 * Report: { date, claudeCode: { from, to }, budgetReached?, sources: [{ id, cursor?, items?, note? }], items: [...] }
 */
export function validateReport(raw, caps = DEFAULT_CAPS) {
  if (!raw || typeof raw !== 'object') throw new Error('the report is not a JSON object')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.date))) throw new Error('date must be YYYY-MM-DD')
  if (!raw.claudeCode || !str(String(raw.claudeCode.to ?? ''), 40)) throw new Error('claudeCode.to (the newest Claude Code version seen) is required')
  if (!Array.isArray(raw.items)) throw new Error('items must be an array')
  if (!Array.isArray(raw.sources)) throw new Error('sources must be an array')
  for (const [i, s] of raw.sources.entries()) if (!s || !str(s.id, 80)) throw new Error(`sources[${i}].id is required`)
  for (const [i, it] of raw.items.entries()) {
    const why = itemProblem(it, i)
    if (why) throw new Error(why)
  }
  const c = { ...DEFAULT_CAPS, ...(caps ?? {}) }
  let budgetReached = raw.budgetReached === true
  let sources = raw.sources
  if (sources.length > c.maxSources) {
    sources = sources.slice(0, c.maxSources)
    budgetReached = true
  }
  let items = raw.items
  if (items.length > c.maxItems) {
    items = items.slice(0, c.maxItems)
    budgetReached = true
  }
  return { report: { ...raw, sources, items, budgetReached }, budgetReached }
}

/**
 * Splits the items into the page's sections. The report lists items most-worth-adopting first. Every
 * "native feature replaces your custom part" item gets a callout, also when it is in the top list.
 */
export function sections(items, topN = DEFAULT_CAPS.topN) {
  const active = items.filter((it) => it.category !== 'Parked')
  const top = active.slice(0, topN)
  const rest = items.filter((it) => !top.includes(it))
  return {
    top,
    replaces: items.filter((it) => it.replaces),
    community: rest.filter((it) => it.community && !it.replaces),
    also: rest.filter((it) => !it.replaces && !it.community),
  }
}

const esc = escapeHtml
const sourceLink = (it) => `<a href="${esc(it.source.url)}" rel="noopener">${esc(it.source.name)}</a>`
const tag = (it) => `<span class="tag tag-${esc(it.category.toLowerCase())}">${esc(it.category)}</span>`

function heroCard(it, n) {
  const c =
    (it.replaces ? `<p class="meta">Native now — replaces your custom ${esc(it.replaces)}</p>` : '') +
    (it.community ? `<p class="meta">${communityMeta(it.community)}</p>` : '')
  return `<article class="hero">
  <div class="rank">${n}</div>
  <div>
    ${tag(it)} <span class="effort" title="effort">${esc(it.effort)}</span>
    <h3>${esc(it.headline)}</h3>
    <p class="hook">${esc(it.hook)}</p>
    <p>${esc(it.why)}</p>
    <p class="file">Touches <code>${esc(it.file)}</code> · ${sourceLink(it)}</p>
    ${c}
  </div>
</article>`
}

const communityMeta = (c) => `${esc(c.license)} · ★ ${esc(c.stars.toLocaleString('en-US'))} · last commit ${esc(c.lastCommit)}`

function callout(it) {
  return `<article class="callout">
  <h3>Native now: ${esc(it.headline)}</h3>
  <p>Replaces your custom <strong>${esc(it.replaces)}</strong>. ${esc(it.hook)}</p>
  <p class="file">Touches <code>${esc(it.file)}</code> · ${sourceLink(it)}</p>
</article>`
}

function pick(it) {
  return `<article class="pick">
  <h3>${esc(it.headline)}</h3>
  <p class="meta">${communityMeta(it.community)}</p>
  <p>${esc(it.hook)}</p>
  <p class="file">Touches <code>${esc(it.file)}</code> · ${sourceLink(it)}</p>
</article>`
}

const alsoRow = (it) => `<li>${tag(it)} <strong>${esc(it.headline)}</strong> — ${esc(it.hook)} <code>${esc(it.file)}</code> · ${sourceLink(it)}</li>`

function section(title, body, cls) {
  return body ? `<section class="${cls}"><h2>${esc(title)}</h2>${body}</section>` : ''
}

/** The full page. `template` is page-template.html; every `<!--SCOUT:KEY-->` marker is replaced. */
export function renderPage(report, template, topN = DEFAULT_CAPS.topN) {
  const s = sections(report.items, topN)
  const from = report.claudeCode.from ? `${report.claudeCode.from} → ` : ''
  const sourceRows = report.sources
    .map((src) => `<li><code>${esc(src.id)}</code>${src.items !== undefined ? ` — ${esc(src.items)} new` : ''}${src.note ? ` — ${esc(src.note)}` : ''}</li>`)
    .join('')
  const fill = {
    TITLE: `Workflow scout — ${esc(report.date)}`,
    DATE: esc(report.date),
    SUMMARY: `${report.items.length} new item${report.items.length === 1 ? '' : 's'} · Claude Code ${esc(from)}${esc(report.claudeCode.to)}`,
    BUDGET: report.budgetReached ? '<p class="budget">SCOUT: budget reached — the run stopped at its cap; some news waits for next week.</p>' : '',
    TOP: section(`Top ${s.top.length} to adopt`, s.top.map((it, i) => heroCard(it, i + 1)).join(''), 'top'),
    REPLACES: section('Native feature now replaces your custom part', s.replaces.map(callout).join(''), 'replaces'),
    COMMUNITY: section('Community picks', s.community.map(pick).join(''), 'community'),
    ALSO: section('Also new', s.also.length ? `<ul class="also">${s.also.map(alsoRow).join('')}</ul>` : '', 'also-new'),
    FOOTER: `<p>Claude Code ${esc(from)}${esc(report.claudeCode.to)}. Sources checked:</p><ul>${sourceRows}</ul><p>Proposals only — nothing was applied.</p>`,
  }
  return template.replace(/<!--SCOUT:([A-Z]+)-->/g, (m, k) => (k in fill ? fill[k] : m))
}

/** The new state: last Claude Code version and one cursor per source (kept when the report has none). */
export function nextState(prev, report) {
  const cursors = { ...(prev?.cursors ?? {}) }
  for (const s of report.sources) if (s.cursor !== undefined && s.cursor !== null && s.cursor !== '') cursors[s.id] = String(s.cursor)
  return { claudeCodeVersion: String(report.claudeCode.to), lastRun: report.date, cursors }
}

function main(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) refuse(`unexpected argument "${a}"`)
    flags[a.slice(2)] = argv[++i]
  }
  if (!flags.report) refuse('--report <file.json> is required')
  const root = resolve(flags.root ?? process.cwd())
  const dir = join(root, 'docs', 'scout')
  const raw = readJson(resolve(flags.report))
  if (!raw) refuse(`cannot read the report ${flags.report} as JSON`)
  if (flags.date) raw.date = flags.date
  const caps = { ...DEFAULT_CAPS, ...(readJson(join(dir, 'sources.json'), {})?.caps ?? {}) }
  let checked
  try {
    checked = validateReport(raw, caps)
  } catch (e) {
    refuse(`report refused — ${e.message}`)
  }
  const { report, budgetReached } = checked
  const prev = readJson(join(dir, 'state.json'), {})
  if (report.items.length === 0) {
    process.stdout.write(`SCOUT: nothing new since ${prev?.claudeCodeVersion ?? report.claudeCode.to}\n`)
    return
  }
  const template = readFileSync(join(HERE, 'page-template.html'), 'utf8')
  const page = renderPage(report, template, caps.topN)
  const why = privacyProblem(page)
  if (why) refuse(`page refused — ${why}. Rewrite the item in your own words without it.`)
  mkdirSync(dir, { recursive: true })
  const pagePath = join(dir, `${report.date}.html`)
  writeFileSync(pagePath, page)
  writeFileSync(join(dir, 'state.json'), JSON.stringify(nextState(prev, report), null, 2) + '\n')
  process.stdout.write(`SCOUT: page docs/scout/${report.date}.html (${report.items.length} items)\n`)
  if (budgetReached) process.stdout.write('SCOUT: budget reached\n')
}

function refuse(why) {
  process.stderr.write(`SCOUT: ${why}\n`)
  process.exit(2)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
