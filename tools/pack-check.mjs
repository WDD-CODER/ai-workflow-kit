/**
 * Pack contract check — every stack pack under packs/ must carry a valid pack.json
 * and the files it names. Run from the kit repo root:
 *
 *   node tools/pack-check.mjs
 *
 * Contract keys: name, standardsDoc, skills[], cursorRules[], gotchas[], validation[].
 * validation entries are npm script names only (no spaces, no raw commands).
 * Node built-ins only. Exit 0 = ok, 1 = problems (one per line).
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { resolve, join } from 'path'

const packsDir = resolve('packs')
const problems = []
let checked = 0

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
}

if (checked === 0 && problems.length === 0) problems.push('no packs found under packs/')
if (problems.length > 0) {
  console.error(problems.join('\n'))
  console.error(`PACK_CHECK: FAIL — ${checked} packs checked, ${problems.length} problems`)
  process.exit(1)
}
console.log(`PACK_CHECK: ok — ${checked} packs, 0 problems`)
