/**
 * PR step: body template, list of open improver PRs, `gh pr create` on the kit repo.
 * The body carries counts and generic one-line descriptions only — never transcript text.
 * SKILL_IMPROVER_GH overrides the gh binary (tests); SKILL_IMPROVER_REPO the kit repo slug.
 */
import { execFileSync } from 'child_process'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export const REPO = () => process.env.SKILL_IMPROVER_REPO || 'WDD-CODER/ai-workflow-kit'
const gh = () => process.env.SKILL_IMPROVER_GH || 'gh'
// A .mjs override (tests) runs through node.
const ghRun = (args, opts) => {
  const bin = gh()
  return bin.endsWith('.mjs') ? execFileSync(process.execPath, [bin, ...args], opts) : execFileSync(bin, args, opts)
}
// A limited GITHUB_TOKEN in the environment shadows the full-scope keyring login; blank it for gh calls.
const ghEnv = () => ({ ...process.env, GITHUB_TOKEN: '' })

export function buildBody({ skill, evidence, diffStat, before, after, evalCount, generatedEvals, unused30 }) {
  const e = evidence
  const pct = (n) => `${Math.round(n * 100)}%`
  const lines = [
    `Nightly skill improvement for \`${skill}\`. Opened only because the new version scored higher on the same evals.`,
    '',
    '## Evidence (counts from local sessions, no text)',
    `- times fired: ${e.fired} (last 30 days: ${e.fired30})`,
    `- user corrections within 3 turns after it fired: ${e.corrections}`,
    `- tool failures right after it fired: ${e.failures}`,
    `- should-have-fired hits (trigger phrase seen, skill not called): ${e.shouldHaveFired}`,
    `- SKILL.md size: ${e.sizeBytes} bytes`,
    '',
    '## What changed',
    '```',
    diffStat.trim(),
    '```',
    generatedEvals ? `Added ${evalCount} generic eval cases (the skill had none).` : `Used the skill's ${evalCount} existing eval cases.`,
    '',
    '## Eval scores (blind judge, same cases for both versions)',
    `- before: ${pct(before)}`,
    `- after: ${pct(after)}`,
    '',
  ]
  if (unused30) lines.push('## Note', 'This skill fired 0 times in the last 30 days: consider removing or merging it. (Not done automatically.)', '')
  lines.push(
    '## How to validate',
    '1. In a project that uses the kit, run a kit-sync dry-run against this branch and check only this skill folder changes.',
    `2. Read the diff of \`${skill}/SKILL.md\`: nothing that you rely on was removed, nothing project-specific was added.`,
    "3. Try 2 of the eval prompts from the skill's `evals/evals.json` by hand and check the assertions hold.",
    '',
    'Merge to adopt; close to reject. Both are safe: nothing is auto-merged.',
  )
  return lines.join('\n')
}

export function openImproverBranches() {
  const out = ghRun(['pr', 'list', '--repo', REPO(), '--state', 'open', '--json', 'headRefName', '--limit', '100'], {
    encoding: 'utf8',
    env: ghEnv(),
  })
  return JSON.parse(out).map((p) => p.headRefName).filter((b) => b.startsWith('chore/skill-improve-'))
}

export function createPr({ branch, skill, bodyText }) {
  const dir = mkdtempSync(join(tmpdir(), 'skill-improver-pr-'))
  const bodyFile = join(dir, 'pr-body.md')
  writeFileSync(bodyFile, bodyText)
  const out = ghRun(
    ['pr', 'create', '--repo', REPO(), '--base', 'main', '--head', branch, '--title', `chore(skill): improve ${skill}`, '--body-file', bodyFile],
    { encoding: 'utf8', env: ghEnv() },
  )
  return out.trim().split(/\s+/).pop()
}
