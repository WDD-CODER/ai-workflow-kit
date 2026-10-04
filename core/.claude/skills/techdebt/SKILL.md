---
name: techdebt
description: Scans for duplicated code, dead code, style violations, and TODO debt — run before PRs, after features, or at session end. Maintains a rolling archive of the last 7 audit reports.
---

# Skill: techdebt

**Trigger:** End of development session, before a PR, after large features, or user says "audit tech debt" / "cleanup" / "check todos".

**Style Violation Rules (inline — no guide read required):**
- Flag: any state type the project's state rules ban ({{stack.stateRules}}) → replace per those rules
- Flag: untyped escape hatches (`any` or the language's equivalent) → replace with explicit types
- Flag: components or modules exceeding 300 lines → refactor candidate
- Flag: temporary auth bypasses or hardcoded keys → security risk, must fix before PR
- Reusable logic → move to the project's shared utilities

<!-- PACK:stack — framework-specific style flags (decorators, banned state types, lint-only rules) come from the stack pack -->


---

## Report Archive — Rolling 7-Report Retention

**Folder:** `.claude/techdebt-reports/`

**Filename convention:** `techdebt-YYYY-MM-DD.md` (one report per calendar day; re-running on the same day overwrites that day's report).

**Retention logic — execute at the START of every audit, before writing the new report:**

1. List all files in `.claude/techdebt-reports/` matching `techdebt-*.md`.
2. Sort by date extracted from filename (oldest first).
3. Count existing reports:
   - **Count < 7:** No deletion needed — proceed to write the new report.
   - **Count ≥ 7:** Delete the oldest file(s) until only 6 remain, making room for the new report (result: 7 after write).
4. Write (or overwrite) today's report: `techdebt-YYYY-MM-DD.md`.

> **Edge case:** If the audit runs multiple times on the same day, the existing report for that date is overwritten in-place — it does NOT count as a new addition, so no old reports are deleted.

---

## Scope Modes

- **Working-tree mode** (invoked from `commit-to-github` [S-full] Phase 0): scope = only files staged for commit
- **Full-project mode** (invoked at session end): scope = all of `{{paths.srcRoot}}`
- **Fast-path skip:** If no source files are in scope → skip entirely and report clean

---

## Phase 0 — docs/brain Orient (CONDITIONAL)

If the task involves an unfamiliar area, an architectural choice, or known-recurring debt: read `docs/brain/index.md`, then only the relevant sub-file (`gotchas.md`, `decisions/`, `patterns/`, etc.). Default: skip for routine cleanup or pattern application. Do not call optional MCP memory tools.

---

## Phase 1: Static Analysis `[Procedural — Haiku/Composer (Fast/Flash)]`

**Duplicate Detection:** Scan for redundant utility functions or UI patterns that should move to the project's shared utilities.

**Dead Code:** Identify unused imports, variables, and commented-out code blocks.

**TODO Audit:** Scan for `// TODO` or `// FIXME` comments — categorize by urgency (critical / nice-to-have).

**Style Violations:** Flag all violations listed in the rules above.

---

## Phase 2: Logic & Complexity Pruning

> **Only invoke if** style violations, refactor candidates, or security flags were found in Phase 1.

**Refactor Candidates:** Identify components or services exceeding 300 lines — propose split strategy.

**Signal Optimization:** Identify imperative logic convertible to declarative Signals or `computed()` values.

**Security Surface:** Verify no temporary auth bypasses or hardcoded keys remain — these are blocking, must be resolved before PR.

---

## Phase 3: Report Generation & Archive Management

**3a — Retention cleanup:**
```
1. Ensure `.claude/techdebt-reports/` exists (create if missing).
2. Glob `.claude/techdebt-reports/techdebt-*.md`.
3. Parse dates from filenames, sort oldest-first.
4. If today's date already has a report → that slot will be overwritten (no deletion needed unless count > 7).
5. If count of *other* dates ≥ 7 → delete oldest until 6 remain.
6. Write today's report.
```

**3b — Report template:** Each report file must follow this structure:

```markdown
# Tech Debt Audit — YYYY-MM-DD

## Summary
- Unused imports removed: X
- TODOs logged: Y (critical: C / nice-to-have: N)
- Components flagged for refactor: Z
- Style violations fixed: W
- Security flags: S

## Scope
<!-- working-tree | full-project -->

## Detailed Findings

### Dead Code
<!-- list removed imports, unused vars, commented blocks -->

### TODO / FIXME Inventory
<!-- table: location | text | urgency -->

### Style Violations
<!-- list: file, line, violation, fix applied or pending -->

### Refactor Candidates
<!-- components/services > 300 lines, proposed split -->

### Security Flags
<!-- any temp auth bypasses, hardcoded keys -->

## Trend (last 7 audits)
<!-- Compare today's totals vs previous reports in the folder.
     Show direction arrows: ↑ worse / ↓ better / → stable -->
```

> The **Trend** section is populated by reading the Summary block from the other reports in the archive folder and comparing counts. This gives a quick at-a-glance view of whether tech debt is growing or shrinking over the rolling window.

---

## Phase 4: Documentation & Sync `[Procedural — Haiku/Composer (Fast/Flash)]`

**Breadcrumb Check:** Run `update-docs` skill to ensure navigation maps reflect the cleaned state.

**Ledger Update:** Mark completed items in `.claude/todo.md` — move unresolved debt to a dedicated "Tech Debt" section.

---

## Completion Gate

Output: `"Tech debt audit complete. [X] unused imports removed, [Y] TODOs logged, [Z] components flagged for refactor. Report saved to .claude/techdebt-reports/techdebt-YYYY-MM-DD.md ([N]/7 reports in archive)."`

If critical logic was changed → invoke CI / npm run {{commands.test}} for verification before committing.

