# ai-workflow-kit mods — playbook

Three Claude Code mods (capped at three: new features go into one of them) for the Planner-Worker worktree workflow, in any project the kit installs into. Built and validated on Claude Code **2.1.299**; the mods API is early access, so pin that version or newer.

| Mod | What you get | Commands |
| --- | --- | --- |
| **fleet** | One registry of every live session across `wt-N` slots, with resume lines; a slot lock that stops a branch switch under another live session; port janitor; a status line with cache countdown, context %, 5h/7d limits with the time each window resets (and a notice in every session when the 5-hour window refreshes), ≈cost and git state; a handoff-and-restart button; a **Pull main** button (main: fast-forward; slot: merge `origin/main`, aborted on conflict); **quick replies** — a `[ ⏎ ]` button inline after each reply the answer marks on purpose (`text` ⏎; fleet adds a short rule to the system prompt), which fills the prompt box, unsent; nothing is guessed from wording; an **orchestrator run** chip with a % that opens one line per plan; phone push (optional) | `/fleet` `/ports` `/health` `/handoff` |
| **guards** | The shell guards in-process (no bash/python/node per edit): main-branch rule, plan Read-Write Scope, kit-owned files, new-plan similarity; hard deny on `git push --no-verify`; role line injected at start; an **Approve** button for the `approved: <path>` protocol | `/approve <path>` `/role` |
| **ship-pilot** | The branch's PR, checks, mergeability and "behind main" as a band; `merge / later / open-pr-only` as buttons that send the literal reply to `/ship`'s gate; a plan progress bar from Atomic Sub-tasks; tick a sub-task from the phone | `/pr` `/merge` `/progress` `/check A3` |

Everything a mod decides is also available as **command text**, so Remote Control from the phone works; the bands, buttons and status line draw only in the terminal and the Desktop app on the PC.

## Install

The kit repository is the marketplace (`.claude-plugin/marketplace.json` at its root, name `ai-workflow-kit-mods`).
A project turns mods on with `mods.enabled` in its `kit.config.json` (e.g. `["fleet", "guards", "ship-pilot"]`);
`kit-install` / `kit-sync` then write the marketplace (with `autoUpdate`) and one `enabledPlugins` entry per mod into
the project's `.claude/settings.json`. Opening the project and accepting the folder's trust dialog registers the
marketplace and loads the mods. By hand, from any folder:

```
claude plugin marketplace add WDD-CODER/ai-workflow-kit
claude plugin install fleet@ai-workflow-kit-mods
```

A private kit repository needs the machine's git credentials (`gh auth login`, then `gh auth setup-git`). Cloud
sessions load no mods from a repository's settings.

**Updates:** every mod change bumps its `plugin.json` `version` and ships in a kit release; `autoUpdate` brings it to
each machine at its next session start. By hand: `claude plugin marketplace update ai-workflow-kit-mods`, then
`claude plugin update <mod>@ai-workflow-kit-mods`.

While developing, `claude --plugin-dir <folder>` loads one from disk and reloads it on save; `/reload-plugins` re-reads an installed one.

Also recommended, as-is, from Anthropic: `claude plugin marketplace add anthropics/claude-plugins-community` then `claude plugin install next-steps@claude-community` (suggested next prompts above the input; costs about one short reply per turn).

### Options (`/config`, under each mod)

| Mod | Option | Default | Note |
| --- | --- | --- | --- |
| fleet | Phone push URL | empty | An `https://ntfy.sh/<private-topic>` or Pushover URL. Empty = no push. Stored in secure storage. |
| fleet | Cache TTL (minutes) | 60 | 60 on a subscription within plan usage, 5 on an API key. |
| fleet | Heartbeat (seconds) | 30 | Registry + git facts refresh. |
| fleet | Stop slot ports on exit | off | Runs `scripts/slot-stop.mjs` when the session ends in a slot (never while `/remote` is live). |
| fleet | Context warning (%) | 70 | When the health band appears. |
| fleet | Front-end / back-end port base | 0 / 0 | Slot N = base + N. 0 = the bases the kit rendered into `scripts/lib/slot.mjs` (`slots.fePorts` / `slots.bePorts`), else `kit.config.json`; none found = the port features stay off. |
| guards | Session-state chars injected | 1500 | 0 turns the injection off. |
| guards | Scope guard fails open | on | Same as today's shell guard. Turn off to fail closed. |
| guards | Append-only hotspots | empty | Comma-separated; every plan may append to these. Empty = the list the kit rendered into `scripts/scope-check.mjs` (`paths.hotspots`, `project.i18nFile`, the stack pack's defaults). |
| ship-pilot | PR poll (seconds) | 60 | 0 = only on `/pr` and after each turn. |
| ship-pilot | Main branch | main | |
| ship-pilot | Phone push URL | empty | Same style as fleet's; receives "checks green/failed". |

## Daily use

**Start of day / after a crash** — `/fleet` (`/fleet forget <id>` drops a stale row that keeps a slot locked):

```
slot  plan  branch                         state      ports       session
main  -     main                           live       5100/6100   3f1c0a92 (this)
wt-1  041   feat/041-toggle-chips          live       5101/6101   9b2e7d10
wt-2  040   feat/040-cook-view             idle 14m   5102/6102   77ac01de
wt-3  -     (detached)                     no session -           -

Resume:
  cd "<repo>-wt-1" && claude --resume 9b2e7d10-…
```

**While working** — the status line under the prompt reads like `cache 42m · ctx 61% · 5h 72% ↻14:30 (2h10m) · wk 64% · ≈$3.10 · feat/041-x · 2 dirty · 1 unpushed`. On the PC a band appears when the cache is about to lapse, context passes 70 % or a limit passes 80 %, with `Keep warm · Compact · Handoff & restart · Keep going`. From the phone: `/health` gives the same facts and a one-line advice.

**Handoff** — `/handoff` (or the button) writes `.claude/sessions/handoff-<branch>.md` (untracked) with `## Session Summary / ## Open Signals / ## Next Steps` and the HEAD hash, clears the conversation and resumes from that file as your first prompt. Use it when `/health` says context is high or the cache went cold.

**Scope** — when the Worker needs a file outside the plan's scope you see the familiar `SCOPE_GUARD … wait for "approved: <path>"` message. Reply `approved: src/x.ts` as before, **or** `/approve src/x.ts`, **or** press *Approve* in the band. All three append the path to the plan's ```` ```scope ```` block.

**PR** — once a PR exists for the branch the band shows `PR #<n> · 7/9 checks · 1 running · mergeable · 2 behind main` and `/pr` prints the check list. When checks finish you get a toast, a terminal notification and (with ship-pilot's own push URL) a phone push. The `merge` button, or `/merge`, sends the literal word `merge` as your reply — `/ship`'s gate, brain capture and the slot-safe merge recipe run exactly as today. It refuses while a check fails or runs, or the PR is a draft or conflicting.

**Plan progress** — `/progress`:

```
Plan NNN · ████░░░░░░ 40% · 2/5 · now: A2 Wire filter panel
  [x] A1: Chip component
  [ ] A2: Wire filter panel
  …
Done when:
  [auto] `npm run build` → exit 0
  [human] Filter panel shows chips on mobile
```

The "now" step follows the model's own task list (TaskUpdate/TodoWrite). `/check A2` ticks that sub-task in the plan file (slot only, never `.claude/todo.md`); it rides the next commit. Done-when validation still goes through `done` / `/done` / `/ship Y`.

**Orchestrator run** — while an `/orchestrate` run is live in this checkout, fleet's dock shows `run <name> NN%`. Press it (or `r`) for a panel under the dock with one line per plan, its stage in plain words and how long it has been there (`506 · checks (gate 506 · 20 s ago) · 3 min`), what the current agent is doing (from the workflow's `journal.jsonl`), and the run's `orch-state.mjs watch` line last. A `STUCK: …` line turns the chip and the panel to the warning colour. The % counts each plan by its stage (building ¼ · checks ½ · reviewers ¾ · merging 0.9 · merged or parked 1). Fleet only reads `.claude/orchestrator-runs/*/status.json` and the journal and runs the `watch` command: no model call, nothing written to the run. It refreshes at each answer's end and every 30 s while a run is live (also for 10 min after a Workflow call, so a run that is just starting shows up); no timer runs otherwise.

**Ports** — `/ports` lists the main and slot ports (base + 0…3) with who listens; stop this slot with `node scripts/slot-stop.mjs` as before.

## Phone (Remote Control)

Works: every `/command` above, the deny messages, the `approved:` reply, `merge` reply, the push notifications. Does not draw: bands, buttons, status line (terminal/Desktop only). A cloud session (claude.ai/code) loads no user mods at all.

## Checks before you trust it

```
claude plugin validate <mod>     # manifest + every $ call the module makes
claude plugin test <mod>         # every *.test.ts of the mod
tsc -p <mod>                     # after the first load laid .claude-plugin/types/
```

Turn everything off for one session with `claude --safe-mode`; disable one mod in `/plugin`.

## Known limits

- Windows is untested by the author's cloud session (Linux). `/ports` uses `netstat -ano` on Windows, `ss`/`netstat` elsewhere; disk warning uses PowerShell on Windows.
- `$.ui.notify` reaches iTerm2/kitty/Ghostty/terminal bell only. The phone needs the push URL.
- The slot lock treats a session as live for 2 minutes after its last heartbeat; `/fleet forget <id>` ends that early.
- A plan's Read-Write Scope is pinned when the session first sees the plan; the only way to widen it in-session is `approved:` / `/approve` / the button. An edit to the scope block itself is denied.
- guards' glob matcher covers `**`, `*`, `?`, `{a,b}` and dot files; an exotic pattern denies rather than allows, and `/ship`'s `scope-check.mjs` stays the backstop.
- The human-only commands (`/handoff`, `/approve`, `/merge`, `/check`) refuse `claude -p` runs too (origin `sdk`), by design.
