---
name: worktree-setup
description: One-time provisioning of the 3 permanent Planner-Worker slots ({{slots.nameFormat}}..3). Not automatic — invoke only when a slot is missing or being (re)initialized.
---

# Skill: worktree-setup
**Model Guidance:** Use Haiku/Flash throughout — this is mechanical.

**Trigger:** User says "setup worktree" or "new worktree" (on-demand only).

> **Not the take-plan flow.** Starting work on a plan is "execute plan NNN" / "take plan
> NNN" (see `.claude/commands/take-plan.md`), which reuses an already-initialized slot.
> This skill only creates the 3 permanent slots the first time, or repairs a missing one.

## What this does

Ensures `../{{project.name}}{{slots.folderSuffix}}`, `../{{project.name}}{{slots.folderSuffix}}` and `../{{project.name}}{{slots.folderSuffix}}` exist as git
worktrees, each detached at `origin/{{git.mainBranch}}`, each with its own `.worktree-root` /
`.worktree-port`, dependencies installed, and `{{paths.serverRoot}}.env` copied. It starts no servers —
`scripts/take-plan.mjs` does that when a plan is actually taken.

---

## Phase 1 — Migrate the legacy parallel worktree (one-time)

If `../{{project.name}}-wt-parallel` exists:

1. Remove the one known disposable artifact before the cleanliness check:
   `../{{project.name}}-wt-parallel/.claude/dev-server.log` (a log file the retired
   `claim-parallel-slot.sh` wrote on every claim — not real work, safe to delete).
2. `git -C ../{{project.name}}-wt-parallel status --porcelain` — if anything remains, **stop and
   report** the dirty/unpushed state to the Human; do not touch the worktree further.
3. If clean: `git worktree move ../{{project.name}}-wt-parallel ../{{project.name}}{{slots.folderSuffix}}`.

If `../{{project.name}}-wt-parallel` does not exist, skip this phase.

---

## Phase 2 — Create missing slots

For each of `{{slots.nameFormat}}`, `{{slots.nameFormat}}`, `{{slots.nameFormat}}` whose directory does not already exist:

```bash
git worktree add --detach ../{{project.name}}-wt-<N> origin/{{git.mainBranch}}
```

Idle slots are always detached at `origin/{{git.mainBranch}}` — never on `main`, never on a branch.

---

## Phase 3 — Provision each slot

For every slot directory (existing after Phase 1, or just created in Phase 2):

1. `npm install` at the slot root and inside `{{paths.serverRoot}}`.
2. Write `.worktree-root` (absolute path back to the main repo) and `.worktree-port` (the
   slot's frontend port — `{{slots.fePorts}}+N` for `{{slots.nameFormat}}`, matching the port map in `AGENTS.md`).
3. Copy `{{paths.serverRoot}}.env` from the main repo into the slot's `{{paths.serverRoot}}.env` — silent skip if
   missing. (This repo only has `{{paths.serverRoot}}.env`; there is no root `.env` to copy.)
4. Start no servers — `take-plan.mjs` starts the backend and `npm run {{commands.dev}} -c slot` when a plan
   is actually taken.

---

## Completion Gate

Output one line per slot:
```
{{slots.nameFormat}}: <created | migrated | already present> — deps installed, .env copied
```

Then: `3 slots ready. In a free slot, say "execute plan NNN" to start work.`
