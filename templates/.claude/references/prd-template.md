# Plan XXX — [Feature Name]

Status: draft | active | done
Snapshot: [origin/{{git.mainBranch}} SHA the plan was verified against — leave filled in if the Architect already set it; save-plan only fills this when empty, never overwrites]

## Problem Statement
[What problem does this solve for the user?]

## Goals & Success Criteria
- Primary: [measurable outcome]
- Success: [how we know it's done — tag each item `[auto]` or `[human]`]

## Execution Mode
- Parallel: yes | no — will this run alongside other active plans?
- Concurrent plans: [list, if parallel: yes]
- Isolated DB: no | yes — yes only when this plan migrates or reshapes data

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`docs/session-state-<branch>.md`, `.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`{{paths.hotspots}}` — add to them, never rewrite or remove an existing entry without escalating).

```scope
[one glob per line, prefer folder globs]
```

## Read Scope

Entire repo. Analysis and architectural suggestions are expected.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact

One line per invariant in `docs/brain/invariants.md` whose `Touches` globs this plan's scope
reaches (`node scripts/scope-check.mjs --arch --plan=<this file>` lists what's missing). Pick
one form per line; a deviation or change needs the Human's explicit `approve arch change INV-n`
in chat first — never write `Arch-approved:` without it.

- INV-n: preserves — [how the rule still holds]
- INV-n: deviation until [plan/phase] — users lose: [plain words] — Arch-approved: Human YYYY-MM-DD
- INV-n: changes — ADR docs/brain/decisions/NNNN-[slug].md — Arch-approved: Human YYYY-MM-DD
- INV-none: preserves — [why no invariant is touched]

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits
by symbol (do not re-run the whole reality check from scratch), then STOP for a go before
touching any milestone.

## User Stories
- As a [user], I want [goal] so that [benefit]

## Functional Requirements

### Must Have (P0)
- [ ] [Specific, testable requirement]

### Should Have (P1)
- [ ] [Requirement]

### Nice to Have (P2)
- [ ] [Requirement]

## UI/UX Notes
- [Layout expectations, {{project.uiLocale}} text considerations]
- [Which keys are needed in `{{project.i18nFile}}`]

## Atomic Sub-tasks
- [ ] A1: [First atomic task]
- [ ] A2: [Second atomic task]

## Technical Considerations
- Dependencies: [existing services/components affected]
- New files needed: [list]
- Model changes: [any interface/type updates]

## Out of Scope
[Explicitly list what is NOT included]

## Critical Questions
[Q&A format per the `brief-detection` skill — multiple choice, never open-ended]
