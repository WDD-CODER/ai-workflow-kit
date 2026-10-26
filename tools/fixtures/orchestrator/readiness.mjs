/**
 * Plans for the readiness product-question rule (core/.claude/agents/orch-readiness.md, step 4), and a deterministic
 * mirror of that rule for the test: a plan that adds or changes interactive behaviour must say what happens on edit,
 * on leave, on cancel and on error; each one it leaves out is a question. Styling-only and backend-only plans are
 * skipped. The real agent is a model; the test keeps the rule and its fixtures honest.
 */
const plan = (title, body) => `# Plan 601 — ${title}

Status: draft
Depends-on: none

## Goals & Success Criteria
${body}

## Read-Write Scope

\`\`\`scope
src/app/profile/**
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
