/**
 * Local state and logs for the skill improver. Everything lives under ~/.claude/skill-improver
 * (override: SKILL_IMPROVER_HOME), never inside a repo. Node built-ins only.
 */
import { appendFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export const stateDir = () => {
  const d = process.env.SKILL_IMPROVER_HOME || join(homedir(), '.claude', 'skill-improver')
  mkdirSync(d, { recursive: true })
  return d
}

export const today = () => new Date().toISOString().slice(0, 10)

export const log = (line) => appendFileSync(join(stateDir(), 'log.txt'), `${new Date().toISOString()} ${line}\n`)

export const readJson = (file, fallback) => {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback
  } catch {
    return fallback
  }
}
export const writeJson = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2))

/** One line per run in spend.jsonl: what each nightly job cost and under which billing mode. */
export const appendSpend = ({ target, mode, usd, tokens, result }) =>
  appendFileSync(
    join(stateDir(), 'spend.jsonl'),
    `${JSON.stringify({ date: today(), target, mode, usd: Math.round(usd * 1e6) / 1e6, tokens, result })}\n`,
  )
