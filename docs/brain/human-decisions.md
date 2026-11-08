# Human decisions — pilot mined from the kit's planning chats (2026-10-21 → 2026-11-07)

Purpose: raw material for the kit "brain" and the future advisor agent. Every row is something the Human decided,
corrected, or ruled. Claude's own suggestions are listed only in the `suggested` column, never as decisions.
Read-only for the workflow: `/plan` and the runner read it, nothing writes it.

Evidence tag per row: `[H]` = the Human's own turn was read; `[S]` = taken from a chat summary (the wording is the
summary's). Plan numbers (a bare `NNN` below) and file names are as the chats cite them.

Status: `in force` / `superseded by D<n>` / `frozen` (by D29, until 090's bar is met) / `open`.

086, 087 and 088 are done (merged in the goal run, after this pilot was mined); the tables say so where they name
them. This is the public copy: names, chat titles, the app project's name and non-English quotes are left out.

## 1. Decisions (chronological)

| id | date | situation | suggested (Claude / agent) | the Human decided | reason (own words or gist) | kind | status | ev |
|---|---|---|---|---|---|---|---|---|
| D01 | 10-21 | Where orchestrator merges | per-run integration branch | Yes: dedicated per-run branch; the Human validates and merges into `main` | keep human control of main | git-safety | in force (D29.2: merge only on literal `merge`) | [S] |
| D02 | 10-21 | UI validation method | scripted e2e + screenshots, browser agents only on failure, one screenshot grid at end | Yes | token cost must stay reasonable | design | partly superseded by D12 | [S] |
| D03 | 10-21 | Model routing base (012) | `models` key: mechanical=haiku, analysis=sonnet, judgment=inherit; shared by both workflows | "12 ok!" | cheapest model that still delivers; never at the expense of code quality | model-choice | in force; judgment pinned to Opus 11-03; reviewer model by A/B (D29.1, done by 087) | [H] |
| D04 | 10-21 | Implementer escalation | Sonnet first, Opus after **two** failures | Sonnet first, Opus after **one** failure; fresh Opus works from a written summary, not the transcript | one failure is enough signal | model-choice | in force; D29 adds: escalate from a clean base, not patch the failed diff (done by 086) | [H] |
| D05 | 10-21 | What counts as a "failure" | first reviewer finding → back to Sonnet; escalate when tests still fail, Sonnet returns `ESCALATE`, or reviewer finds a second time | "take it! approve execute!" | — | process-order | in force | [H] |
| D06 | 10-21 | Mods (fleet, guards, ship-pilot) | move into kit as plugin marketplace; 5-h reset time in fleet | Yes; cloud sessions out of scope; declined phone push and cross-session dedup | mods assist the human at their own machines | scope | in force | [S] |
| D07 | 10-21 | Where mods live in the kit | `mods/` (not `layers/`, which auto-installs) | Accepted the catch | — | scope | in force | [S] |
| D08 | 10-26 | Builder invented a "save changes?" modal nobody asked for | decision log: builder logs unasked choices, human grades ✓/✗, repeats → rules, lessons → kit PR; runs automatically at end of `/ship` and `/orchestrate` | Yes, automatic, no manual command | agents must not make product choices silently | design | in force (022/025 → 030) | [S] |
| D09 | 10-26 | Planning layer above the orchestrator | — (the Human's design) | Planner builds one master plan, splits into mid-sized mini plans; the Human approves the split table before expansion; splitting done by the main Planner session; `/orchestrate` stays independent; size check only flags, never auto-splits; ~3–8 tasks, ≤12 files, to calibrate | too big = context cost, too small = overhead; approve the cheap thing (a table) before the expensive one | process-order | in force as design; not built | [S] |
| D10 | 10-25/27 | Validation cards too complex | 3 layouts; 7 speed-up ideas | Plain-text card, one copy-ready value per line; copy-paste in English, the app's language only for literal app/DB values; CLI text only; ideas 1+2 now (page-by-page replies, one-line page opener), rest → backlog 024 | cards are read in a terminal; the Human's reading time is the bottleneck | human-time | in force; card UX frozen (D29.7) | [S] |
| D11 | 10-28 | Orchestrator learning from run to run | lessons written by scripts from `status.json`, never by agents; each role reads short capped lessons (1–3 % overhead) | Yes; 029 | agents writing their own memory costs 10–20 % and is self-reported | learning | in force; strengthened by 065–067 (code-derived facts only, stable dedup keys) | [S] |
| D12 | 10-29 | Design/UX capability | design reviewer reads builders' screenshots (no live browser); only DESIGN.md violations return to the builder; other findings → report for grading | Yes | cost; keep design judgment with the human | design | frozen (D29.7) | [S] |
| D13 | 10-29 | Stuck run (merge worktree had no packages, env check looked at another folder) | app-project session: bug report only, no fix; fold the fix into the running kit plan, 029 | Yes, and caught Claude twice misreading an attached package-manager plan as the bug report | avoid file conflicts between sessions; kit works in chronological order, same files → same plan | git-safety | in force (rule R7) | [S] |
| D14 | 10-30 | Where run evidence and lessons live | — | A dedicated database for run evidence; kit git repo for lessons and fixes; kit stays public for now; loop semi-automatic first (the Human approves each stage), automatic later | prove the loop is worth it before going private / automatic | data-env | in force | [H] |
| D15 | 10-31 | Switch to a ready-made runner? | keep the kit; the gap is checker quality, not the runner | Accepted | — | architecture | partly superseded by D29 (keep guards/scripts/contract, drop the workflow runtime) | [S] |
| D16 | 11-01 | Automate the human relay (advisor agent) | subagent advisor now, or log Q/A for a month first | Not yet: keep up-front questions and full involvement; log every question + answer in a fixed format; revisit after ~1 month | needs real data to know which decisions an agent can be trusted with | autonomy | in force (076/077 drafted) | [S] |
| D17 | 11-01 | Preflight blocked: main-folder server not running | start it by hand now, fix preflight in the kit later | Start by hand now; investigation-only hand-off first (read-only, mask DB hostnames) | main-folder server is for manual post-merge checks only, not an orchestrator prerequisite | data-env | superseded by D18 | [H] |
| D18 | 11-02 | Same blocker, third run | 058 | Preflight checks, starts what is missing, carries on; **never** a stop that only asks for a server; backend only when a plan has `[auto:main]`; `dev:local` default, `remote` keyword for `dev:remote`; merge 057 before 058 | late stops cost the most time and tokens | data-env | in force (goal step 3) | [H] |
| D19 | 11-02 | Learning loop beyond the orchestrator | 6 options; recommended stage 1 = grade every `/ship` decision + checker pipeline on REGULAR ship behind a switch | "I'm with your recommendation" — stage 1 now, stage 2 after a real app-project run | controlled test on one plan before more data | learning | under revision by 089 (`/ship` diet) | [H] |
| D20 | 11-02 | `/ship fast` after 057 | conflicts with ADR 0007; supersede with a sensitive-path exception | Yes: fast stays fast; ADR 0015 | tokens and time | cost-vs-autonomy | refined by D29.3 (FAST = build+lint, REGULAR adds tests) | [S] |
| D21 | 11-02 | Six fix plans (059–064) after first live run | run them autonomously | **No**: write them, don't run; validate manually first | cost; see the second run first | cost-vs-autonomy | in force | [S] |
| D22 | 11-02 | Agent flagged a DB as production risk (twice) | caution | Corrected: it is the local dev DB, safe | the Human knows the environment | data-env | in force (rule: ask which DB before treating as prod) | [S] |
| D23 | 11-02 | Temp CI commit on PR 81 | — | `git revert`, never reset/force-push | shared history | git-safety | in force | [S] |
| D24 | 11-02 | Trusted kit scripts for checks (056) | allowlist vs denylist | Allowlist | — | security | in force | [S] |
| D25 | 11-02 | Pause before 047/048? | pause after 046 to gather real run data | Yes | later plans depend on evidence, not assumptions | process-order | in force (now frozen) | [S] |
| D26 | 11-03 | Cards all pass but design still wrong (combobox nested in client container) | notes sorter agent | `notes:` as third reply, free text; dedicated fresh-context Sonnet agent; one approval of its table; it never merges; origin order plan → decision → rule → pattern → missing rule; finish the running app-project run first | the Human will not break cards apart by hand; wrong lessons (D1/D7 cases) must not reach the wrong role | learning | 071; frozen (D29.7) | [H] |
| D27 | 11-03 | e2e-check 12.6 of 15 min | raise `gateTimeoutMin` | 20 (PR 95) | — | data-env | in force | [S] |
| D28 | 11-03 | Two plans parked on plan-file merge conflicts | merge-based repair vs full rebuild | Merge-based repair, in separate steps; keep builder code, take main's plan file; proceed without deleting local branches when the guard denied `branch -D` | preserve paid work; no risky combined commands | git-safety | in force | [S] |
| D29 | 11-05/06 | A week in: runs slow, expensive, failing on technical issues | freeze + reliability list; later: rebuild as one script | **Freeze** new capabilities until 11-15; kit plans via `/take-plan` + `/ship`, not `/orchestrate`; fresh-context Opus reviewer sees only plan, diff, tests, decisions; decision rule (take the recommended option if reversible and in scope, log it; stop only on listed conditions); scorecard per run. **11-06:** rebuild the orchestrator as one script (builder + reviewer as `claude -p`, everything else code); **delete** the replaced runtime and agents; (1) reviewer model by blinded A/B, never by tier; (2) merge only on literal `merge`; (3) FAST = build+lint, REGULAR adds tests; (4) `--concurrency 1` until 10 plans merged at ≥ 90 %; (5) delete, not freeze; (6) readiness = script lint + decision rule, no agent; (7) learning loop, brain, grading, readiness kinds, card UX frozen until 090's bar; goal order 086 → 087 → 058 → 088 → 089 → 090 → 084; 085 superseded by 088 | "the work must start bearing fruit soon"; the orchestrator's cost is the workflow runtime (every state write is a model call) | architecture | in force; 086, 087, 088 done | [H] [S] |
| D30 | 11-04 | Karpathy-style benchmark + single-agent prompt loop | wait until the app-project run is validated, then plan it, starting with the code reviewer | no answer recorded | — | learning | open (and frozen by D29.7) | [S] |

## 2. Standing rules distilled from the decisions (the advisor's rulebook)

Each rule names the decisions it rests on. A rule with one source is a candidate, not a rule, until it recurs.

- R1 Code quality beats token savings. Cheapest model that still delivers; stronger model wherever evaluation matters. (D03, D04, memory 10-21)
- R2 The builder never judges its own work. The reviewer runs in a fresh context and sees only the plan, the diff, the test output and the decision list. (D26, D29)
- R3 Never stop a run only to ask the human for something a script can do. Ask everything up front, then run to the end. (D17 → D18, memory 10-26)
- R4 Agents do not make product or design choices alone. An unstated choice is logged as a decision or raised as a question; a written DESIGN.md rule is the only thing that bounces work back to the builder. (D08, D12, D26)
- R5 Facts are written by scripts from state, never by agents: lessons, run facts, counts, decisions. (D11, 065–067, D29)
- R6 The kit is the single source. Kit changes go kit plan → PR → release → `kit-sync`; never patch an installed copy; project-specific things stay project-owned. (D13, PR 81 rules, memory 10-30)
- R7 Git safety: revert, never reset or force-push in a shared checkout; never bypass a guard; one worktree per plan; route work to the worktree by the files it touches; a fix that overlaps a running plan is folded into that plan. (D13, D23, D28)
- R8 Human reading time is the scarcest resource. Cards are plain CLI text with copy-ready values; anything pasted to an agent is English; the app's language only for literal values; every agent-facing message is labelled with its target session. (D10, corrections 11-03)
- R9 Verify before acting. Agent reports are hypotheses; check file and line claims in the code; say what was not verified. (D15 audit, PR 81, 11-06 audit Step 0 rules)
- R10 Decision rule for autonomy: reversible and inside scope → take the recommended option and log it; irreversible, out of scope, or a failing test outside scope → stop. (D29)
- R11 Measure, don't assume: model and prompt choices come from an eval A/B with a held-out split, not from a tier or a preference. (D29.1, orchestrator-vs-evidence)
- R12 Semi-automatic before automatic: validate by hand first, gather real run data before building the next layer (advisor, 047/048, autonomous fix runs). (D14, D16, D21, D25)
- R13 Reliability before capability; subtraction over addition when the base is unstable. (D29)
- R14 Narrow exemptions with a written reason over blanket ones; allowlist over denylist. (D24, 11-05 guard decision)

## 3. Failure patterns (each is a lesson or an eval case)

| id | pattern | seen | owner role | status |
|---|---|---|---|---|
| F01 | Preflight stops the run to ask for a dev server | 3 runs (11-01, 11-02 ×2) | preflight script | fixed by 058 (pending) |
| F02 | Merge worktree without packages; env check inspects another folder → endless rebuilds on Opus/Sonnet | run-497-419 | orchestrator script | folded into 029; retry bug 068 |
| F03 | Plans parked on plan-file merge conflicts after main was edited | run-513-516b | orchestrator script | repaired by hand (D28) |
| F04 | All cards pass, design still wrong (nested combobox) | test-514-515 | builder / planner | notes sorter (071) |
| F05 | Builder invents unrequested UX (save-changes modal) | 28-plan run | builder | decision log (030) |
| F06 | Lessons attributed to the wrong role (D1 → builder; D7 marked reversed; gate failure lessons to all checkers) | test-514-515, run 512/422 | lesson writer | 065–067, 071 origin order |
| F07 | Report prints "Decisions: none" / "ask: 0" with 16 decisions in status.json | run-513-516c | report script | 11-05 reliability plan (e) |
| F08 | Checkers read the builder's own notes (confirmation bias); escalated Opus patches the failed diff instead of a clean start | kit code | orchestrator | done by 086 / 088 (A1, A2) |
| F09 | Opus reviewer worse than Sonnet on the kit baseline (recall 0.19 vs 0.27) at 3× cost | BASELINE.md | reviewer | done by 087 A/B |
| F10 | PII guard caught only at commit for lines the builder (not the plan) writes | run-513 line 205 | guard | 11-05 plan (a); run guards at write time |
| F11 | Chat Claude misidentified an attached document as the bug report (twice) | 10-29 | chat advisor | rule R9 |
| F12 | Chat Claude advised running a plan (035) that was already merged; `Status:` header unreliable | 11-01 | chat advisor | check `git log --merges`, not the status line |
| F13 | Chat Claude proposed an action but sent a report-only prompt | 11-02 | chat advisor | rule: prompt matches the proposed action |
| F14 | Prompts written in the app's language; replies not labelled by target session; verification commands without exact directory | 11-03 | chat advisor | rule R8 |
| F15 | A session tried to bypass hooks/guards to force an edit | 11-02 | builder | rule R7 (rejected) |

## 4. Test set for a future advisor (question → the Human's actual answer)

Format follows 076's row: question, kind, the default/suggestion, whether it was taken, the answer. Replay these against
an advisor and count matches per kind; delegate a kind only when its match rate is high.

| # | question (as asked) | kind | suggestion | taken? | the Human's answer |
|---|---|---|---|---|---|
| Q01 | Escalate implementer after how many failures? | model-choice | 2 | no → 1 | one failure |
| Q02 | What counts as a failure for escalation? | process-order | reviewer finding first back to Sonnet; escalate on tests/ESCALATE/second finding | yes | "take it" |
| Q03 | 012 base shared by both workflows? | scope | yes | yes | "12 ok" |
| Q04 | Run the six fix plans autonomously now? | cost-vs-autonomy | yes | no | write only, validate by hand first |
| Q05 | Keep `/ship fast` fast after 057? | cost-vs-autonomy | supersede ADR 0007 | yes | yes, ADR 0015 |
| Q06 | Is this DB a production risk? | data-env | treat as prod | no | local dev DB, safe |
| Q07 | Remove temp CI commit how? | git-safety | revert | yes | revert, not reset |
| Q08 | Allowlist or denylist for trusted scripts? | security | allowlist | yes | allowlist |
| Q09 | Pause before 047/048 for real data? | process-order | pause | yes | pause |
| Q10 | Fix the stuck run in the app project or in the kit worktree? | git-safety | report only, fold into 029 | yes | report only; fold into 029 |
| Q11 | Which learning-loop package to plan? | learning | stage 1 (grade + checkers behind switch) | yes | "with your recommendation" |
| Q12 | Build the advisor now or in a month? | autonomy | log now, build later | yes, narrower | keep up-front questions; log; revisit in a month |
| Q13 | Freeze, continue waves, or stop the orchestrator? | architecture | freeze | yes | freeze until 11-15 |
| Q14 | Ready-made harness or rebuild as a script? | architecture | rebuild as one script, delete the rest | yes | rebuild; delete, not freeze |
| Q15 | Reviewer on Opus (the Human's wish) or by A/B? | model-choice | by A/B | yes | by A/B, never by tier |
| Q16 | Merge 057 before 058? | process-order | yes | yes | yes |
| Q17 | Start main-folder server by hand or change the kit now? | data-env | by hand now, kit fix later | yes | by hand; then 058 |
| Q18 | Raise `gateTimeoutMin`? | data-env | 20 | yes | 20 |
| Q19 | Repair parked plans by merge or rebuild? | git-safety | merge-based | yes | merge-based, separated steps |
| Q20 | Design reviewer: live browser or builders' screenshots? | design | screenshots | yes | screenshots |

Pattern in the 20 rows: the Human takes the recommended option 17 times; the 3 deviations (Q01, Q04, Q06) all pull
toward **less cost, less autonomy, or the Human's own knowledge of the environment**. A first advisor rule set: never
recommend more autonomy or more spend than the human asked for; never classify an environment (DB, folder) as production
without asking.

## 5. Gaps this pilot cannot fill

- Execution side: what agents actually did lives in Claude Code session transcripts and run `status.json` files, not in
  these chats.
- Verdicts: most rows have no "was it right" yet. D17 (start by hand) was wrong by D18; D15 (keep runner) was half wrong by D29.
- `[S]` rows carry the summary's wording; a line that matters should be re-read in its chat before it becomes a brain row.
