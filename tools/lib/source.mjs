/**
 * Where the kit comes from: the local folder these tools run from, another local folder, or a tagged
 * release on GitHub fetched into a per-user cache. Node built-ins + the git CLI only.
 *
 *   --source github:<owner>/<repo> --ref <tag>   shallow `git fetch --depth 1` of the tag into
 *                                                <cache>/<owner>/<repo>/<tag>/, reused when present
 *   --source <folder>                             a kit checkout on disk (kit development)
 *   (no --source)                                 the kit these tools run from
 *
 * Cache: $AI_WORKFLOW_KIT_CACHE, else ~/.cache/ai-workflow-kit. Never inside a project.
 * $AI_WORKFLOW_KIT_GIT_BASE replaces https://github.com (tests point it at a local folder of bare repos).
 *
 * The tag's commit is looked up with `git ls-remote` every time. A cached copy is reused only when it is
 * at that commit; a tag that moved since it was cached is refused. Offline, a cached copy is reused with a NOTE.
 */
import { existsSync, mkdirSync, renameSync, rmSync } from 'fs'
import { homedir } from 'os'
import { spawnSync } from 'child_process'
import { resolve, join, relative, isAbsolute } from 'path'

const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const NAME_RE = /^[A-Za-z0-9_.-]+$/

export class SourceError extends Error {}

// Never stop for a credential prompt: a public release needs none, and a missing repo should fail, not hang.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV })

export function cacheRoot() {
  return resolve(process.env.AI_WORKFLOW_KIT_CACHE || join(homedir(), '.cache', 'ai-workflow-kit'))
}

function gitBase() {
  return (process.env.AI_WORKFLOW_KIT_GIT_BASE || 'https://github.com').replace(/\/+$/, '')
}

/** "github:owner/repo" -> { kind: 'github', owner, repo }; anything else -> { kind: 'local', path }. */
export function parseSource(text, baseDir = process.cwd()) {
  const m = /^github:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(text)
  if (m) {
    if (!NAME_RE.test(m[1]) || !NAME_RE.test(m[2])) throw new SourceError(`bad github source: ${text}`)
    return { kind: 'github', owner: m[1], repo: m[2] }
  }
  if (text.startsWith('github:')) throw new SourceError(`bad github source: ${text} (expected github:<owner>/<repo>)`)
  const path = text.startsWith('local:') ? text.slice('local:'.length) : text
  return { kind: 'local', path: resolve(baseDir, path) }
}

/** The tag's commit on the remote: a string, null when the tag does not exist, undefined when the remote is unreachable. */
function remoteTagCommit(url, ref) {
  const r = git(['ls-remote', '--tags', url, `refs/tags/${ref}`, `refs/tags/${ref}^{}`])
  if (r.status !== 0) return undefined
  const rows = r.stdout.trim().split('\n').filter(Boolean).map((l) => l.split('\t'))
  if (rows.length === 0) return null
  const peeled = rows.find(([, name]) => name.endsWith('^{}'))
  return (peeled ?? rows[0])[0]
}

function headCommit(dir) {
  const r = git(['rev-parse', 'HEAD'], dir)
  return r.status === 0 ? r.stdout.trim() : null
}

function fetchTag({ owner, repo, ref, log }) {
  if (!REF_RE.test(ref)) throw new SourceError(`bad ref: ${ref} (a release tag such as v0.5.0)`)
  const url = `${gitBase()}/${owner}/${repo}.git`
  const dir = join(cacheRoot(), owner, repo, ref)
  const cached = existsSync(join(dir, 'kit.json')) ? headCommit(dir) : null
  const want = remoteTagCommit(url, ref)
  if (want === null) throw new SourceError(`ref ${ref} not found`)
  if (want === undefined) {
    if (!cached) throw new SourceError(`cannot reach ${url} (offline, or no such public repo) and ${ref} is not cached`)
    log(`NOTE ${url} unreachable — using the cached ${ref} (${cached.slice(0, 7)})`)
    return { dir, commit: cached }
  }
  if (cached === want) {
    log(`SOURCE cached github:${owner}/${repo}@${ref} (${want.slice(0, 7)})`)
    return { dir, commit: want }
  }
  if (cached) throw new SourceError(`tag ${ref} moved: cached ${cached.slice(0, 7)}, remote ${want.slice(0, 7)} — delete ${dir} if the new commit is trusted`)

  const tmp = `${dir}.tmp-${process.pid}`
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const steps = [
    ['init', '-q'],
    ['config', 'core.autocrlf', 'false'], // byte-exact files, whatever the user's global git setting
    ['fetch', '-q', '--depth', '1', url, `refs/tags/${ref}:refs/tags/${ref}`],
    ['-c', 'advice.detachedHead=false', 'checkout', '-q', `refs/tags/${ref}`],
  ]
  for (const s of steps) {
    const r = git(s, tmp)
    if (r.status !== 0) {
      rmSync(tmp, { recursive: true, force: true })
      throw new SourceError(`git ${s.find((x) => !x.startsWith('-'))} failed for ${url}@${ref}: ${(r.stderr || r.stdout).trim().split('\n').pop()}`)
    }
  }
  const got = headCommit(tmp)
  if (got !== want) {
    rmSync(tmp, { recursive: true, force: true })
    throw new SourceError(`fetched ${ref} is at ${got?.slice(0, 7)}, the remote tag points to ${want.slice(0, 7)}`)
  }
  if (!existsSync(join(tmp, 'kit.json'))) {
    rmSync(tmp, { recursive: true, force: true })
    throw new SourceError(`${owner}/${repo}@${ref} has no kit.json — not a workflow kit`)
  }
  rmSync(dir, { recursive: true, force: true })
  renameSync(tmp, dir)
  log(`SOURCE fetched github:${owner}/${repo}@${ref} (${got.slice(0, 7)}) into ${dir}`)
  return { dir, commit: got }
}

/** How a local kit path is written into a project's install.json: relative to the project when possible. */
function localLabel(kitRoot, target) {
  const rel = relative(target, kitRoot)
  return `local:${(rel && !isAbsolute(rel) ? rel : kitRoot).replace(/\\/g, '/')}`
}

/**
 * Resolve the kit to render from.
 *   source    --source text, or the recorded install.json `source` (relative paths resolve against target), or null
 *   ref       --ref text or the recorded `ref` (github sources only)
 *   fallback  the kit these tools run from, used when source is null
 * Returns { kitRoot, record: { source, ref?, commit? } } — record is what install.json stores.
 */
export function resolveSource({ source, ref, fallback, target, baseDir = process.cwd(), log = console.log }) {
  const parsed = source ? parseSource(source, baseDir) : { kind: 'local', path: fallback }
  if (parsed.kind === 'github') {
    if (!ref) throw new SourceError(`--ref <tag> is required with ${source}`)
    const { dir, commit } = fetchTag({ ...parsed, ref, log })
    return { kitRoot: dir, record: { source: `github:${parsed.owner}/${parsed.repo}`, ref, commit } }
  }
  if (ref) throw new SourceError('--ref needs a github:<owner>/<repo> source')
  if (!existsSync(join(parsed.path, 'kit.json'))) throw new SourceError(`${parsed.path} is not a workflow kit (no kit.json)`)
  const commit = headCommit(parsed.path)
  return { kitRoot: parsed.path, record: { source: localLabel(parsed.path, target), ...(commit ? { commit } : {}) } }
}
