# Plan XXX — [Feature Name]

Status: draft | active | done
Depends-on: none | NNN, MMM — the plans that must be merged before this one starts (`scope-check --deps` flags a plan without this line; `take-plan` refuses while one is not merged; `plan-order` computes the run order from it)
Snapshot: [origin/{{git.mainBranch}} SHA the plan was verified against — leave filled in if the author already set it; save-plan only fills this when empty, never overwrites]

## Problem Statement
[What problem does this solve for the user?]

## Goals & Success Criteria
**Primary:** [measurable outcome]

[The Done-when items: one bullet each, each starting with its tag — `scope-check --tags` checks them]
- [auto] [an exact check: a command and its expected output]
- [ui] [one page, one action, one quoted text or element a script asserts — the builder writes one short e2e test
  that saves a screenshot; a browser agent looks only if the test fails or none can be written]
- [human] [what only a person can judge: look and feel, a product decision]

## Execution Mode
- Parallel: yes | no — will this run alongside other active plans?
- Concurrent plans: [list, if parallel: yes]
- Isolated DB: no | yes — yes only when this plan migrates or reshapes data

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
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
by symbol (do not re-run the whole reality check from scratch) and print one line per commit:
`ok` or `conflict: <what>`. All `ok` → continue. STOP for a go only on a `conflict` (a symbol,
line or file this plan names was removed, renamed or rewritten).

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

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] A1: [plain title: what changes and why] — [details] — [target file(s)]
- [ ] A2: [plain title: what changes and why] — [details] — [target file(s)]

## Technical Considerations
- Dependencies: [existing services/components affected]
- New files needed: [list]
- Model changes: [any interface/type updates]
- Backend / API: [new or changed endpoints, server logic — or "none"]
- Auth and validation: [who may call it, what input is checked — or "none"]
- Security surface: [new inputs, secrets, permissions — or "none"]
- Data / migration: [schema or stored-data changes — or "none"]
- Project checks: [each check in `{{paths.planChecks}}` that applies, when that file exists]

Every Atomic Sub-task names its files and is concrete enough for a Worker to run without asking (no "TBD",
"handle errors appropriately", "same as the other screen"). `/plan`'s Architect + PM review checks this.

## Out of Scope
[Explicitly list what is NOT included]

## Critical Questions
[One line per question the Human answers before work starts: `- Q: … A: …`. Offer choices, never an open
question. An unanswered one is `A: open`. `- none` when there are none.]

## Execution Notes
[Written while the plan runs: decisions, evidence (exact output lines), and review gaps the Human kept as is.]
