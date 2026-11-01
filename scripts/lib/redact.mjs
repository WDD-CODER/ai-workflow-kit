/**
 * Redaction for the checker finders: the plan as a finder sees it, without the builder's own claims.
 *
 *   import { redactPlan, hasExecutionNotes } from './redact.mjs'
 *   const text = redactPlan(planText)
 *
 * The builder writes its evidence and decisions into the plan's `## Execution Notes`; a finder that reads "tests pass,
 * scope respected" is primed to agree. redactPlan drops that section (from its heading to the next `## ` heading or
 * the end) and keeps everything else, every `- [x]` / `- [ ]` line included: the ticks are the plan's state, which
 * orch-check-plan needs to see a ticked sub-task with no code. Node built-ins only; no placeholders (tools import it).
 */

const NOTES_HEADING = /^##[ \t]+Execution Notes[ \t]*$/i
const ANY_H2 = /^##[ \t]+\S/

/** True when the text has an `## Execution Notes` heading. */
export function hasExecutionNotes(text) {
  return String(text ?? '').split(/\r?\n/).some((l) => NOTES_HEADING.test(l))
}

/** The plan text without its `## Execution Notes` section(s); line endings are kept as they were. */
export function redactPlan(text) {
  const src = String(text ?? '')
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const out = []
  let skipping = false
  let fence = false
  for (const line of src.split(/\r?\n/)) {
    // A ``` fence inside the notes is skipped with them; a `## ` line inside a fence is not a heading.
    if (/^\s*```/.test(line)) fence = !fence
    if (!fence || /^\s*```/.test(line)) {
      if (NOTES_HEADING.test(line)) { skipping = true; continue }
      if (skipping && !fence && ANY_H2.test(line)) skipping = false
    }
    if (!skipping) out.push(line)
  }
  // Drop the blank lines the removed section leaves at the end.
  while (out.length > 1 && out[out.length - 1] === '' && out[out.length - 2] === '') out.pop()
  return out.join(eol)
}
