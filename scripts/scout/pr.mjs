/**
 * Workflow scout — opens the weekly pull request: branch chore/scout-<date> with docs/scout/<date>.html and
 * docs/scout/state.json, and a body that lists the top items as text, links the page and asks which tips were useful.
 *
 *   node scripts/scout/pr.mjs --report <file.json> [--root <dir>] [--repo <owner/name>] [--dry-run]
 *
 * The pull request is opened through GitHub's REST API (`gh api`), not `gh pr create`: cloud scheduled runs reject
 * the GraphQL calls `gh pr` makes. --dry-run prints the branch, the body and the git / gh calls and changes nothing.
 * Exit 0 = opened (or dry run, or nothing to open), 1 = a git or gh call failed, 2 = refused (reason on stderr).
 * Node built-ins only.
 */
import { existsSync } from 'fs'
import { resolve, join } from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { readJson, validateReport, sections, privacyProblem, DEFAULT_CAPS } from './render.mjs'

/** `git@github.com:o/r.git` or `https://github.com/o/r(.git)` -> `o/r`, else null. */
export function repoFromRemote(url) {
  const m = /github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(String(url ?? '').trim())
  return m ? `${m[1]}/${m[2]}` : null
}

/** The pull request body (markdown). */
export function prBody(report, { repo, branch, topN = DEFAULT_CAPS.topN }) {
  const s = sections(report.items, topN)
  const page = `docs/scout/${report.date}.html`
  const view = repo ? `https://github.com/${repo}/blob/${branch}/${page}` : page
  const one = (it) => `**${it.headline}** — ${it.hook} (\`${it.file}\`)`
  const rest = [...s.replaces, ...s.community, ...s.also].filter((it) => !s.top.includes(it))
  const lines = [
    `Weekly workflow scout — ${report.date}. Claude Code ${report.claudeCode.from ? `${report.claudeCode.from} → ` : ''}${report.claudeCode.to}.`,
    '',
    `## Top ${s.top.length}`,
    '',
    ...s.top.map((it, i) => `${i + 1}. ${one(it)}`),
    '',
    `Page: [${page}](${view}) — open it in a browser from a checkout of this branch (GitHub shows HTML as source).`,
    ...(report.budgetReached ? ['', 'SCOUT: budget reached — some news waits for next week.'] : []),
    '',
    '## Which were useful?',
    '',
    'Tick the ones worth it; the next tuning reads this list. Proposals only — nothing here is applied.',
    '',
    ...[...s.top, ...rest].map((it) => `- [ ] ${it.headline} (\`${it.file}\`)`),
    '',
  ]
  return lines.join('\n')
}

function main(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) refuse(`unexpected argument "${a}"`)
    if (a === '--dry-run') flags['dry-run'] = true
    else flags[a.slice(2)] = argv[++i]
  }
  if (!flags.report) refuse('--report <file.json> is required')
  const root = resolve(flags.root ?? process.cwd())
  const dry = flags['dry-run'] === true
  const raw = readJson(resolve(flags.report))
  if (!raw) refuse(`cannot read the report ${flags.report} as JSON`)
  const caps = { ...DEFAULT_CAPS, ...(readJson(join(root, 'docs', 'scout', 'sources.json'), {})?.caps ?? {}) }
  let report
  try {
    report = validateReport(raw, caps).report
  } catch (e) {
    refuse(`report refused — ${e.message}`)
  }
  const page = `docs/scout/${report.date}.html`
  if (report.items.length === 0 || !existsSync(join(root, page))) {
    process.stdout.write(`SCOUT: no page for ${report.date} — no pull request\n`)
    return
  }
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8' })
    if (r.status !== 0) {
      process.stderr.write(`SCOUT: ${cmd} ${args.slice(0, 3).join(' ')} failed — ${(r.stderr || r.stdout || r.error?.message || '').trim().split('\n').pop()}\n`)
      process.exit(1)
    }
    return r.stdout.trim()
  }
  const repo = flags.repo ?? repoFromRemote(run('git', ['remote', 'get-url', 'origin']))
  if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) refuse(`cannot tell the GitHub repository (got ${JSON.stringify(repo)}); pass --repo <owner/name>`)
  const branch = `chore/scout-${report.date}`
  const title = `chore(scout): workflow news ${report.date}`
  const body = prBody(report, { repo, branch, topN: caps.topN })
  const why = privacyProblem(`${title}\n${body}`)
  if (why) refuse(`pull request refused — ${why}`)
  const calls = [
    ['git', ['switch', '-c', branch]],
    ['git', ['add', '--', page, 'docs/scout/state.json']],
    ['git', ['commit', '-m', title]],
    ['git', ['push', '-u', 'origin', branch]],
    ['gh', ['api', `repos/${repo}`, '--jq', '.default_branch']],
    ['gh', ['api', '-X', 'POST', `repos/${repo}/pulls`, '-f', `title=${title}`, '-f', `head=${branch}`, '-f', 'base=<default>', '-f', 'body=<the body above>', '--jq', '.html_url']],
  ]
  if (dry) {
    process.stdout.write(`SCOUT: dry run — nothing pushed\nrepository: ${repo}\nbranch: ${branch}\n--- body ---\n${body}--- calls ---\n${calls.map(([c, a]) => `${c} ${a.join(' ')}`).join('\n')}\n`)
    return
  }
  for (const [cmd, args] of calls.slice(0, 4)) run(cmd, args)
  const base = run('gh', calls[4][1])
  const url = run('gh', ['api', '-X', 'POST', `repos/${repo}/pulls`, '-f', `title=${title}`, '-f', `head=${branch}`, '-f', `base=${base}`, '-f', `body=${body}`, '--jq', '.html_url'])
  process.stdout.write(`SCOUT: pull request ${url}\n`)
}

function refuse(why) {
  process.stderr.write(`SCOUT: ${why}\n`)
  process.exit(2)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
