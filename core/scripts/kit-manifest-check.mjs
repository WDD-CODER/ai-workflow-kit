/**
 * Kit drift checker — proves every workflow file in a project is classified
 * exactly once in a manifest, and that no core/layer file carries project- or
 * stack-specific strings. Inventory roots and the coupling terms come from
 * kit.config.json, not from constants, so the same script serves any project.
 *
 * Usage:
 *   node scripts/kit-manifest-check.mjs             # inventory vs manifest.json
 *   node scripts/kit-manifest-check.mjs --list      # print unclassified paths (one per line)
 *
 * Flags: --root <dir> (project root, default cwd), --config <file> (default
 * <root>/kit.config.json), --manifest <file> (default <root>/docs/workflow-kit/manifest.json).
 *
 * Coupling terms = every word (>= 5 chars) of each non-empty string value in
 * project.name, stack.name, stack.backend, deploy.host, deploy.dbHost, tools.browser,
 * plus the literal values of hooks.* and slots port bases. A file in tier core or
 * layer:cursor that contains one must be classified parameterize or split.
 *
 * Node built-ins only. Exit 0 = ok, 1 = failures (printed, one per line).
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { resolve, join } from 'path'

const argv = process.argv.slice(2)
const flagValue = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}
const root = resolve(flagValue('--root') ?? process.cwd())
const configPath = resolve(flagValue('--config') ?? join(root, 'kit.config.json'))
const manifestPath = resolve(flagValue('--manifest') ?? join(root, 'docs/workflow-kit/manifest.json'))

const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {}
const get = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), config)

const serverRoot = String(get('paths.serverRoot') ?? '').replace(/\/+$/, '')
const sharedDocs = String(get('paths.sharedDocs') ?? 'docs/project').replace(/\/+$/, '')

const ROOT_FILES = [
  'AGENTS.md', 'CLAUDE.md', 'README_WORKFLOW.md', '.mcp.json', '.lintstagedrc.mjs', '.editorconfig',
  '.prettierrc.json', 'eslint.config.mjs', '.gitignore', '.gitattributes', '.gitleaksignore', '.nvmrc', 'knip.json',
  'package.json', '.claude/settings.json', '.cursor/mcp.json',
  ...(serverRoot ? [`${serverRoot}/package.json`] : []),
]
const ROOT_DIRS = [
  '.claude/commands', '.claude/skills', '.claude/agents', '.claude/references', '.claude/instructions',
  '.claude/prompts', '.claude/workflows', '.cursor/rules', '.cursor/commands', 'scripts', 'docs/agent',
  'docs/brain', sharedDocs, '.husky', '.github/workflows', '.vscode',
]
const TIER_RE = /^(?:core|layer:cursor|template|project|pack:[a-z0-9-]+)$/
const ACTIONS = new Set(['copy', 'parameterize', 'split', 'skeleton', 'stay'])
const SCANNED_TIERS = new Set(['core', 'layer:cursor'])

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const termSources = ['project.name', 'stack.name', 'stack.backend', 'deploy.host', 'deploy.dbHost', 'tools.browser',
  'hooks.shellPath']
const terms = new Set()
for (const key of termSources) {
  const v = get(key)
  if (typeof v !== 'string' || !v.trim()) continue
  // tools.browser values read like "<tool> /browse": only the tool name is a coupling term.
  const words = key.startsWith('hooks.') ? [v.trim()] : key === 'tools.browser' ? [v.trim().split(/\s+/)[0]] : v.split(/[^A-Za-z0-9_-]+/)
  for (const word of words) {
    if (word.length < 5) continue
    terms.add(word)
    if (key === 'project.name') terms.add(word.toLowerCase())
  }
}
for (const key of ['slots.fePorts', 'slots.bePorts']) {
  const v = get(key)
  if (typeof v === 'number') terms.add(String(v))
}
const couplingRe = terms.size ? new RegExp([...terms].map(escapeRe).join('|'), 'g') : null

function walk(rel) {
  const abs = join(root, rel)
  if (!existsSync(abs)) return []
  const out = []
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const childRel = `${rel}/${entry.name}`
    if (entry.isDirectory()) out.push(...walk(childRel))
    else out.push(childRel)
  }
  return out
}

const norm = (p) => p.replace(/\\/g, '/')
const globToRegExp = (glob) =>
  new RegExp(
    '^' +
      norm(glob)
        .replace(/[.+^${}()|[\]]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '.*') +
      '$',
  )

if (!existsSync(manifestPath)) {
  console.error(`KIT_MANIFEST: FAIL — missing ${manifestPath}`)
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const excluded = (manifest.excluded ?? []).map((e) => globToRegExp(e.path))
const entries = manifest.entries ?? []

const files = new Set()
for (const f of ROOT_FILES) if (existsSync(join(root, f))) files.add(f)
for (const d of ROOT_DIRS) for (const f of walk(d)) files.add(f)
const inventory = [...files].filter((f) => !excluded.some((re) => re.test(f))).sort()

const classified = new Set(entries.map((e) => e.path))
const unclassified = inventory.filter((f) => !classified.has(f))
if (argv.includes('--list')) {
  for (const f of unclassified) console.log(f)
  process.exit(0)
}

const problems = unclassified.map((f) => `unclassified: ${f}`)
const seen = new Map()
for (const e of entries) seen.set(e.path, (seen.get(e.path) ?? 0) + 1)
let duplicates = 0
for (const [path, n] of seen) {
  if (n > 1) {
    duplicates += n - 1
    problems.push(`duplicate: ${path} (${n} entries)`)
  }
}
for (const e of entries) {
  if (!inventory.includes(e.path)) problems.push(`not-in-inventory-or-missing-on-disk: ${e.path}`)
  if (!TIER_RE.test(e.tier)) problems.push(`bad tier "${e.tier}": ${e.path}`)
  if (!ACTIONS.has(e.action)) problems.push(`bad action "${e.action}": ${e.path}`)
}

let unhandled = 0
if (couplingRe) {
  for (const e of entries) {
    if (!SCANNED_TIERS.has(e.tier) || e.action === 'parameterize' || e.action === 'split') continue
    const abs = join(root, e.path)
    if (!existsSync(abs) || !statSync(abs).isFile()) continue
    const hits = new Set([...readFileSync(abs, 'utf8').matchAll(couplingRe)].map((m) => m[0]))
    if (hits.size === 0) continue
    unhandled++
    problems.push(`unhandled-coupling: ${e.path} is ${e.tier}/${e.action} but contains: ${[...hits].sort().join(', ')}`)
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  console.error(
    `KIT_MANIFEST: FAIL — ${entries.length - duplicates} classified, ${unclassified.length} unclassified, ${duplicates} duplicates, ${unhandled} unhandled-coupling (${problems.length} problems)`,
  )
  process.exit(1)
}
console.log(`KIT_MANIFEST: ok — ${entries.length} classified, 0 unclassified, 0 duplicates, 0 unhandled-coupling`)
