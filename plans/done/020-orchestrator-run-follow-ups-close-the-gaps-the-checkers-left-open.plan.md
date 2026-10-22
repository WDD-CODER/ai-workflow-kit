# Plan 020 — Orchestrator Run Follow-ups: Close the Gaps the Checkers Left Open

Status: done
Snapshot: 6bc9d95
Depends-on: 011, 013, 014, 017, 018, 019

## Problem Statement
The orchestrator run that built plans 010, 011, 013, 014, 017, 018 and 019 (merged in PR #37, released as v1.4.0)
passed every blocking check, but its independent checkers left a list of minor and nit findings, and the security
follow-up left one gap of the same kind it fixed. None blocks today's use; several make the next real `/orchestrate`
run less reliable or a guard easier to slip past:
- `[ui]` card test commands still go through the destructive-command deny list only, while every other extra check
  command now needs the allowlist (`core/.claude/workflows/orchestrate.js:287`).
- `plan-order` and `take-plan` disagree on "done": `take-plan` counts an open plan with no open sub-tasks as merged,
  `plan-order` does not, so `plan-order` schedules plans that are already on `main` (e.g. 016 before it was closed).
- `.kit/config.json` sets no `paths.hotspots`, so `CHANGELOG.md` and `README.md` count as scope overlap and every open
  plan lands in one lock group — the `--json` conflicts are useless for the orchestrator on this repo.
- The guard's Bash-write reader misses a redirect inside `$( … )`, and reads `>` inside `if [[ … ]]` / `(( … ))` as a
  write. The Bash matcher in `settings.json` runs `branch-guard` and `scope-guard` but not `plan-write-guard`.
- `orch-preflight.mjs` checks only that `scripts/slot-serve.mjs` exists; plan 014's Must Have asks that dev servers
  start.
- `/review-it` lets the Human name a branch, but always diffs `origin/main...HEAD`.
- Smaller: `parseDependsOn` reads numbers after an em dash (`Depends-on: 011 — after release 1.3` adds 001 and 003);
  `agent-eval` passes `--model inherit` to `claude` and its write refusal ignores Bash; `orch-state` stale-lock
  takeover can race; `uiItems()` reads `[ui]` bullets anywhere in the plan; `uiItemsMissing` matches card titles by
  substring; the merge prompt says `--no-ff --no-commit` while `orch-merge.md` says a direct merge commit; the
  missing-packages test relies on `node_modules/.package-lock.json` (npm 7+ only).

## Prerequisites
- none open: 011, 013, 014, 017, 018 and 019 are merged on `main` (`4e0e48e`) and released in v1.4.0.

## Goals & Success Criteria
**Primary:** every finding above is fixed with a test, or closed with a written reason, and the kit checks stay green.

- [auto] `node --test tools/test/*.test.mjs` passes and includes a new case per fixed finding: `[ui]` card test command
  not on the allowlist is dropped with a run note; `plan-order` treats a plan with zero open sub-tasks on main as done
  (same rule as `take-plan`); `parseDependsOn("011 — after release 1.3")` returns `["011"]`; a Bash command
  `x=$(cat > README.md <<'EOF' …)` on a guarded folder is denied; `if [[ $a > $b ]]; then :; fi` is allowed;
  `agent-eval` with `model: inherit` passes no `--model`; two concurrent `orch-state` lock takers never both hold it.
- [auto] `node scripts/plan-order.mjs --json` on this repo reports no lock group caused only by `CHANGELOG.md` or
  `README.md` (`paths.hotspots` set in `.kit/config.json`).
- [auto] `node tools/orchestrator-e2e.mjs` passes, including a case where the preflight reports a dev server that does
  not start (stub `slot-serve` exits 1) as an environment failure before any builder runs.
- [auto] `npm run build`, `npm run lint`, `npm run test`, `npm run e2e`, `node tools/e2e-check.mjs`,
  `node tools/drift-check.mjs --target .` exit 0; CI green on ubuntu and windows.
- [human] `/review-it feat/<some-branch>` run from `main` reviews that branch's diff (Dandan names a branch).

## Execution Mode
- Parallel: no — touches the orchestrator, guards and planning scripts at once.
- Concurrent plans: none.
- Isolated DB: no.
- Kit edits: kit branch `feat/020-orchestrator-follow-ups` + kit PR; Dandan merges. Release: patch v1.4.1.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/.claude/workflows/orchestrate.js
core/.claude/agents/orch-merge.md
core/.claude/commands/review-it.md
core/.claude/settings.json
core/scripts/plan-order.mjs
core/scripts/take-plan.mjs
core/scripts/orch-state.mjs
core/scripts/orch-preflight.mjs
core/scripts/lib/**
core/docs/agent/orchestrator.md
tools/agent-eval.mjs
tools/lib/agent-eval/**
tools/orchestrator-e2e.mjs
tools/fixtures/orchestrator/**
tools/test/**
tools/e2e-check.mjs
core/docs/agent/workflow-map.md
.kit/config.json
.kit/install.json
scripts/**
.claude/**
docs/agent/**
CHANGELOG.md
core/.claude/commands/auto-solve.md
.claude/commands/auto-solve.md
core/docs/agent/standards-git.md
```

## Read Scope

Entire repo. Analysis and architectural suggestions are expected.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside the
`## Read-Write Scope` above: STOP, tell the Human the file, the exact change, and why it can't be done in-scope; offer
`approved: <path>`; then append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — fixes inside existing scripts and agents; guards only get stricter on guarded folders, and the
  orchestrator stays opt-in with `main` never written by a run.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits by symbol and print one line
per commit: `ok` or `conflict: <what>`. STOP for a go only on a `conflict`.

## User Stories
- As Dandan, I want the next real orchestrator run to stop early on a broken dev server and never run an unchecked
  command from a UI card.
- As the Planner, I want `plan-order` to agree with `take-plan` and give useful lock groups on this repo.

## Functional Requirements

### Must Have (P0)
- [ ] `[ui]` card test commands go through the same allowlist as extra check commands.
- [ ] One "done" rule shared by `plan-order` and `take-plan`.
- [ ] `paths.hotspots` set for the kit repo.
- [ ] Bash-write reader: `$( … )` redirects seen; `[[ … ]]` / `(( … ))` comparisons not read as writes; the Bash
  matcher also runs `plan-write-guard`.
- [ ] Preflight starts the dev servers (or proves they answer) and reports a failed start as an environment failure.
- [ ] `/review-it` reviews the branch the Human names.

### Should Have (P1)
- [ ] The smaller findings (Depends-on em dash, agent-eval inherit/Bash, lock race, `[ui]` item scope and title match,
  merge prompt vs agent, `.package-lock.json` fallback).

### Nice to Have (P2)
- none

## UI/UX Notes
- Terminal output only.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [x] A1: Check UI card test commands with the same allowlist as other checks, so no unchecked command reaches the gate — drop with a run note like the other dropped checks — core/.claude/workflows/orchestrate.js, tools/orchestrator-e2e.mjs
- [x] A2: Give planning tools one rule for "already done", so the run order matches what a Worker may take — open plan with zero open sub-tasks on main counts as done in both — core/scripts/lib/plan-deps.mjs, core/scripts/plan-order.mjs, core/scripts/take-plan.mjs
- [x] A3: Stop the changelog and readme from forcing every kit plan into one lock group — set paths.hotspots in the kit's own config, re-sync — .kit/config.json, .kit/install.json
- [x] A4: Make the guard see writes hidden in command substitutions and ignore comparisons in conditions, and run the plan-file guard on shell commands too — core/scripts/lib/guard.mjs, core/.claude/settings.json, tools/test/guards.test.mjs
- [x] A5: Make the run's preflight prove the dev servers start, so a broken server stops the run before any builder — core/scripts/orch-preflight.mjs, tools/orchestrator-e2e.mjs
- [x] A6: Make the review command review the branch the Human names, not always the current one — core/.claude/commands/review-it.md
- [x] A7: Fix the smaller checker findings, each with a test — Depends-on em dash, agent-eval inherit and Bash refusal, lock race, UI item scope and title match, merge prompt vs merge agent, missing-packages fallback — core/scripts/lib/plan-deps.mjs, tools/lib/agent-eval/run.mjs, core/scripts/orch-state.mjs, core/scripts/lib/done-when.mjs, core/.claude/workflows/orchestrate.js, core/.claude/agents/orch-merge.md, core/scripts/lib/slot-procs.mjs, tools/test/
- [x] A8: Sync the installed copies, run every kit check and add the changelog entry — node tools/sync.mjs --target . --apply — CHANGELOG.md, scripts/, .claude/, docs/agent/

## Technical Considerations
- Dependencies: v1.4.0 code from plans 011, 013, 014, 017, 018, 019.
- New files needed: none (tests go into the existing test files).
- Model changes: none.
- Backend / API: none.
- Auth and validation: none.
- Security surface: guard and orchestrator command handling — every change only narrows what is allowed.
- Data / migration: none.
- Project checks: none.

## Out of Scope
- The `[human]` real-project checks of plans 010, 013, 014, 018, 019.
- New orchestrator features.

## Critical Questions
- none

## Execution Notes
Written by the Planner on 2026-10-22 from the orchestrator run's checker findings (minors and nits) and the security
follow-up's open note. Dandan asked for this plan ("yes" to the follow-up plan question).

Builder, 2026-10-22 (branch `feat/020-orchestrator-follow-ups`, worktree `ai-workflow-kit-020`). Decisions taken
without the Human (the conservative option each time):
- **Scope, not extended.** `core/scripts/plan-write-guard.sh` is outside the Read-Write Scope and the scope guard
  refused the edit; no `approved:` was available. The Bash half of the plan-file rule went into
  `core/scripts/lib/guard.mjs` instead (`planWriteDecision`, `node scripts/lib/guard.mjs plan`), and the Bash matcher
  in `core/.claude/settings.json` runs it. `plan-write-guard.sh` itself is unchanged (Edit|Write only). Its line in
  `core/docs/agent/workflow-map.md` (also outside scope) still names only Edit|Write — a one-line docs follow-up.
- **"Done" rule (A2).** `planDoneReason`: Status: finished, or at least one sub-task `[x]` and none open. A plan with
  no sub-task checkbox at all is not done (plan-order would otherwise skip a malformed plan silently); this makes
  take-plan's dependency check slightly stricter than before (it counted zero open as merged even with zero ticked).
- **Dev server (A5).** The builder folders are not slots, so `slot-serve.mjs` cannot start servers for them; the
  preflight passes when the server already answers on the base port (`slots.fePorts`), else runs `slot-serve.mjs`
  once, whose failure (in the main folder it starts nothing) is a FAIL. A project with `commands.dev` must have its
  dev server up before a run; written in the CHANGELOG.
- **agent-eval Bash (A7).** Refusing every Bash agent would refuse every finder; instead an agent with Bash runs only
  on a runner marked `isolated` — `claudeRunner` now runs each case in a scratch copy of its input in the OS temp
  folder (removed after); the test stub is marked isolated (it never runs the agent).
- **Card titles (A7).** A card covers an item only on equal text (case, quotes, spaces aside) — a near-miss title now
  adds the item as unchecked for the Human rather than hiding it.
- **Merge prompt vs agent (A7).** The agent file now follows the prompt (`--no-ff --no-commit`, CHECKS, commit).
- **Test file rename.** `tools/test/guards.test.mjs` uses `NOTES.md` as its out-of-scope file: README.md became a
  hotspot of the kit repo (A3), and hotspots are writable by every plan.

Evidence (worktree `C:/coding projects/Cursor/ai-workflow-kit-020`, after `node tools/sync.mjs --target . --apply`):
- `npm run build` → exit 0 (`PACK_CHECK: ok`); `npm run lint` → exit 0 (3× `LEAK_CHECK: ok`); `npm run test` → exit 0
  (`WORKFLOW_LINK_CHECK: ok`); `npm run e2e` → exit 0 (`ACCEPTANCE_CHECK: ok — 122 checks passed`).
- `node tools/e2e-check.mjs` → exit 0 (`E2E_CHECK: ok — 53 cases passed`); `node tools/drift-check.mjs --target .` →
  exit 0 (`KIT_DRIFT: ok — 0 undeclared differences`).
- `node --test tools/test/*.test.mjs` → exit 0 (`# tests 104`, `# pass 104`, `# fail 0`). New cases: guards
  (`$( … )` write denied on main and in the slot; `if [[ $a > $b ]]` allowed; `(( ))`, backticks, reserved words;
  Bash plan-file guard denies a name-similar new plan, allows reads/ack), plan-order (`parseDependsOn("011 — after
  release 1.3")` → `["011"]`; all-`[x]` plan is done and skipped), agent-eval (inherit → no `--model`; Bash agent
  refused on a non-isolating runner; real runner works in a scratch copy), orchestrator (4 concurrent `note` takers of
  a stale lock: no note lost, lock released), ui-tier (`[ui]` items from Done-when sections only), slot-procs (npm 6
  layout), agent-contracts (merge agent and merge prompt give the same steps).
- `node tools/orchestrator-e2e.mjs` → exit 0 (`ORCHESTRATOR_E2E: ok — 64 cases passed`), including `zeta: a [ui]
  card test that is not an allowed check never reaches the gate…`, `epsilon: a card title covers only the item it
  equals…`, `devfail: the run stops at the preflight with the dev server start failure, before any builder`.
- `node scripts/plan-order.mjs --json` → exit 0; one conflict group, none of its globs is `CHANGELOG.md` or
  `README.md`; `done` lists 011, 013, 014, 017, 018, 019 ("all N sub-task(s) [x]").
- Open: the `[human]` `/review-it feat/<branch>` check; CI on ubuntu and windows (runs on the PR).

Security-review follow-up (2026-10-22):
- HIGH `[[`: the lexer marks quoted/escaped words (`quoted`); only a raw unquoted `[[` in command position opens a
  test, only a raw `]]` closes it; a test left unclosed (separator or end of input) fails closed — every `>` operand
  seen inside it is a write target.
- MEDIUM arithmetic: `arithSubs` collects `$( … )` / backtick substitutions inside `(( … ))` and `$(( … ))` (nested
  too); they are read for writes like any other substitution.
- `orch-state` lock: the CHANGELOG no longer claims two takers never both hold it — the common race is closed, a
  microsecond window remains (no small code fix: a fresh lock moved by mistake cannot be restored atomically).
- Evidence (after `node tools/sync.mjs --target . --apply`): `npm run build` → exit 0 (`PACK_CHECK: ok`); `npm run
  lint` → exit 0 (3× `LEAK_CHECK: ok`); `npm run test` → exit 0 (`WORKFLOW_LINK_CHECK: ok`); `node
  tools/e2e-check.mjs` → exit 0 (`E2E_CHECK: ok — 53 cases passed`); `node tools/drift-check.mjs --target .` → exit 0
  (`KIT_DRIFT: ok — 0 undeclared differences`); `node --test tools/test/*.test.mjs` → exit 0 (`tests 106`, `pass
  106`, `fail 0`); `node tools/orchestrator-e2e.mjs` → exit 0 (`ORCHESTRATOR_E2E: ok — 64 cases passed`). New guards
  tests: `bashWrites: a quoted or escaped [[ is a word, an unclosed [[ fails closed, (( … )) substitutions count` and
  `a quoted [[, an unclosed [[ or a substitution inside (( … )) cannot hide a write on main` (branch-guard denies).

- scope extended: core/docs/agent/workflow-map.md — approved by the Human in chat 2026-10-22 ("approved: core/docs/agent/workflow-map.md"); added the Bash plan-file guard row and corrected the scope-guard row (fail closed, not silent allow).
- scope extended: core/.claude/commands/auto-solve.md — /review-it finding bugs-2 is caused by this plan's A3 (orchestrator Planner decision, the Human approves at PR review)

/review-it round 1 (2026-10-22):
- MAJOR redirect before `[[` (`2>/dev/null [[ a > README.md ]]` opened test mode) → `core/scripts/lib/guard.mjs`
  `bashWrites` tracks `cmdRedir` per simple command (reset in `flush()`); `[[` opens a test only with nothing but
  unquoted reserved words before it and no redirection. Test: `bashWrites: a redirection before [[ makes it a word;
  <( … ) / >( … ) and ${ … } substitutions are read for writes` + `a redirect before [[, a process substitution or a
  ${ … } substitution cannot hide a write on main` (`if [[ $a > $b ]]` still allowed).
- MAJOR `<((…))` read as arithmetic → the lexer reads `<(`/`>(` as a process substitution (one word, `procsub`, its
  body a substitution read for writes; never a file target itself), so `((` after `<`/`>` is never arithmetic. Same
  two tests (`cat <((echo x > README.md))`, `tee >((cat > README.md))`).
- MAJOR unquoted `${…}` copied to the first `}` → new `braceEnd()` (only `${` nests, quotes and `$(…)`/backticks
  skipped whole); the body's `$(…)`/backtick substitutions go through `addSub`. Same two tests
  (`echo ${x:-$(cat > README.md)}`, the backtick form, a nested `${…${…$(…)}}`).
- minor plain `mv` of a plan denied as a new plan → `bashWrites` marks a mv target with its source (`from`);
  `planWriteDecision` allows a target whose source is an existing `plans/*.plan.md` with the same basename. Test:
  `plan-file guard: a plain mv of an existing plan into plans/done/ is a move, not a new plan` (cp, and mv to a new
  name, stay denied).
- minor auto-solve UI gate listed `{{paths.hotspots}}` → `core/.claude/commands/auto-solve.md:80` names the UI text
  file `{{project.i18nFile}}` and says that `(not set)` means only the component/page patterns count (scope extended
  above). No test: a command text; drift-check covers the rendered copy.
- The three new tests fail on the previous `scripts/lib/guard.mjs` (checked: 3 fail, 0 pass) and pass on the fix.
- Evidence (after `node tools/sync.mjs --target . --apply`): `npm run build` → exit 0 (`PACK_CHECK: ok`); `npm run
  lint` → exit 0 (3× `LEAK_CHECK: ok`); `npm run test` → exit 0 (`WORKFLOW_LINK_CHECK: ok`); `node
  tools/e2e-check.mjs` → exit 0 (`E2E_CHECK: ok — 53 cases passed`); `node tools/drift-check.mjs --target .` → exit 0
  (`KIT_DRIFT: ok — 0 undeclared differences`); `node --test tools/test/*.test.mjs` → exit 0 (`tests 109`, `pass
  109`, `fail 0`); `node tools/orchestrator-e2e.mjs` → exit 0 (`ORCHESTRATOR_E2E: ok — 64 cases passed`).

security review round 3 (2026-10-22):
- HIGH `braceEnd()` nested on any `{` after a `$`, even an escaped `\$` (`echo ${x:-\${}; cat > README.md; echo }`
  hid the `cat`), and an unclosed `${` ran to the end (fail open) → `core/scripts/lib/guard.mjs:193` tracks an
  unescaped-`$` flag (cleared after every other character, `$$` toggles it off) and nests only `{` right after one;
  it returns `{ end, closed }`, an unclosed `${` marks the word `unclosed` (`:349`) and `bashWrites` counts that word
  as an unresolved target (`:552`), denied on a guarded folder.
- HIGH a word mixing a process substitution with other text (`tee out<(true)`, `x>(cat)y`) was dropped → the lexer
  stores `procsub` as the substitution's text only when it starts the word (`:374`); `add()` skips only a word that
  is exactly that text and judges any other procsub word unresolved (`:461`). The body is still read for writes.
- Tests: `bashWrites: \\${ and $${ do not nest a ${ … }; an unclosed ${ or a word mixing text and <( … ) is
  unresolved` and `an escaped \\${, an unclosed ${ or a process substitution glued to a word cannot hide a write on
  main` (`tee >(grep x) out.txt` still only `out.txt`; `diff <(sort a) <(sort b)` allowed). Against the previous
  `scripts/lib/guard.mjs` (copied to the OS temp folder): 9 of 13 bashWrites cases fail; all pass on the fix.
- Evidence (after `node tools/sync.mjs --target . --apply`): `npm run build` → exit 0 (`PACK_CHECK: ok`); `npm run
  lint` → exit 0 (3× `LEAK_CHECK: ok`); `npm run test` → exit 0 (`WORKFLOW_LINK_CHECK: ok`); `node
  tools/e2e-check.mjs` → exit 0 (`E2E_CHECK: ok — 53 cases passed`); `node tools/drift-check.mjs --target .` → exit 0
  (`KIT_DRIFT: ok — 0 undeclared differences`); `node --test tools/test/*.test.mjs` → exit 0 (`tests 111`, `pass
  111`, `fail 0`); `node tools/orchestrator-e2e.mjs` → exit 0 (`ORCHESTRATOR_E2E: ok — 64 cases passed`).

strict guard — decided by the Human 2026-10-22 ("strict guard"):
- Why: five review rounds each found a new parsing bypass in `bashWrites`. Strict mode is a fail-closed backstop on
  top of the reader, not a rewrite. `core/scripts/lib/guard.mjs:635-651` (`complexShell`, `shellWrites`: raw-text
  gates that over-include), `:667` (`strictScan`, a narrow grammar), `:998` (`strictShell`), `:1222` (`decide`).
- Rule: a command that is complex (`$(`, backtick, `${`, `<(`, `>(`, `$'`, `$"`, `[[`, `((`, eval, odd quote count)
  and writes (a `>` that is no sink/fd redirect, or a write/shell word) is refused on a guarded folder — the same
  `unresolvedGuarded` test an unresolved target gets — unless every write is a top-level redirect or
  tee/touch/truncate/cp/mv/install/ln/sed -i/perl -i to a plain literal path AND `bashWrites` found that path. Refused
  outright: `$'…'`, `$"…"`, `${…}` other than `${NAME}`, eval, dd, `((…))` with parens/quotes/substitutions, a
  process substitution glued to text, a write inside `$(…)`/backticks/`<(…)`/an unquoted here-document/a nested
  `sh -c`, a command name built at run time, an unclosed quote/construct/here-document. Message:
  `BRANCH_GUARD:/SCOPE_GUARD: this shell command writes and uses $(…)/${…}/backticks/<(…)/[[/((/$'…' — the guard
  cannot verify every target (<why>). Write the file with the Write/Edit tool, or use a plain redirect to a literal
  path.` Not complex: unchanged.
- Tests (`tools/test/guards.test.mjs`): `strictShell: every bypass of the earlier rounds and $'…' quoting is refused;
  plain and read-only commands pass`, `strict guard on main: a complex command that writes is refused unless its only
  writes are plain targets`, `strict guard in a plan folder: a plain target in scope stays allowed, a hidden one is
  refused`. Against 931f14c's `scripts/lib/guard.mjs` (copied to the OS temp folder): 3 of 3 fail; its reader misses 6
  of the 12 bypass forms (three `$'…'` forms, `$(…)` in an unquoted here-document body, a fake `'<<EOF'` here-document,
  `bash -lc`).
- scope extended: core/docs/agent/standards-git.md — strict guard decided by the Human 2026-10-22 (the "strict mode"
  paragraph next to "Shell writes are guarded like Edit/Write").
- Evidence (after `node tools/sync.mjs --target . --apply`): `npm run build` → exit 0 (`PACK_CHECK: ok`); `npm run
  lint` → exit 0 (3× `LEAK_CHECK: ok`); `npm run test` → exit 0 (`WORKFLOW_LINK_CHECK: ok`); `node
  tools/e2e-check.mjs` → exit 0 (`E2E_CHECK: ok — 53 cases passed`); `node tools/drift-check.mjs --target .` → exit 0
  (`KIT_DRIFT: ok — 0 undeclared differences`); `node --test tools/test/*.test.mjs` → exit 0 (`tests 114`, `pass
  114`, `fail 0`); `node tools/orchestrator-e2e.mjs` → exit 0 (`ORCHESTRATOR_E2E: ok — 64 cases passed`).

strict guard round 2 (2026-10-22):
- Why: a security review of 4388a38 found 4 more holes in `strictScan`/`strictShell` — (1, HIGH) shell `-c`
  detection missed `bash -ce`, `-xc`, `-o x -c`; (4) a shell reading its script from /dev/stdin, /dev/fd, `-` or a
  here-document; (3) quoted command words and wrapper prefixes (env, sudo, xargs, nice, timeout …) were skipped;
  (2) `((…))`/`$((…))`/`[[ … ]]` evaluate variable names, and a variable holding `a[$(cmd)]` runs cmd. Fix: strict
  mode is deny by default and narrower, not more parsing — the shell `-c` follower is gone.
- Rules (`core/scripts/lib/guard.mjs`): `:653-667` DENY_WORDS (shells, eval/source/exec/let, dd/sed/perl/awk,
  python*/node/ruby/…, wrappers env/sudo/xargs/find/timeout/nice/nohup/command/builtin/…), `denyWord` (also the write
  commands), `cmdBase` (path, case and .exe stripped); `:861-873` every word of every simple command at every level,
  quoted or not, is checked — the only exception is tee/touch/truncate/cp/mv/install/ln and `sed -i`/`perl -i` as the
  command name of a top-level command (`plainWrite`), `.` and a glob/subscript command name are refused; `:724` `$[…]`;
  `:749` a name inside `((…))`/`$((…))`; `:1004` a name inside `[[ … ]]`; `:924` a process substitution and `:953` any
  `>` redirect but `N>&M` inside a substitution; `:1042-1047` `strictShell` sets aside `<`/`>` read as comparisons, so
  a command that then writes nothing passes (`if [[ $a > $b ]]; then :; fi`, `(( a > b ))`); otherwise the first
  deny reason refuses it. Non-complex commands: unchanged.
- Behaviour change: `if [[ $a > $b ]]; then echo x > src/d.js; fi` in a plan folder and `2>/dev/null [[ a >
  README.md ]]` are now refused (a name in `[[ … ]]` / a `[[` command word holding a glob); tests updated. The commit
  and PR heredoc forms (`git commit -m "$(cat <<'EOF' … EOF)"`, `gh pr create --body "$(cat <<'EOF' … EOF)"`) still
  pass, also with `->`, `<email>`, tee/bash/sed in the text.
- Tests (`tools/test/guards.test.mjs`): `strictShell round 2: shells, wrappers, -c variants, stdin scripts and names
  in arithmetic are refused`, `strict guard round 2 on main: each bypass is denied; the commit/PR heredoc, a
  comparison and a plan write are allowed`. Against 4388a38's installed `scripts/` (copied to the OS temp folder, run
  with GUARDS_ROOT): 4 of the guard tests fail (both new ones and the two updated ones); old `strictShell` refuses 0 of
  the 7 round-2 forms, old `decide` on main denies 4 of 7 (allows `bash -ce`, `sh /dev/stdin <<EOF`, `(( x ))`); new:
  7 of 7.
- Evidence (after `node tools/sync.mjs --target . --apply`): `npm run build` → exit 0 (`PACK_CHECK: ok`); `npm run
  lint` → exit 0 (3× `LEAK_CHECK: ok`); `npm run test` → exit 0 (`WORKFLOW_LINK_CHECK: ok`); `node
  tools/e2e-check.mjs` → exit 0 (`E2E_CHECK: ok — 53 cases passed`); `node tools/drift-check.mjs --target .` → exit 0
  (`KIT_DRIFT: ok — 0 undeclared differences`); `node --test tools/test/*.test.mjs` → exit 0 (`tests 116`, `pass
  116`, `fail 0`); `node tools/orchestrator-e2e.mjs` → exit 0 (`ORCHESTRATOR_E2E: ok — 64 cases passed`).
