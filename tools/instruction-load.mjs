#!/usr/bin/env node
/**
 * A Worker's standing instruction load: the lines of the five files every plan session reads (AGENTS.md, the
 * take-plan command, the ship command, job-validation.md, standards-git.md), as installed in a project.
 *
 *   node tools/instruction-load.mjs [--root <project folder>] [--max <lines>] [--json]
 *
 * Prints one line per file and `INSTRUCTION_LOAD: <sum> lines (max <max>) — ok | over`. Exit 0 at or under the
 * maximum (default 800 for now), 1 above it, 2 when a file is missing. The seed of the kit's instruction budget test.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LOAD_FILES = ['AGENTS.md', '.claude/commands/take-plan.md', '.claude/commands/ship.md', 'docs/agent/job-validation.md', 'docs/agent/standards-git.md']
export const DEFAULT_MAX = 800 // Human 2026-11-07; back to 600 when job-validation.md is shortened

/** Lines of a text the way `wc -l` counts them for a file that ends with a newline (a last line without one counts too). */
export const lineCount = (text) => (text === '' ? 0 : text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length)

/** { files: [{ path, lines }], missing: [path], total, max, over } for the project at `root`. */
export function instructionLoad(root, max = DEFAULT_MAX) {
  const files = []
  const missing = []
  for (const path of LOAD_FILES) {
    const file = join(root, path)
    if (!existsSync(file)) missing.push(path)
    else files.push({ path, lines: lineCount(readFileSync(file, 'utf8')) })
  }
  const total = files.reduce((n, f) => n + f.lines, 0)
  return { files, missing, total, max, over: total > max }
}

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const argv = process.argv.slice(2)
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const root = resolve(opt('--root') ?? fileURLToPath(new URL('..', import.meta.url)))
  const max = opt('--max') === undefined ? DEFAULT_MAX : Number(opt('--max'))
  if (!Number.isInteger(max) || max < 1) {
    console.log(`INSTRUCTION_LOAD: refused — --max ${opt('--max')} is not a whole number of lines`)
    process.exit(2)
  }
  const r = instructionLoad(root, max)
  if (argv.includes('--json')) console.log(JSON.stringify(r))
  for (const f of r.files) console.log(`  ${String(f.lines).padStart(5)}  ${f.path}`)
  for (const m of r.missing) console.log(`  MISSING ${m}`)
  if (r.missing.length) {
    console.log(`INSTRUCTION_LOAD: incomplete — ${r.missing.length} file(s) missing under ${root}`)
    process.exit(2)
  }
  console.log(`INSTRUCTION_LOAD: ${r.total} lines (max ${r.max}) — ${r.over ? 'over' : 'ok'}`)
  process.exit(r.over ? 1 : 0)
}
