# Git Standards

> Load this file when: committing, pushing, creating PRs, renaming branches, or any git write operation.

---

## Branch & commit rules

* `main` is protected. Never write on `main`. Work only on `feature/`, `fix/`, or `chore/` branches.
* Human commits and pushes by default. Agents prepare diffs and commit messages; they do not commit/push unless the Human explicitly asks and approves after prep. **Exception:** `/ship`'s own Phase 0 lane gates (FAST / ULTRA-TRIVIAL / REGULAR — see `.claude/commands/ship.md`) count as that explicit approval, including ULTRA-TRIVIAL's zero-confirmation auto-proceed for single-file docs/handoff diffs. Same in both tools — see `.claude/agents/git-agent.md`.
* `git-agent` prepares diff + commit message only — never runs commit/push itself unless Human explicitly asks and approves after prep.
* GitHub MCP = read only. Write ops are Human-run unless explicitly overridden.
* **`gh`/git write ops in agent sessions:** Claude Code scopes agentic shells to a limited `GITHUB_TOKEN` (fine-grained PAT, no push/merge permission on this repo) even though the keyring holds a full-scope `repo`+`workflow` OAuth token (`gho_...`, inactive while `GITHUB_TOKEN` is set). Prefix `git push`, `gh pr create`, and `gh pr merge` with `env -u GITHUB_TOKEN` so they run against the keyring credential instead of 403ing/retrying against the scoped one. Confirm with `gh auth status` if unsure which credential is active. See [[github-token-precedence]] memory for history.
* Secrets live in `.env` only. Never stage, commit, or print secrets. Never weaken `.gitignore`.
* Build gate: `npm run {{commands.build}}` must pass before any commit.
* Lint gate: `npm run {{commands.lint}}` must pass before milestone sign-off.
* Prefer Conventional Commits (`type(scope): subject`). Focus the body on why, not what.
* Never force-push to `main`/`master`. Avoid destructive git ops unless Human explicitly requests them.
* **Todo sync on ship approval (before commit):** `/ship` Approve **Y** is commit/push consent and Human validation of any `[human]` items — agents **must** mark matching `.claude/todo.md` / plan Atomic Sub-tasks `[x]` and stage them in the **same** ship commit as the job (see `AGENTS.md` **Job validation**, `docs/agent/job-validation.md`, `/ship` Phase 4 On approval). Do not commit the job first and leave todos for a follow-up push. Chat-only jobs: `/done` or Path B in `job-validation.md`.

---

## Post-push Merge Gate (mandatory)

Applies after **any** successful `git push` of a `feature/` / `fix/` / `chore/` branch (agent-run or Human-asked). Never treat “pushed” or “PR URL returned” as session-complete for mergeable work.

**Brain capture is part of this gate** (auto-evoke — not `/ship`-only). After every successful push / PR create, always include a **Brain capture** block per `docs/agent/brain-capture.md`: run the extraction procedure and usefulness gate; omit only when nothing durable happened (`none durable` — the common case for chores). When proposing: the banner line carries **path + one-line title** only, and each entry's **full draft body** (required shape: Pattern = Problem/Solution/When to use; Gotcha = What hurt/Why the obvious fix is wrong/What to do instead; Decision = Context/Decision/Consequences) is printed in a fenced markdown block **directly below the banner**. A title-only proposal is invalid. Two entries (pattern + paired gotcha) are allowed — one banner line + one fenced draft each. **Auto-writes on the gate reply** (`merge` / `later` / `open-pr-only`) by default — the Human sees the full draft before replying; say `no brain` / `skip brain` alongside the reply to opt out for this ship, or `brain edit …` to revise first.

### Feature-complete / chore cleanup / explicit PR work

End the turn with the combined visual block below and **wait** for Human choice. Do not auto-merge before that reply.

```text
╔══════════════════════════════════════════════════════════╗
║  MERGE GATE — push succeeded                             ║
║  Branch: {branch}                                        ║
║  PR:     {url or "none yet — will create on merge"}      ║
║  BRAIN CAPTURE — proposed | none durable                 ║
║    docs/brain/… — "one-line title" (draft below)         ║
║    writes automatically with your reply below            ║
║    (say "no brain" / "brain edit …" to opt out / revise) ║
║                                                          ║
║  Reply:  merge  |  later  |  open-pr-only                ║
║  (merge = approve merge to main + delete remote branch)  ║
╚══════════════════════════════════════════════════════════╝
```

| Reply | Action |
| --- | --- |
| `merge` | Write any proposed brain draft first (unless opted out), then: if no open PR, `gh pr create`. Then merge — outside a slot `gh pr merge --merge --delete-branch`; inside a `{{slots.nameFormat}}` slot see "Merging from a slot" below. Never force-merge. Never merge without this literal reply — a `Y`, `--yes` or "ship fast y" is not a merge. |
| `later` | Write any proposed brain draft first (unless opted out). Leave branch/PR open. Put the PR URL in session Next Steps. Stop. |
| `open-pr-only` | Write any proposed brain draft first (unless opted out). Ensure a PR exists (`gh pr create` if needed). Do **not** merge. Re-show Merge Gate after PR URL is known, or stop if Human said later. |
| `no brain` / `skip brain` (combined with any of the above) | Do not write the proposed draft this ship. Explicit no-op on the brain side only. |
| `brain edit …` (combined with any of the above) | Revise the draft, re-show it, wait again before writing. |

Dirty-tree merge fallback (same as `/ship`): if `gh pr merge --merge --delete-branch` fails due to a dirty local tree, use `gh pr merge {n} --merge --auto`. Do not stash/commit unrelated dirty files to unblock merge.

**Merging from a slot** (`node scripts/lib/slot.mjs --describe` prints `WORKER:`): never pass `--delete-branch` — after merging it switches the local checkout to `{{git.mainBranch}}`, which takes the Worker out of its slot. Instead:

```bash
gh pr merge {n} --merge
git push origin --delete <branch>
```

Stay on the branch, in the slot. Do not `cd` to the main folder and do not check out `{{git.mainBranch}}`. Next job: the Human runs `/clear`, then `take plan NNN` in the same slot — `take-plan.mjs` fetches, releases the merged branch, claims the new plan and keeps the slot's dev servers running.

### Brain capture — auto-write with opt-out

Write the approved fenced draft **verbatim** to `docs/brain/**` (for a gotcha: append to the matching `gotchas/<domain>.md` per the routing table in `docs/brain/gotchas.md`; new file under `patterns/`; next-numbered file under `decisions/`) as part of handling `merge` / `later` / `open-pr-only`, then commit on the PR branch (or open a tiny follow-up PR/commit if already merged). Skip the write only on an explicit `no brain` / `skip brain` reply. `brain edit …` revises the draft and re-shows it before writing. This is why there is no need for a separate `brain approve` token.

### Checkpoint / milestone push

When the push is an incomplete brief checkpoint (or Human said “no PR” / “checkpoint”), show this variant instead — still mandatory, still visible — and **do not** offer merge. Still include Brain capture when something durable happened:

```text
╔══════════════════════════════════════════════════════════╗
║  CHECKPOINT — DO NOT MERGE YET                           ║
║  Branch: {branch}                                        ║
║  Reason: milestone / brief incomplete / no-PR requested  ║
║  BRAIN CAPTURE — proposed | none durable                 ║
║    docs/brain/… — "one-line title" (draft below)         ║
║                                                          ║
║  Keep working on this branch. Merge only when feature-   ║
║  complete (or Human explicitly asks to merge).           ║
║  Draft above writes automatically — reply "no brain" /   ║
║  "skip brain" now to opt out, or "brain edit …" to revise║
╚══════════════════════════════════════════════════════════╝
```

No merge/later reply exists at a checkpoint to ride on, so the draft writes to `docs/brain/**` as soon as it's shown (still not committed/pushed until the next ship cycle) — reply `no brain` / `skip brain` before that next commit to pull it back out, or `brain edit …` to revise it in place.
