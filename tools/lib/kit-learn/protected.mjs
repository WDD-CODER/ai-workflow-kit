/**
 * The graders the learning loop must not reach (plan 046, K10). A card's recommendation may only name these paths as
 * `human-only`: `apply` marks such a proposal `protected: true`, and the autonomy plan (047) never automates it.
 * A path is protected when it equals a literal entry or sits under a `/**` entry.
 */
export const PROTECTED = [
  'tools/agent-eval.mjs',
  'tools/lib/agent-eval/**',
  'tools/test/**',
  'core/scripts/lib/brain-doc.mjs',
  'tools/lib/kit-learn/**',
  'tools/leak-check.mjs',
  'core/scripts/pre-commit-secret-scan.mjs',
]

const norm = (p) => String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '')

export function isProtectedPath(path) {
  const p = norm(path)
  return PROTECTED.some((rule) => (rule.endsWith('/**') ? p.startsWith(rule.slice(0, -2)) : p === rule))
}

/** The protected paths among `paths`. */
export const protectedPaths = (paths) => (Array.isArray(paths) ? paths.map(norm).filter(isProtectedPath) : [])
