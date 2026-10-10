---
name: worktree-setup
description: One-time provisioning or repair of the three permanent Planner-Worker slots `../{{project.name}}{{slots.folderSuffix}}..3` — git worktrees detached at origin/{{git.mainBranch}} with deps installed, `.worktree-root`/`.worktree-port` written and `{{paths.serverRoot}}.env` copied. Use only when the user says "setup worktree", "new worktree", "slot is missing" or a `{{slots.nameFormat}}` folder is absent. Taking a plan into an existing slot is `/take-plan`, not this.
disable-model-invocation: true
---

# worktree-setup

Three slots exist so up to three Workers can run in parallel without touching the main folder. A slot is *infrastructure*: created once, reused for every plan, never on a branch while idle. This skill creates or repairs that infrastructure and nothing else — it starts no servers (`scripts/take-plan.mjs` does that when a plan is taken).

## 1. Create missing slots

For each of `{{slots.nameFormat}}`, `{{slots.nameFormat}}`, `{{slots.nameFormat}}` whose folder `../{{project.name}}{{slots.folderSuffix}}` does not exist:

```bash
git worktree add --detach ../{{project.name}}{{slots.folderSuffix}} origin/{{git.mainBranch}}
```

Detached at `origin/{{git.mainBranch}}`, never on `main` and never on a branch — an idle slot on a branch is how a stale branch gets accidental commits.

## 2. Provision every slot (new or existing)

1. `npm install` at the slot root and inside `{{paths.serverRoot}}`.
2. Write `.worktree-root` = absolute path of the main repo, and `.worktree-port` = `{{slots.fePorts}}+N` (the port map in `AGENTS.md`: `{{slots.nameFormat}}`={{slots.fePorts}}+1, `{{slots.nameFormat}}`={{slots.fePorts}}+2, `{{slots.nameFormat}}`={{slots.fePorts}}+3).
3. Copy `{{paths.serverRoot}}.env` from the main repo into the slot (`{{paths.serverRoot}}.env` is the only env file; skip silently if missing — it is a secret and may be absent on purpose).

## 3. Report

One line per slot, then the next step:

```
{{slots.nameFormat}}: created — deps installed, .env copied
{{slots.nameFormat}}: already present — deps installed, .env copied
{{slots.nameFormat}}: created — deps installed, .env copied
3 slots ready. In a free slot, say "execute plan NNN" to start work.
```

<details><summary>Old pattern: the single `wt-parallel` worktree (pre-2026-09)</summary>

If `../{{project.name}}-wt-parallel` still exists: delete its disposable `.claude/dev-server.log`, then `git -C ../{{project.name}}-wt-parallel status --porcelain`. Dirty or unpushed → stop and report; clean → `git worktree move ../{{project.name}}-wt-parallel ../{{project.name}}{{slots.folderSuffix}}` before step 1.

</details>
