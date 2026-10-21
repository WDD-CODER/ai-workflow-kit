/**
 * Shared engine for kit-install and kit-sync: config resolution, placeholder
 * rendering and the planned file set. Node built-ins only.
 *
 * Layers (first wins on a path clash is an error, never silent):
 *   core/            managed   every project
 *   packs/<name>/    managed   per selected stack pack (pack.json and its agentsFragment / fragments files are not
 *                              installed; paths in pack.json `seeds` are seeds)
 *   layers/<name>/   managed   per selected layer (--layers / stack.layers): an add-on that is not a stack — a backend
 *                              service (supabase), an ownership profile (upstream-owned). layer.json has the optional
 *                              fields of pack.json (provides, configDefaults, fragments, agentsFragment, gotchas, seeds,
 *                              techdebtRules, detect) and is not installed; layers apply after the packs
 *   layers/cursor/   managed   with the Cursor layer (--cursor; no layer.json)
 *   templates/       seed      written once, never updated by sync; templates/cursor/** only with the Cursor layer;
 *                              templates/fragments/** are inputs, not files
 *
 * Text a file gets from the config, before placeholders are rendered:
 *   <!-- PACK:<name> -->  or  # PACK:<name>   (a line of its own) -> the `## <name>` section of every selected pack's
 *                                               pack.json `fragments` file, in pack order; no pack has it = the line is dropped
 *   <!-- KIT:if <cond> --> … <!-- KIT:else --> … <!-- KIT:end -->  (or `# KIT:if <cond>` … `# KIT:end`)
 *                                            -> lines kept or dropped by a config value; <cond> = key | !key |
 *                                               key=value | key!=value (a key is set when it is not empty)
 */
import { readFileSync, readdirSync, existsSync, statSync, chmodSync } from 'fs'
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { resolve, join, dirname, basename, relative, sep } from 'path'
import { fileURLToPath } from 'url'

export const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const NOT_SET = '(not set)'
// Empty is the right rendering for these (they are prefixes / optional fragments, not words in a sentence).
const BLANK_OK = new Set(['paths.srcRoot', 'paths.serverRoot', 'paths.slotEnvFile', 'kit.mcpArgs', 'commands.slotPrepare', 'commands.dev', 'slots.feMatcher', 'slots.feEnvFile'])
export const REQUIRED = ['project.name', 'commands.build', 'commands.lint', 'commands.test', 'hooks.shellPath']
// commands.* hold npm script names; the core files run them as `npm run <name>`. lintStaged is a full command.
const SCRIPT_NAME_KEYS = ['build', 'buildProd', 'dev', 'devLocal', 'test', 'lint', 'e2e', 'codegen', 'cli', 'slotPrepare'].map((k) => `commands.${k}`)

/**
 * commands.* values that are full commands instead of npm script names ("npm run build" renders as
 * `npm run npm run build`). Returns one message per bad key; install and sync refuse while any is left.
 */
export function commandProblems(vals) {
  const out = []
  for (const key of SCRIPT_NAME_KEYS) {
    const v = vals[key]
    if (typeof v !== 'string') continue
    const m = /^\s*npm\s+(?:run(?:-script)?\s+)?(\S.*)$/.exec(v)
    if (m) out.push(`${key} is "${v}" — commands.* take npm script names, not commands: set it to "${m[1].trim()}"`)
  }
  // commands.logQuery is rendered inside a Markdown table cell and an inline code span: no `|`, no backtick.
  const lq = vals['commands.logQuery']
  if (typeof lq === 'string' && /[|`]/.test(lq)) out.push(`commands.logQuery is "${lq}" — it cannot contain "|" or a backtick (it is shown in a Markdown table and a code span): wrap the command in a script`)
  // ci.* modes and other enums: a value outside the set would silently render the default branch of a file.
  for (const [key, allowed] of Object.entries(ENUMS)) {
    const v = vals[key]
    if (!isEmpty(v) && !allowed.includes(v)) out.push(`${key} is "${v}" — allowed: ${allowed.map((a) => `"${a}"`).join(', ')}`)
  }
  // models.*: a tier renders into agent / skill frontmatter `model:`; an unknown value would fail only at run time.
  for (const key of MODEL_KEYS) {
    const v = vals[key]
    if (isEmpty(v) || !MODEL_VALUE.test(v)) out.push(`${key} is "${isEmpty(v) ? '' : v}" — allowed: "haiku", "sonnet", "opus", "fable", "inherit" or a full model id starting "claude-"`)
  }
  // mods.*: each enabled mod must be one the kit's marketplace serves; the repo is an owner/repo pair.
  for (const m of asList(vals['mods.enabled'])) if (!MODS.includes(m)) out.push(`mods.enabled names "${m}" — allowed: ${MODS.map((x) => `"${x}"`).join(', ')}`)
  if (asList(vals['mods.enabled']).length && !/^[\w.-]+\/[\w.-]+$/.test(String(vals['mods.marketplaceRepo'] ?? ''))) out.push(`mods.marketplaceRepo is "${vals['mods.marketplaceRepo'] ?? ''}" — it must be <owner>/<repo>`)
  // ownership.upstreamPaths is read by the kit's own glob matcher and by the scope guard's (picomatch): only the syntax
  // both read alike (`**`, `*`, `?`, a trailing `/`).
  for (const g of asList(vals['ownership.upstreamPaths'])) {
    const why = globProblem(g)
    if (why) out.push(`ownership.upstreamPaths "${g}" — ${why}`)
  }
  return out
}

/** Why a glob is outside the subset every kit matcher reads alike (`**`, `*`, `?`, trailing `/`), or null. */
export function globProblem(g) {
  if (/[{}]/.test(g)) return 'brace lists ({a,b}) are not supported: list each glob on its own'
  if (/[[\]]/.test(g)) return 'character classes ([abc]) are not supported: list each path on its own'
  if (/^!/.test(g)) return 'negation (!) is not supported'
  return null
}
export const MODEL_KEYS = ['models.mechanical', 'models.analysis', 'models.judgment']
const MODEL_VALUE = /^(haiku|sonnet|opus|fable|inherit|claude-[a-z0-9][a-z0-9.-]*)$/
const ENUMS = {
  'ci.lintScope': ['all', 'changed'],
  'ci.appAuditMode': ['enforce', 'report'],
  'ci.testMode': ['run', 'if-present', 'skip'],
  'project.uiDirection': ['rtl', 'ltr'],
}

/**
 * A NOTE when the project has a backend package (server/package.json) but paths.serverRoot is empty: CI then renders
 * no server tests, install or audit. Else null.
 */
export function backendNote(vals, target) {
  if (!isEmpty(vals['paths.serverRoot']) || !existsSync(join(target, 'server', 'package.json'))) return null
  return 'NOTE server/package.json exists but paths.serverRoot is empty: ci.yml and security.yml render no server tests, install or audit. ' +
    'Set paths.serverRoot to "server/" if that is the project backend.'
}

/**
 * A NOTE when commands.dev will start a slot frontend with nothing but the kit defaults (no pack or project set
 * any slots.fe* value): an older effective config may carry a backend-only `commands.dev: "dev"`. Else null.
 */
export function frontendNote(vals) {
  const dev = vals['commands.dev']
  if (isEmpty(dev) || !vals['kit.feDefaults']) return null
  return `NOTE commands.dev "${dev}" starts a frontend dev server in each slot (npm run ${dev} -- --port <port>), with the kit's default slots.fe* values. ` +
    'No root frontend (e.g. a backend-only project)? Set commands.dev to "". Otherwise check slots.fePortArgs makes the server fail on a busy port (strict port), never move to another.'
}

/** The runtime ignore list, read from core/scripts/local-excludes.mjs (its KIT:runtime-ignores block). */
export function runtimeIgnores(kitRoot) {
  const file = join(kitRoot, 'core', 'scripts', 'local-excludes.mjs')
  if (!existsSync(file)) return null
  const block = /KIT:runtime-ignores-begin[^\n]*\n([\s\S]*?)\/\/ KIT:runtime-ignores-end/.exec(readFileSync(file, 'utf8'))
  if (!block) return null
  const out = []
  for (const line of block[1].split(/\r?\n/)) {
    const comment = /^\s*\/\/\s*(.+?)\s*$/.exec(line)
    const entry = /^\s*'([^']+)',?\s*$/.exec(line)
    if (comment && !/KIT:/.test(comment[1])) out.push(`${out.length ? '\n' : ''}# ${comment[1]}`)
    else if (entry) out.push(entry[1])
  }
  return out
}

/**
 * Paths (of `dests`) the target's git ignore rules ignore. Tracked files never count (git does not ignore them).
 * Empty set outside a git work tree.
 */
export function ignoredPaths(target, dests) {
  if (dests.length === 0 || !existsSync(join(target, '.git'))) return new Set()
  const r = spawnSync('git', ['check-ignore', '--stdin'], { cwd: target, input: dests.join('\n') + '\n', encoding: 'utf8' })
  if (r.status !== 0) return new Set()
  return new Set(r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
}

/**
 * The project owns AGENTS.md (listed in `overrides`, or present and not installed by the kit): the kit's rules
 * then go to AGENTS.workflow.md (managed) and CLAUDE.md imports both. `recorded` = .kit/install.json files, or
 * null when there is no install record (then only an override counts).
 */
export function ownsAgents({ target, overrides, recorded }) {
  if (overrides?.has('AGENTS.md')) return true
  if (!recorded) return false
  return existsSync(join(target, 'AGENTS.md')) && !recorded['AGENTS.md']
}
const GOTCHA_FILE = /^docs\/brain\/gotchas\/[^/]+\.md$/
const PACK_SKIP = new Set(['pack.json', 'layer.json', 'AGENTS.fragment.md', 'FRAGMENTS.md'])

/**
 * The pack contract: what a core file may point at that only a stack pack can supply. A pack names its files in
 * pack.json `provides` ({ "<key>": "<path, skill name or heading>" }); the value becomes the config key
 * `stack.<key>` (first pack that provides it wins; a project may set the key itself). Core uses each key only inside
 * a `KIT:if stack.<key>` block with a fallback, so a project with no pack never gets a dangling path.
 *   kind doc     a file the pack ships        kind skill   .claude/skills/<name>/SKILL.md in the pack
 *   kind script  a file the pack ships        kind section a `## ` heading of the pack's standardsDoc
 */
export const CONTRACT = {
  conventionsDoc: 'doc', // conventions for components, templates and styles
  backendDoc: 'doc', // backend / persistence standards (no provider = the project has no backend standards)
  styleSkill: 'skill', // the styling skill to run before a stylesheet edit
  authSkill: 'skill', // the auth + logging skill (guards, interceptors, audit checklist)
  docsMapSkill: 'skill', // optional: the skill that refreshes the folder maps
  docsMapCheck: 'script', // optional: the script that skill runs first
  cssSection: 'section', // the standards-doc section /fix loads for a styling bug
  componentsSection: 'section', // the standards-doc section /fix loads for a UI bug
}

/** `## <name>` sections of a pack's FRAGMENTS.md: name -> lines (inner blank lines kept, outer ones trimmed). */
export function fragmentSections(text) {
  const out = {}
  let cur = null
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const m = /^## (\S+)\s*$/.exec(line)
    if (m) cur = out[m[1]] = []
    else if (cur) cur.push(line)
  }
  for (const k of Object.keys(out)) {
    const l = out[k]
    while (l.length && !l[0].trim()) l.shift()
    while (l.length && !l.at(-1).trim()) l.pop()
  }
  return out
}

const PACK_MARKER = /^[ \t]*(?:<!--[ \t]*PACK:([\w:.-]+)[ \t]*-->|#[ \t]*PACK:([\w:.-]+))[ \t]*$/
/** The PACK:<name> marker on a line, or null. */
export const packMarker = (line) => {
  const m = PACK_MARKER.exec(line.replace(/\r$/, ''))
  return m ? m[1] ?? m[2] : null
}

const COND_LINE = /^[ \t]*(?:#|<!--)[ \t]*KIT:(if|else|end)\b[ \t]*(.*?)[ \t]*(?:-->)?[ \t]*$/
/** The KIT:if / KIT:else / KIT:end directive on a line: { op, arg } or null. */
export const condLine = (line) => {
  const m = COND_LINE.exec(line.replace(/\r$/, ''))
  return m ? { op: m[1], arg: m[2] } : null
}

function evalCond(expr, vals, where) {
  const m = /^(!?)([a-zA-Z][\w.]*)(?:[ \t]*(!?=)[ \t]*(.*))?$/.exec(expr)
  if (!m) throw new Error(`${where}: bad KIT:if condition "${expr}"`)
  const [, neg, key, op, value] = m
  if (!(key in vals)) throw new Error(`${where}: KIT:if names a key kit.config.json does not have: ${key}`)
  let on = op ? String(vals[key] ?? '') === value.trim() : !isEmpty(vals[key])
  if (op === '!=') on = !on
  return neg ? !on : on
}

/** Keep or drop the lines between KIT:if / KIT:else / KIT:end by the config (directive lines are removed). */
export function applyConditionals(text, vals, where = 'file') {
  if (!/KIT:(if|else|end)\b/.test(text)) return text
  const out = []
  const stack = []
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    const d = condLine(line)
    if (!d) {
      if (stack.every((s) => s.on)) out.push(line)
      return
    }
    const at = `${where}:${i + 1}`
    if (d.op === 'if') stack.push({ on: evalCond(d.arg, vals, at), sawElse: false })
    else if (d.op === 'else') {
      const top = stack.at(-1)
      if (!top || top.sawElse) throw new Error(`${at}: KIT:else without a matching KIT:if`)
      top.on = !top.on
      top.sawElse = true
    } else if (!stack.pop()) throw new Error(`${at}: KIT:end without a matching KIT:if`)
  })
  if (stack.length) throw new Error(`${where}: KIT:if without KIT:end`)
  return out.join('\n')
}

/** Fill every PACK:<name> marker line from the packs' FRAGMENTS.md sections (none = the line is dropped). */
function fillPackMarkers(text, fragments) {
  if (!/PACK:/.test(text)) return text
  const out = []
  for (const line of text.split('\n')) {
    const name = packMarker(line)
    if (name == null) out.push(line)
    else {
      // Fragment lines take the marker's indentation (a marker inside an indented YAML or list block).
      const indent = /^[ \t]*/.exec(line)[0]
      for (const f of fragments) out.push(...(f[name] ?? []).map((l) => (l.trim() ? indent + l : l)))
    }
  }
  return out.join('\n')
}

// A seed a pack marks as optional: not written when the project already has one of these (a path, or
// `package.json#<key>` for a key of package.json).
export function presentAlternative(target, alternatives) {
  for (const alt of alternatives ?? []) {
    const [file, key] = alt.split('#')
    const p = join(target, file)
    if (!existsSync(p)) continue
    if (!key) return alt
    try {
      if (readJson(p)[key] != null) return alt
    } catch { /* unreadable: not a style config */ }
  }
  return null
}
export const AGENTS_WORKFLOW = 'AGENTS.workflow.md'
const AGENTS_WORKFLOW_NOTE = '> Kit-managed (ai-workflow-kit): the workflow\'s hard rules and skill triggers, rendered from the kit\'s ' +
  '`AGENTS.md` skeleton because this project keeps its own `AGENTS.md`. `kit-sync` updates this file; change it in ' +
  'the kit, not here. The project\'s own rules stay in `AGENTS.md`; `CLAUDE.md` imports both.'
// A rule that points at a skill is installed only when that skill is.
export const REQUIRES = { '.cursor/rules/auth-and-logging-must-use-skill.mdc': '.claude/skills/auth-and-logging/SKILL.md' }

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
export const sha256 = (data) => createHash('sha256').update(data).digest('hex')
export const posix = (p) => p.split(sep).join('/')
export const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0)

export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('$')) continue
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out)
    else out[key] = v
  }
  return out
}

export function unflatten(flat) {
  const out = {}
  for (const [key, v] of Object.entries(flat)) {
    const parts = key.split('.')
    let cur = out
    parts.slice(0, -1).forEach((p) => (cur = cur[p] ??= {}))
    cur[parts.at(-1)] = v
  }
  return out
}

/**
 * Project overrides: kit.config.json `overrides` = [{ "path": "<installed path>", "reason": "<why>" }].
 * An overridden path belongs to the project for good: install skips it, sync reports it `override` and never writes it.
 * Exact paths only (no globs), so every kept difference is named on its own line. Returns Map(path -> reason).
 */
export function readOverrides(project) {
  const list = project?.overrides ?? []
  if (!Array.isArray(list)) throw new Error('kit.config.json "overrides" must be a list of { "path", "reason" }')
  const map = new Map()
  for (const o of list) {
    if (!o || typeof o.path !== 'string' || o.path.trim() === '' || typeof o.reason !== 'string' || o.reason.trim() === '') {
      throw new Error(`every override needs a non-empty "path" and "reason" (got ${JSON.stringify(o)})`)
    }
    map.set(o.path.trim().replace(/\\/g, '/').replace(/^\.\//, ''), o.reason.trim())
  }
  return map
}

export function loadPack(kitRoot, name) {
  const file = join(kitRoot, 'packs', name, 'pack.json')
  if (!existsSync(file)) throw new Error(`unknown pack "${name}" (no packs/${name}/pack.json)`)
  return readJson(file)
}

export function loadLayer(kitRoot, name) {
  if (name === 'cursor') throw new Error('the Cursor layer is chosen with --cursor, not --layers')
  const file = join(kitRoot, 'layers', name, 'layer.json')
  if (!existsSync(file)) throw new Error(`unknown layer "${name}" (no layers/${name}/layer.json)`)
  return readJson(file)
}

/** Selected packs then layers, in that order: [{ kind, name, dir, manifest }] (dir relative to the kit root). */
export function selectedUnits(kitRoot, packs, layers = []) {
  return [
    ...packs.map((name) => ({ kind: 'pack', name, dir: `packs/${name}`, manifest: loadPack(kitRoot, name) })),
    ...layers.map((name) => ({ kind: 'layer', name, dir: `layers/${name}`, manifest: loadLayer(kitRoot, name) })),
  ]
}

/** A comma list from a flag value ("a, b" -> [a, b]; "" -> []). */
export const splitList = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean)

/**
 * Stack detection: which packs and layers match the project. Each pack.json / layer.json may carry
 *   "detect": { "order": <n, packs: lower first>, "anyOf": [ <rule>, … ] }
 * and a rule matches when every condition in it holds:
 *   deps: [names]   all of them in a package.json's dependencies / devDependencies / peerDependencies;
 *                   in: [folders] which package.json files to read ("" = the root; "{paths.serverRoot}" = the
 *                   project's configured backend folder, skipped when unset); default the root only
 *   path: "<p>"     the file or folder exists in the project
 *   gitRemote: "<name>"   the project's git repo has that remote
 * and "suggestOnly": true makes a match a suggestion (printed, never installed by --yes).
 * Returns { packs: [{ name, why }], layers: [{ name, why }], suggested: [{ name, why, kind }] }.
 */
export function detectStack({ kitRoot, target, project = {} }) {
  const pkgCache = new Map()
  const deps = (folder) => {
    if (!pkgCache.has(folder)) {
      let set = null
      try {
        const p = readJson(join(target, folder, 'package.json'))
        set = new Set(['dependencies', 'devDependencies', 'peerDependencies'].flatMap((k) => Object.keys(p[k] ?? {})))
      } catch { /* no or unreadable package.json */ }
      pkgCache.set(folder, set)
    }
    return pkgCache.get(folder)
  }
  let remotes = null
  const hasRemote = (name) => {
    if (remotes == null) {
      const r = spawnSync('git', ['remote'], { cwd: target, encoding: 'utf8' })
      remotes = new Set(r.status === 0 ? r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [])
    }
    return remotes.has(name)
  }
  const serverRoot = flatten(project)['paths.serverRoot']
  const ruleWhy = (rule) => {
    const why = []
    if (rule.deps) {
      const folders = (rule.in ?? ['']).map((f) => (f === '{paths.serverRoot}' ? (isEmpty(serverRoot) ? null : serverRoot) : f)).filter((f) => f != null)
      const hit = [...new Set(folders)].find((f) => {
        const d = deps(f)
        return d && rule.deps.every((n) => d.has(n))
      })
      if (hit == null) return null
      why.push(`${hit ? `${hit.replace(/\/?$/, '/')}` : ''}package.json has ${rule.deps.join(' + ')}`)
    }
    if (rule.path != null) {
      if (!existsSync(join(target, rule.path))) return null
      why.push(`${rule.path} exists`)
    }
    if (rule.gitRemote != null) {
      if (!hasRemote(rule.gitRemote)) return null
      why.push(`git remote "${rule.gitRemote}" exists`)
    }
    return why.length ? why.join(', ') : null
  }
  const scan = (folder, load) => {
    const dir = join(kitRoot, folder)
    if (!existsSync(dir)) return []
    const out = []
    for (const name of readdirSync(dir).sort()) {
      let m
      try {
        m = load(kitRoot, name)
      } catch {
        continue // not a pack / layer folder (e.g. the Cursor layer)
      }
      for (const rule of m.detect?.anyOf ?? []) {
        const why = ruleWhy(rule)
        if (why) {
          out.push({ name, why, order: m.detect.order ?? 50, suggest: !!m.detect.suggestOnly })
          break
        }
      }
    }
    return out.sort((a, b) => a.order - b.order).map(({ name, why, suggest }) => ({ name, why, suggest }))
  }
  // A `suggestOnly` rule (e.g. an `upstream` remote, which every fork clone has) is printed as a suggestion with its
  // reason, never installed by --yes: the Human names it with --layers / --packs.
  const all = [...scan('packs', loadPack), ...scan('layers', loadLayer).map((l) => ({ ...l, layer: true }))]
  const strip = ({ name, why }) => ({ name, why })
  return {
    packs: all.filter((u) => !u.layer && !u.suggest).map(strip),
    layers: all.filter((u) => u.layer && !u.suggest).map(strip),
    suggested: all.filter((u) => u.suggest).map((u) => ({ ...strip(u), kind: u.layer ? 'layer' : 'pack' })),
  }
}

// Glob -> RegExp for ownership.upstreamPaths: `**` any depth, `*` within one folder, `?` one character; a trailing
// slash means everything under the folder.
export function globToRegExp(glob) {
  let g = glob.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (g.endsWith('/')) g += '**'
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*' && g[i + 1] === '*') {
      if (g[i + 2] === '/') {
        re += '(?:.*/)?'
        i += 2
      } else {
        re += '.*'
        i += 1
      }
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/** The project's upstream-owned path globs (ownership.upstreamPaths), as a list. */
export const upstreamGlobs = (vals) => asList(vals['ownership.upstreamPaths'])

/**
 * overrides plus every one of `dests` that an ownership.upstreamPaths glob matches (reason "upstream-owned"):
 * install never writes them, sync and drift-check report them as `override`. A new Map; explicit overrides keep
 * their own reason.
 */
export function withUpstream(overrides, vals, dests) {
  const res = upstreamGlobs(vals).map(globToRegExp)
  const out = new Map(overrides)
  if (res.length === 0) return out
  for (const d of dests) if (!out.has(d) && res.some((r) => r.test(d))) out.set(d, 'upstream-owned (ownership.upstreamPaths)')
  return out
}

/** Effective flat config: project > pack defaults > kit defaults, then computed defaults. */
export function resolveConfig({ kitRoot, project, packs, layers = [], target, platform = process.platform, nodeVersion = process.versions.node }) {
  const base = flatten(readJson(join(kitRoot, 'kit.config.json')))
  const packLayer = {}
  const techdebtRules = []
  // Packs first, then layers: a layer adds to the stack (lists add up) and fills what no pack set.
  for (const { kind, manifest: pack } of selectedUnits(kitRoot, packs, layers)) {
    techdebtRules.push(...(pack.techdebtRules ?? []))
    // The first pack named is the primary stack: its standards doc is the one core files point at.
    if (kind === 'pack' && isEmpty(packLayer['stack.standardsDoc'])) packLayer['stack.standardsDoc'] = pack.standardsDoc
    // The pack contract: what the pack provides for the core references (first pack that provides a key wins).
    for (const [k, v] of Object.entries(pack.provides ?? {})) if (isEmpty(packLayer[`stack.${k}`])) packLayer[`stack.${k}`] = v
    for (const [k, v] of Object.entries(pack.configDefaults ?? {})) {
      // Lists add up across packs (hotspots, sensitive paths), except slots.* argument lists: the first pack's wins.
      if (Array.isArray(v) && !k.startsWith('slots.')) packLayer[k] = [...new Set([...(packLayer[k] ?? []), ...v])]
      else if (isEmpty(packLayer[k])) packLayer[k] = v
    }
  }
  const proj = flatten(project ?? {})
  const vals = {}
  for (const key of new Set([...Object.keys(base), ...Object.keys(packLayer), ...Object.keys(proj)])) {
    vals[key] = !isEmpty(proj[key]) ? proj[key] : !isEmpty(packLayer[key]) ? packLayer[key] : base[key]
  }
  vals['stack.packs'] = packs
  vals['stack.layers'] = layers
  const name = isEmpty(vals['project.name']) ? basename(resolve(target)) : vals['project.name']
  vals['project.name'] = name
  if (isEmpty(vals['slots.fePorts'])) vals['slots.fePorts'] = 4200
  if (isEmpty(vals['slots.bePorts'])) vals['slots.bePorts'] = 3000
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  if (isEmpty(vals['slots.dbNameFormat'])) vals['slots.dbNameFormat'] = `${slug}_wt\${n}`
  if (isEmpty(vals['slots.dbBackupDir'])) vals['slots.dbBackupDir'] = `${slug}-db-backups`
  if (isEmpty(vals['project.repoName'])) vals['project.repoName'] = basename(resolve(target))
  if (isEmpty(vals['paths.sharedDocs'])) vals['paths.sharedDocs'] = 'docs/project'
  if (isEmpty(vals['hooks.shellPath'])) {
    vals['hooks.shellPath'] = platform === 'win32' && existsSync('C:/Program Files/Git/bin/bash.exe') ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
  }
  // Builtins (not config keys): per-OS MCP launcher and the Node pin.
  vals['kit.mcpCommand'] = platform === 'win32' ? 'cmd' : 'npx'
  vals['kit.mcpArgs'] = platform === 'win32' ? '"/c", "npx", ' : ''
  vals['kit.nodeVersion'] = nodeVersion
  // The stack packs' tech-debt scan rules (pack.json techdebtRules), in pack order.
  vals['kit.techdebtRules'] = techdebtRules
  // tools.browser equal to the kit default (unset, or copied into the effective config install writes): the
  // AGENTS.md skeleton then leaves the tool name out. Compared by value, so install, sync and drift agree.
  vals['kit.browserSet'] = !isEmpty(vals['tools.browser']) && vals['tools.browser'] !== base['tools.browser']
  // commands.dev starts a slot frontend; none of the slots.fe* values differ from the kit defaults = nothing
  // (pack or project) said how. Install and sync print a NOTE then (e.g. an old backend-only `commands.dev: "dev"`).
  const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '')
  vals['kit.feDefaults'] = ['slots.feExec', 'slots.fePortArgs', 'slots.feMatcher', 'slots.feEnvFile'].every((k) => same(vals[k], base[k]))
  // scripts/package.json keeps the module type the root package.json gives the project's own scripts/*.js files.
  let rootType = 'commonjs'
  try {
    const t = readJson(join(resolve(target), 'package.json')).type
    if (t === 'module' || t === 'commonjs') rootType = t
  } catch { /* no or unreadable package.json: Node's default */ }
  vals['kit.scriptsType'] = rootType
  return vals
}

const PLACEHOLDER = /\{\{([a-zA-Z][\w.]*)(?:\|(\w+))?\}\}/g
const asList = (v) => (Array.isArray(v) ? v : isEmpty(v) ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean))

/** Render placeholders. Unknown keys stay verbatim and are reported in `unknown`; empty keys in `notSet`. */
export function render(text, vals, report = { unknown: new Set(), notSet: new Set() }) {
  const out = text.replace(PLACEHOLDER, (whole, key, filter) => {
    if (!(key in vals)) {
      report.unknown.add(key)
      return whole
    }
    const v = vals[key]
    const list = asList(v)
    if (filter === 'quoted') return list.length ? list.map((i) => `'${i}'`).join(', ') : "''"
    if (filter === 'dquoted') return list.length ? list.map((i) => `"${i}"`).join(', ') : '""'
    if (filter === 'glob') return list.length > 1 ? `{${list.join(',')}}` : (list[0] ?? '')
    // A JS/JSON literal of the value as configured (a string stays a string, a list a list): code that must tell them apart.
    if (filter === 'json') return JSON.stringify(v ?? '')
    // Regex alternation body for shell guards: plans|plans/design (dots escaped).
    if (filter === 'alt') return list.map((i) => i.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    if (isEmpty(v)) {
      if (BLANK_OK.has(key)) return ''
      report.notSet.add(key)
      return NOT_SET
    }
    return Array.isArray(v) ? v.join(', ') : String(v)
  })
  return { text: out, report }
}

function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, base, out)
    else out.push(posix(relative(base, full)))
  }
  return out.sort()
}

const sections = (md) => {
  const out = {}
  let cur = null
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    const m = /^## (.+?)\s*$/.exec(line)
    if (m) cur = out[m[1]] = []
    else if (cur && line.trim()) cur.push(line)
  }
  return out
}

/** Replace a marker line with the lines every installed pack contributes to that section. */
function fillMarker(text, marker, lines) {
  return text.replace(new RegExp(`^<!-- ${marker} -->[ \\t]*\\r?\\n`, 'm'), lines.length ? `${lines.join('\n')}\n` : '')
}

// A husky hook runs only scripts that were installed.
function trimHusky(text, planned) {
  return text
    .split('\n')
    .filter((line) => {
      const script = /^node (scripts\/\S+\.mjs)/.exec(line.trim())
      if (script) return planned.has(script[1])
      if (/\bnpx lint-staged\b/.test(line)) return planned.has('.lintstagedrc.mjs')
      return true
    })
    .join('\n')
}

/** Git hooks the kit writes must be executable: on disk, and in the git index (Windows ignores the file mode). */
export const isHook = (dest) => dest.startsWith('.husky/')

/** chmod 755 each written hook and stage it as 100755 when the target is a git work tree. Returns a log line or null. */
export function markHooksExecutable(target, dests) {
  if (dests.length === 0) return null
  for (const d of dests) chmodSync(join(target, d), 0o755)
  const inRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: target, encoding: 'utf8' }).stdout?.trim() === 'true'
  if (!inRepo) return null
  const r = spawnSync('git', ['add', '--chmod=+x', '--', ...dests], { cwd: target, encoding: 'utf8' })
  return r.status === 0 ? `NOTE staged ${dests.join(', ')} as executable (git add --chmod=+x)` : `NOTE could not stage the hooks as executable; run: git add --chmod=+x ${dests.join(' ')}`
}

/**
 * Plan every file the kit would install: [{ dest, kind, source, content }] (content rendered).
 * `vals` is the output of resolveConfig.
 */
/** The Claude Code mods the kit's own marketplace serves (`.claude-plugin/marketplace.json`, `mods/<name>/`). */
export const MODS = ['fleet', 'guards', 'ship-pilot']
export const MODS_MARKETPLACE = 'ai-workflow-kit-mods'

/**
 * settings.json with the mods a project turned on (`mods.enabled`): the kit's marketplace (auto-updating) and one
 * enabledPlugins entry per mod. No mods enabled = the text unchanged.
 */
export function withMods(text, vals) {
  const enabled = asList(vals['mods.enabled'])
  if (!enabled.length) return text
  const s = JSON.parse(text)
  const out = {}
  for (const [k, v] of Object.entries(s)) {
    if (k === 'enabledPlugins') out.extraKnownMarketplaces = { [MODS_MARKETPLACE]: { source: { source: 'github', repo: String(vals['mods.marketplaceRepo']) }, autoUpdate: true } }
    out[k] = v
  }
  out.enabledPlugins = { ...(s.enabledPlugins ?? {}), ...Object.fromEntries(enabled.map((m) => [`${m}@${MODS_MARKETPLACE}`, true])) }
  return `${JSON.stringify(out, null, 2)}\n`
}

export function planFiles({ kitRoot, packs, layers = [], cursor, yesChef, vals, agentsWorkflow = false }) {
  const units = selectedUnits(kitRoot, packs, layers)
  // Builtin for KIT:if: the Cursor layer is installed (set = not empty).
  vals = { ...vals, 'kit.cursor': cursor ? 'yes' : '' }
  const report = { unknown: new Set(), notSet: new Set() }
  const raw = new Map() // dest -> { kind, source, text }
  const add = (dest, kind, source) => {
    const text = readFileSync(join(kitRoot, source), 'utf8')
    const prev = raw.get(dest)
    if (!prev) return raw.set(dest, { kind, source, text })
    // Gotcha files are split per stack: core and a pack may both contribute entries to one domain file.
    if (!GOTCHA_FILE.test(dest)) throw new Error(`path clash: ${dest} comes from both ${prev.source} and ${source}`)
    const body = text.replace(/^﻿?# .*\r?\n+/, '')
    raw.set(dest, { kind, source: `${prev.source} + ${source}`, text: `${prev.text.trimEnd()}\n\n---\n\n${body}` })
  }
  // Brain lessons are a starter set: the project appends its own lessons to these files, so they are
  // seeds (written once, then the project's) rather than managed files that sync keeps comparing.
  const kindOf = (f) => (f.startsWith('docs/brain/') ? 'seed' : 'managed')
  for (const f of walk(join(kitRoot, 'core'))) add(f, kindOf(f), `core/${f}`)
  const skipWhen = new Map() // dest -> alternatives (an optional pack seed)
  const fragments = [] // FRAGMENTS.md sections per selected pack, in pack order
  for (const { dir, manifest: pack } of units) {
    const seeds = pack.seeds ?? {}
    for (const f of walk(join(kitRoot, dir))) {
      if (PACK_SKIP.has(f) || f === pack.agentsFragment || f === pack.fragments) continue
      add(f, f in seeds ? 'seed' : kindOf(f), `${dir}/${f}`)
      if (seeds[f]?.skipWhenPresent?.length) skipWhen.set(f, seeds[f].skipWhenPresent)
    }
    if (pack.fragments) fragments.push(fragmentSections(readFileSync(join(kitRoot, dir, pack.fragments), 'utf8')))
  }
  if (cursor) for (const f of walk(join(kitRoot, 'layers', 'cursor'))) add(f, 'managed', `layers/cursor/${f}`)
  const tplRoot = join(kitRoot, 'templates')
  for (const f of walk(tplRoot)) {
    if (f.startsWith('fragments/')) continue
    if (f.startsWith('cursor/')) {
      if (cursor) add(f.slice('cursor/'.length), 'seed', `templates/${f}`)
      continue
    }
    const dest = f.startsWith('docs/project/') ? `${vals['paths.sharedDocs']}/${f.slice('docs/project/'.length)}` : f
    add(dest, 'seed', `templates/${f}`)
  }
  for (const [dest, needs] of Object.entries(REQUIRES)) if (raw.has(dest) && !raw.has(needs)) raw.delete(dest)
  // The project owns AGENTS.md: the kit's rules are rendered into AGENTS.workflow.md, a managed file.
  if (agentsWorkflow && raw.has('AGENTS.md')) {
    const a = raw.get('AGENTS.md')
    raw.delete('AGENTS.md')
    raw.set(AGENTS_WORKFLOW, { kind: 'managed', source: a.source, text: a.text })
  }

  // Pack-supplied sections for the seed skeletons.
  const frag = { 'Hard rules': [], 'Skill triggers': [], 'Standards index': [] }
  const gotchaRows = []
  for (const { dir, manifest: pack } of units) {
    if (pack.agentsFragment) {
      const s = sections(readFileSync(join(kitRoot, dir, pack.agentsFragment), 'utf8'))
      for (const k of Object.keys(frag)) frag[k].push(...(s[k] ?? []))
    }
    for (const g of pack.gotchas ?? []) gotchaRows.push(g)
  }
  const planned = new Set(raw.keys())
  const files = []
  for (const [dest, { kind, source, text }] of raw) {
    let body = text
    if (dest === 'AGENTS.md' || dest === AGENTS_WORKFLOW) {
      body = fillMarker(body, 'PACK:hard-rules', frag['Hard rules'])
      body = fillMarker(body, 'PACK:skill-triggers', frag['Skill triggers'])
      body = fillMarker(body, 'PACK:standards-index', frag['Standards index'])
      // No browser tool configured: keep the guidance, drop the "Browser tool: browser tool." name.
      if (!vals['kit.browserSet']) body = body.replace('Browser tool: {{tools.browser}}. Default: hand', 'Browser checks: hand')
      if (dest === AGENTS_WORKFLOW) body = body.replace(/^# AGENTS\.md(.*)\r?\n/, (_, rest) => `# ${AGENTS_WORKFLOW}${rest}\n\n${AGENTS_WORKFLOW_NOTE}\n`)
    } else if (dest === 'CLAUDE.md') {
      body = fillMarker(body, 'KIT:yes-chef', yesChef ? readFileSync(join(tplRoot, 'fragments', 'yes-chef.md'), 'utf8').trimEnd().split('\n') : [])
      body = fillMarker(body, 'KIT:agents-workflow', agentsWorkflow ? [`@${AGENTS_WORKFLOW}`] : [])
    } else if (dest === '.claude/settings.json') {
      body = withMods(body, vals)
    } else if (dest === '.gitignore') {
      const list = runtimeIgnores(kitRoot)
      if (list) body = body.replace(/^# KIT:runtime-ignores[ \t]*\r?\n/m, `${list.join('\n')}\n`)
    } else if (dest === 'docs/brain/gotchas.md') {
      const rows = gotchaRows
        .filter((g) => !body.includes(`./gotchas/${basename(g)}`))
        .map((g) => `| [${basename(g, '.md')}](./gotchas/${basename(g)}) | Stack pack gotchas |`)
      body = fillMarker(body, 'KIT:gotcha-rows', rows)
    }
    body = applyConditionals(fillPackMarkers(body, fragments), vals, source)
    if (dest.startsWith('.husky/')) body = trimHusky(body, planned)
    const file = { dest, kind, source, content: render(body, vals, report).text }
    if (skipWhen.has(dest)) file.skipWhenPresent = skipWhen.get(dest)
    files.push(file)
  }
  files.sort((a, b) => (a.dest < b.dest ? -1 : 1))
  return { files, report }
}

export function parseArgs(argv, spec) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`)
    // --key=value is the same as --key value (and the only way PowerShell 5 passes an empty value: --packs=).
    const eq = a.indexOf('=')
    const key = eq > 0 ? a.slice(2, eq) : a.slice(2)
    if (!(key in spec)) throw new Error(`unknown flag: ${a}`)
    if (spec[key] === 'bool') {
      if (eq > 0) throw new Error(`${key} takes no value: ${a}`)
      out[key] = true
    } else out[key] = eq > 0 ? a.slice(eq + 1) : argv[++i]
  }
  return out
}
