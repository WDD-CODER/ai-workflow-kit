# agent-workflow gotchas

## Context compaction can silently drop decisions

**What hurt:** When a long Claude Code session's context window compacts, decisions or task state that only ever lived in conversation (never written to a file) can be summarized away — especially something decided a few tool calls before a compaction boundary.

**Why the obvious fix is wrong:** Trusting "the summary will capture it" isn't safe — summarization prioritizes recent/salient content, not necessarily the one decision that turns out to matter later.

**What to do instead:** Persist load-bearing state to disk as it's decided (`.claude/todo.md`, plan files under `plans/` and their Execution Notes) rather than leaving it only in conversation. This is also why `docs/brain/` exists as its own durable layer — see [[0002-file-based-memory-over-tool-memory]].

---

---

## Pasted plans that never hit `plans/`

**What hurt:** Big plans authored in one IDE (or chat) were copy-pasted into Cursor/Claude for brief-by-brief execution, but nothing forced a write under `plans/`. Mid-flight stages lived only in conversation or `.claude/todo.md`, so agents could not see the live contract.

**Why the obvious fix is wrong:** Relying on “remember to save the plan” fails — save-plan only ran on an explicit phrase, and number-collision checks did not catch same-topic renames.

**What to do instead:** Any pasted Plan Contract triggers `.claude/skills/save-plan/SKILL.md` first. Run `node scripts/plan-name-similarity.mjs --name="…"`. Ask rewrite/save-as-new/cancel **only** on similar name hits. Append mid-brief tasks to the parent plan’s Atomic Sub-tasks + ledger. Claude PreToolUse: `scripts/plan-write-guard.sh`; Cursor: `.cursor/rules/save-plan-must-use-skill.mdc`.

---

---

## PreCompact FAIL substring matches review PASS/FAIL

**What hurt:** A PreCompact transcript grep used loose `FAIL` / `Verify:` tokens. Ordinary `/review-it` tables (`| PASS/FAIL |`, `| Verify cmd |`) and quoted session text were dumped into `.claude/todo.md` as “unresolved signals,” polluting the compact-time ledger.

**Why the obvious fix is wrong:** Dropping signal capture entirely loses the Brief 1 goal (preserve open blockers across `/compact`). Matching only “FAIL” with `\b` still hits `PASS/FAIL` because `/` is a word boundary.

**What to do instead:** Anchor real tool tokens (`UPGRADE_AVAILABLE`, `ROUTING_DECLINED`, `BLOCKED`); require `Verify:` + whitespace; require `FAIL` with a non-`/` predecessor; truncate each match (`cut -c1-300`) so JSONL lines cannot flood `todo.md`.

---

---

## Existing save-plan mitigations still let a plan skip plans/

**What hurt:** The gotcha above ("Pasted plans that never hit `plans/`") already
documents save-plan + `plan-write-guard.sh` + the Cursor `.mdc` rule as the fix —
yet a large plan still executed end-to-end with ~22 `.claude/todo.md`
items marked `[x]` and no `plans/285-*.plan.md` ever created. The mitigations
existed on paper and were still bypassed, silently, with no error.

**Why the obvious fix is wrong:** Assuming "the gate exists" means "the gate
caught it" ignores two concrete bypass paths neither gate covers: (1)
`.claude/commands/plan.md` / `feat.md` / `review-it.md` documented a second,
ungated plan-path convention (`plans/[feature]_v[N].md`) that
`plan-name-similarity.mjs` and `plan-write-guard.sh` never recognized — a plan
saved under that name skips both checks; (2) `brief-detection`'s 3-marker H2
threshold also matches a genuine Plan Contract (Milestones + Atomic Sub-tasks),
and its execute-as-is route goes straight to `/feat` without ever mentioning
save-plan.

**What to do instead:** Treat "the skill exists" as necessary but not
sufficient — verify with a ledger-integrity check
(`scripts/plan-ledger-check.mjs`, wired into `.husky/pre-commit` and `/ship`
Phase 1) that every plan path referenced in `.claude/todo.md` / session briefs
actually resolves on disk. Collapse to one plan-path convention
(`plans/NNN-slug.plan.md` only). Make `brief-detection` check for a
Milestones/Atomic-Sub-tasks shape *before* offering the brief a/b/c gate,
routing Plan-Contract-shaped pastes to save-plan first. See
`plans/291-plan-persistence-brief-sync-hardening.plan.md`.

---

---

## Orphaned instruction file looks wired but nothing loads it

**What hurt:** `.claude/instructions/validation-checklist.md` fully specified HOW TO VALIDATE, but it was only `@`-included from `execute-it.md`. After that command was removed, agents still had JOB DONE close-out and looked compliant — Humans never got click-test bullets.

**Why the obvious fix is wrong:** Adding more “remember to show a checklist” reminders (or leaving the orphan file intact) does not restore enforcement. Agents follow hard gates they already load (`job-validation`, ship, done), not orphaned instruction paths.

**What to do instead:** Move the live rules onto `docs/agent/job-validation.md` and the close-out templates agents must print; leave the old path as a pointer stub. Audit `@include` / skill triggers whenever deleting a command that was the only loader. See [[how-to-validate-on-job-gate]].

---

---

## Same-directory concurrent session breaks the plans/ numbering scan

**What hurt:** Saving a plan needed two renumbers (e.g. 012 → 013 → 014) within
minutes, and separately, five rounds of unrelated docs edits (the auto-write
brain-capture policy change) kept getting silently reverted mid-session.
`ls plans/` / `plan-name-similarity.mjs` were run once early, then the actual
`Write`/`Edit` calls happened several tool calls later. A concurrent Cursor
session on the *same* branch, in the *same* (non-worktree) working directory,
landed its own commits and full-file rewrites in that gap — including
branch switches that changed HEAD out from under an in-progress edit.
`/ship` Phase 3's overlap check only runs when `git worktree list` shows more
than one worktree — this was a single working directory the whole time, so
the check that exists for exactly this failure mode never fired.

**Why the obvious fix is wrong:** Assuming "I already scanned this
conversation" is safe ignores that the scan/read and the `Write`/`Edit`
aren't atomic — any gap (including waiting on a Human reply) is a window for
another session to land files, rewrite a whole file from a stale read, or
switch branches. Re-running `plan-name-similarity.mjs` doesn't catch a
same-number-different-topic collision either — it only compares *titles*.
Retrying an `Edit` immediately after a revert doesn't help either if the
other session is mid-way through its own multi-file batch — it just races
again on the next round.

**What to do instead:** Re-list `plans/` (or re-`git log -3 --oneline`)
immediately before a `Write`/`Edit` on a shared file, not only once earlier
in the conversation — treat any gap of more than a couple tool calls (or a
Human-reply wait) as stale. Since `git worktree list` doesn't detect
same-directory concurrent sessions, don't rely on it as the sole staleness
trigger. When repeated reverts hit the same shared files, stop making
one-file-at-a-time edits with round-trips in between — batch every remaining
edit into a single parallel tool-call message, then commit immediately, to
minimize the window another session has to land a conflicting full-file
write. Related to [[0001-lean-native-workflow]] and the cross-worktree NNN
hardening in `plans/291-plan-persistence-brief-sync-hardening.plan.md` M6,
which covers stale *origin* state but not same-directory local races.

**2026-08-23 confirming case:** the same failure mode hit a shared *reference* file,
not just `plans/`. Mid-session, a concurrent same-directory session staged ~3.5M
lines of deletions under `tools/catalog-seeder/`, plus live edits to `.gitignore`
and `src/styles.scss` — a file this session was actively reading for its exact
`.c-*` engine values. `git reset -- <paths>` to unstage the unrelated deletions
looked sufficient, but the other session **re-staged the same paths** later in
the conversation, silently, between that reset and the eventual commit. The fix:
treat `git reset` as a snapshot, not a guarantee — re-run `git diff --cached --stat`
immediately before every `git commit` on a shared working directory, not just
once after the initial `git add`.

---

---

## Todo archive footer wording and Plan Index placement

**What hurt:** Fully-done `### Plan` sections sitting *below* `## Plan Index` were invisible to `scripts/todo-archive.mjs` (footer cut-off), so dead weight stayed in `todo.md`. Separately, changing the `## Done` stub text away from a recognized phrase caused the stub to be swallowed into the last archived plan section. Keeping a large Plan Index table in `todo.md` also re-bloated the open-work file after Done rows were moved out.

**Why the obvious fix is wrong:** Re-running the archive script “successfully” looks healthy while orphan all-`[x]` sections remain. A “slim” Active/Planned index still costs ~90 lines every session and mostly duplicates stale catalog state.

**What to do instead:** Keep every `### Plan` block above the file footer (`## Where things live`). Do not maintain a Plan Index table in `todo.md` — open work is the sections; Done is `todo-archive/`; all files are under `plans/`. Archive only via `node scripts/todo-archive.mjs`. See `docs/agent/job-validation.md` → Todo archive volumes.

---

---

## `scripts/todo-archive.mjs` section-splitting silently corrupts or drops sibling content

**What hurt:** `splitPlanSections()` only split `.claude/todo.md` on `### Plan` headers. A non-Plan heading sitting between two plan sections (e.g. `## 6. KEEP DEFERRED`) got absorbed into the *preceding* plan's captured text instead of being its own boundary. This silently broke two different things: the swallowed text's literal wording (e.g. `(deferred)`) false-flagged the preceding plan as blocked/deferred, so `isFullyDone()` refused to archive it even when every checkbox was `[x]`.

**Why the obvious fix is wrong:** Narrowing the section boundary (stop at any `## ` heading, not just the next `### Plan`) fixes the false-flagging — but if you stop there, you've introduced a worse bug. `removeSectionsFromTodo()` reconstructed the file from `preamble + kept-sections + footer` only. Once the sibling content is correctly excluded from every section's captured range, it isn't part of *any* section, the preamble, or the footer — so it falls into a gap the reconstruction never accounts for and gets silently deleted the next time a neighboring plan is archived. A partial fix (only the boundary detection) trades a visible bug (false "no all-[x] sections" message) for a silent one (real content vanishing from a tracked file).

**What to do instead:** When a text-splitting function's caller reconstructs the whole document from the parsed pieces, verify the reconstruction accounts for *every* byte of the original — not just the pieces you meant to keep. Prefer excising exact `[start, end)` line ranges of the pieces you're removing from the original line array over rebuilding from `kept.join(...)` fragments; the former can't lose content that was never part of what you're removing. Verify with `--dry-run` before applying, and diff the *unrelated* surrounding content, not just the target section.

---

---

## `brain-review-check.mjs` flags `docs/brain/` subfolder-relative refs as dead

**What hurt:** After splitting `gotchas.md` into `docs/brain/gotchas/*.md`, an early draft wrote cross-references relative to `docs/brain/` (e.g. a bare "gotchas/agent-workflow.md" in backticks, omitting the `docs/brain/` prefix) inside those subfolder files. `node scripts/brain-review-check.mjs --scope=full` flagged every one of them as a dead reference, even though the file existed and any markdown-link syntax around it would have resolved fine in a rendered viewer.

**Why the obvious fix is wrong:** Assuming a backtick-quoted path is safe because it "looks like a relative link from this file" ignores how the checker actually works — `extractRefs()` pulls the raw backtick text and joins it straight onto the repo root (`join(repoRoot, ref)`), with no awareness of which file it came from. There is no such thing as a directory-relative ref as far as the checker is concerned.

**What to do instead:** Inside `docs/brain/**`, always write backtick-quoted cross-references as full repo-relative paths (`` `docs/brain/gotchas/agent-workflow.md` ``), even for a file referencing its own sibling in the same subfolder. Verify with `node scripts/brain-review-check.mjs --scope=full` before shipping any `docs/brain/` restructure.

---

---

## `.claude/todo.md` unchecked box doesn't mean the work wasn't done

**What hurt:** After a mid-session crash, a plan's Milestone 1 looked "not started" from `.claude/todo.md` alone — every box was still `[ ]`. In reality the work was fully implemented and self-verified (`npm run {{commands.build}}` pass, curl tests, live app test — see the session doc) in the crashed session; it just never got committed or human-validated before the machine dropped.

**Why the obvious fix is wrong:** Trusting the todo checkbox state as a proxy for "has this been attempted" leads to either re-doing already-finished work from scratch, or (worse) assuming a stale unchecked item is safe to ignore when it's actually sitting live in the working tree.

**What to do instead:** After any session interruption, before touching a plan's unchecked items: run `git status` for uncommitted changes and check for a same-day `sessions/YYYY-MM-DD-*.md` file before assuming "unchecked" means "not started." A checkbox only reflects Human validation status (per `docs/agent/job-validation.md`), never implementation status.

---

---

## The Skill tool's plain-name resolution can pick a vendored third-party skill over this project's own command of the same name

**Status:** draft — generalized from a project lesson; review before relying on it.

A bare skill/command name can resolve to a vendored skill instead of the project's own — namespace project commands or verify resolution after installing any third-party skill pack.

---

## `RemoteTrigger` rejects sub-hourly cron and silently attaches every connected MCP connector

**What hurt:** Setting up an unattended nightly-maintenance routine, a `*/30 * * * *` cron (30-minute retry cadence, so a fire blocked by a usage cap gets retried soon after) was rejected outright: "Minimum interval is 1 hour." Separately, creating the routine with no `mcp_connections` field in the body still attached all 4 of the account's connected MCP connectors (Gmail, Google Drive, Claude Docs, Claude Code Remote) to the new routine.

**Why the obvious fix is wrong:** Omitting `mcp_connections` reads as "no connectors," but the API defaults to attaching everything already connected at the account level — an unattended nightly code-maintenance job ends up with mailbox/Drive access it never asked for and never needed.

**What to do instead:** Build sub-hourly retry semantics around an hourly cron (comma-separated UTC hours, e.g. `0 23,0,1,2,3 * * *` for a multi-hour local window) plus an idempotency marker file the prompt checks first, so only the first successful fire in a night does real work and every later fire that night is a cheap no-op. After creating any `RemoteTrigger` routine, always follow up with `action: "update", body: {clear_mcp_connections: true}` unless the task genuinely needs a specific connector — then pass only that one explicitly.

---

---

## `RemoteTrigger` cloud routines clone from GitHub, not the local working tree

**What hurt:** A routine invoking a newly-added `.claude/commands/*.md` slash command failed on its first real run — the cloud session clones the repo fresh from the `git_repository` source's default branch, so a command file that only existed locally, uncommitted, on an unpushed feature branch wasn't there yet. The run correctly reported the missing file and refused to improvise a substitute, but the routine was otherwise fully configured and looked ready.

**Why the obvious fix is wrong:** Writing and reviewing a new command file locally, then wiring up the schedule, feels like "done" — but the routine's `sources[].git_repository` has no visibility into local, uncommitted, or unpushed branch state; it only ever sees what's actually merged to the branch it reads.

**What to do instead:** Before trusting a scheduled routine that invokes a repo-local command or skill, get that file merged into the branch the routine's `git_repository` source actually reads (normally `main`), then fire a manual `RemoteTrigger` `run` to confirm it resolves and behaves correctly before relying on the schedule unattended.

---

---

## `/ship`'s ledger and manifest gates can fail on another session's leftovers, not your own diff

**What hurt:** While shipping the two-slot parallel-session system, `scripts/plan-ledger-check.mjs` hard-failed with `MISSING plans/320-recipe-labels-fix-course-category-field.plan.md` — but that reference came from an edit to `.claude/todo.md` made by a *different* concurrent session (in the `../{{project.name}}-wt-recipe-labels` worktree) referencing a plan file that only exists in its own worktree, never staged as part of this ship. Separately, `session-manifest-ship.py` flagged an "overlap" against branch `chore/cook-view-service-split` on `.gitignore`/`.claude/todo.md` — that branch no longer exists locally and is already merged into `main` (it's the tip commit); its `.claude/sessions/` manifest was simply never cleaned up, and its mtime (today) meant the existing ">24h stale" heuristic didn't filter it out either.

**Why the obvious fix is wrong:** Treating either gate failure as "my diff is broken" and trying to fix it in-place is wrong on both counts. For the ledger check: deleting or editing the other session's `.claude/todo.md` entry to unblock your own ship destroys in-progress work you don't own. For the manifest overlap: the `>24h` staleness filter only ages by file mtime, not by whether the branch still exists or is already merged — a manifest for a long-gone, merged branch can still look "fresh" and trip a false-positive STOP.

**What to do instead:**
1. Before treating a `plan-ledger-check.mjs` failure as a real blocker, check whether the dangling reference is actually in *your* diff (`git diff -- <file>` against what you staged). If it isn't, isolate it without touching the other session's intent: `git stash push -m "<descriptive-name>" -- <path>` — stash refs live in the shared `.git` common dir, so the other worktree can retrieve it later with `git stash apply stash^{/<descriptive-name>}`. Never delete or hand-edit another session's uncommitted note in a shared tracked file.
2. Before honoring a `session-manifest-ship.py` overlap as a live conflict, check whether the overlapping branch still exists: `git show-ref --verify --quiet refs/heads/<branch>` (or `git branch --merged main`). A branch that's gone/merged means the manifest is stale regardless of its mtime — treat the overlap as noise, not a stop, and say so explicitly rather than silently overriding it.
3. The Planner-Worker slot model (3 fixed `wt-N` worktrees claimed via `scripts/take-plan.mjs`, see `docs/agent/workflow-map.md`; retired the older two-slot `claim-parallel-slot.sh` system) prevents the *working-tree* version of this problem (two sessions editing the same checkout at once) but does **not** prevent this — both gates inspect committed history and shared tracked files, which any worktree can still independently pollute. Expect to keep hitting this until stale `.claude/sessions/<branch>/` manifests get pruned as part of normal branch cleanup (`/cleanup` → `scripts/prune-old-sessions.sh`).

---

---

## Naive git-status parsing silently drops path characters and undercounts new directories

**What hurt:** In `scripts/ship-prep.mjs`, calling `execFileSync('git', ['status', '--short']).trim()` on the whole multi-line output stripped the leading space off just the *first* line (unstaged-modified status is `" M path"`), silently truncating `.claude/todo.md` into `claude/todo.md` for that one file. Separately, `git status --short` collapses a brand-new untracked directory into a single `?? dir/` line instead of listing the files inside it — a new `scripts/lib/` folder containing one file (a common case) would have reported as 0 files, not 1.

**Why the obvious fix is wrong:** `.trim()` looks like the safe, idiomatic way to clean up command output, but applied to the *whole* multi-line `git status` output it only touches the very first and very last line — and the first line of `git status --short` starts with a status code where a leading space is semantically significant (unstaged vs staged). The bug only manifests on that one specific line, so a spot-check on a diff where the first file happens to be staged (`M ` or `A ` instead of ` M`) looks completely correct while the untracked-modified case silently corrupts.

**What to do instead:** When parsing `git status --short` output in a script, trim only the trailing newline (`.replace(/\r?\n+$/, '')`), never the whole string with `.trim()`. Always pass `--untracked-files=all` when counting or listing changed files, or a brand-new directory with multiple files inside collapses to one `?? dir/` entry and undercounts.

---

---

## New branch-naming convention colliding with pre-existing branches of the same shape

**Status:** draft — generalized from a project lesson; review before relying on it.

Pick a branch-naming scheme only after listing existing branches of the same shape; a new prefix/pattern must not collide with refs already in use.

---

## Bash commands that merely mention `.github` get refused outright

**What hurt:** Claude Code's built-in Auto-mode safety classifier (separate from this
repo's own hooks/settings — nothing in `.claude/settings.json` references it) denies Bash
tool calls whose command text mentions `.github`, even for a purely read-only listing or
count (e.g. `ls .github/workflows`, `find .github -type f`). It pattern-matches on the
string, not on whether the command actually writes to CI/CD config. Hit while building the workflow kit
(`docs/workflow-kit/`) while inventorying `.github/workflows/**`, and separately while
pushing a fix commit directly to `main` (denied as "[Modify Shared Resources]").

**Why the obvious fix is wrong:** There is no project-side fix — it isn't a hook, a
permission rule, or anything configurable in this repo. Retrying the same command, quoting
the path differently, or routing through a wrapper script that still shells out to `ls`/
`find`/`grep` on a `.github` path will hit the same classifier again.

**What to do instead:** Do the filesystem work in Node (or another non-Bash tool) instead
of a shell command that names `.github` — e.g. `fs.readdirSync`/`fs.statSync` walks instead
of `ls`/`find`. Dedicated tools (Glob/Grep/Read) over a `.github/**` path are unaffected;
only the Bash tool's command text triggers it.

---

## An inline `# comment` after a glob in a plan's `scope` block silently makes that glob match nothing

**What hurt:** A plan's scope block had `docs/brain/decisions/*-some-decision.md   # one new ADR`. `scripts/scope-check.mjs` only drops lines that *start* with `#`, so the glob included the trailing comment text. `ship-prep` reported `scope: out` for the plan's own ADR.

**Why the obvious fix is wrong:** Widening the glob or approving the path hides the cause, and every later Worker hits the same trap.

**What to do instead:** Put comments on their own `#` line above the glob. Never put them after it.

---

## Windows: stopping a dev server at its port owner leaves `node --watch` idle forever

**What hurt:** Task Manager filled up with `npm run dev:local` → `cmd.exe` → `cross-env` → `node --watch index.js` chains whose watcher had no child and held no port. On 2026-10-06 four of them sat in `wt-1` and main; on 2026-10-17 `wt-3` still had one from the day before.

**Why the obvious fix is wrong:** Killing whatever holds the port (`taskkill /PID <port owner> /T`) kills only `node index.js`. The watcher prints "Failed running 'index.js'. Waiting for file changes before restarting..." and lives on. A second start while the port is taken ends the same way: the new app dies on `EADDRINUSE`, its watcher stays. Cleaning up by port can never find these, because they hold no port.

**What to do instead:** Stop a dev server from the root of its chain (`killChain` / `stopSlotServers` in `scripts/lib/slot-procs.mjs` walk up from the port owner through npm/cmd/cross-env, then `taskkill /T` the root), never start one while its port is held (`startServer`), and find chains by folder (a chain member's command line contains the checkout path), not only by port. `scripts/orphan-sweep.mjs` at session start removes what a crashed session left. Match the folder with a trailing separator, or the main folder also matches every slot folder named after it.

---

## A watch-mode test script never exits, so an orchestrator gate that runs it hangs

**What hurt:** On 2026-10-27 an orchestrator run gated on `npm run test`, which in that project was its framework's test command in watch mode. It printed its totals and then waited for file changes. One gate sat 32 minutes; the hang also triggered fix rounds and an escalation that fixed nothing. About 70 minutes of a 2-hour run went to it, while the project's CI had always run the same tests once, with the watch flag off.

**Why the obvious fix is wrong:** Retrying or asking a builder to "fix" the failing check changes nothing: the check is not failing, it is waiting. A longer timeout only waits longer.

**What to do instead:** Give the project a test script that runs once and exits (the one CI uses, e.g. named `test:ci`) and set `commands.testCi` to it: the gate runs it instead of `commands.test`. `orch-preflight.mjs` warns when the gate's script looks like a watch mode (`orchestrator.watchTestPattern` names the project's own framework's command), and every gate command is stopped after `orchestrator.gateTimeoutMin` minutes and reported as a fail with a "timed out" tail.

---

## A merge folder without packages parks a finished plan

**What hurt:** On 2026-10-28 an orchestrator run built its one plan and passed every check, then the merge step's `npm run build` failed with `'ng' is not recognized` — twice — and the plan was parked. The merge folder is a worktree `init` had just created; a worktree starts with no `node_modules`. The environment check passed because it looks at the main folder, which has its packages.

**Why the obvious fix is wrong:** Retrying the merge, or sending the plan back to a builder, changes nothing in the merge folder. Linking `node_modules` in from the main folder is worse: on Windows `git worktree remove --force` follows the junction and deletes the main folder's packages.

**What to do instead:** `orch-state.mjs init` installs the merge folder's packages with the same `ensureDeps` a builder folder gets (an idle folder with packages installs nothing), and the env-only preflight (`--env-only --run <run>`) checks `scripts/node_modules/picomatch` in the merge folder too. A folder that cannot be provisioned is an environment failure before any builder runs.

---

## Every orchestrator run note is an agent call

**What hurt:** After the park above, the run wrote about 30 closing notes in 4.5 minutes — each `note` is `orch-state.mjs note`, run by a `kit-runner` agent, so a note loop is a long agent loop. The run looked alive (status.json kept updating) while nothing happened, and the Human's session was stuck on a model whose every reply was blocked.

**Why the obvious fix is wrong:** Writing fewer notes by hand in one place does not stop the next loop; a time-based watchdog cannot live in the workflow script (it has no clock: `Date.now()` throws there).

**What to do instead:** Limits are counters in the workflow (`orchestrator.maxNotesPerPlan`, `maxAgentCallsPerPlan`, and the same failure reason twice in a row parks the plan at once), a dead agent is retried once on `orchestrator.fallbackModel`, and the Human asks `node scripts/orch-state.mjs watch --run <run>` — one line from `status.json` only, `STUCK` with exit 1 — from a second terminal.

---

## A check that needs `.env` or a live database cannot pass in the merge folder

**What hurt:** A plan's `[auto]` item ran a log-query script that reads the backend's log database (it needs the backend's `.env` and the running server). It passed in the builder's worktree, where an `.env` had been copied by hand, then failed in the merge folder — which never gets an `.env` — and the run parked a built and verified plan at the merge step. The Human ran the check from the main folder and merged by hand.

**Why the obvious fix is wrong:** Copying `.env` into every worktree and the merge folder spreads secrets over folders git removes and hides the real fact: the check is about the live environment (a log, data), not about the tree being merged, so it has no business in a merge or a final gate at all.

**What to do instead:** Tag the item `[auto:main]`. Readiness lists its command under `mainCommands`, the run executes it from the main folder with a second gate right after the plan's worktree gate (project scripts only: `node scripts/…`, `node tools/…`), and neither the merge step nor the final gate runs it. The merge step itself runs only `orchestrator.mergeChecks` (`build` = the build plus the plan's scope check); lint and tests run in the plan's gate and once at the final gate.

---

## A slot-only check cannot run from the main folder in an orchestrator run

**What hurt:** A project's plans carried `log-query --since=plan-start --level=error → no entries` as an `[auto]` item. Readiness listed it as an `[auto:main]` command, the Planner approved it on a delegated "decide yourself", and the run ran it from the main folder: `plan-start` reads `.claude/.slot-plan-start`, which only `take-plan` writes in a slot, so it failed every time. The builder spent three fix rounds on it, the plan parked, the later plans never started, and the run needed a restart (about an hour).

**Why the obvious fix is wrong:** Writing a plan-start stamp into the main folder, or rewriting `plan-start` to a time, makes the command pass but proves nothing: the main folder's servers run `origin/<main>`, not the plan's branch, and its log also holds errors the plan never caused.

**What to do instead:** A run drops a main-folder check that reads `plan-start` at launch, with a note, and readiness leaves it out of `mainCommands`. The question it asked — did the app log errors? — is answered once for the whole run: `finish` runs `commands.logQuery` from the main folder with `plan-start` replaced by the run's start time and puts the output in the report. In a slot, the check keeps working as before.

---

## A plan's count or every-X goal was wrong and readiness did not look

**What hurt:** A plan said the draft editor has 3 row-delete handlers; it has 1. Another aimed to make every number box tap-to-edit, but four number boxes sat outside its Read-Write Scope. The builders were right to stay in scope and log `seen:`, but both gaps surfaced after the merge as decisions to grade, not before the run as questions. Separately, a delegated "decide yourself" approved a main-folder command nobody had seen run, and `npx <tool> build` checks landed in `denied` where nobody looked.

**Why the obvious fix is wrong:** A second agent or a post-build checker pays the cost after the damage. Trusting the `go` inside a delegated reply treats the Human as having reviewed a command only the Planner saw.

**What to do instead:** Readiness checks up to 8 claims per plan in its own call and turns each mismatch into a question with a default (`docs/agent/orchestrator.md`, "What a plan claims"). A delegated answer keeps a main-folder command only when `orch-state.mjs main-try` saw it pass from the main folder; an `npx` check maps to the package.json script that runs it or is shown as dropped.

---

## A state call can fail on the copy, not the command

**What hurt:** A run parked a plan at its first step, `worktree: unreadable ORCH_JSON from: node scripts/orch-state.mjs worktree …`. The command had exited 0 and printed a well-formed line; the `kit-runner` agent's copy of that line is what the workflow reads (it has no file access), and the copy did not parse. The error named neither the line nor the parser's message, so the cause could only be dug out of the workflow journal by hand — and stayed unconfirmed. The same runner had also run `git checkout main && git pull` in the main folder on its own before the command.

**Why the obvious fix is wrong:** Raising the runner's effort for every state call pays on every call for an event seen once; a file hand-off between `orch-state.mjs` and the workflow is out of reach (the workflow script cannot read files).

**What to do instead:** The workflow retries a state command once when its copy does not parse (effort `medium`, not for `note` and `finish`), writes a run note `runner retry: … — first attempt: <error>`, and a second failure parks the plan with the parser's message, the first non-ASCII character and the raw line JSON-escaped (`docs/agent/orchestrator.md`, "A bad copy of a state line"). `kit-runner.md` says in so many words: run only the commands in the list, copy an asked-for line character for character.

---

## One parked plan stopped every later plan

**What hurt:** In one run, a plan parked at 22:55 on a slot-only check. The wave gate then skipped the two later plans (`not started: wave N parked <NNN> — later waves not started`) although neither needed anything from it; in the second pass both built and merged with no change from the fix. About an hour of overnight time was lost.

**Why the obvious fix is wrong:** Letting every later plan run after a park is not safe either: a plan that depends on the parked one, or edits the same files, builds on what the park left behind. The workflow cannot tell which is which by wave order alone.

**What to do instead:** `orchestrator.onPark` is `dependents` (default): `orch-state.mjs order` hands the workflow the unmet edges, and `blockedBy()` in `orchestrate.js` skips only the later plans reachable over `Depends-on:` edges (`depends on parked <NNN>`) or a scope-overlap edge (`shares files with parked <NNN>`); the rest still run. `all` is the old behaviour. A `stopRun` and a failed final gate still stop everything.
## A green run, a red pull request

**What hurt:** On 2026-10-29 an orchestrator run finished green and its pull request failed on the CI `rules` job (`KIT_MANIFEST: FAIL — 3 unclassified`); another plan hit the same failure the day before. About ten minutes each. The final gate ran only the project build, lint and test commands, and nothing said which other CI commands it skipped.

**Why the obvious fix is wrong:** Adding one more hard-coded check to the gate fixes that one job and leaves the next CI-only job to repeat it. Rerunning CI until it passes hides a real failure behind a flake.

**What to do instead:** List the cheap CI commands in `orchestrator.ciMirror` (kit.config.json): the final gate runs them after the project checks and the kit manifest check. Install and sync print a `NOTE ci-mirror:` line for each workflow command the gate does not run. A check that passes only on a rerun is recorded as a flake in `status.json` and the report (`## Flaky checks`), so it can be fixed instead of paid for in fix rounds.
