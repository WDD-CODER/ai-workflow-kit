---
description: Review a Worker's branch against its plan with the checker pipeline — three finders, a verifier that drops only refuted findings, and the plan's checks. Report only — never silently fix.
---

# /review-it — Reviewer Protocol ({{project.name}})

You are the Reviewer. Follow CLAUDE.md. Report findings; never silently fix; never commit. The pipeline and the
result schema are in `docs/agent/agent-roles.md`.

## Steps

1. **Target** — The branch under review (`<branch>` below) is the one the Human names (`/review-it feat/NNN-<slug>`),
   else the current branch. `git fetch origin`, then `<ref>` is `origin/<branch>` when that exists, else the local
   `<branch>`; neither exists → tell the Human the branch is not found and STOP. Its plan is `plans/NNN-*.plan.md`
   from the branch name (`feat/NNN-<slug>`, `fix/NNN-<slug>`); no plan number → ask the Human for the plan path and
   STOP. Read the plan. The diff under review is `git diff origin/{{git.mainBranch}}...<ref>` — never `...HEAD` when
   the Human named a branch other than the current one; when it is empty, STOP and tell the Human there is nothing
   to review.
   **Review folder:** `<branch>` is the current branch → this folder. Otherwise the commands below must see that
   branch, not this folder's: check it out read-only in a temporary folder,
   `git worktree add --detach ../<this folder's name>-review-<NNN> <ref>`, run every command of steps 2–3 there
   (finders get that folder and `<ref>` as the branch), and `git worktree remove ../<this folder's name>-review-<NNN>`
   after the verdict. Never switch this folder's branch for a review.

2. **Commands (one `kit-runner` call):** hand the `kit-runner` agent (`.claude/agents/kit-runner.md`) the commands of
   the checks below — the architecture check and the log query (when set), both marked `[capture]` because they exit 0
   while printing what the review needs, and the plan's own check commands (its `[auto]` Done-when commands; none
   named → `npm run {{commands.lint}}`) — and use its `RUN` / `OUTPUT` / `FAILED` blocks as their evidence. The
   judgment on the output stays here. `ESCALATE`, or no `OUTPUT` block for a `[capture]` command → run that command
   inline. Without sub-agents, run the commands inline.
   - **Architecture**: `node scripts/scope-check.mjs --arch --diff=origin/{{git.mainBranch}}` — copy every
     `ARCH: warn …` line into Findings (an invariant from `docs/brain/invariants.md` touched with no
     `## Architecture Impact` entry, or a "Human decision" note naming no INV-n / ADR). Any warn → ESCALATE TO
     ARCHITECT (the Planner, in the main folder).
<!-- KIT:if commands.logQuery -->
   - **Logs**: Run `{{commands.logQuery}}`. Any entry not explained by the plan fails the review.
<!-- KIT:end -->
   - **Checks**: each plan check command with its exit code. A failure is reported as it is; the finders do not
     look for what these commands catch.

3. **Finders, in parallel** — start `orch-check-plan`, `orch-check-bugs` and `orch-check-rules`
   (`.claude/agents/`) in one message, each with the plan path, the branch `<ref>`, the review folder and the base
   `origin/{{git.mainBranch}}`. They run on the `review` tier (`{{models.review}}`, never Haiku — their agent files
   pin it); never pass a cheaper `model` to these calls.
   When the diff touches auth, guards, interceptors, secrets handling or `{{paths.serverRoot}}middleware`, start
   `orch-security` too, with the changed files on those paths. Without sub-agents, read the diff once per lens
   (plan, bugs, rules) inline and write the candidates in the same shape.

4. **Verifier** — hand every candidate (with its `id`) to `orch-verify`. It drops a candidate only with a concrete
   refutation (`file:line` or a command result) and gives each kept one a confidence 0–100.

5. **Filter** — report a finding only when it is kept with confidence ≥ 80, cites a line the diff changed, and is not
   on the do-not-report list (pre-existing issues, unchanged lines, what lint / typecheck / build catch, pedantic
   nits, changes the plan names as intended). The pass/fail comes from that list — no kept `blocker` or `major` —
   never from an agent's own `pass` flag. Check that each agent result names its `model` and `effort`; a result
   without them is treated as missing and that lens is run again inline.

6. **Verdict** — Output:

```
## Review — [plan] / [branch]

| Check | Result | Notes |
|---|---|---|
| Plan-match | PASS/FAIL | kept findings of orch-check-plan |
| Bugs | PASS/FAIL | kept findings of orch-check-bugs |
| Rules | PASS/FAIL | kept findings of orch-check-rules (secrets, dead code, conventions) |
| Security | PASS/FAIL/SKIPPED | orch-security, sensitive paths only |
| Architecture | PASS/WARN | ARCH lines |
<!-- KIT:if commands.logQuery -->
| Logs | PASS/FAIL | {{commands.logQuery}} |
<!-- KIT:end -->
| Checks | PASS/FAIL | command → exit code |

### Decision
APPROVE | RETURN TO WORKER | ESCALATE TO ARCHITECT

### Findings (kept, confidence ≥ 80)
| # | file:line | Severity | Lens | Finding | Verifier | Confidence |
|---|---|---|---|---|---|---|
| 1 | src/a.ts:12 | major | bugs | ... | keep — reproduced with ... | 90 |

### Dropped
| id | Verdict | Why |
|---|---|---|
| plan-2 | refuted | src/a.ts:14 already handles it |

### Agents
role → model / effort, as each result names them
```

7. STOP. Do **not** tick the plan's tasks in this review pass (review ≠ validation of the delivered job). Do not
   commit. After validation per `docs/agent/job-validation.md` (`/ship` Approve **Y**, explicit mark-done, or Tier 1
   evidence for `[auto]` items), the shipping agent marks matching todos — see `AGENTS.md`.
