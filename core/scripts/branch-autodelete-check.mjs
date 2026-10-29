/**
 * Branch auto-delete check — does this repo already delete a branch once its PR merges?
 *
 * Asked before a slot merge runs `git push origin --delete <branch>` (docs/agent/standards-git.md →
 * "Merging from a slot"). Read-only: `git remote get-url origin`, one `gh api` GET, and the files in
 * .github/workflows. Every command runs through spawnSync with an argument array; no text from the repo
 * (remote URL, workflow content) ever reaches a shell.
 *
 * Prints exactly one line, exit 0 always:
 *   AUTODELETE: auto (repo setting)        → GitHub's delete_branch_on_merge is on: skip the delete
 *   AUTODELETE: auto (workflow <file>)     → a workflow run on pull_request deletes branches: skip the delete
 *   AUTODELETE: manual                     → the setting is off and no workflow deletes: delete as before
 *   AUTODELETE: unknown (<why>)            → gh missing / not signed in / call failed: delete as before
 *
 * A workflow counts only when it runs on pull_request (or pull_request_target) and deletes a branch: the kit's
 * own todo-sync workflow deletes its bot branches on push, which says nothing about merged PR branches.
 *
 * Usage: node scripts/branch-autodelete-check.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { spawnSync } from 'child_process'
import { join } from 'path'

const run = (cmd, args, env = process.env) => spawnSync(cmd, args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
const say = (answer) => {
  console.log(`AUTODELETE: ${answer}`)
  process.exit(0)
}

// Delete patterns: the refs API, git push … --delete, gh api -X DELETE … git/refs, and the delete-branch input or flag.
const DELETES = [/git\/refs/, /git\s+push\b[^\n]*\s--delete\b/, /gh\s+api\b[^\n]*-X\s*DELETE\b[^\n]*git\/refs/, /delete-branch/]
// The workflow runs on a pull request event: `on: pull_request`, `on: [push, pull_request]` or a `pull_request:` key.
const ON_PR = /^\s*(on\s*:.*\bpull_request(_target)?\b|pull_request(_target)?\s*:)/m

/** Owner/repo from an https or ssh remote URL, or null. */
function repoSlug(url) {
  const m = String(url).trim().match(/^(?:https?:\/\/[^/]+\/|ssh:\/\/[^/]+\/|[^@\s]+@[^:\s]+:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)
  return m ? `${m[1]}/${m[2]}` : null
}

/** The first workflow file that runs on a pull request and deletes a branch, or null. */
function deletingWorkflow(root) {
  const dir = join(root, '.github', 'workflows')
  if (!existsSync(dir)) return null
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/i.test(n)).sort()) {
    let text = ''
    try {
      text = readFileSync(join(dir, f), 'utf8')
    } catch {
      continue
    }
    if (ON_PR.test(text) && DELETES.some((re) => re.test(text))) return f
  }
  return null
}

function main() {
  const top = run('git', ['rev-parse', '--show-toplevel'])
  const root = top.status === 0 && top.stdout.trim() ? top.stdout.trim() : process.cwd()
  const workflow = deletingWorkflow(root)

  const origin = run('git', ['remote', 'get-url', 'origin'])
  const slug = origin.status === 0 ? repoSlug(origin.stdout) : null
  let setting = null
  let why = null
  if (!slug) why = origin.status === 0 ? 'origin is not a GitHub URL' : 'no origin remote'
  else {
    // GITHUB_TOKEN cleared so gh uses the keyring credential (standards-git.md); either works for a read.
    const gh = run('gh', ['api', `repos/${slug}`, '--jq', '.delete_branch_on_merge'], { ...process.env, GITHUB_TOKEN: '' })
    const out = (gh.stdout || '').trim()
    if (gh.error) why = gh.error.code === 'ENOENT' ? 'gh not installed' : `gh: ${gh.error.message}`
    else if (gh.status !== 0) why = `gh: ${(gh.stderr || '').trim().split(/\r?\n/)[0] || `exit ${gh.status}`}`
    else if (out === 'true' || out === 'false') setting = out === 'true'
    else why = `gh: unexpected answer ${JSON.stringify(out.slice(0, 40))}`
  }

  if (setting === true) say('auto (repo setting)')
  if (workflow) say(`auto (workflow ${workflow})`)
  if (setting === false) say('manual')
  say(`unknown (${why})`)
}

try {
  main()
} catch (e) {
  say(`unknown (${String(e?.message || e).split('\n')[0]})`)
}
