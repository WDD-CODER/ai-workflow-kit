/**
 * Todo query — shared by Claude Code and Cursor.
 *
 * Answers targeted questions about `.claude/todo.md` without reading the
 * whole file into context. Do not Read .claude/todo.md in full.
 *
 * Usage:
 *   node scripts/todo-query.mjs next
 *   node scripts/todo-query.mjs open [--plan NNN]
 *   node scripts/todo-query.mjs sweep
 *   node scripts/todo-query.mjs mark --line N[,N…] [--auto-verified]
 *   node scripts/todo-query.mjs append --from <file>
 *   node scripts/todo-query.mjs sync --plan NNN
 *   node scripts/todo-query.mjs sync --merged
 *   (add --json to next / open / sweep)
 *
 * Exit: 0 on success, 1 when the file is missing, no sections parse, or
 * `mark` is asked to flip a line that isn't currently `[ ]`.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  isTodoFooterLine,
  splitPlanSections,
  isDeferredBlocked,
  checkboxStats,
  isFullyDone
} from './lib/todo-parse.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const TODO_PATH = join(repoRoot, '.claude', 'todo.md')
const PLANS_DIR = join(repoRoot, 'plans')
const ARCHIVE_DIR = join(repoRoot, '.claude', 'todo-archive')

function fail(message) {
  console.error(`TODO_QUERY: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next
        i++
      } else {
        out[key] = true
      }
    } else {
      out._.push(arg)
    }
  }
  return out
}

const argv = process.argv.slice(2)
const subcommand = argv[0]
const args = parseArgs(argv.slice(1))
const asJson = Boolean(args.json)

function readTodo() {
  if (!existsSync(TODO_PATH)) fail('missing .claude/todo.md')
  const raw = readFileSync(TODO_PATH, 'utf8')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  return { raw, eol }
}

function planPathFromHeading(heading) {
  const m = heading.match(/\(([^)]+\.plan\.md)\)/)
  return m ? m[1] : null
}

function planNumberFromHeading(heading) {
  const m = heading.match(/^### Plans?\s+(\d+)/)
  return m ? m[1] : null
}

/** Absolute 1-based line numbers of `- [ ]` items inside a parsed section. */
function openItemLines(section) {
  const chunkLines = section.full.split(/\r?\n/)
  const items = []
  chunkLines.forEach((line, k) => {
    if (/\[ \]/.test(line)) {
      items.push({ line: section.start + k + 1, text: line.trim() })
    }
  })
  return items
}

function cmdNext() {
  const { raw } = readTodo()
  const { sections } = splitPlanSections(raw)
  if (!sections.length) fail('no ### Plan sections parsed from .claude/todo.md')

  const target = sections.find(s => checkboxStats(s.full).open > 0)
  if (!target) {
    if (asJson) {
      console.log(JSON.stringify({ found: false }, null, 2))
    } else {
      console.log('TODO_QUERY: no open plan sections')
    }
    return
  }

  const items = openItemLines(target)
  const result = {
    found: true,
    heading: target.heading,
    plan: planPathFromHeading(target.heading),
    items
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(target.heading)
  if (result.plan) console.log(`  plan: ${result.plan}`)
  for (const item of items) {
    console.log(`  ${item.line}: ${item.text}`)
  }
}

function cmdOpen() {
  const { raw } = readTodo()
  const { sections } = splitPlanSections(raw)
  if (!sections.length) fail('no ### Plan sections parsed from .claude/todo.md')

  let scoped = sections
  if (args.plan) {
    scoped = sections.filter(s => planNumberFromHeading(s.heading) === String(args.plan))
    if (!scoped.length) fail(`no section found for --plan ${args.plan}`)
  }

  const result = scoped
    .map(s => ({ heading: s.heading, plan: planPathFromHeading(s.heading), items: openItemLines(s) }))
    .filter(s => s.items.length)

  if (asJson) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (!result.length) {
    console.log('TODO_QUERY: no open items')
    return
  }

  for (const s of result) {
    console.log(s.heading)
    for (const item of s.items) {
      console.log(`  ${item.line}: ${item.text}`)
    }
  }
}

function tryExecFile(cmd, cmdArgs) {
  try {
    return execFileSync(cmd, cmdArgs, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function hasGh() {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function cmdSweep() {
  const { raw } = readTodo()
  const { sections } = splitPlanSections(raw)
  if (!sections.length) fail('no ### Plan sections parsed from .claude/todo.md')

  const candidates = sections.filter(s => isFullyDone(s.full))
  const deferred = sections.filter(s => isDeferredBlocked(s.full) && checkboxStats(s.full).open === 0)
  const ghAvailable = hasGh()

  const results = candidates.map(s => {
    const num = planNumberFromHeading(s.heading)
    const gitHits = num ? tryExecFile('git', ['log', '--oneline', '-i', `--grep=${num}`]) : ''
    const prHits = num && ghAvailable ? tryExecFile('gh', ['pr', 'list', '--state', 'merged', '--search', num]) : ''
    const verified = Boolean(gitHits || prHits)
    return {
      heading: s.heading,
      plan: planPathFromHeading(s.heading),
      status: verified ? 'verified' : 'unverifiable',
      gitHits: gitHits ? gitHits.split('\n').length : 0,
      prHits: prHits ? prHits.split('\n').length : 0
    }
  })

  if (asJson) {
    console.log(JSON.stringify({ ghAvailable, deferredSkipped: deferred.length, results }, null, 2))
    return
  }

  if (!results.length) {
    console.log('TODO_QUERY: no all-[x] sections to sweep')
    if (deferred.length) console.log(`  (${deferred.length} deferred section(s) excluded)`)
    return
  }

  for (const r of results) {
    console.log(`${r.status.toUpperCase()}: ${r.heading}`)
  }
  if (deferred.length) console.log(`(${deferred.length} deferred section(s) excluded)`)
}

function cmdMark() {
  if (!args.line) fail('mark requires --line N[,N…]')
  const { raw, eol } = readTodo()
  const lines = raw.split(/\r?\n/)
  const targets = String(args.line)
    .split(',')
    .map(s => Number(s.trim()))

  for (const n of targets) {
    if (!Number.isInteger(n) || n < 1 || n > lines.length || !/\[ \]/.test(lines[n - 1])) {
      fail(`line ${n} does not currently contain "[ ]" — refusing whole call, no changes made`)
    }
  }

  const changed = []
  for (const n of targets) {
    const idx = n - 1
    lines[idx] = lines[idx].replace('[ ]', '[x]')
    if (args['auto-verified']) lines[idx] = `${lines[idx].trimEnd()} (auto-verified)`
    changed.push({ line: n, text: lines[idx].trim() })
  }

  writeFileSync(TODO_PATH, lines.join(eol), 'utf8')

  if (asJson) {
    console.log(JSON.stringify({ changed }, null, 2))
    return
  }
  console.log('TODO_QUERY: marked')
  for (const c of changed) console.log(`  ${c.line}: ${c.text}`)
}

function cmdAppend() {
  if (!args.from) fail('append requires --from <file>')
  if (!existsSync(args.from)) fail(`file not found: ${args.from}`)

  const { raw, eol } = readTodo()
  const lines = raw.split(/\r?\n/)

  let footerStart = lines.length
  for (let i = 0; i < lines.length; i++) {
    if (isTodoFooterLine(lines, i)) {
      footerStart = i
      break
    }
  }

  const newSection = readFileSync(args.from, 'utf8').replace(/\s+$/, '').split(/\r?\n/)
  const before = lines.slice(0, footerStart)
  while (before.length && /^\s*$/.test(before[before.length - 1])) before.pop()
  const after = lines.slice(footerStart)

  const out = [...before, '', ...newSection, '', ...after].join(eol)
  writeFileSync(TODO_PATH, out, 'utf8')

  console.log(`TODO_QUERY: appended ${newSection[0] || '(section)'}`)
}

// Only the flat plans/<NNN>-<slug>.plan.md convention counts — legacy plans
// filed under plans/1-100/, plans/100-200/, plans/200-300/ (pre-dating this
// convention) are deliberately not matched, so an old feat/NNN-* branch from
// before this workflow existed is silently not a sync candidate.
function findPlanFileOrNull(nnn) {
  if (!existsSync(PLANS_DIR)) return null
  const match = readdirSync(PLANS_DIR).find(f => f.startsWith(`${nnn}-`) && f.endsWith('.plan.md'))
  return match ? { rel: `plans/${match}`, abs: join(PLANS_DIR, match) } : null
}

function findPlanFile(nnn) {
  const found = findPlanFileOrNull(nnn)
  if (!found) fail(`no plans/${nnn}-*.plan.md found`)
  return found
}

function planTitle(planText) {
  const m = planText.match(/^# Plan \d+\s*[—-]\s*(.+)$/m)
  return m ? m[1].trim() : 'Untitled'
}

/** Flattens `## Atomic Sub-tasks` into one-line checkbox items, folding
 * indented continuation lines and nested `### Stage` sub-headings away. */
function extractAtomicItems(planText) {
  const lines = planText.split(/\r?\n/)
  const startIdx = lines.findIndex(l => /^## Atomic Sub-tasks\s*$/.test(l))
  if (startIdx === -1) return null
  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      endIdx = i
      break
    }
  }

  const items = []
  let current = null
  let stage = null
  const flush = () => {
    if (current) items.push(current)
    current = null
  }
  for (const line of lines.slice(startIdx + 1, endIdx)) {
    if (/^###/.test(line)) stage = line.match(/\bStage \d+\b/)?.[0] ?? null
    const m = line.match(/^- \[([ xX])\]\s*(.*)$/)
    if (m) {
      flush()
      current = { done: m[1].toLowerCase() === 'x', text: m[2].trim(), stage }
    } else if (current && /^\s+\S/.test(line)) {
      current.text += ` ${line.trim()}`
    } else {
      flush()
    }
  }
  flush()
  return items
}

function isArchived(nnn) {
  if (!existsSync(ARCHIVE_DIR)) return false
  const re = new RegExp(`^### Plans?\\s+${nnn}\\b`, 'm')
  return readdirSync(ARCHIVE_DIR)
    .filter(f => f.endsWith('.md'))
    .some(f => re.test(readFileSync(join(ARCHIVE_DIR, f), 'utf8')))
}

const normalizeItemText = text => text.replace(/\s+/g, ' ').trim()

/** Leading task id of a checkbox item — `A1`, `P2b.3`, `M1`, `Stage 2`, `P3.0–P3.5`, `P2a.0–P2a.6`, `P7a–P7f`. */
function itemId(text) {
  const m = text.match(/^(Stage \d+|Milestone \d+|[A-Z]\d+[a-z]?(?:\.\d+[a-z]?)?(?:[–-][A-Z]?\d*[a-z]?(?:\.\d+[a-z]?)?)?)(?=[:\s—]|$)/)
  return m ? m[1] : null
}

/** True when a todo line's id groups the plan item — a range (`P2a.0–P2a.6` holds
 * `P2a.3` and `P2a.3b`; `P7a–P7f` holds `P7c`) or the plan `### Stage N` it sits under. */
function idCovers(lineId, item) {
  if (!lineId) return false
  if (item.stage && lineId === item.stage) return true
  const id = itemId(item.text)
  if (!id) return false
  const dotted = lineId.match(/^([A-Z]\d+[a-z]?)\.(\d+)[–-](?:\1\.)?(\d+)$/)
  const sub = id.match(/^([A-Z]\d+[a-z]?)\.(\d+)/)
  if (dotted && sub) return dotted[1] === sub[1] && +sub[2] >= +dotted[2] && +sub[2] <= +dotted[3]
  const lettered = lineId.match(/^([A-Z]\d+)([a-z])[–-](?:\1)?([a-z])$/)
  const letter = id.match(/^([A-Z]\d+)([a-z])$/)
  if (lettered && letter) return lettered[1] === letter[1] && letter[2] >= lettered[2] && letter[2] <= lettered[3]
  return false
}

/** Ticks `[ ]` lines in an existing todo section whose matching plan item is `[x]`.
 * Never unticks and never rewrites a line's text, notes or spacing — the todo
 * section is often hand-curated (shortened text, `>` notes) and may be ahead
 * of the plan file. Match: same text, else the same task id when that id is
 * unique on both sides, else a grouping line (range id or `Stage N`) — ticked
 * only once every plan item it groups is done. */
function tickExistingSection(nnn, section, items, lines, eol) {
  // `[-]` (dropped/folded) lines still account for their plan items but are never ticked
  const itemRe = /^- \[([ xX-])\]\s*(.*)$/
  const countIds = texts => texts.reduce((acc, t) => {
    const id = itemId(t)
    if (id) acc.set(id, (acc.get(id) ?? 0) + 1)
    return acc
  }, new Map())
  const planIds = countIds(items.map(i => i.text))
  const sectionIds = countIds(lines.slice(section.start, section.end).map(l => l.match(itemRe)?.[2] ?? ''))

  const done = items.filter(i => i.done)
  const doneTexts = new Set(done.map(i => normalizeItemText(i.text)))
  const doneIds = new Set(done.map(i => itemId(i.text)).filter(Boolean))
  const matched = new Set()
  const covered = new Set()
  let ticked = 0

  for (let i = section.start; i < section.end; i++) {
    const m = lines[i].match(itemRe)
    if (!m) continue
    const text = normalizeItemText(m[2])
    const id = itemId(text)
    const uniqueId = id && planIds.get(id) === 1 && sectionIds.get(id) === 1
    const hit = doneTexts.has(text) ? text : uniqueId && doneIds.has(id) ? id : null
    if (hit) matched.add(hit)
    const grouped = hit ? [] : items.filter(it => idCovers(id, it))
    grouped.filter(it => it.done).forEach(it => covered.add(it))
    const groupDone = grouped.length > 0 && grouped.every(it => it.done)
    if ((hit || groupDone) && m[1] === ' ') {
      lines[i] = lines[i].replace('- [ ]', '- [x]')
      ticked++
    }
  }

  const unmatched = done.filter(i => !covered.has(i) && !matched.has(normalizeItemText(i.text)) && !matched.has(itemId(i.text))).length
  if (ticked) writeFileSync(TODO_PATH, lines.join(eol), 'utf8')
  const stats = checkboxStats(lines.slice(section.start, section.end).join('\n'))
  return { skipped: false, nnn, done: stats.done, total: stats.done + stats.open, ticked, unmatched }
}

function syncPlanByNumber(nnn, { requirePlan = true } = {}) {
  const found = findPlanFileOrNull(nnn)
  if (!found) {
    if (requirePlan) fail(`no plans/${nnn}-*.plan.md found`)
    return { notFound: true, nnn }
  }
  const { rel, abs } = found
  const planText = readFileSync(abs, 'utf8')
  const items = extractAtomicItems(planText)
  if (!items || !items.length) {
    if (requirePlan) fail(`${rel} has no "## Atomic Sub-tasks" checkboxes`)
    return { notFound: true, nnn }
  }

  const { raw, eol } = readTodo()
  const lines = raw.split(/\r?\n/)
  const { sections } = splitPlanSections(raw)
  const existing = sections.find(s => planNumberFromHeading(s.heading) === nnn)

  if (!existing && isArchived(nnn)) {
    return { skipped: true, nnn, done: items.filter(i => i.done).length, total: items.length }
  }

  if (existing) return tickExistingSection(nnn, existing, items, lines, eol)

  const heading = `### Plan ${nnn} — ${planTitle(planText)} (\`${rel}\`)`
  const body = items.map(it => `- [${it.done ? 'x' : ' '}] ${it.text}`).join('\n')
  const newSectionLines = `${heading}\n${body}`.split('\n')

  let out
  {
    let footerStart = lines.length
    for (let i = 0; i < lines.length; i++) {
      if (isTodoFooterLine(lines, i)) {
        footerStart = i
        break
      }
    }
    const before = lines.slice(0, footerStart)
    while (before.length && /^\s*$/.test(before[before.length - 1])) before.pop()
    const after = lines.slice(footerStart)
    out = [...before, '', ...newSectionLines, '', ...after].join(eol)
  }

  writeFileSync(TODO_PATH, out, 'utf8')
  return { skipped: false, nnn, done: items.filter(i => i.done).length, total: items.length }
}

function cmdSyncPlan() {
  if (!args.plan) fail('sync --plan requires a plan number')
  const nnn = String(args.plan)
  const result = syncPlanByNumber(nnn)
  if (result.skipped) {
    console.log(`TODO_QUERY: plan ${nnn} already archived — skipped`)
    return
  }
  console.log(`TODO_QUERY: sync plan ${nnn} (${result.done}/${result.total} done${result.unmatched ? `; ${result.unmatched} done plan item(s) matched no todo line - tick by hand` : ''})`)
}

function git(cmdArgs) {
  try {
    return execFileSync('git', cmdArgs, { cwd: repoRoot, encoding: 'utf8' }).replace(/\r?\n+$/, '')
  } catch {
    return ''
  }
}

function isAncestorOfMain(ref) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ref, 'origin/main'], { cwd: repoRoot, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function mergedFeatPlanNumbers() {
  const local = git(['branch', '--list', 'feat/*', '--format=%(refname:short)'])
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
  const remote = git(['branch', '-r', '--list', 'origin/feat/*', '--format=%(refname:short)'])
    .split('\n')
    .map(s => s.trim().replace(/^origin\//, ''))
    .filter(Boolean)

  const names = new Set([...local, ...remote])
  const numbers = new Set()
  for (const name of names) {
    const m = name.match(/^feat\/(\d+)-/)
    if (!m) continue
    const ref = local.includes(name) ? name : `origin/${name}`
    if (isAncestorOfMain(ref)) numbers.add(m[1])
  }
  return [...numbers]
}

// Merged branches are usually deleted (gh --delete-branch, take-plan's release), and a squash merge is never an
// ancestor - so branch refs miss most merged plans. The plan file itself is the record: a Worker's [x] marks reach
// this checkout only by merging. Any open todo section whose plan file has more [x] than the section needs a sync.
function plansAheadOfTodo() {
  if (!existsSync(TODO_PATH)) return []
  const { sections } = splitPlanSections(readFileSync(TODO_PATH, 'utf8'))
  const numbers = []
  for (const s of sections) {
    const nnn = planNumberFromHeading(s.heading)
    if (!nnn) continue
    const found = findPlanFileOrNull(nnn)
    if (!found) continue
    const items = extractAtomicItems(readFileSync(found.abs, 'utf8'))
    if (!items) continue
    if (items.filter(i => i.done).length > checkboxStats(s.full).done) numbers.push(nnn)
  }
  return numbers
}

function cmdSyncMerged() {
  const numbers = [...new Set([...mergedFeatPlanNumbers(), ...plansAheadOfTodo()])]
  if (!numbers.length) {
    console.log('TODO_QUERY: sync --merged — nothing to sync (no merged feat/NNN-* branch, no plan file ahead of its todo section)')
    return
  }
  let synced = 0
  for (const nnn of numbers) {
    const result = syncPlanByNumber(nnn, { requirePlan: false })
    if (result.notFound) continue
    synced++
    if (result.skipped) {
      console.log(`TODO_QUERY: plan ${nnn} already archived — skipped`)
    } else {
      console.log(`TODO_QUERY: sync plan ${nnn} (${result.done}/${result.total} done${result.unmatched ? `; ${result.unmatched} done plan item(s) matched no todo line - tick by hand` : ''})`)
    }
  }
  if (!synced) console.log('TODO_QUERY: sync --merged — no merged branches matched a plans/NNN-*.plan.md')
}

function cmdSync() {
  if (args.plan) return cmdSyncPlan()
  if (args.merged) return cmdSyncMerged()
  fail('sync requires --plan NNN or --merged')
}

switch (subcommand) {
  case 'next':
    cmdNext()
    break
  case 'open':
    cmdOpen()
    break
  case 'sweep':
    cmdSweep()
    break
  case 'mark':
    cmdMark()
    break
  case 'append':
    cmdAppend()
    break
  case 'sync':
    cmdSync()
    break
  default:
    fail(`unknown subcommand "${subcommand ?? ''}" — expected next | open | sweep | mark | append | sync`)
}
