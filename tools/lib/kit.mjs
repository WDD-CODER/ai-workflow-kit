/**
 * Shared engine for kit-install and kit-sync: config resolution, placeholder
 * rendering and the planned file set. Node built-ins only.
 *
 * Layers (first wins on a path clash is an error, never silent):
 *   core/            managed   every project
 *   packs/<name>/    managed   per selected stack pack (pack.json, AGENTS.fragment.md are not installed)
 *   layers/cursor/   managed   with the Cursor layer
 *   templates/       seed      written once, never updated by sync; templates/cursor/** only with the Cursor layer;
 *                              templates/fragments/** are inputs, not files
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { createHash } from 'crypto'
import { resolve, join, dirname, basename, relative, sep } from 'path'
import { fileURLToPath } from 'url'

export const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const NOT_SET = '(not set)'
// Empty is the right rendering for these (they are prefixes / optional fragments, not words in a sentence).
const BLANK_OK = new Set(['paths.srcRoot', 'paths.serverRoot', 'paths.slotEnvFile', 'kit.mcpArgs'])
export const REQUIRED = ['project.name', 'commands.build', 'commands.lint', 'commands.test', 'hooks.shellPath']
const GOTCHA_FILE = /^docs\/brain\/gotchas\/[^/]+\.md$/
const PACK_SKIP = new Set(['pack.json', 'AGENTS.fragment.md'])
// A rule that points at a skill is installed only when that skill is.
const REQUIRES = { '.cursor/rules/auth-and-logging-must-use-skill.mdc': '.claude/skills/auth-and-logging/SKILL.md' }

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

export function loadPack(kitRoot, name) {
  const file = join(kitRoot, 'packs', name, 'pack.json')
  if (!existsSync(file)) throw new Error(`unknown pack "${name}" (no packs/${name}/pack.json)`)
  return readJson(file)
}

/** Effective flat config: project > pack defaults > kit defaults, then computed defaults. */
export function resolveConfig({ kitRoot, project, packs, target, platform = process.platform, nodeVersion = process.versions.node }) {
  const base = flatten(readJson(join(kitRoot, 'kit.config.json')))
  const packLayer = {}
  for (const name of packs) {
    const pack = loadPack(kitRoot, name)
    // The first pack named is the primary stack: its standards doc is the one core files point at.
    if (isEmpty(packLayer['stack.standardsDoc'])) packLayer['stack.standardsDoc'] = pack.standardsDoc
    for (const [k, v] of Object.entries(pack.configDefaults ?? {})) {
      if (Array.isArray(v)) packLayer[k] = [...new Set([...(packLayer[k] ?? []), ...v])]
      else if (isEmpty(packLayer[k])) packLayer[k] = v
    }
  }
  const proj = flatten(project ?? {})
  const vals = {}
  for (const key of new Set([...Object.keys(base), ...Object.keys(packLayer), ...Object.keys(proj)])) {
    vals[key] = !isEmpty(proj[key]) ? proj[key] : !isEmpty(packLayer[key]) ? packLayer[key] : base[key]
  }
  vals['stack.packs'] = packs
  const name = isEmpty(vals['project.name']) ? basename(resolve(target)) : vals['project.name']
  vals['project.name'] = name
  if (isEmpty(vals['slots.fePorts'])) vals['slots.fePorts'] = 4200
  if (isEmpty(vals['slots.bePorts'])) vals['slots.bePorts'] = 3000
  if (isEmpty(vals['slots.dbNameFormat'])) vals['slots.dbNameFormat'] = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}_wt\${n}`
  if (isEmpty(vals['paths.sharedDocs'])) vals['paths.sharedDocs'] = 'docs/project'
  if (isEmpty(vals['hooks.shellPath'])) {
    vals['hooks.shellPath'] = platform === 'win32' && existsSync('C:/Program Files/Git/bin/bash.exe') ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
  }
  // Builtins (not config keys): per-OS MCP launcher and the Node pin.
  vals['kit.mcpCommand'] = platform === 'win32' ? 'cmd' : 'npx'
  vals['kit.mcpArgs'] = platform === 'win32' ? '"/c", "npx", ' : ''
  vals['kit.nodeVersion'] = nodeVersion
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
      if (/^npx lint-staged\b/.test(line.trim())) return planned.has('.lintstagedrc.mjs')
      return true
    })
    .join('\n')
}

/**
 * Plan every file the kit would install: [{ dest, kind, source, content }] (content rendered).
 * `vals` is the output of resolveConfig.
 */
export function planFiles({ kitRoot, packs, cursor, yesChef, vals }) {
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
  for (const f of walk(join(kitRoot, 'core'))) add(f, 'managed', `core/${f}`)
  for (const p of packs) {
    for (const f of walk(join(kitRoot, 'packs', p))) if (!PACK_SKIP.has(f)) add(f, 'managed', `packs/${p}/${f}`)
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

  // Pack-supplied sections for the seed skeletons.
  const frag = { 'Hard rules': [], 'Skill triggers': [], 'Standards index': [] }
  const gotchaRows = []
  for (const p of packs) {
    const pack = loadPack(kitRoot, p)
    if (pack.agentsFragment) {
      const s = sections(readFileSync(join(kitRoot, 'packs', p, pack.agentsFragment), 'utf8'))
      for (const k of Object.keys(frag)) frag[k].push(...(s[k] ?? []))
    }
    for (const g of pack.gotchas ?? []) gotchaRows.push(g)
  }
  const planned = new Set(raw.keys())
  const files = []
  for (const [dest, { kind, source, text }] of raw) {
    let body = text
    if (dest === 'AGENTS.md') {
      body = fillMarker(body, 'PACK:hard-rules', frag['Hard rules'])
      body = fillMarker(body, 'PACK:skill-triggers', frag['Skill triggers'])
      body = fillMarker(body, 'PACK:standards-index', frag['Standards index'])
    } else if (dest === 'CLAUDE.md') {
      body = fillMarker(body, 'KIT:yes-chef', yesChef ? readFileSync(join(tplRoot, 'fragments', 'yes-chef.md'), 'utf8').trimEnd().split('\n') : [])
    } else if (dest === 'docs/brain/gotchas.md') {
      const rows = gotchaRows
        .filter((g) => !body.includes(`./gotchas/${basename(g)}`))
        .map((g) => `| [${basename(g, '.md')}](./gotchas/${basename(g)}) | Stack pack gotchas |`)
      body = fillMarker(body, 'KIT:gotcha-rows', rows)
    } else if (dest.startsWith('.husky/')) {
      body = trimHusky(body, planned)
    }
    files.push({ dest, kind, source, content: render(body, vals, report).text })
  }
  files.sort((a, b) => (a.dest < b.dest ? -1 : 1))
  return { files, report }
}

export function parseArgs(argv, spec) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`)
    const key = a.slice(2)
    if (!(key in spec)) throw new Error(`unknown flag: ${a}`)
    if (spec[key] === 'bool') out[key] = true
    else out[key] = argv[++i]
  }
  return out
}
