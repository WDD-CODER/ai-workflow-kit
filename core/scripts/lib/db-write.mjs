/**
 * Database writes a builder may not run on its own.
 *
 *   dbWriteKind(command)            'migrate' | 'seed' | 'raw-write' | null for one shell command
 *   builderMarker(folder)           the orchestrator builder marker of the worktree holding `folder`, or null
 *   dbWriteAsk(command, folder)     the ESCALATE text for an unlisted database write in a builder worktree, or null
 *
 * The rule is for orchestrator builders only. `orch-state.mjs worktree` writes the marker `orch-builder.json`
 * ({ run, plan, planPath, branch }) into the builder worktree's own git dir; the guard reads it from the worktree that
 * holds the command's folder. A worktree without it (a Human session, a Worker slot) is never asked about, and a marker
 * whose branch is not the branch checked out now (a slot given back, then reused) counts as none.
 *
 * A command is "listed" when the plan's text contains it as written; a listed one runs. Read-only database commands
 * (prisma migrate status, a psql SELECT) are never asked about.
 */
import { readFileSync, existsSync, statSync } from 'fs'
import { join, resolve } from 'path'

const MIGRATE = [
  /\bprisma\s+migrate\s+(?!status\b|diff\b)\S+/,
  /\bprisma\s+db\s+push\b/,
  /\bdrizzle-kit\s+(?:push|migrate)\b/,
  /\bknex\s+migrate(?::(?!status\b|list\b|currentVersion\b)\w+|(?=\s|$))/,
  /\btypeorm(?:-ts-node-\w+)?\s+migration:run\b/,
  /\b(?:npm|pnpm)\s+run\s+(?:migrate|db:migrate|db:push)(?=\s|$)/,
]
const SEED = [
  /\b(?:npm|pnpm)\s+run\s+(?:seed|db:seed)(?=\s|$)/,
  /\bprisma\s+db\s+seed\b/,
  /\bnode\s+(?:\S+\s+)*?(?:\S*[\\/])?seed[\w.-]*(?=\s|$)/,
]
const RAW_CLIENT = /(?:^|[\s;&|(])(?:psql|mongosh|mongo|sqlite3)(?:\.exe)?(?=\s|$)/
const RAW_WRITE = /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b|\b(?:insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|drop)\b/i

/** 'migrate' | 'seed' | 'raw-write' | null — the kind of database write one command (segment) is. */
export function dbWriteKind(command) {
  const c = String(command ?? '').replace(/\s+/g, ' ').trim()
  if (!c) return null
  if (SEED.some((re) => re.test(c))) return 'seed'
  if (MIGRATE.some((re) => re.test(c))) return 'migrate'
  if (RAW_CLIENT.test(c) && RAW_WRITE.test(c)) return 'raw-write'
  return null
}

/** The simple commands of a shell line: split on && || ; | and newlines (quotes are not parsed — over-splitting only
 *  makes a segment shorter, and a segment is judged on its own words). */
export function commandSegments(command) {
  return String(command ?? '')
    .split(/&&|\|\||[;\n|]/)
    .map((s) => s.trim())
    .filter(Boolean)
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

/** { run, plan, planPath, branch, root } of the builder worktree holding `folder`, or null. */
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

/** The text an unlisted database write in a builder worktree is refused with (`ESCALATE: db-write <command>`), or null. */
export function dbWriteAsk(command, folder) {
  const segments = commandSegments(command).filter((s) => dbWriteKind(s))
  if (!segments.length) return null
  const marker = builderMarker(folder)
  if (!marker) return null
  let planText = ''
  for (const base of [marker.root, process.cwd()]) {
    try {
      planText = readFileSync(resolve(base, String(marker.planPath ?? '')), 'utf8')
      break
    } catch {}
  }
  const norm = (s) => s.replace(/\s+/g, ' ').trim()
  const plan = norm(planText)
  const unlisted = segments.find((s) => !plan.includes(norm(s)))
  if (!unlisted) return null
  return `ESCALATE: db-write ${norm(unlisted)} — a ${dbWriteKind(unlisted)} command plan ${marker.plan} does not list. Do not run it: stop and return status ESCALATE with this line as the blocker; the run asks the Human.`
}
