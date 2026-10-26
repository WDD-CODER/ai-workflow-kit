# Decision review — the Human grades unasked choices, lessons flow back

> Load when: a run report or a `/ship` tree lists decisions to grade, the Human replies with `D<n> ✗ …` or `failed: …`,
> or `docs/brain/agent-rules.md` / `decision-log.md` is written. Hard rule lives in `AGENTS.md`.

The checkers judge code against the plan and the rules. They do not judge a product choice nobody asked for (a "save
changes?" dialog on leaving a screen, an automatic action). This loop makes those choices visible, graded and
remembered, at almost no cost: the only model work is one short step, and only when the Human graded something wrong.

## 1. Agents log what they chose

- A behaviour the plan does not describe (what happens on edit, on leave, on cancel, on error; a new dialog, a new
  confirmation, an automatic action) gets the **simplest option** and a `decisions` entry that starts with `behaviour:`,
  names the choice and ends with how to reverse it. A Worker writes it in `## Execution Notes` as
  `- decision: behaviour: … — reverse: …`.
- A defect noticed outside the agent's job is **not fixed**: a `decisions` entry that starts with `seen:` and names
  `file:line` (or the page and steps). Worker form: `- decision: seen: …`.
- Before building, `orch-readiness` asks a product question for a plan that adds or changes interactive behaviour and
  does not say what happens on edit / leave / cancel / error.

## 2. The Human grades in one reply

The run report (`/orchestrate` step 4) or the `/ship` tree numbers the decisions `D1…Dn`, grouped by plan, `behaviour:`
first, and ends with the format:

```text
Reply: decisions: ok  |  D<n> ✗ <what I'd choose>   (several on one line, comma-separated)
```

A `failed:` card reply (`job-validation.md`) is graded the same way; the learning step treats each failed card as
`C<n> ✗ <what I saw>`.

## 3. The learning step — automatic, only when something was graded wrong

Runs after **Y** in `/ship` (On approval, step 2) and after the decisions reply in `/orchestrate` (step 5). The Human
runs no command.

1. `node scripts/decision-log.mjs learn --reply "<the Human's replies>"` — no `✗` and no `failed:` prints
   `LEARNING: nothing to record`: one line, **no model call**, stop here.
2. **Log.** Write the decisions list to a scratch file (`[{ "id": "D1", "plan": "451", "text": "…" }]`; failed cards as
   `C<n>`), give each `✗` a short kind slug (`confirm-dialog-on-leave`) and whether a checker should have caught it,
   then `node scripts/decision-log.mjs add --reply "<graded reply>" --decisions <file> --kinds D3=<slug>
   --checker-miss D3=yes|no`. It appends one row per `✗` to `docs/brain/decision-log.md`; a malformed reply is refused
   with a usage line and nothing is written.
3. **Rule.** `node scripts/decision-log.mjs repeats` lists kinds logged twice or more. For each, write one short rule
   (what to do instead, one line) and add it with `node scripts/decision-log.mjs rules --add "<rule>"`. The file is
   capped at 30 lines / 2,400 characters (`rules --check`): when full, merge or drop an older rule first. The rule is
   written on the same reply as the brain entry and shown in the wrap-up; `no rule` in the reply skips it. Builders read
   `docs/brain/agent-rules.md`, never `decision-log.md`.
4. **Kit feedback.** A lesson that is true for any project — not tied to this product's screens, names or code —
   goes to the kit: `node scripts/kit-feedback.mjs --title "<title>" --text "<the lesson, general terms>"`. It opens a
   pull request on the kit repository (`.kit/install.json` `source`) with one file under `feedback/inbox/`, and
   **refuses** (exit 2, nothing pushed) text that names the project or its repository, a path under `paths.srcRoot` /
   `paths.serverRoot`, or holds a code fence. Rewrite the lesson without them, or keep it project-local. The kit's
   Planner turns inbox entries into plans and deletes them when done.
5. **Eval cases.** A graded decision can become a checker eval case (`docs/agent/agent-evals.md`, label
   `human-verdict <date>:`). Such a case holds project code, so it stays in the project's own case set;
   only a generic one goes to the kit.

## 4. Pilot and final gate (orchestrator)

A run with more plans than `orchestrator.pilotSize` builds the first plans in wave order, stops with the report and the
decisions, and starts the rest on the Human's `continue` — with the graded decisions and any new rule already in place.
After the last merge, one gate runs the project's full build and test once on the run branch; a failure is a finding in
the report and the branch is not handed over as clean (`docs/agent/orchestrator.md`).
