# Gotchas

Index into the domain-split gotcha files under `docs/brain/gotchas/`. Each entry: what hurt / why the obvious fix is wrong / what to do instead. Append new entries at the bottom of the matching domain file below; never delete a still-true entry. If a domain file exceeds ~150 lines / ~10 entries, propose splitting it further into a narrower domain file as a brain proposal at the next Merge Gate.

## Domain files

| File | Scope |
| --- | --- |
| [agent-workflow](./gotchas/agent-workflow.md) | Session/context management, plan persistence and numbering, `.claude/todo.md` archiving, brain-capture gating |
| [git-workflow](./gotchas/git-workflow.md) | Worktrees, `gh` auth/PR mechanics, repo-tracked files that interact with commit/push/merge |
| [ci](./gotchas/ci.md) | `.github/workflows/*`, the build pipeline, dependency audit |
| [backend](./gotchas/backend.md) | Server routes, data access, logging transport |
<!-- KIT:gotcha-rows -->

## Where to append a new entry

When `/ship` or the Post-push Merge Gate proposes a new gotcha, write it (verbatim, per `docs/agent/brain-capture.md`) to the domain file whose scope matches the trap. Touches `.claude/`, `plans/`, `.claude/todo.md`, session state or agent tooling → `agent-workflow`; git/worktree/`gh` mechanics → `git-workflow`; CI or the build pipeline → `ci`. Doesn't fit → add a new `docs/brain/gotchas/<domain>.md` file, then add a row to the table above in the same change.

## Gotcha shape (for drafting)

```
## <short title naming the trap>

**What hurt:** <symptom, concretely — file/line where relevant>

**Why the obvious fix is wrong:** <why the tempting fix doesn't actually solve it>

**What to do instead:** <the rule a future agent should follow>
```

See also `docs/brain/how-it-works.md` for the visual tour and `docs/brain/index.md` for the full second-brain reading order.
