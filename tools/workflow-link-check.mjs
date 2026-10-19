/**
 * Workflow link check — every path the installed workflow docs point at must exist. Run from the kit root:
 *
 *   node tools/workflow-link-check.mjs                   # installs the fixtures (packs [], angular, node-express,
 *                                                         # angular + node-express, each with the Cursor layer) into
 *                                                         # temp folders and checks each
 *   node tools/workflow-link-check.mjs --target <dir>    # checks an installed project
 *
 * Scanned: .claude/commands, .claude/skills, .claude/agents, docs/agent, .cursor/commands, .cursor/rules (*.md, *.mdc)
 * and AGENTS.md, AGENTS.workflow.md, CLAUDE.md, README_WORKFLOW.md. Checked on every line:
 *   - a backticked path under a folder the kit installs (`.claude/…`, `docs/…`, `scripts/…`, …): the file or folder
 *     exists. Examples and runtime files are skipped: anything with <…>, *, {…}, $, NNN or YYYY in it, and the
 *     RUNTIME list below (files the workflow creates while it runs).
 *   - `node scripts/<file>`: the script exists.
 *   - `npm run <script>`: package.json has it (no package.json yet: one of the configured commands.* names);
 *     `--if-present` runs are optional. `npm run (not set)` is a config key the project still has to fill.
 * Node built-ins only. Exit 0 = 0 missing, 1 = missing references (one per line: file:line: what).
 */
import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative, resolve } from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'
import { resolveConfig, readJson } from './lib/kit.mjs'

const kit = resolve(fileURLToPath(new URL('..', import.meta.url)))

const SCAN_DIRS = ['.claude/commands', '.claude/skills', '.claude/agents', 'docs/agent', '.cursor/commands', '.cursor/rules']
const SCAN_FILES = ['AGENTS.md', 'AGENTS.workflow.md', 'CLAUDE.md', 'README_WORKFLOW.md']
// Files and folders the workflow writes while it runs (never installed). A path equal to one of these, or starting
// with one, is not checked. Optional files (paths.planChecks, the tech-debt baseline) come from kit.config.json.
const RUNTIME = [
  '.claude/todo.md', '.claude/todo-archive/', '.claude/sessions/', '.claude/techdebt-reports/', '.claude/reports/',
  '.claude/settings.local.json', '.claude/worktrees/', '.claude/.session-state-path', '.claude/.last-npm-install-hash',
  '.claude/.last-npm-install-hash-scripts', '.claude/session-manifests/', '.claude/plans/', '.claude/scheduled_tasks.lock',
  '.claude/scheduled_tasks.json', '.claude/logs/', '.claude/.session-lock', 'scripts/package-lock.json', 'scripts/node_modules/',
  'docs/session-state', '.claude/.plan-write-ack', '.claude/dev-server.log', '.github/pull_request_template.md',
]
const EXAMPLE = /[<>*{}$…]|NNN|YYYY|\.\.\./

function walk(dir, base, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, base, out)
    else if (/\.(md|mdc)$/.test(e)) out.push(relative(base, p).replace(/\\/g, '/'))
  }
  return out
}

const isRuntime = (p) => RUNTIME.some((r) => p === r || p === r.replace(/\/$/, '') || p.startsWith(r))

/**
 * Missing references in an installed project: [{ file, line, what }]. A backticked path is checked when its first
 * folder is one the kit installed into (.kit/install.json), else one the project has.
 */
export function linkProblems(dir) {
  const out = []
  let inst = null
  try {
    inst = JSON.parse(readFileSync(join(dir, '.kit/install.json'), 'utf8'))
  } catch { /* not kit-installed */ }
  const installed = Object.keys(inst?.files ?? {})
  const roots = new Set(installed.length
    ? installed.filter((p) => p.includes('/')).map((p) => p.split('/')[0])
    : readdirSync(dir).filter((e) => statSync(join(dir, e)).isDirectory()))
  // The effective config (project > packs > kit defaults), as install rendered it.
  let project = {}
  try {
    project = readJson(join(dir, 'kit.config.json'))
  } catch { /* no config: kit defaults */ }
  const vals = resolveConfig({ kitRoot: kit, project, packs: inst?.packs ?? project.stack?.packs ?? [], target: dir })
  let scripts = null
  try {
    scripts = Object.keys(readJson(join(dir, 'package.json')).scripts ?? {})
  } catch { /* no package.json yet: the configured commands.* script names count */ }
  const commandNames = Object.entries(vals).filter(([k, v]) => k.startsWith('commands.') && typeof v === 'string' && v).map(([, v]) => v)
  const npmOk = new Set(scripts ?? commandNames)
  // Optional files a doc names "when the file exists": the planning checklist and the tech-debt baseline.
  const optional = new Set([vals['paths.planChecks'], `${vals['paths.sharedDocs']}/techdebt-baseline.json`].filter(Boolean))
  const files = [...SCAN_DIRS.flatMap((d) => walk(join(dir, d), dir)), ...SCAN_FILES.filter((f) => existsSync(join(dir, f)))]
  const exists = (p) => existsSync(join(dir, p.replace(/\/$/, '')))
  for (const file of files) {
    const lines = readFileSync(join(dir, file), 'utf8').split(/\r?\n/)
    lines.forEach((text, i) => {
      const at = { file, line: i + 1 }
      const seen = new Set()
      for (const [, raw] of text.matchAll(/`([^`\n]+)`/g)) {
        let p = raw.trim().replace(/^\.\//, '').replace(/[.,;:)]+$/, '').replace(/#.*$/, '').replace(/:\d+(-\d+)?$/, '')
        if (/\s/.test(p) || EXAMPLE.test(p) || !p.includes('/') || p.startsWith('/') || /^[a-z]+:\/\//i.test(p)) continue
        if (!roots.has(p.split('/')[0]) || isRuntime(p) || optional.has(p) || seen.has(p)) continue
        seen.add(p)
        if (!exists(p)) out.push({ ...at, what: `path ${p} does not exist` })
      }
      for (const [, p] of text.matchAll(/\bnode\s+(scripts\/[\w./-]+)/g)) {
        if (EXAMPLE.test(p) || seen.has(p)) continue
        seen.add(p)
        if (!exists(p)) out.push({ ...at, what: `node ${p}: script does not exist` })
      }
      for (const m of text.matchAll(/\bnpm run(?:-script)?\s+(\(not set\)|[\w:.-]+)([^`\n|]*)/g)) {
        const [, name, rest] = m
        if (/--if-present/.test(rest) || EXAMPLE.test(name)) continue
        if (name === '(not set)') out.push({ ...at, what: 'npm run (not set): a commands.* key the project has not filled' })
        else if (!npmOk.has(name)) out.push({ ...at, what: `npm run ${name}: ${scripts ? 'package.json has no such script' : 'not a configured commands.* script'}` })
      }
    })
  }
  return out
}

const FIXTURES = [
  { name: 'packs-none', packs: '' },
  { name: 'angular', packs: 'angular' },
  { name: 'node-express', packs: 'node-express' },
  { name: 'angular-node-express', packs: 'angular,node-express' },
]

function main() {
  const argv = process.argv.slice(2)
  const t = argv.indexOf('--target')
  if (t >= 0) {
    const dir = resolve(argv[t + 1] ?? '.')
    const probs = linkProblems(dir)
    for (const p of probs) console.error(`${p.file}:${p.line}: ${p.what}`)
    console.log(`WORKFLOW_LINK_CHECK: ${probs.length ? 'FAIL' : 'ok'} — ${probs.length} missing in ${dir}`)
    process.exit(probs.length ? 1 : 0)
  }
  let total = 0
  for (const fx of FIXTURES) {
    const dir = mkdtempSync(join(tmpdir(), `kit-links-${fx.name}-`))
    writeFileSync(join(dir, 'kit.config.json'), JSON.stringify({ project: { name: `links-${fx.name}` }, commands: { build: 'build', lint: 'lint', test: 'test' }, hooks: { shellPath: 'bash' } }))
    const r = spawnSync(process.execPath, [join(kit, 'tools', 'install.mjs'), '--target', dir, '--cursor', ...(fx.packs ? ['--packs', fx.packs] : [])], { encoding: 'utf8' })
    if (r.status !== 0) {
      console.error(`${fx.name}: install exited ${r.status}: ${(r.stdout + r.stderr).trim().split('\n').pop()}`)
      total++
    } else {
      const probs = linkProblems(dir)
      for (const p of probs) console.error(`${fx.name}: ${p.file}:${p.line}: ${p.what}`)
      console.log(`${fx.name.padEnd(22)} ${probs.length} missing`)
      total += probs.length
    }
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`WORKFLOW_LINK_CHECK: ${total ? 'FAIL' : 'ok'} — ${FIXTURES.length} fixtures (packs [], angular, node-express, angular + node-express), ${total} missing`)
  process.exit(total ? 1 : 0)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main()
