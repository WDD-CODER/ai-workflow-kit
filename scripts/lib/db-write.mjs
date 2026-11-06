/**
 * Database writes a builder may not run on its own.
 *
 *   dbWriteKind(command)            'migrate' | 'seed' | 'raw-write' | null for one shell command
 *   builderMarker(folder)           the orchestrator builder marker of the worktree holding `folder`, or null
 *   dbWriteAsk(command, folder)     the ESCALATE text for an unlisted database write in a builder worktree, or null
 *
 * The rule is for orchestrator builders only. `orch-state.mjs worktree` writes the marker `orch-builder.json`
 * ({ run, plan, planPath, branch, planRef: the run branch's commit sha }) into the builder worktree's own git dir; the guard reads it from the
 * worktree that holds the command's folder. A worktree without it (a Human session, a Worker slot) is never asked
 * about, and a marker whose branch is not the branch checked out now (a slot given back, then reused) counts as none.
 *
 * A command is "listed" when a line of the code the plan prescribes (a fenced block line or an inline code span) is
 * that command, whitespace aside. The plan is read at `planRef` (the run branch the builder started from), never from
 * the worktree, so a builder cannot list a command by editing its own copy of the plan; no plan text → not listed.
 * Read-only database commands (prisma migrate status, a psql SELECT) are never asked about.
 */
import { readFileSync, existsSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { prescribedSnippets } from './plan-guard-scan.mjs'

// Each pattern is written anchored at the command word of a segment (after variable assignments and launchers such as
// npx, sudo, env, yarn, bunx, nohup, timeout). A command whose word is a known read-only or package tool (git, rg, grep,
// echo, an install) is judged by the anchored patterns only, so a word in its commit message, search or package name is
// never a write. Any other command — a wrapper the list does not know, `bash -c "…"`, `eval` — is judged by the same
// patterns anywhere in it (fail closed).
const ASSIGN = '(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*'
const LAUNCHER = '(?:sudo(?:\\s+-u\\s+\\S+|\\s+-[^u\\s]\\S*)*|doas|npx(?:\\s+-\\S+)*|bunx|env|nohup|nice(?:\\s+-n\\s+\\S+)?|time|exec|command|stdbuf(?:\\s+-\\S+)*|timeout\\s+(?:-\\S+\\s+)*\\S+|xargs(?:\\s+-\\S+)*|yarn(?:\\s+run)?|npm\\s+exec(?:\\s+--)?|pnpm\\s+(?:exec|dlx))'
const PREFIX = new RegExp(`^${ASSIGN}(?:${LAUNCHER}\\s+${ASSIGN})*`)
const SAFE = /^(?:git\s+(?:status|log|diff|show|add|commit|branch|switch|fetch|push|rev-parse|ls-files|grep|restore|stash)|rg|grep|findstr|echo|printf|cat|type|less|more|head|tail|ls|dir|wc|code|npm\s+(?:install|i|ci|add|uninstall|remove|view|info|ls|outdated)|pnpm\s+(?:install|i|add|remove|why|ls|outdated)|yarn\s+(?:add|install|remove|why))(?=\s|$)/
// The same pattern found anywhere, ending at a word end or a closing quote (`bash -c "npm run seed"`).
const loose = (re) => new RegExp(re.source.replace(/^\^/, '(?:^|[\\s;&|("\'=`])').split('(?=\\s|$)').join('(?=[\\s"\'`;)|&]|$)'), re.flags)
const BIN = (name) => `(?:\\S*[\\\\/])?${name}(?:\\.exe|\\.cmd)?`
const MIGRATE = [
  new RegExp(`^${BIN('prisma')}\\s+migrate\\s+(?!status\\b|diff\\b)\\S+`),
  new RegExp(`^${BIN('prisma')}\\s+db\\s+push\\b`),
  new RegExp(`^${BIN('drizzle-kit')}\\s+(?:push|migrate)\\b`),
  new RegExp(`^${BIN('knex')}\\s+migrate(?::(?!status\\b|list\\b|currentVersion\\b)\\w+|(?=\\s|$))`),
  new RegExp(`^${BIN('typeorm(?:-ts-node-\\w+)?')}\\s+migration:run\\b`),
  /^(?:npm|pnpm)\s+run\s+(?:migrate|db:migrate|db:push)(?=\s|$)/,
]
const SEED = [
  /^(?:npm|pnpm)\s+run\s+(?:seed|db:seed)(?=\s|$)/,
  new RegExp(`^${BIN('prisma')}\\s+db\\s+seed\\b`),
  // Exactly seed-check / seed-checker (.js/.mjs/.cjs/.ts or none) is a read-only check script, not a seed write;
  // any other name that starts with seed (seed-checkout, seed-checks-off) still is.
  /^node\s+(?!--test\b)(?:-\S+\s+)*(?:\S*[\\/])?seed(?!-check(?:er)?(?:\.[cm]?[jt]s)?(?=\s|$))(?![\w.-]*\.test\.)[\w.-]*(?=\s|$)/,
]
const RAW_CLIENT = new RegExp(`^${BIN('(?:psql|mongosh|mongo|sqlite3)')}(?=\\s|$)`)
const RAW_WRITE = /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b|\b(?:insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|replaceOne|drop)\b/i
// A client fed a script it does not show (-f file, --file, < file, .read): what it runs is unknown — counted as a write.
const RAW_SCRIPT = /(?:^|\s)(?:-f|--file)(?:\s|=)|<\s*\S|(?:^|\s)\.read\s/

const SEED_LOOSE = SEED.map(loose)
const MIGRATE_LOOSE = MIGRATE.map(loose)
const RAW_CLIENT_LOOSE = loose(RAW_CLIENT)
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/^[({]\s*/, '')
const stripped = (s) => flat(s).replace(PREFIX, '')
// Safe only when the segment's own first word (variable assignments aside, no launcher) is the safe tool, and nothing
// in it runs other code: no $( ), backticks, process substitution, -exec, --pre, git -c / an alias `!`.
// (also a word that opens with a quote or a backslash before a dash: a quoted option the option list cannot read)
const RUNS_CODE = /\$\(|`|<\(|>\(|\s--?exec\b|\s-x\b|--extcmd\b|--pre\b|\s-c\s|--config-env\b|!|(?:^|\s)["'\\]+-/
// …and every option it carries (read outside quoted text) is one of these: an option that can name a program
// (--upload-pack, -O, --ext-diff, --pre …) makes the command judged like any other.
const SAFE_OPTIONS = new Set(['-m', '--message', '-a', '--all', '-A', '-n', '-i', '-e', '-l', '-w', '-v', '-q', '--quiet', '--oneline', '--stat', '--name-only', '--short', '-s', '-p', '--porcelain', '--no-edit', '--amend', '-r', '--staged', '--cached'])
const isSafe = (s) => {
  const own = flat(s).replace(new RegExp(`^${ASSIGN}`), '')
  if (!SAFE.test(own) || RUNS_CODE.test(own)) return false
  // Fail closed on any shell form this reader does not model: an expansion, a brace, an escape, or a quote that is
  // not one whole word ("a b" alone between spaces). What is left after the whole-word quotes is read as plain words.
  if (/[$\\{]/.test(own)) return false
  const words = own.replace(/(^|\s)(?:"[^"]*"|'[^']*')(?=\s|$)/g, '$1Q')
  // a glued quote, a glob / tilde that can expand into an option, or any control, redirect or comment character
  if (/["'*?[~&|;<>()#%^\n\r]/.test(words)) return false
  const opts = words.match(/(?:^|\s)-\S*/g) ?? []
  return opts.every((o) => SAFE_OPTIONS.has(o.trim()))
}

/** Does this command run a database client (anchored; anywhere unless it is a safe tool's own command)? */
function runsClient(command) {
  return RAW_CLIENT.test(stripped(command)) || (!isSafe(command) && RAW_CLIENT_LOOSE.test(flat(command)))
}

/** 'migrate' | 'seed' | 'raw-write' | null — the kind of database write a command is. */
export function dbWriteKind(command) {
  const c = stripped(command)
  if (!c) return null
  const all = flat(command)
  const safe = isSafe(command)
  if (SEED.some((re) => re.test(c)) || (!safe && SEED_LOOSE.some((re) => re.test(all)))) return 'seed'
  if (MIGRATE.some((re) => re.test(c)) || (!safe && MIGRATE_LOOSE.some((re) => re.test(all)))) return 'migrate'
  if (runsClient(command) && (RAW_WRITE.test(all) || RAW_SCRIPT.test(all))) return 'raw-write'
  return null
}

/** The simple commands of a shell line: split on && || ; | and newlines (quotes are not parsed). */
export function commandSegments(command) {
  return String(command ?? '')
    .split(/&&|\|\||[;\n\r|&]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** The database writes of a shell line: each segment that is one, and — because splitting ignores quotes — the whole
 *  line when a database client and a write keyword sit in different segments (`psql -c "SELECT 1; DROP TABLE x"`). */
export function dbWrites(command) {
  const segments = commandSegments(command)
  const out = segments.filter((s) => dbWriteKind(s))
  const whole = String(command ?? '').replace(/\s+/g, ' ').trim()
  // A segment that runs a database client, whose write keyword a quoted `;` or `|` split into the next segment.
  const client = segments.some((s) => runsClient(s))
  // A client fed through a pipe or a here-document runs a script the line does not show: a write.
  // (fail closed: any client on a line with a pipe or a here-document counts as fed)
  const fed = client && /\||<</.test(whole)
  const raw = (client && (RAW_WRITE.test(whole) || RAW_SCRIPT.test(whole))) || fed
  if (fed) return [...new Set([...out, whole])]
  // The whole line again for a client write split across segments (always), or for any write when a quote or an
  // escape may have made the split wrong.
  const split = /["'\\`]/.test(whole)
  if ((raw && !out.some((s) => dbWriteKind(s) === 'raw-write')) || (split && !out.length && dbWriteKind(whole))) out.push(whole)
  return out
}

function gitDirOf(folder) {
  let dir = resolve(folder)
  for (;;) {
    const dotGit = join(dir, '.git')
    if (existsSync(dotGit)) {
      if (statSync(dotGit).isDirectory()) return { root: dir, gitDir: dotGit }
      const m = readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m)
      return m ? { root: dir, gitDir: resolve(dir, m[1]) } : null
    }
    const up = resolve(dir, '..')
    if (up === dir) return null
    dir = up
  }
}

/** { run, plan, planPath, branch, planRef, root } of the builder worktree holding `folder`, or null. */
export function builderMarker(folder) {
  const wt = gitDirOf(folder)
  if (!wt) return null
  let m
  try {
    m = JSON.parse(readFileSync(join(wt.gitDir, 'orch-builder.json'), 'utf8'))
  } catch {
    return null
  }
  if (!m || typeof m !== 'object' || !m.run || !m.plan || !m.branch) return null
  let head = ''
  try {
    head = readFileSync(join(wt.gitDir, 'HEAD'), 'utf8').trim()
  } catch {}
  if (head !== `ref: refs/heads/${m.branch}`) return null
  return { ...m, root: wt.root }
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim()

/** The plan's prescribed command lines, read at the marker's planRef (never the worktree copy). */
function listedCommands(marker) {
  if (!marker.planRef || !marker.planPath) return new Set()
  const r = spawnSync('git', ['-C', marker.root, 'show', `${marker.planRef}:${String(marker.planPath).replace(/\\/g, '/')}`], { encoding: 'utf8', timeout: 5000 })
  if (r.status !== 0) return new Set()
  const lines = prescribedSnippets(r.stdout, { all: true }).flatMap((s) => s.code.split('\n'))
  return new Set(lines.map((l) => norm(l.replace(/^\s*\$\s+/, ''))).filter(Boolean))
}

/** The text an unlisted database write in a builder worktree is refused with (`ESCALATE: db-write <command>`), or null. */
export function dbWriteAsk(command, folder) {
  const writes = dbWrites(command)
  if (!writes.length) return null
  const marker = builderMarker(folder)
  if (!marker) return null
  const listed = listedCommands(marker)
  const unlisted = writes.find((s) => !listed.has(norm(s)))
  if (!unlisted) return null
  return `ESCALATE: db-write ${norm(unlisted)} — a ${dbWriteKind(unlisted)} command plan ${marker.plan} does not list. Do not run it: stop and return status ESCALATE with this line as the blocker; the run asks the Human.`
}
