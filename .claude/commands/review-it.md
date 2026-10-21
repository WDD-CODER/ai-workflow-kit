---
description: Review the latest Contractor milestone against its Plan Contract. Report only — never silently fix.
---

# /review-it — Reviewer Protocol (ai-workflow-kit)

You are the Reviewer. Follow CLAUDE.md. Report findings; never silently fix; never commit.

## Steps

1. **Session handoff** — List `/sessions/` and read the newest file (by filename date / mtime). That is Cursor's execution summary. If `/sessions/` is empty, STOP and tell the Human: no handoff found.

2. **Plan** — From the session file, identify the plan path under `plans/` (`NNN-slug.plan.md`). Read it. Identify the milestone under review. Do not review other milestones.

3. **Checks** (scoped to milestone files only):
   - **Plan-match**: Did Cursor implement only what the milestone declared?
   - **Convention compliance**: the hard rules in AGENTS.md and the standards in `(not set)`, no API keys in client code
   - **Secrets**: No hardcoded API keys, tokens, passwords
   - **Dead code**: No unused imports / stubbed leftovers from the milestone
   - **Commands (one `kit-runner` call):** hand the `kit-runner` agent (`.claude/agents/kit-runner.md`) the commands of
     the three checks below — the architecture check and the log query (when set), both marked `[capture]` because they
     exit 0 while printing what the review needs, and the milestone's Verify command — and use its `RUN` / `OUTPUT` /
     `FAILED` blocks as their evidence. The judgment on the output stays here. `ESCALATE`, or no `OUTPUT` block for a
     `[capture]` command → run that command inline. In Cursor (no sub-agents) run the three commands inline.
   - **Architecture**: Run `node scripts/scope-check.mjs --arch --diff=origin/main` and copy every `ARCH: warn …` line into Findings (an invariant from `docs/brain/invariants.md` touched with no `## Architecture Impact` entry, or a "Human decision" note naming no INV-n / ADR). Any warn → ESCALATE TO ARCHITECT (the Planner, in the main folder).
   - **Verify command**: Run the milestone's declared Verify command (usually `npm run lint` and/or targeted build). Record exit code.

4. **Security-sensitive?** If the milestone touches auth, guards, interceptors, or `middleware`:
   - Rely on pre-commit security grep + CI security workflow; judgment-only review remains in this command

5. **Verdict** — Output:

```
## Review — [plan] / Milestone [N]

| Check | Result | Notes |
|---|---|---|
| Plan-match | PASS/FAIL | file:line |
| Conventions | PASS/FAIL | ... |
| Secrets | PASS/FAIL | ... |
| Dead code | PASS/FAIL | ... |
| Architecture | PASS/WARN | ARCH lines |
| Verify cmd | PASS/FAIL | exit code |

### Decision
APPROVE | RETURN TO CURSOR | ESCALATE TO ARCHITECT

### Findings
- ...
```

6. STOP. Do **not** mark the milestone `[x]` in this review pass (review ≠ validation of the delivered job). Do not commit. After validation per `docs/agent/job-validation.md` (`/ship` Approve **Y**, explicit mark-done, or Tier 1 evidence for `[auto]` items), the shipping agent marks matching todos — see `AGENTS.md`.
