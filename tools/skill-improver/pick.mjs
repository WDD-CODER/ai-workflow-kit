/**
 * Picker: highest evidence score; ties -> least recently improved; skips a skill with an open improver PR;
 * pauses entirely when 3 or more improver PRs are open (no pile-up). Pure function.
 */
export const MAX_OPEN = 3

/**
 * @param {Record<string, {score:number}>} skills evidence per skill
 * @param {Record<string, string>} lastImproved skill -> ISO date
 * @param {string[]} openBranches head branch names of open improver PRs (chore/skill-improve-<skill>-<date>)
 * @returns {{ skill: string|null, reason: string }}
 */
export function pick(skills, lastImproved = {}, openBranches = []) {
  if (openBranches.length >= MAX_OPEN) return { skill: null, reason: `paused: ${openBranches.length} improver PRs open` }
  const names = Object.keys(skills)
  const cand = names.filter((n) => !openBranches.some((b) => b.startsWith(`chore/skill-improve-${n}-`)))
  if (!cand.length) return { skill: null, reason: 'no candidate skill' }
  cand.sort(
    (a, b) =>
      skills[b].score - skills[a].score ||
      (lastImproved[a] ?? '').localeCompare(lastImproved[b] ?? '') ||
      a.localeCompare(b),
  )
  return { skill: cand[0], reason: `score ${skills[cand[0]].score}` }
}
