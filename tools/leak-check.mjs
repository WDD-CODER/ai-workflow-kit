/**
 * Leak check — fails if a scanned file names a framework, stack, product, hosting
 * provider, machine path or port outside a {{placeholder}} or a
 * <!-- PACK:<stack> --> marker. Run from the kit repo root:
 *
 *   node tools/leak-check.mjs                          # core/, layers/ and templates/ (all terms)
 *   node tools/leak-check.mjs --root <dir> [--root …]  # explicit roots (all terms)
 *   node tools/leak-check.mjs --root packs --project-only
 *
 * --project-only: stack packs may name their own framework, so only project,
 * machine, port and tool-choice terms are checked there.
 *
 * Node built-ins only. Exit 0 = clean, 1 = leaks (printed as path:line: term).
 */
import { readFileSync, readdirSync, existsSync } from 'fs'
import { resolve, join } from 'path'

const argv = process.argv.slice(2)
const roots = []
argv.forEach((a, i) => {
  if (a === '--root') roots.push(resolve(argv[i + 1]))
})
if (roots.length === 0) roots.push(resolve('core'), resolve('layers'), resolve('templates'))
const projectOnly = argv.includes('--project-only')

const STACK_TERMS = [
  ['angular', /Angular/gi],
  ['framework-cli', /\bng\s+(?:build|serve|test|lint|e2e|generate)\b/g],
  ['express', /\bExpress\b/g],
  ['mongo', /\bMongo(?:DB|ose)?\b/g],
  ['atlas', /\bAtlas\b/g],
  ['render', /\bRender\b/g],
]
const PROJECT_TERMS = [
  ['product', /FoodVibe|\bHebrew\b|dictionary\.json/gi],
  ['machine', /C:[\\/]+coding projects|\bdanwe\b|C:[\\/]+Program Files[\\/]+Git/gi],
  ['ports', /\b420[0-3N]\b|\b300[0-3N]\b/g],
  ['browser', /gstack/gi],
]
const TERMS = projectOnly ? PROJECT_TERMS : [...STACK_TERMS, ...PROJECT_TERMS]

// Placeholders and PACK markers are allowed to carry anything.
const strip = (line) => line.replace(/\{\{[\w.]+\}\}/g, '').replace(/<!--\s*\/?PACK(?::[\w-]+)?\s*-->/g, '')

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}

const leaks = []
let files = 0
for (const root of roots) {
  if (!existsSync(root)) continue
  for (const file of walk(root)) {
    files++
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, n) => {
      const s = strip(line)
      for (const [name, re] of TERMS) {
        re.lastIndex = 0
        const m = re.exec(s)
        if (m) leaks.push(`${file.slice(root.length + 1).replace(/\\/g, '/')}:${n + 1}: ${name} "${m[0]}" (${root.replace(/\\/g, '/').split('/').pop()})`)
      }
    })
  }
}

if (leaks.length > 0) {
  console.error(leaks.join('\n'))
  console.error(`LEAK_CHECK: FAIL — ${leaks.length} leaks in ${files} files`)
  process.exit(1)
}
console.log(`LEAK_CHECK: ok — ${files} files, 0 leaks`)
