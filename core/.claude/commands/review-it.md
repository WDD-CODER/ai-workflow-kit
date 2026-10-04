---
description: Review the latest Contractor milestone against its Plan Contract. Report only — never silently fix.
---

# /review-it — Reviewer Protocol ({{project.name}})

You are the Reviewer. Follow CLAUDE.md. Report findings; never silently fix; never commit.

## Steps

1. **Session handoff** — List `/sessions/` and read the newest file (by filename date / mtime). That is Cursor's execution summary. If `/sessions/` is empty, STOP and tell the Human: no handoff found.

2. **Plan** — From the session file, identify the plan path under `plans/` (`NNN-slug.plan.md`). Read it. Identify the milestone under review. Do not review other milestones.

3. **Checks** (scoped to milestone files only):
   - **Plan-match**: Did Cursor implement only what the milestone declared?
   - **Convention compliance**: the hard rules in AGENTS.md and the standards in `{{stack.standardsDoc}}`, no API keys in client code
   - **Secrets**: No hardcoded API keys, tokens, passwords
   - **Dead code**: No unused imports / stubbed leftovers from the milestone
   - **Verify command**: Run the milestone's declared Verify command (usually `npm run {{commands.lint}}` and/or targeted build). Record exit code.

4. **Security-sensitive?** If the milestone touches auth, guards, interceptors, or `{{paths.serverRoot}}middleware`:
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
| Verify cmd | PASS/FAIL | exit code |

### Decision
APPROVE | RETURN TO CURSOR | ESCALATE TO ARCHITECT

### Findings
- ...
```

6. STOP. Do **not** mark the milestone `[x]` in this review pass (review ≠ validation of the delivered job). Do not commit. After validation per `docs/agent/job-validation.md` (`/ship` Approve **Y**, explicit mark-done, or Tier 1 evidence for `[auto]` items), the shipping agent marks matching todos — see `AGENTS.md`.
