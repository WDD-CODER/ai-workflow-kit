/**
 * Kit feedback — sends one generalised lesson to the kit repository as a pull request (docs/agent/decision-review.md).
 *
 *   node scripts/kit-feedback.mjs --title "<short title>" --text "<the lesson, in general terms>" [--dry-run] [--root <folder>]
 *   node scripts/kit-feedback.mjs --title "<…>" --text-file <file> [--dry-run]
 *
 * The kit repository is the `source` in .kit/install.json (`github:<owner>/<repo>`). The entry lands on a new branch
 * `feedback/<date>-<slug>` as `feedback/inbox/<date>-<slug>.md`, and a pull request is opened with `gh`; nothing goes to
 * the kit's main branch. The text is refused (exit 2, nothing pushed) when it names this project or its repository,
 * holds a path under paths.srcRoot / paths.serverRoot, or contains a code fence — a lesson that travels to every
 * project must not carry one project's code or name. --text-file reads only a scratch file (under the OS temp folder
 * or .claude/sessions/, never a dotfile or a ".." path), so no secret file can reach the entry. --dry-run prints the entry and the gh calls and pushes nothing.
 *
 * Needs `gh` signed in. Node built-ins only. Exit 0 = sent (or dry run), 2 = refused or bad input, 1 = gh failed.
 */
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, basename, relative, isAbsolute } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const FENCE = '`'.repeat(3)

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const slugOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'lesson'

/** Why the text may not leave the project (the first reason), or null. `cfg` is the project's kit config. */
export function privacyProblem(text, cfg, rootName) {
  const t = String(text ?? '')
  const names = [cfg?.project?.name, cfg?.project?.repoName, rootName].filter((n) => typeof n === 'string' && n.trim().length >= 3)
  for (const n of names) {
    // Whole-name match (a project called "app" does not refuse the word "application").
    if (new RegExp(`(^|[^a-z0-9])${n.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`, 'i').test(t)) return `it names the project or repository "${n}"`
  }
  for (const key of ['srcRoot', 'serverRoot']) {
    const p = cfg?.paths?.[key]
    if (typeof p === 'string' && p.trim() && t.includes(p.trim().replace(/\\/g, '/'))) return `it names a path under paths.${key} (${p})`
  }
  if (t.includes(FENCE)) return 'it contains a code fence'
  return null
}

/** Why --text-file may not be read (the first reason), or null: only a scratch file, never a dotfile or a `..` path. */
export function textFileProblem(file, root, tmp = tmpdir()) {
  const raw = String(file ?? '')
  if (raw.split(/[\\/]+/).includes('..')) return 'a path with ".." is not read'
  const abs = resolve(raw)
  if (basename(abs).startsWith('.')) return 'a dotfile is not read'
  const inside = (dir) => {
    const rel = relative(resolve(dir), abs)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  }
  if (!inside(tmp) && !inside(join(root, '.claude', 'sessions'))) return 'only a file under the temp folder or .claude/sessions/ is read'
  return null
}

/** `github:owner/repo` -> `owner/repo`, or null. */
export function repoOf(source) {
  const m = /^github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/.exec(String(source ?? ''))
  return m ? m[1] : null
}

export function entryFile(date, slug, title, text) {
  return [`# ${title}`, '', `Sent ${date} from a project using the kit. One lesson, written in general terms.`, '', text.trim(), ''].join('\n')
}

function main(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) refuse(`unexpected argument "${a}"`)
    if (a === '--dry-run') flags['dry-run'] = true
    else flags[a.slice(2)] = argv[++i]
  }
  const root = resolve(flags.root ?? process.cwd())
  const title = String(flags.title ?? '').trim()
  let text = flags.text
  if (text === undefined && flags['text-file']) {
    const bad = textFileProblem(flags['text-file'], root)
    if (bad) refuse(`--text-file refused — ${bad}. Write the lesson to a scratch file first.`)
    text = readFileSync(resolve(flags['text-file']), 'utf8')
  }
  if (!title || !text || !String(text).trim()) refuse('--title and --text (or --text-file) are required')
  const cfg = readJson(join(root, '.kit', 'config.json')) ?? readJson(join(root, 'kit.config.json')) ?? {}
  const why = privacyProblem(`${title}\n${text}`, cfg, basename(root))
  if (why) refuse(`refused — ${why}. Write the lesson without project names, repository names, project paths or code.`)
  const install = readJson(join(root, '.kit', 'install.json'))
  const repo = repoOf(install?.source)
  if (!repo) refuse(`.kit/install.json source is ${JSON.stringify(install?.source ?? null)} — kit feedback needs github:<owner>/<repo>`)
  const date = new Date().toISOString().slice(0, 10)
  const slug = slugOf(title)
  const branch = `feedback/${date}-${slug}`
  const path = `feedback/inbox/${date}-${slug}.md`
  const body = entryFile(date, slug, title, String(text))
  const calls = [
    ['api', `repos/${repo}`, '--jq', '.default_branch'],
    ['api', `repos/${repo}/git/ref/heads/<default>`, '--jq', '.object.sha'],
    ['api', '-X', 'POST', `repos/${repo}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', 'sha=<sha>'],
    ['api', '-X', 'PUT', `repos/${repo}/contents/${path}`, '-f', `message=feedback: ${title}`, '-f', `branch=${branch}`, '-f', 'content=<base64 of the entry>'],
    ['pr', 'create', '--repo', repo, '--head', branch, '--base', '<default>', '--title', `feedback: ${title}`, '--body', `One lesson from a project using the kit: ${path}`],
  ]
  if (flags['dry-run']) {
    process.stdout.write(`KIT_FEEDBACK: dry run — nothing pushed\nrepository: ${repo}\nbranch: ${branch}\nfile: ${path}\n--- entry ---\n${body}--- gh calls ---\n${calls.map((c) => `gh ${c.join(' ')}`).join('\n')}\n`)
    return
  }
  const gh = (args) => {
    const r = spawnSync('gh', args, { encoding: 'utf8' })
    if (r.status !== 0) {
      process.stderr.write(`KIT_FEEDBACK: gh ${args.slice(0, 3).join(' ')} failed — ${(r.stderr || r.stdout || r.error?.message || '').trim().split('\n').pop()}\n`)
      process.exit(1)
    }
    return r.stdout.trim()
  }
  const base = gh(calls[0])
  const sha = gh(['api', `repos/${repo}/git/ref/heads/${base}`, '--jq', '.object.sha'])
  gh(['api', '-X', 'POST', `repos/${repo}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', `sha=${sha}`])
  gh(['api', '-X', 'PUT', `repos/${repo}/contents/${path}`, '-f', `message=feedback: ${title}`, '-f', `branch=${branch}`, '-f', `content=${Buffer.from(body).toString('base64')}`])
  const url = gh(['pr', 'create', '--repo', repo, '--head', branch, '--base', base, '--title', `feedback: ${title}`, '--body', `One lesson from a project using the kit: ${path}`])
  process.stdout.write(`KIT_FEEDBACK: sent — ${url}\n`)
}

function refuse(why) {
  process.stderr.write(`KIT_FEEDBACK: ${why}\n`)
  process.exit(2)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
