/**
 * Style QA redaction — no token or credential reaches a report or the finding store. The pre-commit secret scan's
 * patterns (one list, scripts/pre-commit-secret-scan.mjs) plus the shapes a page can leak into a finding: a JWT, a
 * bearer token of any length from 8 characters, a secret-looking query or form value, credentials in a URL.
 *
 *   import { redact, deepRedact } from './redact.mjs'
 *
 * Node built-ins only; no placeholders (tools import it).
 */
import { PATTERNS } from '../pre-commit-secret-scan.mjs'

export const REDACT_PATTERNS = [
  ...PATTERNS.map(({ name, re }) => ({ name, re: new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`) })),
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { name: 'bearer-token', re: /Bearer\s+[A-Za-z0-9\-_.=]{8,}/g },
  { name: 'secret-param', re: /\b(?:token|access_token|refresh_token|id_token|api[_-]?key|apikey|secret|password|passwd|pwd|session|sid|auth)=[^\s&"'`|]{4,}/gi },
  { name: 'url-credentials', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/gi },
]

/** The text with every secret-looking part replaced by `[redacted:<pattern name>]`. */
export function redact(text) {
  let t = String(text ?? '')
  for (const { name, re } of REDACT_PATTERNS) t = t.replace(re, `[redacted:${name}]`)
  return t
}

/** A value with every string in it redacted (arrays and plain objects are walked). */
export function deepRedact(v) {
  if (typeof v === 'string') return redact(v)
  if (Array.isArray(v)) return v.map(deepRedact)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepRedact(x)]))
  return v
}
