/**
 * Nightly skill improver. One skill with the worst evidence gets a better version, proven by a before/after eval
 * graded by a separate blind judge. A kit PR opens ONLY when the new version scores higher.
 *
 *   node tools/skill-improver/run.mjs [--target skill] [--once] [--budget 400000] [--skill <name>] [--dry-run]
 *
 * --target   what to improve; only `skill` exists here (any other value: exit 2, `unknown target <t>`).
 *            Plans 047 (`learn`) and 048 (`agent`) add targets on the same lib/ core.
 * --once     one skill only (the scheduled run may add a 2nd when the 1st finished under 200000 tokens)
 * --budget   hard token cap for the whole run (default 400000); on reach: `SKILL_IMPROVER: budget reached (N/cap)`, nothing pushed
 * --skill    skip the picker and improve this skill
 * --dry-run  evidence + pick only (0 tokens), prints the pick
 * Env: SKILL_IMPROVER_HOME (state folder), SKILL_IMPROVER_CLAUDE / SKILL_IMPROVER_GH (binaries), SKILL_IMPROVER_REPO,
 *      SKILL_IMPROVER_EDIT_MODEL / _RUN_MODEL / _JUDGE_MODEL (defaults opus / sonnet / models.review, never Haiku).
 * Every run prints `SKILL_IMPROVER: billing plan-limits|api-key` before its first model call and appends one line
 * to <state>/spend.jsonl: {date, target, mode, usd, tokens, result}.
 * Exit: 0 done (PR, no-change or paused), 2 out-of-scope or unknown target, 3 budget reached, 1 error.
 */
import { spawnSync } from 'child_process'
import { existsSync, readFileSync, mkdirSync, mkdtempSync, cpSync, copyFileSync, readdirSync, statSync, rmSync } from 'fs'
import { join, resolve, dirname, relative } from 'path'
import { fileURLToPath } from 'url'
import { Meter, BudgetError } from './lib/budget.mjs'
import { runClaude, body } from './lib/claude.mjs'
import { stateDir, today, log, readJson, writeJson, appendSpend } from './lib/log.mjs'
import { createWorktree, git } from './lib/worktree.mjs'
import { outOfScope, skillAllowed, leakGuard } from './lib/guards.mjs'
import { buildBody, openImproverBranches, createPr } from './lib/pr.mjs'
import { writeEvidence, listSkills } from './evidence.mjs'
import { pick } from './pick.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const kitCheckout = resolve(here, '..', '..')

const argv = process.argv.slice(2)
const flag = (k) => argv.includes(k)
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)

const TARGETS = ['skill']
const TARGET = arg('--target', 'skill')
if (!TARGETS.includes(TARGET)) {
  console.error(`unknown target ${TARGET}`)
  process.exit(2)
}

const BUDGET = Number(arg('--budget', 400000))

/** Judging roles never run on Haiku (the Human's standing rule): env, else the kit's models.review, else sonnet. */
export function judgeModel(repoRoot, env = process.env) {
  let m = env.SKILL_IMPROVER_JUDGE_MODEL
  if (!m) {
    for (const f of [join(repoRoot, '.kit', 'config.json'), join(repoRoot, 'kit.config.json')]) {
      m = readJson(f, {}).models?.review
      if (m) break
    }
  }
  m = !m || m === 'inherit' ? 'sonnet' : m
  if (/haiku/i.test(m)) throw new Error(`judge model ${m} refused: judging roles never run on Haiku`)
  return m
}

class OutOfScope extends Error {
  constructor(path) {
    super(`out-of-scope ${path}`)
    this.path = path
  }
}

const readEvals = (dir) => {
  const f = join(dir, 'evals', 'evals.json')
  if (!existsSync(f)) return null
  const j = JSON.parse(readFileSync(f, 'utf8'))
  return Array.isArray(j.evals) && j.evals.length ? j.evals : null
}

function filesText(dir) {
  const out = []
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      if (n === '.claude') continue
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (out.join('').length < 60000) out.push(`--- file ${relative(dir, p)} ---\n${readFileSync(p, 'utf8').slice(0, 8000)}`)
    }
  }
  walk(dir)
  return out.join('\n')
}

const scratch = () => mkdtempSync(join(stateDir(), 'sandbox-'))

// Claude Code refuses to write under a `.claude/` path (protected), so the model edits a staged copy of the skill in a
// neutral folder (`.claude` is spelled `dot-claude` there) and the runner copies every staged file back to its real
// place in the worktree. A file the model wrote outside the skill folder lands outside it in the worktree too,
// where the path guard catches it.
const MAP = (p) => p.replace(/(^|\/)\.claude(?=\/|$)/g, '$1dot-claude')
const UNMAP = (p) => p.replace(/(^|\/)dot-claude(?=\/|$)/g, '$1.claude')
async function inStage({ wt, skillRel, fn }) {
  const sb = scratch()
  const root = join(sb, 'kit')
  const stagedSkill = join(root, MAP(skillRel))
  mkdirSync(stagedSkill, { recursive: true })
  cpSync(join(wt.path, skillRel), stagedSkill, { recursive: true })
  try {
    await fn({ cwd: sb, stagedSkill })
    rmSync(join(wt.path, skillRel), { recursive: true, force: true })
    const copyBack = (d) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) copyBack(p)
        else {
          const dest = join(wt.path, UNMAP(relative(root, p).replace(/\\/g, '/')))
          mkdirSync(dirname(dest), { recursive: true })
          copyFileSync(p, dest)
        }
      }
    }
    copyBack(root)
  } finally {
    rmSync(sb, { recursive: true, force: true })
  }
}

/** Run one eval case with a skill folder, then have the blind judge grade the assertions. Returns pass rate 0..1. */
async function scoreArm({ skillDir, evals, judgeSystem, meter, models }) {
  const skillMd = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
  let passed = 0
  let total = 0
  for (const ev of evals) {
    const sandbox = scratch()
    try {
      const res = await runClaude({
        prompt: ev.prompt,
        cwd: sandbox,
        meter,
        model: models.run,
        appendSystem: `You have this skill available. Follow it. Skill folder (read references from there if needed): ${skillDir}\n\n${skillMd}`,
      })
      const judged = await runClaude({
        prompt: [
          `Task given to the assistant:\n${ev.prompt}`,
          `Assistant final answer:\n${res.text}`,
          `Files it produced:\n${filesText(sandbox) || '(none)'}`,
          `Assertions (grade each true/false):\n${ev.assertions.map((a, i) => `${i + 1}. ${a}`).join('\n')}`,
        ].join('\n\n'),
        cwd: sandbox,
        meter,
        model: models.judge,
        appendSystem: judgeSystem,
        allowedTools: 'Read',
      })
      const m = [...judged.text.matchAll(/\{[^{}]*"results"\s*:\s*\[[^\]]*\][^{}]*\}/g)].pop()
      const results = m ? JSON.parse(m[0]).results : []
      ev.assertions.forEach((_, i) => {
        total++
        if (results[i] === true) passed++
      })
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  }
  return total ? passed / total : 0
}

/** The `skill` target: improve one skill. Returns { result: 'pr'|'no-change' }. */
async function improveSkill({ skill, evidenceFor, meter, repoRoot }) {
  const date = today()
  const models = {
    edit: process.env.SKILL_IMPROVER_EDIT_MODEL || 'opus',
    run: process.env.SKILL_IMPROVER_RUN_MODEL || 'sonnet',
    judge: judgeModel(repoRoot),
  }
  const branch = `chore/skill-improve-${skill}-${date}`
  const wt = createWorktree({ repoRoot, branch, name: `${skill}-${date}` })
  const oldCopy = join(stateDir(), 'old', skill)
  try {
    const info = listSkills(wt.path).find((s) => s.name === skill)
    if (!info) throw new Error(`skill ${skill} not found in origin/main`)
    const skillRel = relative(wt.path, info.dir).replace(/\\/g, '/')
    rmSync(oldCopy, { recursive: true, force: true })
    cpSync(info.dir, oldCopy, { recursive: true })

    const commandMd = body(readFileSync(join(wt.path, 'core', '.claude', 'commands', 'improve-skill.md'), 'utf8'))
    const judgeSystem = body(readFileSync(join(wt.path, 'core', '.claude', 'agents', 'skill-judge.md'), 'utf8'))

    // Evals: existing, or 3 generic cases written first (they become part of the PR).
    let generated = false
    if (!readEvals(info.dir)) {
      generated = true
      await inStage({ wt, skillRel, fn: ({ cwd, stagedSkill }) => runClaude({
        prompt: `Write ${stagedSkill}/evals/evals.json for the skill "${skill}" (skill-creator format: {"skill_name","evals":[{"id","prompt","expected_output","files":[],"assertions":[...]}]}). Exactly 3 generic cases that exercise the skill, 3-5 machine-checkable assertions each. Evidence counts (no text): ${JSON.stringify(evidenceFor)}. Never name a real project, person or path; use invented example names.`,
        cwd,
        meter,
        model: models.run,
      }) })
      if (!readEvals(info.dir)) throw new Error('eval generation produced no valid evals.json')
    }
    const evals = readEvals(info.dir)

    // Edit (strong model), inside the skill folder only.
    await inStage({ wt, skillRel, fn: ({ cwd, stagedSkill }) => runClaude({
      prompt: `Skill to improve: ${skill}\nSkill folder: ${stagedSkill}\nEvidence counts (no text): ${JSON.stringify(evidenceFor)}\nEval cases (do not edit them): ${join(stagedSkill, 'evals', 'evals.json')}`,
      cwd,
      meter,
      model: models.edit,
      appendSystem: commandMd,
    }) })

    // Path guard before any more spend.
    const allowed = skillAllowed(skill)
    const changed = git(wt.path, 'status', '--porcelain', '-uall').split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''))
    const bad = outOfScope(changed, allowed)
    if (bad) throw new OutOfScope(bad)
    if (!changed.length) {
      log(`no-change ${skill} 0 0 editor changed nothing`)
      console.log(`SKILL_IMPROVER: no-change ${skill} (editor changed nothing)`)
      return { result: 'no-change' }
    }

    const before = await scoreArm({ skillDir: oldCopy, evals, judgeSystem, meter, models })
    const after = await scoreArm({ skillDir: info.dir, evals, judgeSystem, meter, models })
    if (!(after > before)) {
      const reason = after === before ? 'no improvement' : 'regressed'
      log(`no-change ${skill} ${before.toFixed(2)} ${after.toFixed(2)} ${reason}`)
      console.log(`SKILL_IMPROVER: no-change ${skill} ${before.toFixed(2)} -> ${after.toFixed(2)} (${reason})`)
      return { result: 'no-change' }
    }

    // The kit renders core/packs skills into its own .claude/skills/ and records hashes in .kit/install.json; without a
    // sync the kit CI drift step fails on this PR. Sync in the worktree, then require drift-check to pass.
    const node = (args) => spawnSync(process.execPath, args, { cwd: wt.path, encoding: 'utf8', timeout: 180000 })
    const sync = node(['tools/sync.mjs', '--target', '.', '--apply'])
    const drift = sync.status === 0 ? node(['tools/drift-check.mjs', '--target', '.']) : null
    if (sync.status !== 0 || drift.status !== 0) {
      const why = sync.status !== 0 ? 'sync failed' : 'drift-check failed'
      const out = drift ?? sync
      log(`no-change ${skill} ${before.toFixed(2)} ${after.toFixed(2)} ${why}`)
      console.log(`SKILL_IMPROVER: no-change ${skill} (${why}), nothing pushed\n${(out.stdout + out.stderr).trim().split('\n').slice(0, 5).join('\n')}`)
      return { result: 'no-change' }
    }
    const afterSync = git(wt.path, 'status', '--porcelain', '-uall').split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''))
    const badSync = outOfScope(afterSync, allowed)
    if (badSync) throw new OutOfScope(badSync)

    const stage = [skillRel, `.claude/skills/${skill}`, '.kit/install.json'].filter((p) => existsSync(join(wt.path, p)))
    git(wt.path, 'add', '--', ...stage)
    git(wt.path, 'commit', '-q', '-m', `chore(skill): improve ${skill} (evals ${Math.round(before * 100)}% -> ${Math.round(after * 100)}%)`)
    const diffStat = git(wt.path, 'diff', '--stat', 'origin/main', '--', ...stage)
    const bodyText = buildBody({
      skill,
      evidence: evidenceFor,
      diffStat,
      before,
      after,
      evalCount: evals.length,
      generatedEvals: generated,
      unused30: evidenceFor.fired30 === 0,
    })
    const changedFiles = git(wt.path, 'diff', '--name-only', 'origin/main').split('\n').filter(Boolean)
    const guard = outOfScope(changedFiles, allowed)
    if (guard) throw new OutOfScope(guard)
    const leak = leakGuard({ files: changedFiles.map((f) => join(wt.path, f)), bodyText, projectOnly: skillRel.startsWith('packs/') })
    if (!leak.ok) {
      log(`no-change ${skill} ${before.toFixed(2)} ${after.toFixed(2)} leak-check failed`)
      console.log(`SKILL_IMPROVER: leak-check failed, nothing pushed\n${leak.output}`)
      return { result: 'no-change' }
    }
    git(wt.path, 'push', '-q', 'origin', branch)
    const url = createPr({ branch, skill, bodyText })
    log(`pr ${skill} ${before.toFixed(2)} ${after.toFixed(2)} ${url}`)
    console.log(`SKILL_IMPROVER: pr ${url}`)
    return { result: 'pr' }
  } finally {
    wt.remove()
    rmSync(oldCopy, { recursive: true, force: true })
  }
}

async function main() {
  const repoRoot = resolve(arg('--repo', kitCheckout))
  const statePath = join(stateDir(), 'state.json')
  const state = readJson(statePath, { lastImproved: {} })
  const meter = new Meter(BUDGET)
  let result = 'done'
  const finish = (code) => {
    if (!flag('--dry-run')) appendSpend({ target: TARGET, mode: meter.mode, usd: meter.usd, tokens: meter.total, result })
    return code
  }
  const { ev } = writeEvidence({ kitRoot: repoRoot, since: state.lastRun })
  let open
  try {
    open = openImproverBranches()
  } catch (e) {
    log(`paused cannot list open PRs: ${e.message.split('\n')[0]}`)
    console.log('SKILL_IMPROVER: paused (cannot list open improver PRs)')
    result = 'paused'
    return finish(0)
  }
  const exclude = [...open]
  const limit = flag('--once') || arg('--skill') ? 1 : 2
  try {
    for (let n = 0; n < limit; n++) {
      if (n === 1 && meter.total >= 200000) break
      const p = arg('--skill') ? { skill: arg('--skill'), reason: 'chosen' } : pick(ev.skills, state.lastImproved, exclude)
      if (!p.skill) {
        console.log(`SKILL_IMPROVER: ${p.reason}`)
        if (n === 0) result = 'paused'
        break
      }
      if (!ev.skills[p.skill]) throw new Error(`unknown skill ${p.skill}`)
      console.log(`SKILL_IMPROVER: picked ${p.skill} (${p.reason})`)
      if (flag('--dry-run')) break
      exclude.push(`chore/skill-improve-${p.skill}-x`)
      const r = await improveSkill({ skill: p.skill, evidenceFor: ev.skills[p.skill], meter, repoRoot })
      result = r.result
      state.lastImproved[p.skill] = today()
    }
  } catch (e) {
    if (e instanceof BudgetError) {
      log(`budget reached ${e.used}/${e.limit}`)
      console.log(`SKILL_IMPROVER: budget reached (${e.used}/${e.limit})`)
      result = 'budget'
      return finish(3)
    }
    if (e instanceof OutOfScope) {
      log(`out-of-scope ${e.path}`)
      console.log(`SKILL_IMPROVER: out-of-scope ${e.path}`)
      result = 'out-of-scope'
      return finish(2)
    }
    result = 'error'
    finish(1)
    throw e
  }
  if (!flag('--dry-run')) {
    state.lastRun = new Date().toISOString()
    writeJson(statePath, state)
  }
  console.log(`SKILL_IMPROVER: done (${meter.total}/${BUDGET} tokens, $${meter.usd.toFixed(4)}, ${meter.mode})`)
  return finish(0)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      log(`error ${e.message.split('\n')[0]}`)
      console.error(`SKILL_IMPROVER: error ${e.message}`)
      process.exit(1)
    },
  )
}
