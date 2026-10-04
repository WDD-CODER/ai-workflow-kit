---
description: Claim this {{slots.nameFormat}} slot for a plan and start its dev servers (Planner-Worker workflow)
allowed-tools: Read, Bash
---

# /take-plan NNN — claim a slot

Triggers: "execute plan NNN", "take plan NNN" (only meaningful inside a {{slots.nameFormat}} slot — see
`.claude/skills/worktree-setup/SKILL.md` for one-time slot provisioning).

0. **Check where you are first.** Run `node scripts/lib/slot.mjs --describe`. If it prints
   `PLANNER: main folder`, do not `cd` into a slot and carry on: this session's hooks and
   guards belong to the folder it was opened in. Run `node scripts/lib/slot.mjs --list`, tell
   the Human which slot is free, and ask them to open a new session in that slot's folder.
   Stop here.
1. Run:
   ```bash
   node scripts/take-plan.mjs <NNN>
   ```
   It validates everything that can refuse (plan on `origin/{{git.mainBranch}}`, a readable
   Read-Write Scope, clean tree, free slot, usable ports) before it claims, so a refusal leaves the slot
   untouched. A merged branch from the slot's previous plan is released automatically.
   The slot's own dev servers keep running across plans (restarted only after an npm
   install); unrecorded leftovers on its ports are stopped. It runs the optional prepare
   step and waits until both servers listen.
2. **Exit 1** → show the printed `TAKE_PLAN: …` lines and stop. Do not retry automatically.
   Ask the Human how to proceed. Common cases:
   - plan has no readable scope (neither a ```` ```scope ```` block nor a `**Scope:**` list of
     backticked globs) → the Planner fixes the plan on `{{git.mainBranch}}`; nothing was claimed.
   - a port is held by a program that is not a dev server → the Human frees it.
   - prepare step or a server failed after the claim → the log tail is printed; fix the cause,
     then re-run the same command: it resumes the claim instead of refusing "busy".
   - leftover servers to clear by hand → `node scripts/slot-stop.mjs` (never `taskkill /PID`
     from Git Bash: it rewrites `/PID`).
3. **Exit 0** — the script printed `OK plan=NNN branch=… fe={{slots.fePorts}}+N be={{slots.bePorts}}+N db=shared|{{slots.dbNameFormat}}`
   followed by `scope-check.mjs --drift`'s own line:
   - **`REALITY: clean`** → read the plan (`plans/NNN-*.plan.md`) and start executing its
     milestones. No reality-check report needed.
   - **`REALITY: drift`** → run the plan's own "Step 0 — Reality Check" against exactly the
     commits listed (nothing more), then **STOP for a go** before touching any milestone.

Read anything in the repo; only write inside the plan's `## Read-Write Scope` (enforced by
`scripts/scope-guard.sh` and, at `/ship` time, `scripts/ship-prep.mjs`). Escalate to the
Human for anything outside scope — see `AGENTS.md`'s Planner-Worker bullet.

Done means: mark `[x]` in the plan file's own Atomic Sub-tasks. Never edit `.claude/todo.md`;
the Planner's `todo-query.mjs sync --merged` copies your marks there after the merge.
