---
description: Claim this {{slots.nameFormat}} slot for a plan and start its dev servers (Planner-Worker workflow)
allowed-tools: Read, Bash
---

# /take-plan NNN — claim a slot

Triggers: "execute plan NNN", "take plan NNN" (only meaningful inside a {{slots.nameFormat}} slot — see
`.claude/skills/worktree-setup/SKILL.md` for one-time slot provisioning).

1. Run:
   ```bash
   node scripts/take-plan.mjs <NNN>
   ```
2. **Exit 1** → show the printed `TAKE_PLAN: …` line and stop. Do not retry automatically —
   the message already says what's blocking (dirty tree, busy slot, foreign port, plan not
   on `origin/{{git.mainBranch}}`). Ask the Human how to proceed.
3. **Exit 0** — the script printed `OK plan=NNN branch=… fe={{slots.fePorts}}+N be={{slots.bePorts}}+N db=shared|{{slots.dbNameFormat}}`
   followed by `scope-check.mjs --drift`'s own line:
   - **`REALITY: clean`** → read the plan (`plans/NNN-*.plan.md`) and start executing its
     milestones. No reality-check report needed.
   - **`REALITY: drift`** → run the plan's own "Step 0 — Reality Check" against exactly the
     commits listed (nothing more), then **STOP for a go** before touching any milestone.

Read anything in the repo; only write inside the plan's `## Read-Write Scope` (enforced by
`scripts/scope-guard.sh` and, at `/ship` time, `scripts/ship-prep.mjs`). Escalate to the
Human for anything outside scope — see `AGENTS.md`'s Planner-Worker bullet.
