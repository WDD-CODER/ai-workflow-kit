/**
 * Pre-commit: block staged files that look like hardcoded secrets / API keys.
 * `PATTERNS` is exported (scripts/lib/brain-doc.mjs redacts with the same list); the git check runs only when this file is
 * the script being run, so importing it does nothing.
 */
import { execSync } from 'child_process'
import { readFileSync, realpathSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

export const PATTERNS = [
  { name: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'generic-api-key', re: /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i },
  { name: 'bearer-token', re: /Bearer\s+[A-Za-z0-9\-_\.]{20,}/ },
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'google-api-key', re: /AIza[0-9A-Za-z\-_]{20,}/ },
  { name: 'mongo-uri-creds', re: /mongodb(?:\+srv)?:\/\/[^:\s]+:[^@\s]+@/ }
]

function main() {
  const staged = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' })
    .split('\n')
    .map(f => f.trim())
    .filter(f => f && !f.endsWith('.md') && !f.includes('package-lock.json'))

  let blocked = false
  for (const file of staged) {
    let content
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const { name, re } of PATTERNS) {
      if (re.test(content)) {
        console.error(`secret-scan: blocked ${file} — matched pattern "${name}"`)
        blocked = true
      }
    }
  }

  if (blocked) {
    console.error('\nCommit blocked: remove hardcoded secrets/API keys from staged files.')
    process.exit(1)
  }
}

// Run the scan only when this file is the script being run (an import just reads PATTERNS). The paths are compared by real
// path, and case-insensitively on Windows, so a symlink or a differently-cased path never skips the scan; if the paths
// cannot be resolved the scan runs (fail closed).
function runDirectly() {
  if (!process.argv[1]) return false
  try {
    const a = realpathSync(resolve(process.argv[1]))
    const b = realpathSync(fileURLToPath(import.meta.url))
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
  } catch {
    return true
  }
}
if (runDirectly()) main()
