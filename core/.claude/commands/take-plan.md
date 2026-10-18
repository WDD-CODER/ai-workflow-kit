---
description: Claim this {{slots.nameFormat}} slot for a plan; dev servers start only when a step needs them (Planner-Worker workflow)
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
   It starts **no** dev servers: it stops whatever this slot still runs (orphaned watchers
   included) and prints `TAKE_PLAN: servers: off — start them with node scripts/slot-serve.mjs`.
   The claim is finished once the branch is checked out; an npm install failure after that is
   only a warning.
2. **Exit 1** → show the printed `TAKE_PLAN: …` lines and stop. Do not retry automatically.
   Ask the Human how to proceed. Common cases:
   - plan has no readable scope (neither a ```` ```scope ```` block nor a `**Scope:**` list of
     backticked globs) → the Planner fixes the plan on `{{git.mainBranch}}`; nothing was claimed.
   - a port is held by a program that is not a dev server → the Human frees it.
   - `… fails the architecture gate` plus `ARCH: …` lines → the plan's `## Architecture Impact`
     misses an invariant or an approval; the Planner fixes it on main. Nothing was claimed.
   - leftover servers to clear by hand → `node scripts/slot-stop.mjs` (never `taskkill /PID`
     from Git Bash: it rewrites `/PID`).
3. **Exit 0** — the script printed `OK plan=NNN branch=… fe={{slots.fePorts}}+N be={{slots.bePorts}}+N db=shared|{{slots.dbNameFormat}}`
   followed by `scope-check.mjs --drift`'s own line:
   - **`REALITY: clean`** → read the plan (`plans/NNN-*.plan.md`) and start executing its
     milestones right away. No reality-check report needed.
   - **`REALITY: drift`** → run the plan's own "Step 0 — Reality Check" against exactly the
     commits listed (nothing more). Print one line per commit: `ok` or `conflict: <what>`. All `ok`
     → start executing, no go needed. **STOP for a go** only on a `conflict` (a symbol, line or
     file the plan names was removed, renamed or rewritten).

4. **Open with the plan brief, before any work.** Right after reading the plan, print a
   **PLAN BRIEF** to the Human — 2–3 plain lines, no more: what the plan changes and why it matters.
   Not the plan's title restated, not a milestone list, no jargon. Then start executing. Validation
   cards come later, at close-out (`/done`, `/ship`), per `docs/agent/job-validation.md`.

**Dev servers on demand.** Start them only when a step needs the running app — a browser check,
a validation click-list for the Human, `/remote`, preflight — or when the Human says "start servers":
`node scripts/slot-serve.mjs` (prints `SLOT_SERVE: be=<port> started|kept, fe=<port> started|kept`).
If it fails, only that step is blocked: show the printed log tail, then carry on with the steps that
don't need the app. Stop them with `node scripts/slot-stop.mjs`; the merge, `free-merged-slots.mjs` and
the SessionEnd hook stop them too.

Read anything in the repo; only write inside the plan's `## Read-Write Scope` (enforced by
`scripts/scope-guard.sh` and, at `/ship` time, `scripts/ship-prep.mjs`). Escalate to the
Human for anything outside scope — see `AGENTS.md`'s Planner-Worker bullet.

Done means: mark `[x]` in the plan file's own Atomic Sub-tasks. Never edit `.claude/todo.md`;
the todo-sync Action (`.github/workflows/todo-sync.yml`) copies your marks there after the merge.
