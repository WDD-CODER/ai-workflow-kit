/**
 * Breadcrumbs check — the deterministic half of the `breadcrumbs` skill.
 *
 * breadcrumbs.md files live at the Major Seams only (see SEAMS). This script:
 *   - lists each seam with: present / MISSING
 *   - flags any breadcrumbs.md found outside a seam (leaf folders must stay clean)
 *   - for every present breadcrumbs.md, checks that each `backticked` path it
 *     mentions exists on disk (stale entries are the usual rot) and lists the
 *     seam's direct children that the file does not mention (new, undocumented)
 *
 * Prints one block per seam. Exit 0 when nothing is missing, stale or stray;
 * exit 1 otherwise. Node built-ins only. Read-only — the skill does the writing.
 *
 * Usage: node scripts/breadcrumbs-check.mjs [--json]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { resolve, dirname, join, relative } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const APP = 'src/app'
// The seams are the folders a newcomer lands in. Anything deeper is a leaf.
const SEAMS = ['core', 'core/services', 'core/models', 'core/components', 'shared', 'pages'].map((s) => join(APP, s))
// Files that are not worth a breadcrumb line.
const IGNORE = new Set(['breadcrumbs.md', '.gitkeep', '.DS_Store', 'index.ts'])
// Specs never earn a line (see the skill), so they are never "not mentioned".
const IGNORE_PATTERN = /\.spec\.ts$/

const json = process.argv.includes('--json')
const out = { seams: [], stray: [], problems: 0 }

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (e.name === 'breadcrumbs.md') acc.push(p)
  }
  return acc
}

const seamSet = new Set(SEAMS.map((s) => resolve(repoRoot, s)))
for (const file of walk(join(repoRoot, APP))) {
  if (!seamSet.has(resolve(dirname(file)))) {
    out.stray.push(relative(repoRoot, file).replace(/\\/g, '/'))
    out.problems++
  }
}

for (const seam of SEAMS) {
  const abs = join(repoRoot, seam)
  const entry = { seam: seam.replace(/\\/g, '/'), present: false, stale: [], unmentioned: [] }
  const file = join(abs, 'breadcrumbs.md')
  if (!existsSync(abs)) { entry.seam += ' (folder absent)'; out.seams.push(entry); continue }
  entry.present = existsSync(file)
  if (!entry.present) { out.problems++; out.seams.push(entry); continue }

  const text = readFileSync(file, 'utf8')
  const mentioned = new Set([...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].replace(/\/$/, '')))
  for (const m of mentioned) {
    // Only path-looking mentions are checked; `signal()`, `.c-*` and npm
    // packages / path aliases (`@angular/core`, `@services/*`) are prose.
    if (!/^[\w.-]+(\/[\w.-]+)*$/.test(m) || !/[./]/.test(m)) continue
    const bases = [abs, join(repoRoot, APP), repoRoot]
    // `foo.service` is a common shorthand for `foo.service.ts`
    const candidates = bases.flatMap((b) => [join(b, m), join(b, m + '.ts')])
    if (!candidates.some(existsSync)) entry.stale.push(m)
  }
  for (const child of readdirSync(abs)) {
    if (IGNORE.has(child) || IGNORE_PATTERN.test(child)) continue
    const isDir = statSync(join(abs, child)).isDirectory()
    const name = child
    const hit = [...mentioned].some((m) => m === name || m.endsWith('/' + name) || m.startsWith(name + '/'))
    if (!hit) entry.unmentioned.push(isDir ? name + '/' : name)
  }
  if (entry.stale.length || entry.unmentioned.length) out.problems++
  out.seams.push(entry)
}

if (json) {
  console.log(JSON.stringify(out, null, 2))
} else {
  for (const s of out.seams) {
    console.log(`${s.present ? 'OK     ' : 'MISSING'} ${s.seam}/breadcrumbs.md`)
    for (const x of s.stale) console.log(`   stale entry (not on disk): ${x}`)
    for (const x of s.unmentioned) console.log(`   not mentioned: ${x}`)
  }
  for (const x of out.stray) console.log(`STRAY   ${x} — outside a seam, delete it`)
  console.log(out.problems ? `BREADCRUMBS: ${out.problems} seam(s) need attention` : 'BREADCRUMBS: clean')
}
process.exit(out.problems ? 1 : 0)
