---
name: techdebt
description: Tech-debt audit for {{project.name}} — dead code, duplicated logic, style-rule violations (banned state types, untyped escape hatches, lint rules), oversized components or modules, leftover TODO/FIXME and security leftovers — written as a dated report with a 7-report trend. Use before a PR, after a large feature, at session end, from `/refactor`, by the nightly maintenance job, or when the user says "audit", "tech debt", "cleanup", "dead code" or "check todos".
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

- `node scripts/techdebt-report.mjs scan` — counts the debt markers in the project's own `.ts .tsx .js .jsx .html .css .scss`
  files (untyped escape hatches, `@ts-ignore`, `eslint-disable`, `console.log`, TODO/FIXME, files over 300 lines, plus the
  stack pack's rules) and compares them with `{{paths.sharedDocs}}/techdebt-baseline.json`: `NEW_DEBT: yes` means a count went
  up since the baseline. On an old codebase record the baseline once (`scan --write-baseline`, commit it), so the report
  shows the trend instead of the whole legacy. `--list` prints every hit.
- `npm run {{commands.lint}}` — the project's style rules
- the project's dead-code tool, if it has one (unused exports, files and dependencies)
- a grep for the state types the project bans ({{stack.stateRules}}) that lint does not catch

<!-- PACK:techdebt -->

- `grep -rnE "TODO|FIXME" <scope>` — classify each as critical / nice-to-have
- components or modules over 300 lines (`wc -l`) — split candidates
- anything that looks like a temporary auth bypass or a hardcoded key — these are **blocking** and go to the top of the report

Then read for what tools can't see: copied logic blocks that belong in the project's shared utilities, imperative state that the project's state rules would derive instead.

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

## Scan vs baseline
<the scan table and its NEW_DEBT line, verbatim>

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
<!-- KIT:if stack.docsMapSkill -->
- Folder maps stale after deletions → run `{{stack.docsMapSkill}}`.
<!-- KIT:end -->
- Finish with one line: `Tech debt audit written to <REPORT_PATH> — N blocking, N findings, N fixed.`
