# Security review — fleet, guards, ship-pilot

Reviewed 2026-10-14 against Claude Code 2.1.299. This is a self-review by the author's Claude session, not an external audit. It is honest about scope: what each mod can reach, what it refuses, how it fails, and what it never does.

## Threat model

Mods run **in-process with no sandbox**. A mod can read every prompt and tool call, approve tool calls, run host processes, read and write files, reach the network, and spend usage through `$.model`. So the review asks, per mod:

1. What does it execute on the host, and with what arguments?
2. What does it write, and where?
3. What can it approve or deny, and what happens when it fails?
4. What leaves the machine?
5. Who can trigger a destructive action — the person, the model, or another mod?

`claude plugin validate` lists every `$` call a module makes, by function. Those lists are in `validate-*.txt` beside this file and are the ground truth for sections 1–4.

## Independent review (second pass) and what changed

After the self-review, a separate reviewer agent traced attack paths against the finished code. Its findings, and the fix applied to each (all covered by tests):

| Severity | Finding | Fix |
| --- | --- | --- |
| High | The model could widen a plan's scope by editing the ```` ```scope ```` block or rewriting `.worktree-plan`; the guard re-read the file. | Scope globs are **pinned** at first sight of the plan and grow only through `/approve`/the button. An Edit/Write to the plan is simulated in memory and **denied if the parsed scope would differ**. `.worktree-plan/-port/-root` are not editable. A file that changed behind the guard is ignored with a toast. |
| High | `src/../../other/.env` passed `src/**` because `..` was never resolved. | Paths are normalised; a relative path that climbs above the root is denied; an absolute path outside the worktree is left to that folder's own session (as the shell guard does), but can no longer masquerade as in-scope. |
| Medium | `--no-verify` regex missed backslash-newlines, `--no-verif`, `core.hooksPath`, and GitHub API writes to main. | Commands are flattened and checked per pipeline segment for `git` + `push` + a bypass marker; `mcp__github__push_files` / `create_or_update_file` / `delete_file` with `branch: main` are denied. Fail-closed. |
| Medium | The *Handoff & restart* button called the command through `$.command.run`, which the human-only check refuses. | The button runs the handoff routine directly (a press is the person's act); the slash command keeps its origin check. |
| Medium | `$.store` is per-plugin, so the cross-mod notify inbox could never deliver. | Removed. ship-pilot has its own `pushUrl` option. |
| Medium | A future-dated registry row would be "live" forever and lock a slot. | Rows dated in the future (> 60 s) or a day old are pruned; `/fleet forget <id>` drops one by hand. |
| Medium | The handoff was re-submitted as the person's own words and injected as plain text next session. | The resume is framed as the plugin's message (no `asUser`); guards wraps the state excerpt as quoted data in `<session-state>` tags; the previous state file is kept as `.claude/handoff-previous.md`. |
| Low | *Approve* button on a glob the model chose; stale blockers on the merge button; `failOpen` covering the branch guard; multi-line `/approve`. | Button refuses globs (type `/approve` instead); the merge button re-polls before sending; branch, kit-owned and GitHub guards fail closed regardless of `failOpen`; `/approve` takes one repo-relative line. |

Still true, verified by the reviewer: argv-only process calls, no `$.env`, `https://`-gated push, fork only on `/handoff` and *Keep warm*, deny-only `tool.check`/`tool.call`, origin checks on the human-only commands, the limited file writes.

## Common guarantees (all three)

- **No shell.** Every process call is `$.process.run(argv)` — an argument vector, never a shell string. Nothing from a prompt, a file or a PR reaches an argv (file paths are the model's tool inputs and are only *compared*, never executed).
- **Known executables only:** `git`, `gh`, `node scripts/<kit script>.mjs`, `df`/`ss`/`netstat`, `powershell -NoProfile -Command "(Get-PSDrive -Name C).Free"`. All with timeouts (≤ 15 s).
- **No secrets.** No `$.env.get` at all. No `.env` reads. `pushUrl` is the only sensitive option and is declared `sensitive` so it lives in secure storage, not settings.json.
- **No model calls except where named:** fleet's `/handoff` and *Keep warm* (`$.model.fork`); nothing else spends usage.
- **Human-only commands check `e.origin`:** `/handoff`, `/approve`, `/merge`, `/check` refuse `{ kind: 'plugin' }` and anything that is not the composer or the Remote Control bridge. The model cannot run them through `$.command.run`, and a prompt injection cannot make the model run them.
- **State writes are the plugin's own.** `$.state` is per-plugin by contract; `$.store` keys are prefixed (`fleet:session:*`, `fleet:notify:*`).
- **Buttons are the person's act.** A band button runs only from a `ui.press` raised by the surface.

## fleet

| Concern | Finding |
| --- | --- |
| Host processes | `git branch/status/rev-list/worktree/rev-parse`; `df -k`; `ss`/`netstat` (via `sh -c` **only** on Linux, with a fixed string and no interpolation); `powershell … Get-PSDrive`; `node scripts/slot-stop.mjs` only when `autoStopPorts` is on, in a slot, and no `/remote` link is live. |
| Files written | `.claude/.session-lock` (same shape as the shell workflow); `docs/session-state-<branch>.md` or `.claude/handoff-<branch>.md` on `/handoff`. Never outside the session's checkout. |
| Permission effect | `tool.check` on Bash: **deny only** (`git checkout/switch/reset` while another live session holds the folder). It never returns `allow`, so it cannot lift a rule or the classifier. Fails **closed** (`.catch` → deny) when the registry cannot be read. |
| Network | One optional `POST` to `pushUrl`, only when it starts with `https://`, body = the notification text (e.g. "PR #<n>: all 9 checks green"). Nothing else leaves the machine. Phone pushes never carry file contents or prompts. |
| Model spend | `/handoff` = one fork (cache-shared); *Keep warm* = one fork of `ok`. Both person-initiated. |
| Cross-session store | The plugin's own store (per-plugin, shared across sessions on the machine); one small JSON row per live session; day-old and future-dated rows are pruned; `/fleet forget <id>`. |
| Residual risk | A session that crashes leaves its row for up to 2 minutes as "live" (the slot lock then refuses a branch switch in that folder for that long); `/fleet forget <id>` ends it sooner. |

## guards

| Concern | Finding |
| --- | --- |
| Host processes | `git branch --show-current`; `node scripts/plan-name-similarity.mjs --file=<rel>` where `<rel>` is a repo-relative path that matched `plans/.+\.plan\.md$` (no shell, so spaces or quotes in a name cannot escape). |
| Files written | Only the active plan file, only through `/approve` or the *Approve* button, only appending one line inside its ```` ```scope ```` block. |
| Permission effect | `tool.call` on Edit/Write/MultiEdit/NotebookEdit: **deny only**. `tool.call` on Bash: **deny only** (`git push … --no-verify`). It never answers `allow` and never calls `tool.check`, so it cannot widen anything the user's rules or the classifier would stop. |
| Failure mode | Scope/branch guard: fails **open** by default (`failOpen: true`), with a toast, exactly as `scope-guard.sh` does today ("/ship scope gate will verify"); set `failOpen: false` to fail closed. The `--no-verify` guard fails **closed**: its `.catch` re-tests the regex and denies. |
| Prompt injection | A path cannot approve itself: approval needs a human-origin command or a press, the scope is pinned per session, and an edit that would change the scope block is denied. The deny text echoes the path back to the model as plain text. |
| Context injection | `prompt.compose` adds a `session`-scoped section built from the role and ≤ `stateInjectChars` of `docs/session-state-<branch>.md`. That file is already repo content the model reads today; the mod does not add any new source of text. |
| Residual risk | The glob matcher is a 40-line port, not picomatch. It supports `**`, `*`, `?`, `{a,b}` and dot files, which covers every scope block in `plans/` today. An exotic pattern (`!(…)`, `[abc]`) would not match and would **deny**, never allow. `/ship`'s `scope-check.mjs --diff` (real picomatch) remains the backstop. |

## ship-pilot

| Concern | Finding |
| --- | --- |
| Host processes | `git branch/rev-list`; `gh pr view <branch> --json <fixed field list>`. **It never runs `gh pr merge`, `gh pr create` or `git push`.** |
| Files written | The active plan file, only on `/check`, only flipping one `- [ ]` to `- [x]`, only inside a `wt-N` slot. Never `.claude/todo.md`. |
| Merge | The *merge* button and `/merge` submit the literal word `merge` **as the person's reply** (`asUser: true`). The engine's transcript still names the plugin as origin. `/ship`'s own Phase 4.5 then runs: brain capture, PR creation, the slot-safe merge recipe. The mod adds a gate *in front*: it refuses to send `merge` while checks fail or run, the PR is a draft, conflicting or closed. There is no auto-merge path. |
| Permission effect | None. It hooks `tool.call` only to **observe** TaskUpdate/TodoWrite/plan edits (it always calls `next(e)` first). |
| Network | `gh` (your existing GitHub auth) and, if set, one `POST` of the checks result to its own `pushUrl`. |
| Residual risk | `prLine` renders PR titles/check names from GitHub in the band. They are drawn as text, never executed or parsed as commands. |

## What the engine itself enforces

- A hook has 10 s; a `.catch` 1 s; all `session.end` hooks ~1.5 s. fleet's `slot-stop` on exit uses a 1.2 s timeout for that reason.
- Managed-settings deny rules hold over any mod on Team/Enterprise plans; none of these mods tries to lift one.
- A mod that crashes the shared hooks worker three times is unloaded with every other user mod. None of these mods loops without awaiting, and every poll is a `$.clock.every` dispatch of its own.

## Things to check on your PC before trusting them

1. Run `claude plugin validate <mod>` yourself and read the `calls:` line — it must match the tables above.
2. Keep `pushUrl` empty until you have a private ntfy/Pushover topic; a public topic is readable by anyone who guesses its name.
3. Try the slot lock with two terminals in one slot before relying on it.
4. `guards` with `failOpen: true` is the same safety level as today's shell guards; flip it to `false` once you have seen it behave for a week.
