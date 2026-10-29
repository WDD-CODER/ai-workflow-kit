/**
 * Done-when tags — the shape rule for a plan's Done-when items (docs/agent/job-validation.md), shared by
 * scripts/scope-check.mjs --tags (the save-plan shape lint) and scripts/orch-state.mjs plan-info (the [ui] items the
 * orchestrator holds the builder's cards against). Pure: callers pass the plan text.
 */
/** A `## Goals & Success Criteria`, `## Success Criteria` or `## Done when` heading: where Done-when items live. */
const DONE_WHEN_SECTION_RE = /^##\s+.*(?:success criteria|done[- ]when)/i

/** The plan's `[ui]` items, verbatim without the tag, in file order — only from its Done-when sections (Goals &
 *  Success Criteria, Success Criteria, Done when): a `[ui]` bullet in the notes or the sub-tasks is not an item. */
export function uiItems(planText) {
  const out = []
  let inSection = false
  for (const line of String(planText).replace(/\r\n/g, '\n').split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      inSection = DONE_WHEN_SECTION_RE.test(line)
      continue
    }
    if (!inSection) continue
    const m = /^\s*[-*]\s*(?:\[[ xX]\]\s*)?\[ui\]\s*(.+)$/.exec(line)
    if (m) out.push(m[1].trim())
  }
  return out
}

/**
 * The tags a Done-when item may start with (docs/agent/job-validation.md). Lower case, exactly as written.
 * `[auto:main]` is an `[auto]` item whose command the orchestrator runs from the main folder, not in a worktree or the
 * merge folder: it reads the live environment (`.env`, a database, a log) those folders never have.
 */
export const DONE_WHEN_TAGS = ['auto', 'auto:main', 'ui', 'human']

/**
 * The save-plan shape lint for Done-when tags: every top-level bullet of a `## Goals & Success Criteria`,
 * `## Success Criteria` or `## Done when` section starts with `[auto]`, `[auto:main]`, `[ui]` or `[human]` (after an
 * optional `[ ]` / `[x]` box). Returns one problem line per bad item: no tag, an unclosed tag (`[ui`) or a wrong
 * spelling (`[UI]`, `[main]`).
 */
export function doneWhenTagProblems(planText) {
  const problems = []
  let inSection = false
  const lines = String(planText).replace(/\r\n/g, '\n').split('\n')
  lines.forEach((line, i) => {
    if (/^#{1,6}\s/.test(line)) {
      inSection = DONE_WHEN_SECTION_RE.test(line)
      return
    }
    if (!inSection) return
    const m = /^[-*]\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line)
    if (!m) return
    const body = m[1].trim()
    const tag = /^\[([^\]\s]*)\]/.exec(body)
    if (tag && DONE_WHEN_TAGS.includes(tag[1])) return
    let why
    if (tag) why = `tag [${tag[1]}] is not one of ${DONE_WHEN_TAGS.map((t) => `[${t}]`).join(', ')} (lower case, exactly)`
    else if (/^\[[a-z]+(?:\s|$)/i.test(body)) why = `tag ${body.split(/\s/)[0]} is not closed — write ${DONE_WHEN_TAGS.map((t) => `[${t}]`).join(', ')}`
    else why = `no tag — start the item with ${DONE_WHEN_TAGS.map((t) => `[${t}]`).join(', ')}`
    problems.push(`line ${i + 1}: ${why}: ${body.slice(0, 80)}`)
  })
  return problems
}
