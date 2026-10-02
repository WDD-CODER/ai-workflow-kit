/**
 * Pre-commit: block staged files that look like hardcoded secrets / API keys.
 */
import { execSync } from 'child_process'
import { readFileSync } from 'fs'

const PATTERNS = [
  { name: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'generic-api-key', re: /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i },
  { name: 'bearer-token', re: /Bearer\s+[A-Za-z0-9\-_\.]{20,}/ },
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'gemini-or-google-key', re: /AIza[0-9A-Za-z\-_]{20,}/ },
  { name: 'mongo-uri-creds', re: /mongodb(?:\+srv)?:\/\/[^:\s]+:[^@\s]+@/ }
]

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
