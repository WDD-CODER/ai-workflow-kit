/**
 * Write session state — shared by Claude Code and Cursor.
 * Implements /ship Phase 5 (session-state fold): resolves the same target
 * path session-startup.sh reads, then appends or fully rewrites it per the
 * schema in .claude/commands/ship.md Phase 5.
 * See plans/324-ship-prep-and-write-session-state-scripts.plan.md.
 *
 * Usage:
 *   node scripts/write-session-state.mjs --summary "<bullets>" --next "<bullets>" [--pr <url>]
 *
 * Bullets are newline-separated; each line is normalized to a "- " prefix.
 * Does not run `git add` or amend — those stay as prose steps in ship.md.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { resolveSessionStatePath } from './session-state-path.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next !== undefined) {
        out[key] = next
        i++
      } else {
        out[key] = true
      }
    }
  }
  return out
}

function fail(message) {
  console.error(`WRITE_SESSION_STATE: ${message}`)
  process.exit(1)
}

const args = parseArgs(process.argv.slice(2))
if (!args.summary) fail('requires --summary "<bullets>"')
if (!args.next) fail('requires --next "<bullets>"')

function git(cmdArgs) {
  try {
    return execFileSync('git', cmdArgs, { cwd: repoRoot, encoding: 'utf8' }).replace(/\r?\n+$/, '')
  } catch {
    return ''
  }
}

function resolveTargetPath() {
  const resolved = resolveSessionStatePath()
  if (resolved === 'NONE') fail('resolved session-state path is NONE (detached HEAD in an idle slot) — nothing to write')
  return join(repoRoot, resolved)
}

function toBullets(raw) {
  return String(raw)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => (l.startsWith('-') ? l : `- ${l}`))
    .join('\n')
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function countChangedFiles() {
  const out = git(['diff', 'origin/main...HEAD', '--stat'])
  if (!out) return { count: 0, stat: '' }
  const lines = out.split('\n')
  const summaryLine = lines[lines.length - 1] || ''
  const m = summaryLine.match(/(\d+) files? changed/)
  return { count: m ? Number(m[1]) : Math.max(lines.length - 1, 0), stat: out }
}

const targetPath = resolveTargetPath()
const branch = git(['branch', '--show-current'])
const shortHead = git(['rev-parse', '--short', 'HEAD'])
const { count: changedFileCount, stat } = countChangedFiles()
const summaryBullets = toBullets(args.summary)
const nextBullets = toBullets(args.next)
const pr = args.pr || 'N/A'

if (changedFileCount <= 1 && existsSync(targetPath)) {
  const existing = readFileSync(targetPath, 'utf8')
  const lines = existing.split(/\r?\n/)
  const headingIdx = lines.findIndex(l => /^## Session Summary\s*$/.test(l))
  if (headingIdx === -1) fail(`${targetPath} exists but has no "## Session Summary" heading — cannot append`)

  let insertAt = lines.length
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      insertAt = i
      break
    }
  }
  while (insertAt > headingIdx + 1 && /^\s*$/.test(lines[insertAt - 1])) insertAt--

  const newLine = `- ${todayISO()} (${shortHead}): ${args.summary.split(/\r?\n/)[0].trim()}`
  lines.splice(insertAt, 0, newLine)
  writeFileSync(targetPath, lines.join('\n'), 'utf8')
  console.log(`WRITE_SESSION_STATE: appended one line to ${targetPath}`)
} else {
  const content = `# Session State

## Branch
${branch}

## Date
${todayISO()}

## Session Summary
${summaryBullets}

## Files Modified
${stat || '(no diff against origin/main)'}

## Commit
${shortHead || 'none'}

## PR
${pr}

## Next Steps
${nextBullets}
`
  writeFileSync(targetPath, content, 'utf8')
  console.log(`WRITE_SESSION_STATE: full rewrite of ${targetPath}`)
}
