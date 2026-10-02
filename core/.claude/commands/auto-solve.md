---
description: Autonomous plan executor — finds next incomplete plan, validates, executes, surfaces for approval
allowed-tools: Read, Write, Edit, Bash, Agent, Skill
---

# Command: auto-solve

Autonomous workflow that processes plans from `todo.md` one by one.

**Assumes:** Session started with `--worktree --dangerously-approve`

---

## Phase 0 — Find Next Plan

Do not Read .claude/todo.md in full.

1. Run `node scripts/todo-query.mjs next` — prints the first plan section with unchecked `[ ]` items, its plan file path (e.g., `plans/219-recipe-header-photo-picker.plan.md`), and each open item with its line number
2. If it reports no open plan sections → report "All plans complete" and stop

---

## Phase 1 — Understand & Present

1. Read the plan file completely
2. **Present to user in plain language:**

```
## Next Plan: [Plan Name]

**What this does:** [1-2 sentence plain English summary]

**Tasks:**
1. [Plain language description of checkbox 1]
2. [Plain language description of checkbox 2]
...

**Complexity assessment:** [Simple / Medium / Complex]
**Estimated scope:** [N files, N components]

Continuing in 5 seconds... (Ctrl+C to stop)
```

3. Run `sleep 5` (allows user to abort if something looks wrong):
```bash
sleep 5
```

4. Assess complexity. If the plan has more than 8 tasks, touches >3 subsystems, or requires architectural decisions → stop and report:
```
   COMPLEXITY GATE — This plan requires human planning first.
   Reason: [specific reason]
```

---

## Phase 1.5 — Git History Check (before any modification)

Before touching any file mentioned in the plan:

1. **Check recent commits on target files:**
```bash
git log --oneline -5 -- <file>
```

2. **If plan involves restoration or revert:**
```bash
git diff <base>..HEAD -- <file>
```
Review what would be lost. Surface to user if significant changes detected.

3. **Rule:** Never add methods, restore code, or make structural changes without first verifying current state via git history. This prevents wasted tool calls on already-done work.

---

## Phase 2 — Pre-Validate Checkboxes

For each checkbox in the plan:

**Step 1 — UI-DETECTION GATE:** Before pre-validating any checkboxes, scan the plan's target files. If any target file matches `**/*.component.html`, `**/*.component.ts`, `**/*.component.{{stack.stylesheetExt}}`, `**/*.page.html`, `**/*.page.ts`, `**/*.page.{{stack.stylesheetExt}}`, or `{{paths.hotspots}}` — the plan is **UI-TOUCHING**. For UI-TOUCHING plans, Phase 2 MUST invoke {{tools.browser}}` against the affected route(s) at least once, capture a snapshot, and include the snapshot summary in the pre-validation output. Grep-only verification is forbidden for UI-TOUCHING plans.

**Step 1a — Route identification:** To identify the affected route, read the page component's usage in `{{paths.hotspots}}`. If the route cannot be identified, ask the user which route to probe before proceeding. Do not guess.

**Step 1b — Browser budget cap:** Phase 2 browser invocation is capped at 5 {{tools.browser}}` actions per plan (goto + snapshot + up to 3 additional inspection actions). If more than 5 are needed to verify the plan's assumptions, stop and surface the gap instead of continuing.

**Step 2 — Code inspection:** Read the target file, check if the described change already exists.

Mark each checkbox as:
- `DONE` — already implemented in code
- `TODO` — needs to be done
- `BLOCKED` — dependency missing or unexpected state

**MANDATORY OUTPUT FORMAT** — Pre-validation results MUST be rendered as a literal markdown table:

```
| # | Task | Status | Evidence |
|---|------|--------|----------|
| 1 | [task text] | DONE | file.ts:45 — method exists |
| 2 | [task text] | TODO | not found in target file |
| 3 | [task text] | BLOCKED | missing dependency: X |
```

`Status` must be one of `DONE` / `TODO` / `BLOCKED`. `Evidence` must be a one-line reference (file:line, browser snapshot reference, or skip reason). Inline prose summaries do NOT satisfy this requirement. A `DONE` with no Evidence entry is invalid and must be downgraded to `TODO`. If the table is not produced, Phase 2 did not run.

**If ALL tasks are DONE (zero TODO or BLOCKED items):**
→ Mark all checkboxes `[x]` in `todo.md`
→ **Surface Phase 5** with all tasks shown as DONE in the report — explicit user "approve" is still required before archiving. Phase 3 is skipped (no code to execute). Phase 4 is skipped (no files modified). The Phase 5 report must include: `Phase 4 skipped — plan pre-validated-done, no changes made.`
→ Do NOT archive until the user types "approve" or "approve and stop" in this session.

---

## Phase 3 — Execute

Use parallelism heuristics (persona orchestration retired) to determine parallelism:
- Tasks targeting **different files** → run in parallel via Agent tool
- Tasks with **dependencies or same file** → run sequentially

Execute all `TODO` tasks.

For `BLOCKED` tasks:
- If solvable without major deviation → solve and continue
- If complex/risky → mark as "needs human" and skip

After each task: update checkbox in `.claude/todo.md` to `[x]`.

---

## Phase 4 — Self-Validate

**BUILD SCOPE RULE** — `npm run {{commands.build}}` must run against the current plan's changes. A build result from a previous plan in the same session is NOT valid Phase 4 evidence, even if no files overlap. Each plan starts Phase 4 with a fresh build.

**Skip exemption** — Phase 4 may be skipped ONLY if Phase 2 confirmed all tasks as DONE (pre-validated-done) AND no files were modified in Phase 3. In that case, replace Phase 4 with a single line in the Phase 5 report: `Phase 4 skipped — plan pre-validated-done, no changes made.` This exemption does NOT apply if any task was executed in Phase 3.

**Logging requirement** — Silent skipping is forbidden. If Phase 4 is skipped, the reason must appear explicitly in the Phase 5 report. A Phase 5 report with no Phase 4 entry is invalid.

Run validation checklist:
```bash
npm run {{commands.build}} 2>&1 | tee /tmp/build-output.txt
if grep -q "ERROR" /tmp/build-output.txt; then
  echo "BUILD FAILED — errors detected:"
  grep "ERROR" /tmp/build-output.txt
  exit 1
fi
```

```bash
npm run {{commands.lint}} 2>/dev/null || echo "No lint configured"
```

If plan touched UI/layout:
- Read `.worktree-port` (fallback {{slots.fePorts}})
- Run `/qa http://localhost:<port>/<affected-page>`
- Capture screenshot via `$B screenshot /tmp/qa-shot.png` ({{tools.browser}}); if it is unavailable, skip visual QA and note it in the report

---

## Phase 5 — Surface for Approval

1. **Sound signal:**
```bash
powershell -Command "[console]::beep(800,300); Start-Sleep -Milliseconds 100; [console]::beep(1000,300)"
```

2. **Present validation report:**

```
===================================================
PLAN COMPLETE — AWAITING APPROVAL
===================================================

## Plan: [Name]

## Summary
[One sentence: what was accomplished]

## Tasks Completed
| # | Task | Status | What was done |
|---|------|--------|---------------|
| 1 | [checkbox text] | DONE | [short description] |
| 2 | [checkbox text] | DONE | [short description] |
| 3 | [checkbox text] | SKIPPED | [reason] |

## Validation
npm run {{commands.build}} — passed / failed
npm run {{commands.lint}} — passed / N/A
Visual QA — passed / skipped / screenshot captured

## Files Modified
- path/to/file1.ts
- path/to/file2.{{stack.stylesheetExt}}

===================================================
Commands:
  "approve"          — commit changes and continue to next plan
  "approve and stop" — commit changes and end session
  "show diff"        — display git diff
  "abort"            — discard all changes (git checkout .)
===================================================
```

---

## Phase 6 — Handle User Response

### ARCHIVAL PRECONDITION (enforced before ANY archive action)

Before any edit to `todo.md` that removes a section, or any run of `node scripts/todo-archive.mjs`, ALL three rules below must be satisfied:

1. **Approval required** — the user must have typed the literal string `"approve"` or `"approve and stop"` in the current session. Inference from file state, commit history, pre-validation results, or any other source does NOT satisfy this precondition. If the precondition is not met, stop and ask.
2. **Pre-validated-done plans still need approval** — if Phase 2 pre-validation determined a plan is already fully done, Phase 5 must still be surfaced with all tasks marked DONE, and the user must still type "approve" before archiving. Pre-validated-done plans do not skip the approval gate.
3. **Operational tasks require session evidence** — tasks that are migrations, deployments, reviews, or PR merges can NEVER be marked `[x]` based on filesystem inference or code presence. They require either (a) direct evidence from a command run in this session (e.g. `gh pr list` confirming a merge), or (b) explicit user confirmation ("yes, the migration ran") in this session. If neither exists, the task stays `[ ]` and is surfaced as BLOCKED in Phase 2.

---

### Plan-to-plan dirty-state gate
After marking a plan complete, run `git status --short`. If output is non-empty:
- Abort the auto-solve loop
- Output: "Previous plan left dirty state — manual review required."
- Do NOT proceed to next plan.

---

- **"approve":**
  1. Before committing, verify plan file number is still unique (re-check `plans/` directory)
  2. If collision detected (another worktree created same-numbered plan), rename current plan to next available number and update `todo.md` reference
  3. Commit with conventional message (read `.claude/agents/git-agent.md`)
  4. **Archive the completed plan** (run immediately after commit, or after pre-validate-all-DONE approval):
     - Run `node scripts/todo-archive.mjs` — moves fully-`[x]` `### Plan` sections from `.claude/todo.md` into `.claude/todo-archive/NNN.md` volumes (max 300 lines; rolls automatically)
     - Do **not** hand-append to a monolithic `todo-archive.md`
  5. Loop back to Phase 0 for next plan
- **"approve and stop"** → Commit (Human via `git-agent` prep), archive the plan (same step 4 above), then `/ship`
- **"show diff"** → Run `git diff`, then wait for next command
- **"abort"** → Run `git checkout .` to discard, end session

---

## Error Handling

- **Build fails:** Stop, show full error output, wait for user input — do not auto-fix
- **{{tools.browser}} unavailable:** Skip visual QA and note it in the report (no raw browser-automation MCP fallback)
- **Unexpected file state:** Stop that task, mark as "needs human", continue with others
- **All tasks blocked:** Surface immediately, don't wait for validation phase

---

## Permissions Required

These are already in `.claude/settings.json`:
- `Bash(*)` — for build, git, sound
- `Write/Edit` for worktree paths
- `Skill` — for invoking {{tools.browser}}` ({{tools.browser}}; primary visual QA)
