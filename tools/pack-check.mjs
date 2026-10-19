/**
 * Pack contract check — every stack pack under packs/ must carry a valid pack.json
 * and the files it names. Run from the kit repo root:
 *
 *   node tools/pack-check.mjs
 *
 * Contract keys: name, standardsDoc, skills[], cursorRules[], gotchas[], validation[].
 * validation entries are npm script names only (no spaces, no raw commands).
 * Optional: provides (the pack contract, tools/lib/kit.mjs CONTRACT: each value must exist in the pack), fragments
 * (a file whose `## <name>` sections each fill a PACK:<name> marker some core file has), seeds (pack files installed
 * as seeds), agentsFragment, configDefaults, techdebtRules (each pattern a valid regex), detect ({ order, anyOf: [rules] },
 * each rule with deps / path / gitRemote — the installer's stack detection).
 * Layers (layers/<name>/ except the Cursor layer) carry layer.json with the same optional fields (name = folder;
 * a layer has no standards doc, so it provides no `section` key); their provides count as providers.
 *
 * Core side of the contract (core/, layers/, templates/):
 *   - a `{{stack.<key>}}` contract placeholder only inside a `KIT:if stack.<key>` block (a project without the
 *     pack gets the fallback, never a dangling path), and some pack must provide every key core uses;
 *   - no literal reference to a workflow file or skill only a pack ships (`docs/agent/conventions.md`, a backticked
 *     skill name): it dangles with packs []. Use the contract key or a PACK: fragment instead.
 * Node built-ins only. Exit 0 = ok, 1 = problems (one per line).
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { resolve, join, relative } from 'path'
import { CONTRACT, REQUIRES, fragmentSections, packMarker, condLine } from './lib/kit.mjs'

const packsDir = resolve('packs')
const problems = []
let checked = 0

const configKeys = new Set()
const collectKeys = (obj, prefix) => {
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('$')) continue
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) collectKeys(v, key)
    else configKeys.add(key)
  }
}
collectKeys(JSON.parse(readFileSync(resolve('kit.config.json'), 'utf8')), '')

function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, base, out)
    else out.push(relative(base, p).replace(/\\/g, '/'))
  }
  return out
}

const providers = {} // contract key -> packs that provide it
const fragmentNames = [] // [pack, section name]
const packOnly = new Map() // installed workflow path -> pack
const packSkills = new Map() // skill name -> pack

const packs = existsSync(packsDir)
  ? readdirSync(packsDir).filter((d) => statSync(join(packsDir, d)).isDirectory())
  : []

for (const dir of packs) {
  const root = join(packsDir, dir)
  const file = join(root, 'pack.json')
  if (!existsSync(file)) {
    problems.push(`${dir}: missing pack.json`)
    continue
  }
  checked++
  let pack
  try {
    pack = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    problems.push(`${dir}: pack.json is not valid JSON (${e.message})`)
    continue
  }
  if (pack.name !== dir) problems.push(`${dir}: name "${pack.name}" must equal the folder name`)
  if (typeof pack.standardsDoc !== 'string' || !pack.standardsDoc) problems.push(`${dir}: standardsDoc must be a path`)
  else if (!existsSync(join(root, pack.standardsDoc))) problems.push(`${dir}: standardsDoc not found: ${pack.standardsDoc}`)
  for (const key of ['skills', 'cursorRules', 'gotchas', 'validation']) {
    if (!Array.isArray(pack[key])) problems.push(`${dir}: ${key} must be an array`)
  }
  for (const s of pack.skills ?? []) {
    if (!existsSync(join(root, '.claude/skills', s, 'SKILL.md'))) problems.push(`${dir}: skill not found: ${s}`)
  }
  for (const r of pack.cursorRules ?? []) {
    if (!existsSync(join(root, '.cursor/rules', `${r}.mdc`))) problems.push(`${dir}: cursor rule not found: ${r}`)
  }
  for (const g of pack.gotchas ?? []) {
    if (!existsSync(join(root, g))) problems.push(`${dir}: gotchas file not found: ${g}`)
  }
  for (const v of pack.validation ?? []) {
    if (!/^[\w:.-]+$/.test(v)) problems.push(`${dir}: validation "${v}" must be an npm script name, not a command`)
  }
  checkOptional(dir, root, pack, typeof pack.standardsDoc === 'string' ? join(root, pack.standardsDoc) : null)
  // What only this pack ships, which a core file must not name: workflow paths and skill names.
  const meta = new Set(['pack.json', pack.agentsFragment, pack.fragments].filter(Boolean))
  for (const f of walk(root)) if (!meta.has(f) && /^(docs|\.claude|scripts)\//.test(f)) packOnly.set(f, dir)
  for (const s of pack.skills ?? []) packSkills.set(s, dir)
}

// Layers: the same optional fields in layer.json (the Cursor layer has none and is chosen with --cursor).
const layersDir = resolve('layers')
const layerDirs = existsSync(layersDir) ? readdirSync(layersDir).filter((d) => d !== 'cursor' && statSync(join(layersDir, d)).isDirectory()) : []
let layersChecked = 0
for (const dir of layerDirs) {
  const root = join(layersDir, dir)
  const file = join(root, 'layer.json')
  if (!existsSync(file)) {
    problems.push(`layers/${dir}: missing layer.json`)
    continue
  }
  layersChecked++
  let layer
  try {
    layer = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    problems.push(`layers/${dir}: layer.json is not valid JSON (${e.message})`)
    continue
  }
  if (layer.name !== dir) problems.push(`layers/${dir}: name "${layer.name}" must equal the folder name`)
  for (const g of layer.gotchas ?? []) if (!existsSync(join(root, g))) problems.push(`layers/${dir}: gotchas file not found: ${g}`)
  checkOptional(`layers/${dir}`, root, layer, null)
}

/** The optional manifest fields packs and layers share (agentsFragment, configDefaults, provides, fragments, seeds,
 * techdebtRules, detect). `docPath` = the pack's standards doc (a `section` contract key names one of its headings). */
function checkOptional(dir, root, pack, docPath) {
  if (pack.agentsFragment != null) {
    const frag = join(root, String(pack.agentsFragment))
    if (!existsSync(frag)) problems.push(`${dir}: agentsFragment not found: ${pack.agentsFragment}`)
    else {
      const text = readFileSync(frag, 'utf8')
      for (const h of ['## Hard rules', '## Skill triggers', '## Standards index']) {
        if (!text.includes(h)) problems.push(`${dir}: agentsFragment is missing "${h}"`)
      }
    }
  }
  for (const key of Object.keys(pack.configDefaults ?? {})) {
    if (!configKeys.has(key)) problems.push(`${dir}: configDefaults key not in kit.config.json: ${key}`)
  }
  // The pack contract: each provided value must exist in the pack.
  const headings = docPath && existsSync(docPath)
    ? readFileSync(docPath, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim())
    : []
  for (const [key, value] of Object.entries(pack.provides ?? {})) {
    const kind = CONTRACT[key]
    if (!kind) {
      problems.push(`${dir}: provides "${key}" is not a contract key (${Object.keys(CONTRACT).join(', ')})`)
      continue
    }
    providers[key] = [...(providers[key] ?? []), dir]
    if (!configKeys.has(`stack.${key}`)) problems.push(`${dir}: contract key stack.${key} is missing from kit.config.json`)
    else if (typeof value !== 'string' || !value) problems.push(`${dir}: provides.${key} must be a non-empty string`)
    else if (kind === 'skill' && !existsSync(join(root, '.claude/skills', value, 'SKILL.md'))) problems.push(`${dir}: provides.${key}: skill not found: ${value}`)
    else if ((kind === 'doc' || kind === 'script') && !existsSync(join(root, value))) problems.push(`${dir}: provides.${key}: file not found: ${value}`)
    else if (kind === 'section' && !headings.includes(value)) problems.push(`${dir}: provides.${key}: ${docPath ? `${pack.standardsDoc} has no "## ${value}" section` : 'only a pack with a standardsDoc provides a section'}`)
  }
  if (pack.fragments != null) {
    const frag = join(root, String(pack.fragments))
    if (!existsSync(frag)) problems.push(`${dir}: fragments file not found: ${pack.fragments}`)
    else for (const name of Object.keys(fragmentSections(readFileSync(frag, 'utf8')))) fragmentNames.push([dir, name])
  }
  for (const s of Object.keys(pack.seeds ?? {})) {
    if (!existsSync(join(root, s))) problems.push(`${dir}: seed not found: ${s}`)
  }
  for (const r of pack.techdebtRules ?? []) {
    if (!r || typeof r.id !== 'string' || !(typeof r.pattern === 'string' || Number.isInteger(r.lines))) {
      problems.push(`${dir}: techdebtRules entry needs an id and a pattern (or lines): ${JSON.stringify(r)}`)
      continue
    }
    for (const k of ['pattern', 'exclude']) {
      try {
        if (r[k] != null) new RegExp(r[k], k === 'pattern' ? r.flags ?? '' : '')
      } catch (e) {
        problems.push(`${dir}: techdebtRules ${r.id}: ${k} is not a valid regex (${e.message})`)
      }
    }
  }
  if (pack.detect != null) {
    const rules = pack.detect.anyOf
    if (!Array.isArray(rules) || rules.length === 0) problems.push(`${dir}: detect.anyOf must be a non-empty list of rules`)
    for (const rule of Array.isArray(rules) ? rules : []) {
      const known = ['deps', 'in', 'path', 'gitRemote']
      const extra = Object.keys(rule ?? {}).filter((k) => !known.includes(k))
      if (!rule || extra.length || !(Array.isArray(rule.deps) || typeof rule.path === 'string' || typeof rule.gitRemote === 'string')) {
        problems.push(`${dir}: detect rule needs deps [names], path or gitRemote (only ${known.join(', ')}): ${JSON.stringify(rule)}`)
      }
    }
  }
}

// Core side: contract placeholders guarded, every used key provided, no literal pack-only reference.
const coreFiles = ['core', 'layers', 'templates'].flatMap((d) => walk(resolve(d)).map((f) => `${d}/${f}`))
const coreShips = new Set(walk(resolve('core')))
// A template rule that is installed only together with the pack skill it points at (kit.mjs REQUIRES).
const requiresOk = new Set(Object.keys(REQUIRES).map((dest) => `templates/cursor/${dest}`))
const markers = new Set()
const used = new Set()
const tick = '`'
for (const file of coreFiles) {
  const stack = []
  readFileSync(resolve(file), 'utf8').split(/\r?\n/).forEach((line, i) => {
    const at = `${file}:${i + 1}`
    const d = condLine(line)
    if (d) {
      if (d.op === 'if') stack.push({ cond: d.arg.trim(), inElse: false })
      else if (d.op === 'else' && stack.length) stack.at(-1).inElse = true
      else if (d.op === 'end') stack.pop()
      return
    }
    const marker = packMarker(line)
    if (marker) markers.add(marker)
    for (const [, key] of line.matchAll(/\{\{stack\.(\w+)(?:\|\w+)?\}\}/g)) {
      if (!(key in CONTRACT)) continue
      used.add(key)
      if (!stack.some((s) => s.cond === `stack.${key}` && !s.inElse)) problems.push(`${at}: {{stack.${key}}} outside a "KIT:if stack.${key}" block (no pack = a dangling reference)`)
    }
    if (requiresOk.has(file)) return
    for (const [p, pk] of packOnly) {
      if (!coreShips.has(p) && line.includes(p)) problems.push(`${at}: names ${p}, which only pack ${pk} ships — use a pack contract key (stack.*) or a PACK: fragment`)
    }
    for (const [s, pk] of packSkills) {
      if (line.includes(`${tick}${s}${tick}`) || line.includes(`.claude/skills/${s}/`)) problems.push(`${at}: names the skill ${s}, which only pack ${pk} ships — use a pack contract key (stack.*) or a PACK: fragment`)
    }
  })
}
for (const key of used) if (!providers[key]) problems.push(`core uses {{stack.${key}}}, but no pack provides "${key}" (pack.json provides)`)
for (const [dir, name] of fragmentNames) if (!markers.has(name)) problems.push(`${dir}: fragments section "${name}" fills no PACK:${name} marker in core, layers or templates`)

if (checked === 0 && problems.length === 0) problems.push('no packs found under packs/')
if (problems.length > 0) {
  console.error(problems.join('\n'))
  console.error(`PACK_CHECK: FAIL — ${checked} packs + ${layersChecked} layers checked, ${problems.length} problems`)
  process.exit(1)
}
console.log(`PACK_CHECK: ok — ${checked} packs, ${layersChecked} layers, ${used.size} contract keys used by core (each provided), 0 problems`)
