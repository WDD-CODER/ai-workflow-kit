/**
 * Plans for the readiness product-question rule (core/.claude/agents/orch-readiness.md, step 4), and a deterministic
 * mirror of that rule for the test: a plan that adds or changes interactive behaviour must say what happens on edit,
 * on leave, on cancel and on error; each one it leaves out is a question. Styling-only and backend-only plans are
 * skipped. The real agent is a model; the test keeps the rule and its fixtures honest.
 */
const plan = (title, body, scope = 'src/app/profile/**') => `# Plan 601 — ${title}

Status: draft
Depends-on: none

## Goals & Success Criteria
${body}

## Read-Write Scope

\`\`\`scope
${scope}
\`\`\`

## Atomic Sub-tasks
- [ ] A1: ${title}
`

/** Interactive, and silent about edit / leave / cancel / error. */
export const SILENT_PLAN = plan('Editable profile form with a save button', '- [ui] The profile page has an editable form with a Save button that stores the name')

/** Interactive, and says what happens when. */
export const COVERED_PLAN = plan('Editable profile form with a save button', `- [ui] The profile page has an editable form with a Save button that stores the name

## What happens when
- On edit: the Save button becomes enabled.
- On leave: nothing extra happens; unsaved changes are dropped.
- On cancel: the fields go back to the stored values.
- On error: the page shows the message "Could not save".`)

/** Interactive, partly covered: leave and error are missing. */
export const PARTLY_PLAN = plan('Editable profile form with a save button', `- [ui] The profile page has an editable form with a Save button that stores the name

## What happens when
- On edit: the Save button becomes enabled.
- On cancel: the fields go back to the stored values.`)

/** Styling only: no questions. */
export const STYLE_PLAN = plan('Restyle the profile heading', '- [auto] css-only: the heading uses the brand colour token, no behaviour change')

/** Backend only: no questions. */
export const BACKEND_PLAN = plan('Add a profile endpoint', '- [auto] backend-only: GET /profile returns 200 for a signed-in user')

/** Says "3 row-delete handlers"; the source (FALSE_COUNT_FILES) has 1. */
export const FALSE_COUNT_PLAN = plan('Confirm before the draft editor deletes a row', '- [auto] The draft editor has 3 row-delete handlers; each asks before it deletes', 'src/app/draft/**')
export const FALSE_COUNT_FILES = { 'src/app/draft/draft-editor.ts': 'class DraftEditor {\n  onRowDelete(i: number) {}\n  onRowAdd() {}\n}' }

/** Says "every number box", scope src/app/a/**; number boxes also sit in src/app/b/**. */
export const EVERY_PLAN = plan('Make every number box tap-to-edit', '- [ui] Every number box is tap-to-edit on the event pages', 'src/app/a/**')
export const EVERY_FILES = {
  'src/app/a/event-guests.html': '<number-box [value]="guests"></number-box>',
  'src/app/b/event-deposit.html': '<number-box [value]="deposit"></number-box>',
}

/**
 * The claims rule (orch-readiness.md, step 4): a count next to a code noun, and an "every X" goal, are checked against
 * the files. Returns one question per mismatch: a wrong count → build for what the code has; an "every X" with hits
 * outside the plan's scope → widen scope or leave them as follow-ups.
 */
export function claimGaps(text, files) {
  const out = []
  const t = String(text)
  const lines = (re) => Object.entries(files).flatMap(([f, src]) => src.split('\n').map((l, i) => [`${f}:${i + 1}`, l]).filter(([, l]) => re.test(l)).map(([at]) => at))
  const count = /\b(\d+)\s+([a-z]+)-([a-z]+)\s+(?:handlers?|endpoints?)\b/i.exec(t)
  if (count) {
    const hits = lines(new RegExp(`${count[2]}\\w*${count[3]}|${count[3]}\\w*${count[2]}`, 'i'))
    if (hits.length !== Number(count[1])) out.push(`claim: ${count[0]} — found: ${hits.length} (${hits.join(', ')}) — build for what the code has, or fix the plan? Default if unanswered: build for what the code has`)
  }
  const every = /\bevery ([a-z]+ [a-z]+) is\b/i.exec(t)
  if (every) {
    const scope = (/```scope\n([\s\S]*?)```/.exec(t)?.[1] ?? '').split('\n').map((g) => g.trim().replace(/\*\*$/, '')).filter(Boolean)
    const outside = lines(new RegExp(every[1].replace(' ', '[ -]?'), 'i')).filter((at) => !scope.some((g) => at.startsWith(g)))
    if (outside.length) out.push(`claim: every ${every[1]} — found: ${outside.length} outside scope (${outside.join(', ')}) — widen scope to these files, or leave them as follow-ups? Default if unanswered: leave them as follow-ups`)
  }
  return out
}

const WHEN = ['edit', 'leave', 'cancel', 'error']

/** The missing "what happens when" cases of a plan: [] when covered or not interactive. */
export function behaviourGaps(text) {
  const t = String(text)
  if (/css-only|backend-only|styling only/i.test(t)) return []
  if (!/\b(form|dialog|modal|button|editable|click|navigat\w+)\b/i.test(t)) return []
  const m = /^#{2,3} what happens when[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/im.exec(t)
  const section = m ? m[1].toLowerCase() : ''
  return WHEN.filter((w) => !new RegExp(`\\bon ${w}\\b`).test(section))
}
