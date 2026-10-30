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
 * project must not carry one project's code or name. When an open inbox file with the same slug exists on the kit
 * (`gh api` on feedback/inbox/), the pull request adds a `seen-in: N` line to that file instead of a new file; --dry-run
 * prints which path it would take. --text-file reads only a scratch file (under the OS temp folder
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

/** The inbox file name (`<date>-<slug>.md`) among `names` that holds this slug, or null. */
export function inboxMatch(names, slug) {
  const re = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.md$`)
  return names.map((n) => n.trim()).find((n) => re.test(n)) ?? null
}

/** An inbox entry with its `seen-in: N` line raised by one (a first repeat makes it `seen-in: 2`): { text, n }. */
export function bumpSeen(content) {
  const m = /^seen-in:[ \t]*(\d+)[ \t]*$/m.exec(content)
  if (m) return { n: Number(m[1]) + 1, text: content.replace(m[0], `seen-in: ${Number(m[1]) + 1}`) }
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  return { n: 2, text: [lines[0], '', 'seen-in: 2', ...lines.slice(1)].join('\n') }
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
  // The same lesson from another project: an open inbox file with this slug gets a `seen-in: N` line (a priority for the
  // kit's Planner) in a pull request, instead of a second file. KIT_FEEDBACK_GH (a node script) replaces `gh` — for tests only.
  const run = (args) => (process.env.KIT_FEEDBACK_GH ? spawnSync(process.execPath, [process.env.KIT_FEEDBACK_GH, ...args], { encoding: 'utf8' }) : spawnSync('gh', args, { encoding: 'utf8' }))
  const listing = run(['api', `repos/${repo}/contents/feedback/inbox`, '--jq', '.[].name'])
  const existing = listing.status === 0 ? inboxMatch(listing.stdout.split('\n'), slug) : null
  if (flags['dry-run']) {
    const chosen = existing ? `seen-in: feedback/inbox/${existing} gets a seen-in line (no new file)` : listing.status === 0 ? 'new file' : 'new file (the inbox could not be listed)'
    process.stdout.write(`KIT_FEEDBACK: dry run — nothing pushed\nrepository: ${repo}\npath: ${chosen}\nbranch: ${branch}\nfile: ${path}\n--- entry ---\n${body}--- gh calls ---\n${calls.map((c) => `gh ${c.join(' ')}`).join('\n')}\n`)
    return
  }
  const gh = (args) => {
    const r = run(args)
    if (r.status !== 0) {
      process.stderr.write(`KIT_FEEDBACK: gh ${args.slice(0, 3).join(' ')} failed — ${(r.stderr || r.stdout || r.error?.message || '').trim().split('\n').pop()}\n`)
      process.exit(1)
    }
    return r.stdout.trim()
  }
  if (existing) {
    const file = `feedback/inbox/${existing}`
    const baseBranch = gh(calls[0])
    const sha = gh(['api', `repos/${repo}/git/ref/heads/${baseBranch}`, '--jq', '.object.sha'])
    const fileSha = gh(['api', `repos/${repo}/contents/${file}?ref=${baseBranch}`, '--jq', '.sha'])
    const current = Buffer.from(gh(['api', `repos/${repo}/contents/${file}?ref=${baseBranch}`, '--jq', '.content']).replace(/\s/g, ''), 'base64').toString('utf8')
    const bumped = bumpSeen(current)
    const seenBranch = `${branch}-seen`
    gh(['api', '-X', 'POST', `repos/${repo}/git/refs`, '-f', `ref=refs/heads/${seenBranch}`, '-f', `sha=${sha}`])
    gh(['api', '-X', 'PUT', `repos/${repo}/contents/${file}`, '-f', `message=feedback: seen again — ${title}`, '-f', `branch=${seenBranch}`, '-f', `sha=${fileSha}`, '-f', `content=${Buffer.from(bumped.text).toString('base64')}`])
    const url = gh(['pr', 'create', '--repo', repo, '--head', seenBranch, '--base', baseBranch, '--title', `feedback: seen again (seen-in: ${bumped.n}) — ${title}`, '--body', `The same lesson came from another project: ${file} now says seen-in: ${bumped.n}.`])
    process.stdout.write(`KIT_FEEDBACK: sent — ${url} (seen-in: ${bumped.n} on ${file})\n`)
    return
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
