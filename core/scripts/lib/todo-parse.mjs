/**
 * Shared `.claude/todo.md` parser — used by todo-archive.mjs, todo-query.mjs,
 * and plan-ledger-check.mjs. One parser only; never copy these functions.
 */

/**
 * todo.md footers only — not archive container `## Done` (which sits above plans).
 * Matches `## Plan Index`, `## Where things live`, or `## Done` + stub phrase.
 */
export function isTodoFooterLine(lines, i) {
  if (/^## Plan Index\b/.test(lines[i])) return true
  if (/^## Where things live\b/.test(lines[i])) return true
  if (!/^## Done\s*$/.test(lines[i])) return false
  for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
    if (/Completed entries are in/i.test(lines[j])) return true
    if (/Completed plan sections live in/i.test(lines[j])) return true
    if (/^### Plans?\b/.test(lines[j])) return false
    if (/^## /.test(lines[j])) return false
  }
  return false
}

/**
 * Split markdown into `### Plan …` sections.
 * Stops the last section before todo.md footers (`## Done` stub / `## Plan Index`).
 */
export function splitPlanSections(text) {
  const lines = text.split(/\r?\n/)
  const sectionStarts = []
  for (let i = 0; i < lines.length; i++) {
    if (/^### Plans?\b/.test(lines[i])) sectionStarts.push(i)
  }

  if (!sectionStarts.length) {
    return { preamble: text, sections: [], lines, sectionStarts, footerStart: lines.length }
  }

  let footerStart = lines.length
  for (let i = sectionStarts[0]; i < lines.length; i++) {
    if (isTodoFooterLine(lines, i)) {
      footerStart = i
      break
    }
  }

  const sections = []
  for (let s = 0; s < sectionStarts.length; s++) {
    const start = sectionStarts[s]
    let end = s + 1 < sectionStarts.length ? sectionStarts[s + 1] : footerStart
    if (end > footerStart) end = footerStart

    // A non-"### Plan" heading (e.g. "## 6. KEEP DEFERRED") between this plan
    // and the next one must also close the section — otherwise unrelated
    // sibling content (and any "(deferred)" wording in it) gets absorbed into
    // this plan's block and corrupts its checkbox/deferred stats.
    for (let i = start + 1; i < end; i++) {
      if (/^## /.test(lines[i])) {
        end = i
        break
      }
    }

    const chunk = lines.slice(start, end)
    while (chunk.length && /^\s*$/.test(chunk[chunk.length - 1])) chunk.pop()
    while (chunk.length > 1 && /^---\s*$/.test(chunk[chunk.length - 1])) {
      chunk.pop()
      while (chunk.length && /^\s*$/.test(chunk[chunk.length - 1])) chunk.pop()
    }

    sections.push({
      heading: chunk[0] || '',
      full: chunk.join('\n'),
      start,
      end
    })
  }

  return {
    preamble: lines.slice(0, sectionStarts[0]).join('\n'),
    sections,
    lines,
    sectionStarts,
    footerStart
  }
}

export function isDeferredBlocked(sectionText) {
  return (
    /\(deferred\)/i.test(sectionText) ||
    /\(skipped\)/i.test(sectionText) ||
    /\[~\]/.test(sectionText)
  )
}

export function checkboxStats(sectionText) {
  const open = (sectionText.match(/^- \[ \]/gm) || []).length
  const done = (sectionText.match(/^- \[x\]/gim) || []).length
  return { open, done }
}

export function isFullyDone(sectionText) {
  const { open, done } = checkboxStats(sectionText)
  return open === 0 && done > 0 && !isDeferredBlocked(sectionText)
}

export function findArchiveCandidates(todoText) {
  const { sections } = splitPlanSections(todoText)
  return sections.filter(s => isFullyDone(s.full))
}
