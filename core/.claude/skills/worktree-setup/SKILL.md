---
name: worktree-setup
description: One-time provisioning or repair of the three permanent Planner-Worker slots `../{{project.repoName}}{{slots.folderSuffix}}` (N = 1..{{slots.count}}) — git worktrees detached at origin/{{git.mainBranch}} with deps installed (root, `scripts/`, backend), `.worktree-root`/`.worktree-port` written, runtime files excluded and the backend `.env` copied. Use only when the user says "setup worktree", "new worktree", "slot is missing" or a `{{slots.nameFormat}}` folder is absent. Taking a plan into an existing slot is `/take-plan`, not this.
disable-model-invocation: true
---

# worktree-setup

Three slots exist so up to three Workers can run in parallel without touching the main folder. A slot is *infrastructure*: created once, reused for every plan, never on a branch while idle. This skill creates or repairs that infrastructure and nothing else — it starts no servers (`scripts/take-plan.mjs` does that when a plan is taken).

## 1. Create missing slots

For each slot N = 1..{{slots.count}} (`{{slots.nameFormat}}`) whose folder `../{{project.repoName}}{{slots.folderSuffix}}` does not exist:

```bash
git worktree add --detach ../{{project.repoName}}{{slots.folderSuffix}} origin/{{git.mainBranch}}
```

Detached at `origin/{{git.mainBranch}}`, never on `main` and never on a branch — an idle slot on a branch is how a stale branch gets accidental commits.

## 2. Provision every slot (new or existing)

1. `npm install` at the slot root, `npm install` inside `scripts/` (the workflow scripts' own dependencies, `scripts/package.json`), and `npm install` inside the backend folder `{{paths.serverRoot}}` when the project has one (`paths.serverRoot` set).
2. Write `.worktree-root` = absolute path of the main repo, and `.worktree-port` = `{{slots.fePorts}}+N` (the port map in `AGENTS.md`: slot N = {{slots.fePorts}}+N).
3. `node scripts/local-excludes.mjs` — adds the runtime files (`.worktree-*`, logs, install hashes) to the shared `.git/info/exclude`, so a slot never looks dirty even when the project keeps its own `.gitignore`.
4. With a backend folder only: copy `{{paths.serverRoot}}.env` from the main repo into the slot (`{{paths.serverRoot}}.env` is the only env file; skip silently if missing — it is a secret and may be absent on purpose).

## 3. Report

One line per slot, then the next step:

```
<slot 1>: created — deps installed, .env copied
<slot 2>: already present — deps installed, .env copied
<slot 3>: created — deps installed, .env copied
3 slots ready. In a free slot, say "execute plan NNN" to start work.
```

<details><summary>Old pattern: the single `wt-parallel` worktree (pre-2026-09)</summary>

If `../{{project.repoName}}-wt-parallel` still exists: delete its disposable `.claude/dev-server.log`, then `git -C ../{{project.repoName}}-wt-parallel status --porcelain`. Dirty or unpushed → stop and report; clean → `git worktree move ../{{project.repoName}}-wt-parallel ../{{project.repoName}}{{slots.folderSuffix}}` before step 1.

</details>
