---
name: techdebt
description: Tech-debt audit for {{project.name}} — dead code, duplicated logic, style-rule violations (banned state types, untyped escape hatches, lint rules), oversized components, leftover TODO/FIXME and security leftovers — written as a dated report with a 7-report trend. Use before a PR, after a large feature, at session end, from `/refactor`, by the nightly maintenance job, or when the user says "audit", "tech debt", "cleanup", "dead code" or "check todos".
allowed-tools: Bash(node scripts/techdebt-report.mjs *) Bash(npm run {{commands.lint}} *)
---

# techdebt

Produces `.claude/techdebt-reports/techdebt-<today>.md`. The folder keeps the newest 7 so the Trend section can show whether debt is shrinking; the script owns that bookkeeping so you never compute dates or decide what to delete.

## 1. Prepare (script)

```bash
node scripts/techdebt-report.mjs prepare --scope full-project    # session end, nightly, "audit tech debt"
node scripts/techdebt-report.mjs prepare --scope working-tree    # before a PR: only staged files
```

It prints `REPORT_PATH`, the scope (and the staged file list in working-tree mode), what it pruned, and a `TREND` table of the previous reports' Summary counts. If the scope lists no source files, write a two-line "clean, nothing in scope" report and stop.

## 2. Analyze the scope

Run the tools that exist before reading code by hand — they are faster and don't miss files:

- `npm run {{commands.lint}}` — style rules (semicolons, quotes, `any`)
- the project's dead-code tool, if the stack pack provides one <!-- PACK:stack -->
- grep for the state patterns the project bans ({{stack.stateRules}}) — lint does not catch them
- `grep -rnE "TODO|FIXME" <scope>` — classify each as critical / nice-to-have
- components or services over 300 lines (`wc -l`) — split candidates
- anything that looks like a temporary auth bypass or a hardcoded key — these are **blocking** and go to the top of the report

Then read for what tools can't see: copied logic blocks that belong in the project's shared utilities, imperative state that should be derived state.

Fix only what is mechanical and safe in this scope (unused imports, commented-out code, stray `console.log`). Anything that changes behaviour is a finding, not a fix — it becomes a `[ ]` in the report for a plan to pick up.

## 3. Write the report

Write `REPORT_PATH` with exactly this structure; the script parses the `## Summary` lines next time to build the trend, so keep the labels verbatim:

```markdown
# Tech Debt Audit — YYYY-MM-DD

## Summary
- Unused imports removed: N
- TODOs logged: N (critical: C / nice-to-have: N)
- Components flagged for refactor: N
- Style violations: N
- Security flags: N

## Scope
full-project | working-tree (file list)

## Detailed Findings
### Security Flags
### Dead Code
### Style Violations
### Refactor Candidates
### TODO / FIXME Inventory

## Trend (last 7 audits)
<the TREND table from the script, with ↑ worse / ↓ better / → stable next to today's numbers>
```

## 4. Hand-off

- Open findings that need a plan → append `[ ]` items under a `### Tech Debt` heading in `.claude/todo.md` (Planner only; a Worker lists them in the report and in its PR description instead).
- Breadcrumbs stale after deletions → run `breadcrumbs`.
- Finish with one line: `Tech debt audit written to <REPORT_PATH> — N blocking, N findings, N fixed.`
