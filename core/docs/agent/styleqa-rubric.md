# Style QA rubric — what the visual reviewer looks for

Kit-owned, shared by every project: `.claude/agents/styleqa-reviewer.md` reads it with the project's own theme facts
(`docs/qa/styleqa-theme.md`). The scripts (`docs/agent/styleqa.md`) already measure overflow, touch targets, token
literals and contrast; the reviewer looks at what a script cannot judge.

## Checks

| ID | Look for |
| --- | --- |
| V1 | A control that looks unstyled — a native button, input or select in the browser's default look next to styled ones |
| V2 | An off-theme surface — a colour, shadow or radius that does not fit the theme facts or the rest of the page |
| V3 | Alignment and spacing — edges that do not line up, uneven gaps between like items, cramped or loose groups |
| V4 | Text direction — text, icons or controls on the wrong side for the UI direction; mixed directions in one row |
| V5 | Hierarchy — the main thing is not the most prominent, headings and body text are not told apart |
| V6 | Small-width fit where the measured checks found nothing — squeezed, clipped or awkwardly wrapped content |
| V7 | Family mismatch — the page does not look like its sibling pages (a different header, card or button style) |
| V8 | Dead space — a large empty area that is not an empty state, or a layout that leaves half the width unused |

## Rules

1. Report only what is visible in the screenshot.
2. Never guess a cause in code; describe what is seen and what was expected.
3. Skip what the entry's `measured` list already holds.
4. At most 6 findings per state; keep the highest severities.
5. "No findings" is valid and common.
6. Never report a finding you are not at least 70% sure of.

Severity: `high` — a user would notice at once or cannot use it; `medium` — visibly off; `low` — a small inconsistency.
