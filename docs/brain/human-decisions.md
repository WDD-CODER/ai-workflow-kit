# Human decisions — mined from the planning chats of the kit and the app project (2026-09-30 → 2026-11-08)

Purpose: raw material for the kit "brain" and the future advisor agent. Every row is something the Human decided,
corrected, or ruled. Claude's own suggestions are listed only in the `suggested` column, never as decisions.
Read-only for the workflow: `/plan` and the runner read it, nothing writes it.

Evidence tag per row: `[H]` = the Human's own turn was read; `[S]` = taken from a chat summary (the wording is the
summary's). Plan numbers (a bare `NNN` below) and file names are as the chats cite them.

Status: `in force` / `in force (app)` (an app-project rule: it answers app questions, never kit ones) / `superseded by D<n>` / `frozen` (by D29, until 090's bar is met) / `done` (a one-time decision already carried out: test material, never a default) / `open`.

`taken?`: did the Human take the suggestion — `yes` / `no` / `narrower` / `no answer`; `—` = nothing was suggested, the decision was his own; `n/r` = not recorded (D01–D30, see section 4). The last word of `ev` on D31 and later is the row's id in the mining files (`KD` = this project's chats, `FD` = the app project's chats).

086, 087 and 088 are done (merged in the goal run, after this pilot was mined); the tables say so where they name
them. This is the public copy: names, chat titles, the app project's name and non-English quotes are left out.

## 1. Decisions (chronological)

| id | date | situation | suggested (Claude / agent) | the Human decided | reason (own words or gist) | kind | taken? | status | ev |
|---|---|---|---|---|---|---|---|---|---|
| D01 | 10-21 | Where orchestrator merges | per-run integration branch | Yes: dedicated per-run branch; the Human validates and merges into `main` | keep human control of main | git-safety | n/r | in force (D29.2: merge only on literal `merge`) | [S] |
| D02 | 10-21 | UI validation method | scripted e2e + screenshots, browser agents only on failure, one screenshot grid at end | Yes | token cost must stay reasonable | design | n/r | partly superseded by D12 | [S] |
| D03 | 10-21 | Model routing base (012) | `models` key: mechanical=haiku, analysis=sonnet, judgment=inherit; shared by both workflows | "12 ok!" | cheapest model that still delivers; never at the expense of code quality | model-choice | n/r | in force; judgment pinned to Opus 11-03; reviewer model by A/B (D29.1, done by 087) | [H] |
| D04 | 10-21 | Implementer escalation | Sonnet first, Opus after **two** failures | Sonnet first, Opus after **one** failure; fresh Opus works from a written summary, not the transcript | one failure is enough signal | model-choice | n/r | in force; D29 adds: escalate from a clean base, not patch the failed diff (done by 086) | [H] |
| D05 | 10-21 | What counts as a "failure" | first reviewer finding → back to Sonnet; escalate when tests still fail, Sonnet returns `ESCALATE`, or reviewer finds a second time | "take it! approve execute!" | — | process-order | n/r | in force | [H] |
| D06 | 10-21 | Mods (fleet, guards, ship-pilot) | move into kit as plugin marketplace; 5-h reset time in fleet | Yes; cloud sessions out of scope; declined phone push and cross-session dedup | mods assist the human at their own machines | scope | n/r | in force | [S] |
| D07 | 10-21 | Where mods live in the kit | `mods/` (not `layers/`, which auto-installs) | Accepted the catch | — | scope | n/r | in force | [S] |
| D08 | 10-26 | Builder invented a "save changes?" modal nobody asked for | decision log: builder logs unasked choices, human grades ✓/✗, repeats → rules, lessons → kit PR; runs automatically at end of `/ship` and `/orchestrate` | Yes, automatic, no manual command | agents must not make product choices silently | design | n/r | in force (022/025 → 030) | [S] |
| D09 | 10-26 | Planning layer above the orchestrator | — (the Human's design) | Planner builds one master plan, splits into mid-sized mini plans; the Human approves the split table before expansion; splitting done by the main Planner session; `/orchestrate` stays independent; size check only flags, never auto-splits; ~3–8 tasks, ≤12 files, to calibrate | too big = context cost, too small = overhead; approve the cheap thing (a table) before the expensive one | process-order | n/r | in force as design; not built | [S] |
| D10 | 10-25/27 | Validation cards too complex | 3 layouts; 7 speed-up ideas | Plain-text card, one copy-ready value per line; copy-paste in English, the app's language only for literal app/DB values; CLI text only; ideas 1+2 now (page-by-page replies, one-line page opener), rest → backlog 024 | cards are read in a terminal; the Human's reading time is the bottleneck | human-time | n/r | in force; card UX frozen (D29.7) | [S] |
| D11 | 10-28 | Orchestrator learning from run to run | lessons written by scripts from `status.json`, never by agents; each role reads short capped lessons (1–3 % overhead) | Yes; 029 | agents writing their own memory costs 10–20 % and is self-reported | learning | n/r | in force; strengthened by 065–067 (code-derived facts only, stable dedup keys) | [S] |
| D12 | 10-29 | Design/UX capability | design reviewer reads builders' screenshots (no live browser); only DESIGN.md violations return to the builder; other findings → report for grading | Yes | cost; keep design judgment with the human | design | n/r | frozen (D29.7) | [S] |
| D13 | 10-29 | Stuck run (merge worktree had no packages, env check looked at another folder) | app-project session: bug report only, no fix; fold the fix into the running kit plan, 029 | Yes, and caught Claude twice misreading an attached package-manager plan as the bug report | avoid file conflicts between sessions; kit works in chronological order, same files → same plan | git-safety | n/r | in force (rule R7) | [S] |
| D14 | 10-30 | Where run evidence and lessons live | — | A dedicated database for run evidence; kit git repo for lessons and fixes; kit stays public for now; loop semi-automatic first (the Human approves each stage), automatic later | prove the loop is worth it before going private / automatic | data-env | n/r | in force | [H] |
| D15 | 10-31 | Switch to a ready-made runner? | keep the kit; the gap is checker quality, not the runner | Accepted | — | architecture | n/r | partly superseded by D29 (keep guards/scripts/contract, drop the workflow runtime) | [S] |
| D16 | 11-01 | Automate the human relay (advisor agent) | subagent advisor now, or log Q/A for a month first | Not yet: keep up-front questions and full involvement; log every question + answer in a fixed format; revisit after ~1 month | needs real data to know which decisions an agent can be trusted with | autonomy | n/r | superseded by D234 (data mined into D31–D233) | [S] |
| D17 | 11-01 | Preflight blocked: main-folder server not running | start it by hand now, fix preflight in the kit later | Start by hand now; investigation-only hand-off first (read-only, mask DB hostnames) | main-folder server is for manual post-merge checks only, not an orchestrator prerequisite | data-env | n/r | superseded by D18 | [H] |
| D18 | 11-02 | Same blocker, third run | 058 | Preflight checks, starts what is missing, carries on; **never** a stop that only asks for a server; backend only when a plan has `[auto:main]`; `dev:local` default, `remote` keyword for `dev:remote`; merge 057 before 058 | late stops cost the most time and tokens | data-env | n/r | in force (goal step 3) | [H] |
| D19 | 11-02 | Learning loop beyond the orchestrator | 6 options; recommended stage 1 = grade every `/ship` decision + checker pipeline on REGULAR ship behind a switch | "I'm with your recommendation" — stage 1 now, stage 2 after a real app-project run | controlled test on one plan before more data | learning | n/r | under revision by 089 (`/ship` diet) | [H] |
| D20 | 11-02 | `/ship fast` after 057 | conflicts with ADR 0007; supersede with a sensitive-path exception | Yes: fast stays fast; ADR 0015 | tokens and time | cost-vs-autonomy | n/r | refined by D29.3 (FAST = build+lint, REGULAR adds tests) | [S] |
| D21 | 11-02 | Six fix plans (059–064) after first live run | run them autonomously | **No**: write them, don't run; validate manually first | cost; see the second run first | cost-vs-autonomy | n/r | in force | [S] |
| D22 | 11-02 | Agent flagged a DB as production risk (twice) | caution | Corrected: it is the local dev DB, safe | the Human knows the environment | data-env | n/r | in force (rule: ask which DB before treating as prod) | [S] |
| D23 | 11-02 | Temp CI commit on PR 81 | — | `git revert`, never reset/force-push | shared history | git-safety | n/r | in force | [S] |
| D24 | 11-02 | Trusted kit scripts for checks (056) | allowlist vs denylist | Allowlist | — | security | n/r | in force | [S] |
| D25 | 11-02 | Pause before 047/048? | pause after 046 to gather real run data | Yes | later plans depend on evidence, not assumptions | process-order | n/r | in force (now frozen) | [S] |
| D26 | 11-03 | Cards all pass but design still wrong (combobox nested in client container) | notes sorter agent | `notes:` as third reply, free text; dedicated fresh-context Sonnet agent; one approval of its table; it never merges; origin order plan → decision → rule → pattern → missing rule; finish the running app-project run first | the Human will not break cards apart by hand; wrong lessons (D1/D7 cases) must not reach the wrong role | learning | n/r | 071; frozen (D29.7) | [H] |
| D27 | 11-03 | e2e-check 12.6 of 15 min | raise `gateTimeoutMin` | 20 (PR 95) | — | data-env | n/r | in force | [S] |
| D28 | 11-03 | Two plans parked on plan-file merge conflicts | merge-based repair vs full rebuild | Merge-based repair, in separate steps; keep builder code, take main's plan file; proceed without deleting local branches when the guard denied `branch -D` | preserve paid work; no risky combined commands | git-safety | n/r | in force | [S] |
| D29 | 11-05/06 | A week in: runs slow, expensive, failing on technical issues | freeze + reliability list; later: rebuild as one script | **Freeze** new capabilities until 11-15; kit plans via `/take-plan` + `/ship`, not `/orchestrate`; fresh-context Opus reviewer sees only plan, diff, tests, decisions; decision rule (take the recommended option if reversible and in scope, log it; stop only on listed conditions); scorecard per run. **11-06:** rebuild the orchestrator as one script (builder + reviewer as `claude -p`, everything else code); **delete** the replaced runtime and agents; (1) reviewer model by blinded A/B, never by tier; (2) merge only on literal `merge`; (3) FAST = build+lint, REGULAR adds tests; (4) `--concurrency 1` until 10 plans merged at ≥ 90 %; (5) delete, not freeze; (6) readiness = script lint + decision rule, no agent; (7) learning loop, brain, grading, readiness kinds, card UX frozen until 090's bar; goal order 086 → 087 → 058 → 088 → 089 → 090 → 084; 085 superseded by 088 | "the work must start bearing fruit soon"; the orchestrator's cost is the workflow runtime (every state write is a model call) | architecture | n/r | in force; 086, 087, 088 done | [H] [S] |
| D30 | 11-04 | Karpathy-style benchmark + single-agent prompt loop | wait until the app-project run is validated, then plan it, starting with the code reviewer | no answer recorded | — | learning | n/r | open (and frozen by D29.7) | [S] |
| D31 | 09-30 | Migrated recipe labels show in the list filter but vanish in the editor | Run a read-only diagnostic plan first (plus an amendment), consolidate labels later | Approved the diagnostic-first approach | Understand the cause before merging labels | process-order | yes | done | [S] FD81 |
| D32 | 09-30 | Planning in the browser chat vs an agentic desktop session | Plain project chat is cheaper for planning; execute in the coding agent | Kept his split: plan in the chat project, execute in the coding agent | Token cost | cost-vs-autonomy | yes | in force | [S] FD82 |
| D33 | 09-30 | Reducing token use across agent workflows | — | Principle: mechanical, deterministic work moves into Node scripts; the model does only judgement work | Pay tokens only for judgement | cost-vs-autonomy | — | in force | [S] FD83 |
| D34 | 09-30 | Token-saving ideas | — | First a report with pain vs gain per item, before any brief | Decide on evidence before committing work | process-order | — | in force | [S] FD84 |
| D35 | 09-30 | Candidate: scripted browser audits for mobile/render flows | Listed as one of nine savings items | Deferred; approved the rest as four sequenced briefs | Those audits run rarely | scope | narrower | done | [S] FD85 |
| D36 | 09-30 | Shared hotspot files (styles, dictionary, routes) in parallel plans | Add a contract milestone (M0) that settles hotspot files first | Rejected: parallel plans rarely edit the same existing code; treat hotspots as append-only | Simpler rule covers the real risk | architecture | no | in force | [S] FD86 |
| D37 | 09-30 | Which worktree slot runs a plan | Automatic slot picking | Rejected: three permanent slots, reused; the Human starts work with 'execute plan NNN' | Keep the start of execution in human hands | autonomy | no | superseded by D235 | [S] FD87 |
| D38 | 09-30 | Parallel slots hit the wrong backend | — | Each slot gets its own front-end/back-end port pair; shared local DB by default, isolated DB only when a plan opts in | A real collision showed it | data-env | — | in force | [S] FD88 |
| D39 | 09-30 | Step-0 'reality check' before every plan | Run it on every plan | Make it conditional: run only when git shows drift since the plan's snapshot | It was the most expensive step | cost-vs-autonomy | no | in force | [S] FD89 |
| D40 | 09-30 | Behaviour of the fast ship flag | Assumed the fast flag skips review | Corrected: only the fast lane skips; the flag does not | Claude must not assume tool behaviour | learning | no | in force | [S] FD90 |
| D41 | 09-30 | Plans pushed straight to main | Allow pushes to main only for plan files and the todo ledger, enforced by local hooks | Approved | Plans must land fast without opening code to main | git-safety | yes | in force | [S] FD91 |
| D42 | 09-30 | Two-tier validation proposal (auto vs human checks) | Tag tiers at plan-writing time; ship approval stays commit/push consent; one combined brief | Approved all three | — | process-order | yes | in force | [S] FD92 |
| D43 | 10-01 | Dead or duplicate commands and skills | Delete the unused ones; replace a self-evaluation command with built-in usage commands + a light tune command | Approved deletions; confirmed which commands he still uses | Less to load and maintain | scope | yes | done | [S] FD93 |
| D44 | 10-01 | Where planning happens | — | Both the chat project and the coding-agent terminal stay supported and aligned | He plans from both | process-order | — | in force | [S] FD94 |
| D45 | 10-01 | Saving a plan from the chat | (Save step said 'Ready to execute Task 1') | Plans written in the chat never auto-execute: only written, saved and pushed; the coding agent then tells him to start execution in a session | Execution starts only when he chooses | autonomy | — | in force | [S] FD95 |
| D46 | 10-01 | Snapshot SHA could predate the analysis | Claude fills in the SHA it verified against | Approved | Drift check must use the analysed code | process-order | yes | in force | [S] FD96 |
| D47 | 10-01 | Extracting the workflow into a kit: who owns the files after extraction | Kit repo becomes the source of truth [recommended] | Yes — but it must stop and notify him explicitly before the switch happens | 'This is a big risk' | git-safety | narrower | done | [H] FD97 |
| D48 | 10-01 | Kit support for the second editor | Ship its rules as an optional install layer | Keep it as an option for other projects even though he mostly uses the coding agent | Token efficiency for projects that use both | architecture | yes | in force | [H] FD98 |
| D49 | 10-01 | Kit stack | Asked which stack the next app uses | Angular now, built so it is easy to switch to React or another stack later | Future flexibility | architecture | — | in force | [H] FD99 |
| D50 | 10-01 | Kit plan details (lessons, where plans live) | Lessons travel with a triage verdict; plans stay in the app's plans folder | 'Whatever you recommend on the plans' | Trusts the recommendation on mechanics | process-order | yes | done | [H] FD100 |
| D51 | 10-02 | Token-hygiene fixes | Two fixes (one own suggestion dropped after re-checking) | Asked whether they cut functionality, then approved writing the plan | Save tokens only without losing function | cost-vs-autonomy | yes | done | [S] FD101 |
| D52 | 10-04 | Duplicate products in the DB | — | Wants a token-efficient deterministic script, not manual or AI review | Cost | cost-vs-autonomy | — | in force (app) | [S] FD102 |
| D53 | 10-04 | Product merge scope and user-edited copies | Asked: master only or cascade; merge or skip edited copies | No recorded reply in this chat | — | data-env | no answer | open | [S] FD103 |
| D54 | 10-04 | Split the project into separate front-end and back-end repos? | Don't split; maybe formalize workspaces after the big refactor; ADR or plan? | No recorded reply | — | architecture | no answer | superseded by D235 | [S] FD104 |
| D55 | 10-04 | Triaging ~75 voice-dictated bug notes | — | Default to safe, reversible choices | Avoid damage from guesses | data-env | — | in force (app) | [S] FD105 |
| D56 | 10-04 | Schema changes on stored data | — | Never break stored data: mark fields optional/deprecated instead of removing them; always back up before a data migration | Existing records must keep working | data-env | — | in force (app) | [S] FD106 |
| D57 | 10-04 | Cleaning 63 dish-type values | — | The plan must show him the full mapping at execution time for approval; Claude does not decide now | Contentious data needs his eyes | autonomy | — | done | [S] FD107 |
| D58 | 10-04 | Removing empty space for hidden recipes in the bottom nav | Remove the space | Remove the space but keep the bar itself | — | product | narrower | in force (app) | [S] FD108 |
| D59 | 10-05 | Master-data cleanup depends on an unshipped dedupe plan | Asked whether to wait | Wait: ship the dedupe plan first; the new plan builds on it | Avoid drift | process-order | — | done | [S] FD109 |
| D60 | 10-05 | Empty recipes and dishes in master data | Asked which to delete | Delete only obvious test junk; keep checklists and genuine understocked dishes | Real menu items must not be lost | data-env | — | in force (app) | [S] FD110 |
| D61 | 10-05 | Ingredients with zero amounts | Asked how to handle | Recover from the original seed where possible; report the rest for manual fixing in the UI | Zero amounts silently break cost and scaling | data-env | — | in force (app) | [S] FD111 |
| D62 | 10-05 | User-edited copies of master records | Asked how to handle | Leave them untouched ('user edits win'); report-only bucket | Users' edits win | data-env | — | in force (app) | [S] FD112 |
| D63 | 10-05 | Logging: a log server that never ran | Drop the standalone log server and route through the existing server; durable logging understated | Pushed back: losing session logs and real users' errors is unprofessional; build proper logging | Standard practice in production apps | architecture | no | in force (app) | [S] FD113 |
| D64 | 10-05 | Where logs are stored | Options: DB collection vs external error tracker | DB collection now (queryable by the AI workflow); external tracker deferred until real clients | Cost and usefulness to agents | cost-vs-autonomy | — | in force (app) | [S] FD114 |
| D65 | 10-05 | Permissions model for shared metadata | (His own initial idea: chef / sous-chef hierarchy) | Dropped it: a user has full CRUD on own items and can hide or rename shared defaults for himself only (restorable); admin changes apply to everyone | Simpler rule | product | — | superseded by D97 | [S] FD115 |
| D66 | 10-05 | A plan silently broke a core architecture decision | Four-layer guard: invariants registry, Architecture Impact section in plans, blocking plan gate + warn-only diff gate, CI invariant tests | Approved; a gate override needs his explicit approval only when requested | Stop silent architecture corruption | architecture | yes | in force | [S] FD116 |
| D67 | 10-05 | After the permission fixes | — | Asked for a plain-language summary of expected CRUD behaviour | Understand the result | human-time | — | done | [S] FD117 |
| D68 | 10-07 | Corrupted user data in a dev-only DB | Fix the code and migrate first, or the nulls regenerate | Wipe user data and restore from backup, keeping ingredients and dishes (all users are dev users); accepted the code-fix-first condition | The data doesn't matter yet | data-env | — | done | [S] FD118 |
| D69 | 10-07 | Was a fix already merged? | Said it was not merged, based on the plan file's status field | Check the actual code, not the status field | Stale metadata misleads | learning | no | in force | [S] FD119 |
| D70 | 10-07 | Null fields keep breaking validation | — | 'Find the correct solution across all places and fix the architecture info so it sticks' | Root cause, not a patch | architecture | — | in force | [H] FD120 |
| D71 | 10-07 | Global DB driver setting and an extra field in the same migration | Asked: approve the global setting? include the extra field or count first? | No recorded reply | — | data-env | no answer | open | [S] FD121 |
| D72 | 10-10 | Upgrading the agent skills | — | Research current best practice and make old vs new measurable, not just described | Evidence of improvement | learning | — | in force | [S] FD122 |
| D73 | 10-10 | Before rewriting 14 skills | Start rewriting | 'Stop and check which skills are even used' | Don't polish unused things | process-order | no | in force | [S] FD123 |
| D74 | 10-10 | How to measure skill usage | Infer it from git history | Use the official usage-doctor command | Use the real data source | learning | no | in force | [S] FD124 |
| D75 | 10-10 | A skill that looked unused | Treated it as unused | It runs through the nightly job — keep it | Automated use counts | learning | no | done | [S] FD125 |
| D76 | 10-10 | Skill rewrite scope | Asked: which repos, legacy guidance prose, staged or full | Both repos, kit first; delete the legacy multi-model guidance entirely; full rewrite of all 14 in one pass | Legacy prose can't be acted on | scope | — | done | [S] FD126 |
| D77 | 10-10 | Autonomous QA agent | — | Browser-only, report-only: never fixes, reports with screenshots | Separation of testing and fixing | autonomy | — | in force | [S] FD127 |
| D78 | 10-10 | QA cadence | — | Nightly unattended run (03:00) that keeps state across nights | Use idle hours | autonomy | — | done | [S] FD128 |
| D79 | 10-10 | Where the nightly QA runs | Asked: working folder or dedicated checkout | A dedicated checkout tracking main, not his working folder | Don't disturb work in progress | data-env | — | in force | [S] FD129 |
| D80 | 10-19 | Refresh of the AI model chain; models differ in free vs paid | Brief listed free and paid models, paid prices 'for info', no recommendation | Free tier only: no paid models, no billing | No unattended spend | cost-vs-autonomy | — | in force (app) | [S] FD01 |
| D81 | 10-19 | Default order of the AI model chain | Order by biggest free bucket AND best recipe quality first | Order strictly by most free daily calls first; quality only as tie-break | Users must not burn the best models' small free quota early | cost-vs-autonomy | narrower | in force (app) | [S] FD02 |
| D82 | 10-19 | Where non-code product talk (vision, MVP, ideas) should live | — | Two modes in one project: plan mode (English plan body, never saved to the doc store) and conversation mode (the app's language, saved to the doc store) | Product thinking needs a persistent home separate from code plans | process-order | — | in force | [S] FD03 |
| D83 | 10-19 | When content gets written to the doc store | — | Nothing is saved without explicit approval; the Human runs /sum-up, Claude may only suggest it | Control over what persists | autonomy | — | in force (app) | [S] FD04 |
| D84 | 10-19 | Keeping the doc-store index current | — | Index update is mandatory and part of the same save, never a separate step | One reliable entry point to find any doc | process-order | — | in force | [S] FD05 |
| D85 | 10-19 | Doc-store folder layout and closed list of doc types | Four subfolders + a closed list of doc types | Accepted as proposed | — | process-order | yes | done | [S] FD06 |
| D86 | 10-19 | Language of the project prompt | (Human's own earlier instruction: whole prompt in English) | Technical terms, code and commands in English; everything else in the app's language | Readability for the Human | human-time | — | in force | [S] FD07 |
| D87 | 10-19 | Spec session for events and pricing | — | No code and no plans at this stage; only collect and sharpen spec docs | Specs first, plans derived later | process-order | — | done | [S] FD08 |
| D88 | 10-19 | Quantity model for an event | Treated event type and serving type as one dimension | Two separate dimensions, multiplied: qty per person × guests × event-type factor × serving-type factor | They vary independently | product | no | in force (app) | [S] FD09 |
| D89 | 10-19 | Safety margin in the price quote | Computed the margin incorrectly | Margin = 10% of the quote total, shown to the chef only | Correctness of the business rule | product | no | in force (app) | [S] FD10 |
| D90 | 10-19 | Manual per-dish quantity factor | — | Add it to the MVP | It almost exists in the app already | scope | — | done | [S] FD11 |
| D91 | 10-19 | Automatic buffet split engine and a learning 'event features' engine | Move to the parking lot (proposer not clear from summary) | Parked for later | Too complex for now | scope | yes | in force (app) | [S] FD12 |
| D92 | 10-19 | Where architecture items (multi-tenancy) are recorded | — | Code/architecture → repo; product → doc store; never mixed | Single source of truth per kind | process-order | — | in force | [S] FD13 |
| D93 | 10-19 | Scanning the whole project history into the doc store | Estimate cost/usage first, then scan in two passes | Go ahead with the full scan | — | cost-vs-autonomy | yes | done | [S] FD14 |
| D94 | 10-19 | Draft proposals marked '(assumption)' from chat summaries only | Present proposals built from summaries, unverified | 'You have code access — why not check what is done and what isn't?' → verify every assumption against the code first | Facts must come from the source, not summaries | process-order | no | in force | [H] FD15 |
| D95 | 10-19 | Approving many doc updates | Re-present the updated list for review | No need to show again — just update the relevant docs | Reading time is the bottleneck | human-time | no | in force | [S] FD16 |
| D96 | 10-19 | Duplicate legacy handoff doc in an old folder | Check and move it to trash | Trash it (not permanent delete) | Reversible cleanup | data-env | yes | done | [S] FD17 |
| D97 | 10-19 | Vision (business owner + staff) contradicts code (single global admin) | Flag it; needs a new ADR and invariant changes | Keep the owner+staff business model as target; record as repo item | Product vision drives architecture | architecture | yes | in force (app) | [S] FD18 |
| D98 | 10-19 | Is the MVP sellable; add a sales bot / lead filtering | Bot is heavy: messaging-API work, call-recording legal limits, free model can't run 24/7; 6–8 weeks | Sales bot, full CRM and call recording stay out of MVP; event pipeline + notes become the first lead building block | Ship something usable first | scope | yes | in force (app) | [S] FD19 |
| D99 | 10-19 | Documenting the expanded vision | Split into three docs: Vision, Business model, MVP roadmap | Approved | — | scope | yes | done | [S] FD20 |
| D100 | 10-19 | Spec method for a multi-agent build | Pre-write a high-level spec per product sector (9 sectors) | Challenged it: sector specs are not one-shot-able by agents → audit the live code first, write one page per real gap only | Agents need concrete, verified gaps | process-order | no | in force | [S] FD21 |
| D101 | 10-19 | Locking the MVP definition | Business entity (owner+staff) first, scalable; caveat: if the audit finds it heavy, the call returns to the Human; pilot goal: one client runs 3 real events in 6 weeks with actual vs planned profit | Approved — 'I approve both writing and setting off' | Wants fast-growth capability | architecture | yes | in force (app) | [H] FD22 |
| D102 | 10-19 | Dashboard reporting | Event pipeline replaces manual monthly reporting; 'deposit paid' = a flag only; 'not closed' status as an assumption | Approved: pipeline inquiry→quote→deposit→orders→execution→post-production auto-updates the dashboard, free-text notes on every event | Notes field is the first step toward leads | product | yes | in force (app) | [H] FD23 |
| D103 | 10-19 | Deriving equipment from dishes | — | Deferred to the parking lot | Not needed for the pilot | scope | — | in force (app) | [S] FD24 |
| D104 | 10-19 | Supplier order sheet | — | Fix the wrong numbers in the existing order sheet, and add a one-tap copy (mobile and desktop) that keeps the structure for pasting into a messaging app: 2 clicks instead of ~6 | Save clicks; the supplier must read quantities without confusion | product | — | in force (app) | [H] FD25 |
| D105 | 10-19 | Exported prep lists | — | Every exportable list must print accurately | In phase one the chef prints prep sheets per station | product | — | in force (app) | [S] FD26 |
| D106 | 10-20 | Many separate dropdown implementations | One shared base with variants; discovery-only audit brief, discussion summary before any plan | Use the dropdown as a pilot to validate the wider 'one-off components' hypothesis; pass the brief to the planner | Validate before expanding the audit | process-order | yes | done | [S] FD27 |
| D107 | 10-20 | What a new business gets on signup | Clone only products, units and categories | Full master copy, as today; keep the clone scope easy to narrow later | — | product | no | in force (app) | [S] FD28 |
| D108 | 10-20 | Staff and money fields | — | Staff see money fields but never edit them; no revenue/profit on the dashboard for staff | Owner controls money | security | — | in force (app) | [S] FD29 |
| D109 | 10-20 | MVP scope additions | — | Bulk product import and paste-recipe / paste-ingredients are in the MVP | — | scope | — | in force (app) | [S] FD30 |
| D110 | 10-20 | Menu pricing fields | — | Remove take rate and pieces per person; product defaults to its cheapest supplier | Simplify | product | — | in force (app) | [S] FD31 |
| D111 | 10-20 | Event snapshot and execution checklist | — | Snapshot freezes at 'execution'; arrival checklist, invoice flag and delivery-note photo are in the MVP | — | product | — | in force (app) | [S] FD32 |
| D112 | 10-20 | Pilot start vs tenancy work | — | Pilot may start before the business/team plans finish if the first business runs solo | Don't block the pilot on the full build | process-order | — | in force (app) | [S] FD33 |
| D113 | 10-20 | Pasting the full spec docs in the app's language into the coding agent | Don't — the brief already holds the rules; a second source of truth would conflict | No recorded reply | — | process-order | no answer | open | [S] FD34 |
| D114 | 10-20 | Where agent tool-servers (MCP) fit in the project | Only a read-only local DB server (and hosting logs later); keep the CLI for the code host, keep the existing browser tool, keep file memory | Approved two plans: config cleanup, and a read-only DB server scoped to localhost, never production | Least access needed | architecture | yes | in force | [S] FD35 |
| D115 | 10-20 | Recurring one-off components across the app | — | First restate and expand the diagnosis; only after confirmation audit the whole codebase (UI, services, forms, state, style) | Agree on the problem before acting | process-order | — | done | [S] FD36 |
| D116 | 10-21 | This session runs in parallel with another session building the orchestrator in the same repo | — | Track the other session's decisions via chat search; send a hand-off message at the end | avoid duplicate or conflicting work | process-order | — | in force | [S] KD35 |
| D117 | 10-21 | Where to build the new orchestrator | build it in the kit and sync it out to projects (follows the plan-006 precedent) | Yes | — | architecture | yes | in force | [S] KD36 |
| D118 | 10-21 | When to send the retrospective questionnaire to a running orchestrator | after the run finishes, not mid-run | Yes | — | process-order | yes | done | [S] KD39 |
| D119 | 10-21 | Execution mechanism for the orchestrator | workflow script (what the real run used), over subagents or `claude -p` sessions | Workflow script | the real run's evidence | architecture | yes | superseded by D29 | [S] KD40 |
| D120 | 10-21 | Where the agent eval set lives | mechanism in the kit, real cases in the project | Yes | keep the kit product-agnostic | data-env | yes | in force | [S] KD41 |
| D121 | 10-21 | Run-size limit | no hard cap; wave-based gating | Yes | — | scope | yes | superseded by D29 | [S] KD42 |
| D122 | 10-21 | Order of 9 reuse/consistency plans (~15–18 sessions) | Do P1 (reuse layer, no app code) first, then the two current pain points, then pause and measure | Built the reuse layer and moved to the family-convergence plans | Every later feature is enforced instead of hoped for | architecture | yes | done | [S] FD37 |
| D123 | 10-22 | When to start the design-tool → front-end workflow | Build the workflow 'rail' (docs/scripts) now; new screen designs only after the MVP merges | Wait for the MVP merge; think and prepare only, no further actions proposed until then | Designs must be based on the merged app | process-order | no | superseded by D218 | [S] FD38 |
| D124 | 10-22 | A visual change to a component family | Default: update the shared base and flag every usage for review, don't ask each time | Approved | — | design | yes | in force | [S] FD39 |
| D125 | 10-22 | Scope of the design workflow | — | Must become part of the kit, reusable across projects | Reuse beyond this app | architecture | — | in force | [S] FD40 |
| D126 | 10-22 | Claude hedged ('go check if X is possible') | Asked the Human to verify a tool limitation himself | 'Don't tell me to go check — validate it'; inspect the real agents folder instead of assuming roles exist | Claude must verify, not delegate checks | learning | no | in force | [S] FD41 |
| D127 | 10-26 | Move the app to pnpm to save disk across worktrees | plan the kit-side change first (the kit assumes npm in many files) | Deferred; not blocking | — | scope | yes | done | [S] KD44 |
| D128 | 10-26 | A planning layer above the orchestrator (023) | — | `/orchestrate` must stay independent and unchanged | — | architecture | — | in force | [S] KD45 |
| D129 | 10-26 | Reload / tab close with unsaved work | Use the browser's native dialog (only option) [recommended] | Approved | — | product | yes | in force (app) | [S] FD57 |
| D130 | 10-26 | Closing a modal via Escape/backdrop with edits | Confirm before discarding [recommended] | Approved | — | product | yes | in force (app) | [S] FD58 |
| D131 | 10-26 | Removing a line vs deleting an entity | Line → remove at once + undo toast; entity → confirm modal [recommended] | Approved | — | product | yes | in force (app) | [S] FD59 |
| D132 | 10-26 | Language of the UI briefs | — | Briefs in English for the planner, plus a separate summary in the app's language for the Human | Agent input vs human reading | human-time | — | in force | [S] FD60 |
| D133 | 10-27 | Seven ideas to speed up validation | seven ranked ideas | Ideas 1 (page-by-page replies, agent fixes while he reviews) and 2 (one-line page opener) now; the rest saved as a backlog plan | — | scope | narrower | frozen | [S] KD48 |
| D134 | 10-27 | Two PRs green in CI | — | Asked Claude to push and merge them; release tagging and the app sync stay with him | — | git-safety | — | done | [S] KD49 |
| D135 | 10-27 | Each menu doubles as a lead; returning clients retyped | Separate a client entity (who) from the event (what); stage stays on the event | Approved, and added a client type field (private / business / production company) | — | architecture | yes | in force (app) | [S] FD42 |
| D136 | 10-27 | Client data visibility | — | Staff see client name and phone only; owner controls all other fields | Client relationship stays with the owner | security | — | in force (app) | [S] FD43 |
| D137 | 10-27 | Client fields on the menu screen | — | No editable client fields on the menu; a read-only client row only, editing moves to the client entity | One place to edit | product | — | in force (app) | [S] FD44 |
| D138 | 10-27 | May staff create a client from the inquiry dialog? | (a) Yes — staff take inquiries [recommended, matches 'staff create anything'] | (b) Owner only — accepted the invariant deviation | Owner controls the client list | security | no | in force (app) | [H] FD45 |
| D139 | 10-27 | Migration: events with a name but no phone | (a) One client per distinct name [recommended] | (a) | — | data-env | yes | done | [H] FD46 |
| D140 | 10-27 | Soft delete for clients in the first plan | (a) Off, no delete UI yet [recommended] | (a) | — | scope | yes | done | [H] FD47 |
| D141 | 10-27 | Sizing the client work for the autonomous orchestrator | — | Study the orchestrator, split into 5 dependency-ordered plans, deliver one polished English handoff file | Plans must fit the executor | process-order | — | done | [S] FD48 |
| D142 | 10-27 | Site-visit stage between phone quote and final quote | — | Two touchpoints: phone-intake questionnaire + a separate on-site checklist with the client/producer | Mirrors the real workflow | product | — | in force (app) | [S] FD49 |
| D143 | 10-27 | Checklist items across businesses | — | One shared master list; each business adds its own items and sees only its own; platform admin sees all additions to improve the shared template | Learn from user behaviour | product | — | in force (app) | [S] FD50 |
| D144 | 10-27 | Who may answer and add ad-hoc items on an event | (a) Any member, like notes [chosen by default] | (b) Owner only ('q1 - b') | Owner controls event logistics | security | no | in force (app) | [H] FD51 |
| D145 | 10-27 | Are master checklist items locked to the owner? | (a) Not locked — any member adds own items [chosen by default] | (a) | — | security | yes | in force (app) | [H] FD52 |
| D146 | 10-27 | Before designing the site-visit feature | — | Research industry prior art first | Don't design from scratch | learning | — | in force | [S] FD53 |
| D147 | 10-28 | Doc-store sum-up: client entity and site visit — inside the MVP or after? | Question, no recommendation | After the MVP (and the MVP is already merged) | — | scope | — | done | [H] FD54 |
| D148 | 10-28 | Which product sector holds the site-visit feature | Question: sector 09 or 05, no recommendation | sector 05 | — | product | — | in force (app) | [H] FD55 |
| D149 | 10-28 | 24 proposed doc-store updates | Approve the list (all, or by number) | 'Approve' — all 24 | — | autonomy | yes | done | [H] FD56 |
| D150 | 10-29 | Design/UX capability: plan order | 031 (file ownership, layers, install scan) first, then 032 (design) | no answer recorded in the chat | — | process-order | no answer | open | [S] KD51 |
| D151 | 10-29 | An existing project file blocks a kit capability (lint config etc.) | separate kit layer + an import line he approves; never overwrite | no answer recorded in the chat | — | architecture | no answer | open | [S] KD52 |
| D152 | 10-29 | Running an orchestrator next to a Planner session | — | Two sessions from the same main project folder, one running `/orchestrate`, one as Planner; never from a worktree slot | — | process-order | — | in force; the Human wants to change it (D235) | [S] KD53 |
| D153 | 10-29 | Four new orchestrator bugs found while 029 is mid-build | — | Fold the four fixes into the running 029 as sub-tasks (not edit it on `main`); a new 032 for the session-state cleanup, after 029 and before 030/031 | same files; the kit runs plans in chronological order | process-order | — | done | [S] KD54 |
| D154 | 10-29 | Diagnosing why builders started on Opus | — | Verify every claim against the actual code and git history, not docs; briefs must separate what was verified from what was not | docs drift from code | process-order | — | in force | [S] KD55 |
| D155 | 10-29 | Where the fix for that bug goes | — | Fold it into the running kit 029, not a parallel plan; keep step numbering; protect npm projects | the kit works in chronological order; the fix touches the same files as 029 | process-order | — | in force | [S] KD57 |
| D156 | 10-29 | One plan bundles 4 unrelated cleanups (two mechanical, two needing judgement) | Split into a mechanical plan and a judgement plan [recommended] | No recorded reply | — | process-order | no answer | open | [S] FD61 |
| D157 | 10-30 | Triage of decisions in the learning system (041) | shadow mode first | Yes | — | autonomy | yes | frozen | [S] KD59 |
| D158 | 10-30 | Network access for the evidence DB | open network access + per-machine write-only users | Yes | — | security | yes | in force | [S] KD60 |
| D159 | 10-30 | Agent-improvement sessions | weekly sessions with a $10 cap | Yes | cost | cost-vs-autonomy | yes | frozen | [S] KD61 |
| D160 | 10-30 | Which agent prompt to improve first | the bug-checker agent | Yes | — | scope | yes | superseded by D29 | [S] KD62 |
| D161 | 10-30 | A separate review finding about 040 | — | Fold it into 043 as a small sub-task, and do not record it as a Human decision | keep provenance clean: reviewers' findings are not his requirements | learning | — | in force | [S] KD63 |
| D162 | 10-30 | 035 (skill improver) already exists | — | Update 035 before it is built (review-tier judge, shared core, cost tracking) | 047/048 will reuse its runner | process-order | — | done | [S] KD64 |
| D163 | 10-30 | How agents finish a plan | ship and merge per plan | Replaced with his standard review hand-off (fetch, rebase, build, lint, test, push, fixed report block) for 9 plans; not for plans already done | he reviews every branch before merge | git-safety | no | done | [S] KD65 |
| D164 | 10-30 | Unified date field works the same everywhere but looks inconsistent | Keep it unified, fix only broken issues, log the look as design debt, check for outside style overrides | Keep unified; design once later | Unification work is done; one design will apply everywhere | design | yes | in force (app) | [S] FD62 |
| D165 | 10-31 | Model per plan in a batch of core-orchestrator plans | Opus for plans touching core state/retry/merge logic; Sonnet only for isolated new tools | Yes | nothing automated catches logic errors between plans | model-choice | yes | done | [S] KD66 |
| D166 | 10-31 | Rebased branch already pushed; force-push blocked | merge `origin/main` into the branch instead of rebasing | Yes | — | git-safety | yes | in force | [S] KD67 |
| D167 | 10-31 | 030 would conflict with two plans about to merge | — | Paused 030 mid-build; restarted only after 044 and 041 landed | overlapping files | process-order | — | done | [S] KD68 |
| D168 | 10-31 | Writing the review hand-off block | — | Keep agent-reported decisions separate from his; do not attribute review findings to him as requirements | provenance | learning | — | in force | [S] KD69 |
| D169 | 10-31 | 044 merged and green | defer closing the plan until the human check in the app project | Yes | — | process-order | yes | in force | [S] KD70 |
| D170 | 10-31 | Agents run two slow e2e suites locally; one already runs the other | consolidate CI coverage and simplify local-check guidance (a plan for a new agent) | no answer recorded | he flagged the runtime as excessive | human-time | no answer | open | [S] KD71 |
| D171 | 11-01 | Agent proposed splitting backlog 024 into six dependent plans | drop idea C3 to backlog, put C6 before C5 | Approved → 050–054 | — | scope | yes | done | [S] KD72 |
| D172 | 11-01 | Nightly skill-improver task (035 S8–S10) | run it | First explain in plain terms what it does, its token cost and billing, then run | wants to know cost before autonomy | cost-vs-autonomy | narrower | in force | [S] KD73 |
| D173 | 11-01 | Claude told him to run 035 | run 035 | Caught that 035 was already merged (pasted the agent's report) | repo state beats Claude's recollection | process-order | no | in force | [S] KD74 |
| D174 | 11-01 | Keep polishing the kit, or start running it on the app now | run on the app now; real runs produce the learning data | no final decision; asked first how exactly lessons are decided | — | process-order | no answer | open | [S] KD75 |
| D175 | 11-01 | Compare his tools with free alternatives | broad comparison of the whole stack | Narrowed: skills and tools only, not the orchestrator stack | that was his intent | scope | narrower | done | [S] KD78 |
| D176 | 11-01 | Production DB URI sits in the shared env file copied to every agent slot | Move it to a separate file that only production-bound scripts load explicitly | Approved, and required proof that every consumer loads from the right place and the new file is git-ignored | Secrets must never be pushed; slots must stay local | security | yes | in force | [H] FD63 |
| D177 | 11-01 | Before writing the plan | — | 'First tell me in the briefest way what we are doing to solve this' | Short overview before details | human-time | — | in force | [H] FD64 |
| D178 | 11-01 | Synced repo knowledge hits 100% capacity | Narrow the sync filters; then: keep sync connected, the linked folder wins | No explicit decision | — | data-env | no answer | open | [S] FD65 |
| D179 | 11-01 | Site-visit plans for the orchestrator | Split 2 plans into 7, with an environment-fix plan as prerequisite | Saved the 7 plans | Earlier run stalled on environment, not code | process-order | yes | done | [S] FD66 |
| D180 | 11-02 | 046 agent needs an out-of-scope edit to the state script to finish two items | allow it | Approved | — | scope | yes | done | [S] KD81 |
| D181 | 11-02 | Backfill filled the brain DB and the query tool reads it | — | Close 045 on that evidence; also close 024, 049, 055 | — | process-order | — | done | [S] KD82 |
| D182 | 11-02 | Claude proposed editing the app's files, then sent a prompt asking only for a report | — | Corrected the mismatch | the prompt must do what was proposed | process-order | — | in force | [S] KD84 |
| D183 | 11-02 | A session tried to bypass a hook/guard to force an edit | bypass the guard | Rejected | guards are not to be bypassed | git-safety | no | in force | [S] KD85 |
| D184 | 11-02 | Leak-check term list | the Planner guessed the terms | He supplies the full list himself (name, username, email, cluster id, city, street) | only he knows what is private | security | no | in force | [S] KD86 |
| D185 | 11-02 | Run 057 on the orchestrator, or next to an orchestrator test? | 057 stays solo (the kit has no orchestrator config); the app's orchestrator test may run at the same time (different repo) | Yes | — | process-order | yes | done | [S] KD90 |
| D186 | 11-02 | How he wants answers during runs | — | Short and direct; always a ready-to-paste prompt when one is implied | his reading time | human-time | — | in force | [S] KD96 |
| D187 | 11-03 | Setting up the evidence DB user for `/kit-learn` | a custom role (read all, write 4 collections), added to the existing user's roles | Yes, added, not replacing the existing role | — | security | yes | done | [S] KD97 |
| D188 | 11-03 | Four plans (050–053) each carry a human validation item | consolidate them into one item (069), retire 050–053 as superseded | Yes | fewer manual checks | human-time | yes | done | [S] KD98 |
| D189 | 11-03 | How Claude writes UI/tool walkthroughs and mixed-language text | — | Exact container labels in backticks, one action per step, field → value pairs, say what must NOT be selected, add vs replace, end with verification and the next command; every line starts with the app's language, English terms mid-sentence, commands in code blocks; also as a rule for kit-installed agents | he follows steps literally | human-time | — | in force | [S] KD99 |
| D190 | 11-03 | Dev-server ports he is reminded to close by hand | — | Wants them closed automatically by the end-of-work flows; first a read-only investigation with file:line evidence | he expected this to be automated | human-time | — | in force | [S] KD100 |
| D191 | 11-03 | Why invariant-touching plans default to Opus | — | Asked for the evidence; it was a value choice, not a measurement | model choice must be measured | model-choice | — | in force | [S] KD101 |
| D192 | 11-03 | Product question in a run: client phone | — | Phone is required | — | product | — | in force (app) | [S] KD102 |
| D193 | 11-03 | Product question in a run: who may create a client | — | Owner only, enforced on the server, with the existing test | — | product | — | in force (app) | [S] KD103 |
| D194 | 11-03 | Ungraded decisions left after grading | approve the rest in one go | Rejected the blanket approval | every decision gets a real grade | learning | no | in force | [S] KD105 |
| D195 | 11-03 | A sub-agent recommended keeping 070 as one plan | keep 070 whole | Split it (A1, A2, B, C) per his own plan-size rule | his documented rules beat a sub-agent's opinion | process-order | no | in force | [S] KD106 |
| D196 | 11-03 | Readiness questions for 065 | the agent's defaults | Replied "defaults" | — | autonomy | yes | done | [S] KD108 |
| D197 | 11-03 | Claude wrote an agent prompt in the app's language and did not say which session it was for | — | Agent prompts are always in English and labelled with the target session | he pastes into two sessions | human-time | — | in force | [S] KD110 |
| D198 | 11-05 | 513 collides with a security guard that blocks log lines with phone data | add a guard exemption or change the plan (left to him) | no answer recorded | — | security | no answer | open | [S] KD112 |
| D199 | 11-05 | Is the GitHub MCP server needed? | — | Read-only audit only: no edits, never print token values, names only | secrets | security | — | in force | [S] KD113 |
| D200 | 11-05 | The decision rule let the builder side judge itself | — | Caught it: a fresh-context Opus reviewer validates each plan before merge | no self-review | architecture | — | in force | [S] KD115 |
| D201 | 11-05 | Preflight plan deferred out of the freeze sequence | defer it | Include it now in the active sequence | it causes the stops | process-order | no | done | [S] KD116 |
| D202 | 11-05 | Security plugin fails with 401 (revoked token) mid-run | — | Fix it after the autonomous run ends | don't disturb the run | process-order | — | done | [S] KD117 |
| D203 | 11-05 | Use desktop computer-use to answer terminal prompts for him | advised against (it would bypass a validation hook built on purpose) | not recorded | — | autonomy | no answer | superseded by D235 | [S] KD118 |
| D204 | 11-05 | Independent judgment of the system | — | Have an external notebook tool with best-practice sources judge the design; "don't try to make me happy" | wants frank assessment | learning | — | in force | [S] KD119 |
| D205 | 11-05 | A chat scan turned into an autonomous plan-writing run (PR of 8 plans) | write plans for every open idea | His intent was narrower: a prompt to scan the app project's own chats; build plans only after he picks from that map | he decides what gets built | scope | narrower | in force | [S] KD120 |
| D206 | 11-05 | A Planner session merged plans to main and parked 15 plans without his recall of approving | — | Flagged it to verify; he does not recall authorising it | nothing lands without his approval | git-safety | — | open | [S] KD121 |
| D207 | 11-05 | Is the code-host MCP server needed? | Not needed; delete its config entry | Only asked whether the empty token is fine; no delete decision recorded | — | security | no answer | superseded by D235 | [S] FD67 |
| D208 | 11-06 | Dead and redundant code | — | Run the audit once now and document the method thoroughly; a weekly autonomous run comes later | Make it repeatable before automating | autonomy | — | in force | [S] FD75 |
| D209 | 11-06 | Scripts and DB collections from the retired v1 schema | Explained v1; asked whether a rollback is ever needed | Never roll back; approve dropping the v1 collections (pre-drop backup kept as the archive) | Dead material misleads agents | data-env | yes | done | [S] FD76 |
| D210 | 11-06 | Orphan dictionary keys found by the audit | Listed as unused / removable | Never remove them; report a count only | They may be used later | scope | no | in force (app) | [S] FD77 |
| D211 | 11-06 | Running the three cleanup plans | All three fully in parallel | Parallel, except the scripts plan must not run alongside another open plan that edits the same package manifest | Avoid merge conflicts | git-safety | narrower | in force | [S] FD78 |
| D212 | 11-06 | Dropping collections on production | Agent runs local only; the Human runs production by a runbook in the plan | Approved | Production changes stay in human hands | data-env | yes | in force | [S] FD79 |
| D213 | 11-07 | The kit Planner stopped: four premises in Claude's prompt were stale | option A (add the file, tag tests, spin a small new plan) + corrected prompt | Asked Claude's view; choice not recorded | repo state beats Claude's summary | process-order | no answer | open | [S] KD122 |
| D214 | 11-07 | Source for an open-items sweep | Started from repo files (and fetched the local repo) | Source = the project's chat history, not the repo | The open items were discussed, not coded | data-env | no | done | [S] FD68 |
| D215 | 11-07 | Site-visit panel placement recorded wrongly in a saved plan | Fix the plan to the Human's earlier answer | Collapsed card, opened on tap (recording fix) | — | design | yes | in force (app) | [S] FD69 |
| D216 | 11-07 | Owner-only client creation, revisited | Keep it, or a small plan 'staff create with name + phone only' | Keep owner-only; revisit after the pilot | — | security | — | in force (app) | [S] FD70 |
| D217 | 11-07 | Legacy plan superseded by the 'business is the tenant' ADR | Close it as superseded | Closed | — | scope | yes | done | [S] FD71 |
| D218 | 11-07 | Design-tool workflow prep, now that the MVP is merged | Start the preparation now | Start now | The waiting condition is met | process-order | yes | done | [S] FD72 |
| D219 | 11-07 | Separate production env file touches kit-owned files | Two plans: one project plan, one kit change | Two plans | Each ends in a different place; project part can run without a kit release | architecture | yes | done | [S] FD73 |
| D220 | 11-07 | DB scripts use mixed target flags | Earlier: keep existing flags, add only where missing; then: unify | One flag for all scripts (local / production); only the production target loads the production env file; no flag = local | Explicit, uniform, safe default | data-env | yes | in force | [S] FD74 |
| D221 | 11-08 | NotebookLM report: simplify; freeze or delete the learning-loop layer | delete the model-run runtime layer (~10 files), keep guards, scripts, contract, eval | Pushed back ("delete everything we built?"); accepted once shown it is one layer and multi-plan runs stay | must keep running several plans | architecture | yes | done | [H] KD123 |
| D222 | 11-08 | Out-of-scope file in a plan run (install-check) | `approved: <path>` and print the reviewer A/B table first | Asked what to answer ("?"), took it | — | scope | yes | done | [H] KD124 |
| D223 | 11-08 | Two open questions on 097 (runner's hard limits) | only explicit `## Execution Mode` lines count; production words match whole words and only with a DB/folder word; when in doubt refuse and ask | Asked what to answer, took the drafted answers | a false refusal is fine, a silent default is not | security | yes | done | [H] KD125 |
| D224 | 11-08 | An agent merged a PR on its own because the run needed it | note it: always ask before merging a PR he has not pre-approved | Sent the note; the agent saved the rule | merges to main are his | git-safety | yes | in force | [H] KD126 |
| D225 | 11-08 | Third plan with the same timeout cause | run all three together (`go`) | Yes | same cause, same fix | process-order | yes | done | [H] KD127 |
| D226 | 11-08 | Runs keep dying and he has to type `restart` | detached run + supervisor that relaunches up to 3 times, only with ≥ 4 GB free, waiting otherwise | Took every recommendation; wants a run to finish on its own and only real decisions reach him | his time; stuck runs block everything | autonomy | yes | in force | [H] KD128 |
| D227 | 11-08 | 101 lets a builder change the test next to its source file | allow it | Raised the risk that a builder weakens the test to pass; Claude added code blocks on assertion changes and a reviewer STOP rule | tests must not be gamed | security | narrower | in force | [H] KD129 |
| D228 | 11-08 | A plan changes mid-run | — | Raised that it must be recorded; recorded by script from git, never by an agent | provenance | learning | — | in force | [H] KD130 |
| D229 | 11-08 | Which merges a run may do on its own | — | Merges into the run branch are never asked; only the merge to the project's `main` is his | — | git-safety | — | in force | [H] KD131 |
| D230 | 11-08 | Next 100–104 vs the running 095/098/099 | wait until that run merges (same files; preflight refuses overlap; memory) | not recorded | — | process-order | no answer | open | [S] KD132 |
| D231 | 11-08 | How to collect test data for the advisor | a tool that parses the full chat export into a private store | No tool: a prompt in each project's chats, with personal details anonymised | simpler; privacy | scope | no | done | [H] KD133 |
| D232 | 11-08 | Wait ~1 month before building the advisor (D16)? | build only a check script now; shadow mode after 11-15 | Questioned the wait: a year of chats is enough data; asked what 098/099 have to do with it | he already has the data | autonomy | no | superseded by D234 | [H] KD134 |
| D233 | 11-08 | Worker agents' self-reported decisions; Claude found a stale path before commit | Fix the path, then commit | Approved the commit | — | git-safety | yes | done | [S] FD80 |
| D234 | 11-08 | Build the advisor agent now that both projects' chats are mined? | build 100 (advisor + time-split eval) vs import the mined rows only | Import only; no advisor now; keep relaying questions by hand, one round per run | a single question round per run costs minutes; most lost time is tooling stops (098/099); revisit if he still returns more than once per run after 098/099, or most questions turn out routine | autonomy | yes | in force | [H] |
| D235 | 11-09 | Status review of the mined rows before merge | Claude's statuses | D37 no longer holds (not how slots work now); D152 holds but he wants it changed; D32/D44 hold; D78 (nightly QA) no longer runs; D54: do not split the app into two repos for now; D203: no computer-use to answer terminal prompts; D207: delete the code-host MCP server only if it is truly unused anywhere in the project | he reviewed them one by one | process-order | narrower | in force | [H] |

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

### 2.1 Rules mined from this project's chats (2026-11-08)

1. **Merges to `main` are his alone.** Agents merge only into the run branch; any PR he has not pre-approved stops with a question, even when a run needs it. — KD37, D134, D206, D224, D229
2. **Never rewrite shared history or bypass a guard.** `git revert`, not reset or force-push; merge `origin/main` into a pushed branch instead of rebasing; run separated steps, not risky combined commands; a guard denial is respected. — D166, KD80, D183, KD109
3. **Spend and autonomy follow evidence.** Write plans before running them, pause for real runs before the next layer, explain cost before an autonomous task, freeze capability for reliability. — D172, KD77, KD87, KD94, KD114
4. **No DB or folder is production without his explicit answer.** Local DB by default; remote only on an explicit keyword; when in doubt, refuse and ask. — KD92, KD95, D223
5. **The repo is the truth, not docs or Claude's memory.** Verify against code and git, cite evidence, and mark what was not verified. — D154, D173, D191, D213
6. **One writer per file set; respect the chronological order.** A fix touching a running plan's files is folded into that plan; overlapping plans wait; merge the plan that blocks another first. — D153, KD56, D155, D167, KD93
7. **Keep provenance clean.** Reviewer and agent findings are never recorded as his decisions; run facts and lessons are written by scripts, not by agents. — KD50, D161, D168, D228
8. **A stop that needs no judgment must resolve itself.** Servers start, ports close and dead runs relaunch automatically; only real decisions reach him. — KD91, D190, D201, D226
9. **His documented rules beat an agent's recommendation.** Plans stay mid-sized and are split by his size rule; he decides what gets built. — KD46, D195, D205
10. **Agent-facing text is English, ready to paste and labelled by target session.** Cards and prompts put each copy value on its own line; walkthroughs follow his step format. — KD47, D186, D189, D197

Candidates (one source each): an independent fresh-context reviewer, never self-review (D200); tests may never be weakened to pass (D227); product rules (who may create what, required fields) are asked up front and enforced on the server (D193); sensitive values are never printed (D199).

### 2.2 Rules mined from the app project's chats (2026-11-08)

1. **Verify against the real source; never assume, and never hand him a check Claude can run.** Code beats summaries, plan status fields and memory of tool behaviour. Rows: D94, D100, D126, D176, D214, D40, D69, D73, D74, D75.
2. **The human starts execution and approves irreversible switches; approvals come in one batch.** No auto-execution, no automatic slot picking, explicit stop-and-notify before ownership changes, contentious data mappings shown for approval at run time, gate overrides only with his approval. Rows: D83, D95, D101, D149, D37, D45, D47, D57, D66.
3. **Never lose or break real data; prefer reversible actions.** Mark fields deprecated instead of removing them, back up before migrations, trash instead of delete, keep user edits, keep anything that may be used later, delete only obvious junk. Rows: D96, D107, D209, D210, D55, D56, D60, D61, D62.
4. **Production stays in human hands and is always explicit.** Agents work locally or in a dedicated checkout; production needs an explicit flag, a separate secret file and a manual runbook, and local is the default. Rows: D114, D176, D220, D212, D79.
5. **Spend tokens and money only where judgement is needed.** Deterministic work goes into scripts, expensive steps run only when needed, free tier first, external services deferred until real clients exist. Rows: D80, D81, D33, D39, D51, D52, D64.
6. **The owner controls money, clients and event answers; staff get read access.** He accepts an invariant deviation for this. Rows: D108, D136, D138, D144, D216. (D65 is an older, single-admin model that D97 superseded.)
7. **Fix the root cause and encode it in the architecture so it sticks.** Invariants, ADRs and gates instead of one-off patches; production-grade standards even before real users. Rows: D97, D63, D66, D70.
8. **One shared component per pattern.** Change a family at its base, never per screen, and keep it unified even if it looks bad for now. Rows: D106, D122, D124, D164.
9. **Keep scope lean, and prefer the simpler rule that covers the real risk.** Park heavy or rare features, add cheap almost-built ones, and reject extra process. Rows: D90, D91, D98, D103, D140, D147, D35, D36, D39.
10. **Sequence by dependency and size plans for the executor.** Wait for what a plan builds on, split per executor session, separate project and kit changes, and don't run plans that touch the same file in parallel. Rows: D123, D141, D179, D218, D219, D211, D59.

**Also recurring (≥ 2 rows), outside the top 10:**
- Code and architecture live in the repo; product thinking lives in the doc store. Rows: D82, D92.
- Explain briefly and plainly first, because reading is his bottleneck. Rows: D86, D95, D132, D177, D67.
- Measure before changing: a report or usage data first, then a plan. Rows: D34, D72, D73.
- Build workflow pieces so other projects can reuse them, and keep the stack swappable. Rows: D125, D49.

*Candidate (one source):* design so the platform learns from users, e.g. the admin sees every business's additions (D143).

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

Since 11-08, every Decisions row with `taken?` = `yes`, `no` or `narrower` is a test item too (D31–D233); the 20 rows below are the original pilot.

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
