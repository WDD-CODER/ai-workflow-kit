/**
 * Required workflow steps: which steps of a kit workflow a project's own copy (an override) must keep.
 *
 * The kit marks a step with the comment line `# KIT:required — …` directly above its `- name:` line.
 * Node built-ins only: the kit's tools and the project script `scripts/override-check.mjs` both import this.
 */

const MARKER = /^[ \t]*#[ \t]*KIT:required\b/
const NAME_ITEM = /^[ \t]*-[ \t]+name:[ \t]*(.*?)[ \t]*$/

const unquote = (v) => {
  const s = v.trim()
  const m = /^(["'])(.*)\1(?:[ \t]+#.*)?$/.exec(s)
  if (m) return m[2]
  return s.replace(/[ \t]+#.*$/, '')
}

/** The step names a template marks `# KIT:required`, in marker order. A marker not directly above a `- name:` line throws. */
export function requiredSteps(templateText, where = 'workflow') {
  const lines = templateText.split('\n').map((l) => l.replace(/\r$/, ''))
  const names = []
  lines.forEach((line, i) => {
    if (!MARKER.test(line)) return
    const m = NAME_ITEM.exec(lines[i + 1] ?? '')
    if (!m || !m[1]) throw new Error(`${where}:${i + 1}: KIT:required marker is not directly above a "- name:" line`)
    names.push(unquote(m[1]))
  })
  return names
}

/** Every `name:` of a real step: a list item under `steps:` — not a comment, not inside a `run: |` body. */
export function stepNames(workflowText) {
  const names = []
  let stepsIndent = -1 // indent of the `steps:` key being read, -1 = not inside one
  let itemIndent = -1 // indent of the `-` of its list items
  let block = -1 // indent of the key whose `|` / `>` body is being skipped, -1 = none
  for (const raw of workflowText.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim() || /^[ \t]*#/.test(line)) continue
    const indent = /^[ \t]*/.exec(line)[0].length
    if (block >= 0) {
      if (indent > block) continue
      block = -1
    }
    const item = /^([ \t]*)-[ \t]/.exec(line)
    const keyCol = item ? item[0].length : indent
    if (/^[^#]*:[ \t]*[|>][+-]?\d*[ \t]*(?:#.*)?$/.test(line)) block = keyCol
    if (stepsIndent >= 0) {
      if (itemIndent < 0) {
        if (item && indent >= stepsIndent) itemIndent = indent
        else stepsIndent = -1
      } else if (indent < itemIndent) {
        stepsIndent = -1
        itemIndent = -1
      }
    }
    const steps = /^([ \t]*)steps:[ \t]*(?:#.*)?$/.exec(line)
    if (steps) {
      stepsIndent = steps[1].length
      itemIndent = -1
      continue
    }
    if (stepsIndent < 0 || itemIndent < 0) continue
    const named = item && indent === itemIndent ? NAME_ITEM.exec(line) : indent === itemIndent + 2 ? /^[ \t]*name:[ \t]*(.*?)[ \t]*$/.exec(line) : null
    if (named && named[1]) names.push(unquote(named[1]))
  }
  return names
}

/** The required names the workflow's steps do not contain. */
export function missingSteps(workflowText, required) {
  const have = new Set(stepNames(workflowText))
  return required.filter((n) => !have.has(n))
}
