/**
 * Open plan paths — the one place that knows where open plans live.
 *
 * An open plan is a `*.plan.md` file directly inside one of OPEN_PLAN_DIRS
 * (`plans/` itself, plus subfolders such as `plans/design/`). Range folders
 * (`plans/300-400/`) and `plans/archive/` hold closed plans and never count.
 * Shared by take-plan, todo-query, scope-check, lib/slot, plan-close and
 * next-plan-number. The shell guards (branch-guard.sh, .husky/pre-push) carry
 * the same list as OPEN_PLAN_SHELL_RE.
 */
import { readdirSync, existsSync, statSync } from 'fs'
import { join, posix } from 'path'

export const OPEN_PLAN_DIRS = [{{plans.openDirs|quoted}}]

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** POSIX-ERE body matching an open plan path, for grep -E / bash [[ =~ ]]. */
export const OPEN_PLAN_SHELL_RE = `^(${OPEN_PLAN_DIRS.map(escapeRe).join('|')})/[^/]+\\.plan\\.md$`
export const OPEN_PLAN_RE = new RegExp(OPEN_PLAN_SHELL_RE)

const toPosix = (rel) => String(rel).replace(/\\/g, '/').replace(/^\.\//, '')

/** True for `plans/NNN-x.plan.md` and `plans/design/NNN-x.plan.md`; false for range folders and archive/. */
export function isOpenPlanPath(rel) {
  return OPEN_PLAN_RE.test(toPosix(rel))
}

/** Every open plan under root, as repo-relative POSIX paths, sorted. */
export function listOpenPlans(root) {
  const out = []
  for (const dir of OPEN_PLAN_DIRS) {
    const abs = join(root, dir)
    if (!existsSync(abs)) continue
    for (const name of readdirSync(abs)) {
      if (!name.endsWith('.plan.md')) continue
      if (!statSync(join(abs, name)).isFile()) continue
      out.push(posix.join(dir, name))
    }
  }
  return out.sort()
}

/** The open plan numbered nnn among paths (e.g. a `git ls-tree` listing), or null. */
export function findOpenPlanIn(paths, nnn) {
  const prefix = `${nnn}-`
  return paths.map(toPosix).find((p) => isOpenPlanPath(p) && posix.basename(p).startsWith(prefix)) ?? null
}

/** The open plan numbered nnn under root (repo-relative POSIX path), or null. */
export function findOpenPlan(root, nnn) {
  return findOpenPlanIn(listOpenPlans(root), nnn)
}
