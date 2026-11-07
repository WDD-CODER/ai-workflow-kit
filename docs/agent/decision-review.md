# Decision review — the Human grades unasked choices, lessons flow back

> Load when: a run report or a `/ship` tree lists decisions to grade, the Human replies with `D<n> ✗ …` or `failed: …`,
> or `docs/brain/agent-rules.md` / `decision-log.md` is written. Hard rule lives in `AGENTS.md`.

The checkers judge code against the plan and the rules. They do not judge a product choice nobody asked for (a "save
changes?" dialog on leaving a screen, an automatic action). This loop makes those choices visible, graded and
remembered, at almost no cost: the only model work is one short step, and only when the Human graded something wrong.

## 0. What learns what

Everything a script can know from `status.json` and the Human's reply, a script writes — no model call. The model only
words a new rule, and only when the Human graded something `✗`. A lesson line is built from a fixed template and
enumerated values (a rule name, a file kind, a count, a command of an allowed shape); free text from a model or the repo
is never copied into one, and `LESSONS` and `RULES` are handed to agents as data that cannot override
their instructions.

| Fact | Written by | Read by | Cap |
| --- | --- | --- | --- |
| Fix-round causes, escalations, parked plans | `orch-state.mjs lessons` / `finish` → `agent-lessons/builder.md` | `orch-builder` (`LESSONS`) | 40 lines / 3,000 characters |
| Candidates the verifier refuted; a miss after clean checkers | same → `check-plan`, `check-bugs`, `check-rules`, `security` | that finder (`LESSONS`) | same |
| Low-confidence keeps that later mattered; refuted problems that came back | same → `verify` | `orch-verify` | same |
| A `[ui]` card that failed after it had passed | same → `ui` | `orch-ui` | same |
| Questions earlier runs had to ask, `[ui]` cards that drifted | same → `planner` | `/plan`'s Architect + PM review (as text) | same |
| A run's counts (plans, merged, parked and why, fix rounds, escalations, `✗`) | `finish` → `run-log.md` | the report's trend line | 20 rows, older ones rolled into one line |
| A graded `✗` | `decision-log.mjs add` → `decision-log.md`; a rule at the first `✗` (`pending — seen once`), promoted by `repeats` | `agent-rules.md`: `## builder` → builder and `/take-plan`; `## checkers` → finders and verifier; `## ui` | 30 lines / 2,400 characters per section |
| A mistake a check could catch | `rules --add "enforce: …"` → `## enforce candidates` | nobody (listed in the wrap-up) | 10 lines |
| A graded `checker-miss: yes` | `decision-log.mjs case` → `docs/agent-evals/cases/<checker>/<date>-<kind>/` | the eval harness | one folder per miss |
| A problem seen in runs of any project (park, timeout, env-fail, by-hand toil, a lesson several projects sent) | the kit's `/kit-learn` (kit repository only): `kit-learn.mjs collect` → the ledger (`issues`) in the kit brain (`docs/agent/kit-brain.md` "Kit side") | the Human, as at most 5 cards and one reply line | one issue per signature, `proposals` row per card |
| A lesson true for every project | the kit's `kit-lessons.mjs add`, after the Human's `I<n> lesson <role>` → `docs/agent/kit-lessons/<role>.md` | every role at launch, before its project lessons (`LESSONS`); `/plan`'s review reads `planner.md` from both folders | 2,000 characters of live lines per role; retired only for a positive reason |
| Per decision kind, the agreement over every project's grades | `kit-learn.mjs triage-prior` → `docs/agent/kit-lessons/triage-calibration.md` | the report's decision view in `orch-state.mjs finish`, as a starting point for a kind the project has graded fewer than 20 times | one row per kind |

## 1. Agents log what they chose

- A behaviour the plan does not describe (what happens on edit, on leave, on cancel, on error; a new dialog, a new
  confirmation, an automatic action) gets the **simplest option** and a `decisions` entry that starts with `behaviour:`,
  names the choice and ends with how to reverse it. A Worker writes it in `## Execution Notes` as
  `- decision: behaviour: … — reverse: …`.
- Removing or narrowing user-facing behaviour the plan does not name (a key handler, an input mode, a field, a screen,
  a shortcut) is logged as `removes: <what users lose> — reverse: <how>` (Worker: `- decision: removes: …`); when the
  plan cannot be done without it, the agent stops (`ESCALATE`). The run report lists these first and adds a card each
  under "What only the Human can do".
- A defect noticed outside the agent's job is **not fixed**: a `decisions` entry that starts with `seen:` and names
  `file:line` (or the page and steps). Worker form: `- decision: seen: …`.
- `/plan`'s Architect + PM review asks a product question for a plan that adds or changes interactive behaviour and
  does not say what happens on edit / leave / cancel / error.

## 2. The Human grades in one reply

The run report (`/orchestrate` step 4) or the `/ship` tree numbers the decisions `D1…Dn`, every `removes:` line first, then grouped by plan, `behaviour:`
first, and ends with the format:

```text
Reply: decisions: ok  |  D<n> ✗ <what I'd choose>   (several on one line, comma-separated)
```

A `failed:` card reply (`job-validation.md`) is graded the same way; the learning step treats each failed card as
`C<n> ✗ <what I saw>`.

## 3. The learning step — automatic, only when something was graded wrong

Runs after **Y** in `/ship` (On approval, between steps 1 and 2; only when `review.learn` is `on`) and after the decisions reply in `/orchestrate` (step 5). The Human
runs no command.

0. **Grade first, every reply.** Before the gate below, every grade reply — `decisions: ok` included — is stored by
   `decision-log.mjs grade` (§5): in `/orchestrate` by the workflow, in `/ship` with `--run ship-<NNN>` on the list
   `decision-log.mjs pending` wrote and `--mark <plan file>`, which tags the graded plan lines (§5 "In `/ship`").
1. `node scripts/decision-log.mjs learn --reply "<the Human's replies>"` — no `✗` and no `failed:` prints
   `LEARNING: nothing to record`: one line, **no model call**, stop here.
2. **Log.** Write the decisions list to a scratch file (`[{ "id": "D1", "plan": "451", "text": "…" }]`; failed cards as
   `C<n>`), give each `✗` a short kind slug (`confirm-dialog-on-leave`) and whether a checker should have caught it,
   then `node scripts/decision-log.mjs add --reply "<graded reply>" --decisions <file> --kinds D3=<slug>
   --checker-miss D3=yes|no`. It appends one row per `✗` to `docs/brain/decision-log.md`; a malformed reply is refused
   with a usage line and nothing is written.
3. **Rule — from the first `✗`.** `add` prints a `RULE_PROPOSAL <id> <kind> pending` line for a `✗` whose kind has no
   earlier row. In the same model step that classifies the kind, answer one of two things per such line: whether a
   check, a hook or a test could catch the mistake instead of a rule — then `rules --add "enforce: <what would catch
   it, one line>"`, which files it under `## enforce candidates` (cap 10 lines; no agent reads it) — or
   `rules --add "<rule, one line>" --pending --kind <kind>`, which writes the rule marked ` (pending — seen once)`.
   `node scripts/decision-log.mjs repeats` lists kinds logged twice or more and promotes their pending rules (drops the
   mark); a kind that repeats with no pending rule gets one written now, as before. A `checker-miss: yes` also gets a
   rule for `## checkers` (`--section checkers`, same step; `no rule` skips it) and its eval case (item 5). Each section
   is capped at 30 lines / 2,400 characters (`rules --check` names the one that is over; pending lines count): when
   full, merge or drop an older rule first. The rules are shown in the wrap-up, with the enforce candidates under
   "Enforce candidates (a plan each, when you want them)" (`rules --enforce`); a plan from one is a normal `/plan`.
   `docs/brain/agent-rules.md` has one section per role; builders read `## builder`, never `decision-log.md`.
4. **Kit feedback.** A lesson that is true for any project — not tied to this product's screens, names or code —
   goes to the kit. On a machine set up for the kit brain (`KIT_BRAIN_URI` set, `docs/agent/kit-brain.md`) the same
   command sends it to the brain's `lessonsIn` collection, after the same refusals, and opens no pull request; the rest of
   this item describes the pull-request path used otherwise. The graded rows written by `grade` (item 1) are sent to the
   brain too, `ok` and `✗` alike. `node scripts/kit-feedback.mjs --title "<title>" --text "<the lesson, general terms>"`. By default it opens a
   pull request on the kit repository (`.kit/install.json` `source`) with one file under `feedback/inbox/`, and
   **refuses** (exit 2, nothing pushed) text that names the project or its repository, a path under `paths.srcRoot` /
   `paths.serverRoot`, or holds a code fence. Rewrite the lesson without them, or keep it project-local. `--text-file`
   reads only a scratch file under the OS temp folder or `.claude/sessions/` (never a dotfile or a `..` path). The kit's
   Planner turns inbox entries into plans and deletes them when done.
5. **Eval cases — automatic for a checker miss.** A `✗` graded `checker-miss: yes` becomes an eval case with no model
   call and no command from the Human: `node scripts/decision-log.mjs case --from D<n> --run <name> [--checker
   orch-check-bugs] [--dir <folder>]` writes `docs/agent-evals/cases/<checker>/<date>-<kind>/` in the harness shape
   (`docs/agent/agent-evals.md` "Case shape"): `input/plan.md`, `input/diff.patch` (the hunk around the decision's
   `file:line`), the touched file under `input/`, `expected.json` (one finding there; the note starts
   `human-verdict <date>: <the Human's line>`) and a `README.md` naming the finder that ran. Such a case holds project
   code, so it stays in the project's own case set; only a generic one goes to the kit. The wrap-up prints the path;
   `orch-state.mjs brain-commit` commits it on the run branch.

## 5. Triage, grades and follow-ups (orchestrator and `/ship`)

- **In `/ship`** (only when `review.learn` is `on` — this project: `off`; `off` shows no decisions, grades
  nothing, runs no learning step and proposes no brain entry). A Worker plan's decisions are the `- decision:` lines of
  its `## Execution Notes`. Under the Phase 4 tree: `node scripts/decision-log.mjs pending --plan <the plan file> --out
  <scratch>/decisions.json` (`<scratch>` = a temporary folder outside the repo) lists the ones with no
  `[graded D<n> ok|✗ YYYY-MM-DD]` tag as `D<n> · …` lines, `removes:` first, then `behaviour:`, then `seen:`, numbered on
  from the highest graded `D<n>`, so an id never repeats within the plan across sessions and checkpoints. Print them as
  they are and end with the reply format of §2; the grade may ride on the `Y` reply (`Y, D2 ✗ no dialog`).
  `DECISIONS: none to grade` → print nothing. On Y, for every grade reply — `decisions: ok` included — run
  `node scripts/decision-log.mjs grade --run ship-<NNN> --reply "<the Human's grade reply>" --decisions <scratch>/decisions.json --mark <the plan file>`
  (`<NNN>` = the plan number; the run name stays the same across sessions and checkpoints): it stores every item (`ok`
  ones too) in `decision-grades.jsonl`, adds the `seen:` items to `docs/brain/follow-ups.md` and tags the graded lines.
  Then the learning step (§3): `node scripts/decision-log.mjs learn --reply "<the Human's replies this session>"`. The
  plan file, the `docs/brain` files and any new `docs/agent-evals/cases/<checker>/<case>` folder join the ship's one
  commit; the wrap-up lists new rules, case paths and the enforce candidates. `/ship` has no triage, so the rows carry `triageVerdict: none`: they never count toward the triage
  agreement (`stats`, the kit's `triage-prior`), but their `seen:` items become follow-ups like the orchestrator's. The
  grades, the follow-ups and the tagged plan file are committed with the ship.

- **One line per decision.** `orch-state.mjs decision` merges a differently worded repeat in code: the same type, in the same plan
  (a `seen:` defect in any plan), and either the same `file:line` named or 60 % of the words alike with no different
  `file:line`. The first wording is kept; the repeats stay under it as `also:` lines. Code merges only near-identical wordings. Decisions live in `status.json`
  (`decisions[]`), so a relaunch numbers on from the highest earlier id and files a repeat of an earlier decision under it.
- **No triage agent.** The report shows every decision (shadow view); the hard rules still apply in code: a
  type other than `behaviour` or `seen`, and a decision naming auth, permissions, data shape, money or security, is `ask`.
- **Grades.** After the Human's reply `decision-log.mjs grade` appends one JSON line per decision, `ok` ones included, to
  `decision-grades.jsonl` (in `docs/brain/`) (13 fields; never twice for one run and id). `stats` prints the agreement per kind from them.
- **Follow-ups.** Every graded `seen:` item becomes a row in `docs/brain/follow-ups.md`. `/plan`'s review lists the open rows for the files a
  new plan touches (`decision-log.mjs follow-ups --open --files …`); a plan that takes one writes `- follow-up: <run> <id>`
  in its Execution Notes. The grades and follow-ups are committed on the run branch
  (`orch-state.mjs brain-commit`), so the pull request carries them.

## 4. Final gate (orchestrator)

After the last merge, one gate runs the project's full build and test once on the run branch; a failure is a finding in
the report and the branch is not handed over as clean (`docs/agent/orchestrator.md`).
