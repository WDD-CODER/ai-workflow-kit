#!/usr/bin/env node
/**
 * Kit-owned lessons (plan 046; kit repository only, never rendered into a project). Lessons true for every project live in
 * core/docs/agent/kit-lessons/<role>.md; every change is applied here, by id, one line at a time.
 *
 *   node tools/kit-lessons.mjs add    --role <role> --text "<lesson>" --why "<reason>" --issue I7 [--since 1.13.0]
 *   node tools/kit-lessons.mjs update K<n> [--text "<lesson>"] [--why "<reason>"]
 *   node tools/kit-lessons.mjs retire K<n> --reason enforced:<path>|gone:<why> [--human]
 *   node tools/kit-lessons.mjs check
 *   node tools/kit-lessons.mjs list
 *
 * `--dir <folder>` replaces core/docs/agent/kit-lessons (tests). `since` defaults to the next minor version after kit.json's.
 * A safety lesson (its text or reason names auth, security, secrets or data loss) is retired only with `--human`.
 * `--dry-run` prints the new line and writes nothing. Exit 0 = ok, 1 = refused or a check failed, 2 = bad arguments.
 * Node built-ins only.
 */
import { resolve, join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { KIT_LESSON_ROLES, addLesson, updateLesson, retireLesson, checkDir, readAll, isSafety, liveChars, fileOf, writeText } from './lib/kit-learn/lessons.mjs'

const kitRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

function parse(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) out._.push(a)
    else if (['human', 'dry-run'].includes(a.slice(2))) out[a.slice(2)] = true
    else if (argv[i + 1] !== undefined) out[a.slice(2)] = argv[++i]
    else throw new Error(`${a} needs a value`)
  }
  return out
}

/** The next minor version after kit.json's: "since v1.13.0" for a lesson added while 1.12.0 is released. */
export function nextVersion(root = kitRoot) {
  try {
    const [maj, min] = String(JSON.parse(readFileSync(join(root, 'kit.json'), 'utf8')).version).split('.').map(Number)
    if (Number.isInteger(maj) && Number.isInteger(min)) return `${maj}.${min + 1}.0`
  } catch { /* fall through */ }
  return '0.0.0'
}

export function main(argv, { root = kitRoot, out = (s) => process.stdout.write(`${s}\n`), err = (s) => process.stderr.write(`${s}\n`) } = {}) {
  let f
  try {
    f = parse(argv)
  } catch (e) {
    err(`KIT_LESSONS: ${e.message}`)
    return 2
  }
  const cmd = f._[0]
  const dir = resolve(f.dir ?? join(root, 'core', 'docs', 'agent', 'kit-lessons'))
  if (!['add', 'update', 'retire', 'check', 'list'].includes(cmd)) {
    err('KIT_LESSONS: usage: node tools/kit-lessons.mjs add|update|retire|check|list — see the header of this file')
    return 2
  }
  if (!existsSync(dir)) {
    err(`KIT_LESSONS: ${dir} does not exist`)
    return 1
  }
  if (cmd === 'check') {
    const problems = checkDir(dir)
    for (const p of problems) err(`KIT_LESSONS: ${p}`)
    out(problems.length ? `KIT_LESSONS: ${problems.length} problem(s)` : 'KIT_LESSONS: ok')
    return problems.length ? 1 : 0
  }
  if (cmd === 'list') {
    for (const [role, p] of Object.entries(readAll(dir))) {
      out(`${role}: ${p.live.length} live line(s), ${liveChars(p.live)} of 2000 characters, ${p.retired.length} retired`)
      for (const l of p.live) out(`  ${l.id}${isSafety(l) ? ' [safety]' : ''} ${l.text} (issue ${l.issue}, since v${l.since})`)
    }
    return 0
  }
  let r
  if (cmd === 'add') {
    if (!f.role || !f.text || !f.why || !f.issue) {
      err('KIT_LESSONS: add needs --role, --text, --why and --issue')
      return 2
    }
    r = addLesson(dir, { role: f.role, text: f.text, why: f.why, issue: f.issue, since: f.since ?? nextVersion(root) })
  } else if (cmd === 'update') {
    if (!/^K\d+$/.test(f._[1] ?? '') || (f.text === undefined && f.why === undefined)) {
      err('KIT_LESSONS: update needs K<n> and --text and/or --why')
      return 2
    }
    r = updateLesson(dir, f._[1], { text: f.text, why: f.why })
  } else {
    if (!/^K\d+$/.test(f._[1] ?? '') || !f.reason) {
      err('KIT_LESSONS: retire needs K<n> and --reason enforced:<path>|gone:<why>')
      return 2
    }
    r = retireLesson(dir, f._[1], { reason: f.reason, human: f.human === true })
  }
  if (r.error) {
    err(`KIT_LESSONS: ${r.error}`)
    return 1
  }
  if (f['dry-run']) {
    out(`KIT_LESSONS: dry run — ${r.role}.md would get ${r.line}`)
    return 0
  }
  writeText(fileOf(dir, r.role), r.text)
  out(`KIT_LESSONS: ${cmd} ${r.id ?? f._[1]} in ${r.role}.md — ${r.line}`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}

export { KIT_LESSON_ROLES }
