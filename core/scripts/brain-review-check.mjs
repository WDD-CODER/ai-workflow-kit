/**
 * Advisory-only staleness check for docs/brain/.
 * Never auto-edits or auto-deletes — only prints findings. Always exits 0.
 *
 * Modes:
 *   --scope=dead-refs  Fast: flags brain entries referencing files deleted/renamed by the
 *                      current PR's diff (vs the base branch). Wired into ci.yml, every PR.
 *   --scope=full       Full: dead refs across the whole repo (not diff-scoped) + all
 *                      past-due `review-by` dates in docs/brain/decisions/. Wired into
 *                      /ship's feature-complete/PR path only.
 *
 * Usage: node scripts/brain-review-check.mjs --scope=dead-refs|full [--base=main]
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const brainDir = join(repoRoot, 'docs', 'brain')

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const [key, value] = arg.replace(/^--/, '').split('=')
    return [key, value ?? true]
  })
)
const scope = args.scope
if (scope !== 'dead-refs' && scope !== 'full') {
  console.error('Usage: node scripts/brain-review-check.mjs --scope=dead-refs|full [--base=main]')
  process.exit(0)
}
const base = args.base || process.env.GITHUB_BASE_REF || '{{git.mainBranch}}'

function listBrainFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listBrainFiles(full))
    else if (entry.endsWith('.md')) out.push(full)
  }
  return out
}

// Matches backtick-quoted paths like `{{paths.srcRoot}}core/services/logging.service.ts`
// or `{{paths.serverRoot}}routes/ai.js` — a path segment with a slash and a known extension.
const REF_PATTERN = /`([\w./-]+\/[\w.-]+\.(?:ts|html|{{stack.stylesheetExt}}|js|mjs|json|md|py|sh))`/g

function extractRefs(fileText) {
  const refs = []
  let match
  while ((match = REF_PATTERN.exec(fileText)) !== null) refs.push(match[1])
  return refs
}

function extractReviewBy(fileText) {
  const match = fileText.match(/^review-by:\s*(\d{4}-\d{2}-\d{2})\s*$/m)
  return match ? match[1] : null
}

function gitDeletedOrRenamedFiles(baseRef) {
  try {
    const out = execFileSync('git', ['diff', '--name-status', `${baseRef}...HEAD`], { cwd: repoRoot, encoding: 'utf8' })
    const deleted = new Set()
    for (const line of out.split('\n')) {
      if (!line) continue
      const [status, ...paths] = line.split('\t')
      if (status === 'D') deleted.add(paths[0])
      else if (status.startsWith('R')) deleted.add(paths[0]) // old name of a rename
    }
    return deleted
  } catch {
    return new Set() // no base ref available (e.g. shallow clone, local run) — advisory, skip quietly
  }
}

const brainFiles = listBrainFiles(brainDir)
const findings = []

if (scope === 'dead-refs') {
  const deleted = gitDeletedOrRenamedFiles(base)
  if (deleted.size > 0) {
    for (const file of brainFiles) {
      const refs = extractRefs(readFileSync(file, 'utf8'))
      for (const ref of refs) {
        if (deleted.has(ref)) {
          findings.push(`${file.replace(repoRoot + '\\', '').replace(repoRoot + '/', '')} references "${ref}", which this PR deletes/renames`)
        }
      }
    }
  }
}

if (scope === 'full') {
  for (const file of brainFiles) {
    const text = readFileSync(file, 'utf8')
    const relFile = file.replace(repoRoot + '\\', '').replace(repoRoot + '/', '')

    for (const ref of extractRefs(text)) {
      if (!existsSync(join(repoRoot, ref))) {
        findings.push(`${relFile} references "${ref}", which no longer exists in the repo`)
      }
    }

    const reviewBy = extractReviewBy(text)
    if (reviewBy && new Date(reviewBy) < new Date()) {
      findings.push(`${relFile} has review-by: ${reviewBy}, which is in the past`)
    }
  }
}

if (findings.length === 0) {
  console.log(`brain-review-check (--scope=${scope}): no issues found`)
} else {
  console.log(`brain-review-check (--scope=${scope}): ${findings.length} advisory finding(s)`)
  for (const f of findings) console.log(`  - ${f}`)
  console.log('\nAdvisory only — no files were changed. Review and supersede/fix by hand.')
}

process.exit(0)
