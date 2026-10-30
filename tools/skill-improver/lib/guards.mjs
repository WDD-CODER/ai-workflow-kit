/**
 * Guards shared by every target: the path guard (allowed-path list per target) and the leak guard.
 */
import { spawnSync } from 'child_process'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Allowed paths for the `skill` target: anything under `<anywhere>/.claude/skills/<skill>/`. */
export const skillAllowed = (skill) => [new RegExp(`(^|/)\\.claude/skills/${esc(skill)}/`)]

/** Path guard: every changed path must match one allowed pattern. Returns the first offender or null. */
export function outOfScope(paths, allowed) {
  return paths.find((p) => !allowed.some((re) => re.test(p.replace(/\\/g, '/')))) ?? null
}

/** Leak guard on the changed files and the PR body. Returns { ok, output }. */
export function leakGuard({ files, bodyText, projectOnly }) {
  const dir = mkdtempSync(join(tmpdir(), 'skill-improver-leak-'))
  const bodyFile = join(dir, 'pr-body.md')
  writeFileSync(bodyFile, bodyText)
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'leak-check.mjs')
  const run = (roots, extra) => spawnSync(process.execPath, [script, ...roots.flatMap((r) => ['--root', r]), ...extra], { encoding: 'utf8' })
  const a = run(files, projectOnly ? ['--project-only'] : [])
  const b = run([bodyFile], ['--project-only'])
  return { ok: a.status === 0 && b.status === 0, output: `${a.stdout}${a.stderr}${b.stdout}${b.stderr}`.trim() }
}
