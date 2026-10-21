# /plan — Planning Path

Use this path for product planning, PRDs, HLDs, and technical design decisions.
The **Planner** (Claude Code in the main folder) is the Architect and the Product Manager.
Claude.ai or another tool may draft a plan; the Planner still runs the review below before saving.

## Loads

- `.claude/references/prd-template.md` — product requirements / Plan Contract template
- `.claude/references/hld-template.md` — high-level design template
- `docs/project/tech-stack.md` + `docs/project/current-state.md` — stack + capsule
- `docs/brain/invariants.md` — architecture invariants (Architecture Impact)
- `docs/project/plan-checks.md` — this project's own planning checks (when the file exists)
- `docs/agent/` — path-scoped standards (loaded when the plan touches matching areas)

## Invokes

- The Planner, with the Human — writes / updates a Plan Contract in
  `plans/NNN-slug.plan.md` (via `.claude/skills/save-plan/SKILL.md`)
- Does **not** invoke agent personas: the Architect and PM work is a conversation with the Human,
  run inline by the Planner

## Typical flow

1. User describes the problem or feature area.
2. The Planner runs structured scoping (forcing questions, landscape, premise challenge), asking only
   where the decision is the Human's, and writes the plan to the PRD template. Then it runs the
   **Architect + PM review** below on its own draft. It fixes what it can, and the review block lists
   each fix, so the Human sees what changed.
   **Architecture step:** read `docs/brain/invariants.md` and fill the plan's
   `## Architecture Impact` — one line per invariant whose `Touches` globs the scope reaches
   (`preserves` / `deviation until …` / `changes — ADR …`), or `INV-none: preserves — <why>`.
   A question whose answer could break an invariant is asked as: INV-n · current rule ·
   proposed change · who loses what. A yes needs the Human's explicit `approve arch change INV-n`,
   then a superseding ADR plus an `Arch-approved: Human YYYY-MM-DD` line.
3. Output: a Plan Contract under `plans/NNN-slug.plan.md` in the PRD template's shape. Its
   `## Atomic Sub-tasks` are the milestones. Each success criterion is tagged `[auto]` or `[human]`,
   and an `[auto]` one names the exact check that proves it. Persist with save-plan (never invent a
   parallel naming scheme).
4. User approves the plan → save via the Planner protocol below → say "execute plan NNN"
   in a free `wt-N` slot to start work (`.claude/commands/take-plan.md`) → `/review-it`.

## Architect + PM review (always)

Runs on **every plan the Planner saves**: plans it writes, and briefs or Plan Contracts it receives
(Claude.ai, Cursor, another agent, a paste). It also runs on a brief or a feature request when the Human
picks **a** at the `brief-detection` gate: the same review, and nothing is saved. Workers in slots do not
author plans; a Plan Contract saved
mid-brief inside a slot goes through save-plan only. Check against the real codebase on
`origin/main` (fetched), not against what the draft says exists.

**Architect**
- `## Architecture Impact` is filled from `docs/brain/invariants.md` (the architecture step above);
  `node scripts/scope-check.mjs --arch --plan=<path>` reports nothing missing.
- Every file, symbol, script and service the plan names exists on `origin/main`, or is
  marked new.
- The design follows the project's standards doc (`(not set)`) and the patterns the code
  already uses; a new pattern is named and justified.
- `## Read-Write Scope` covers every file the steps write, and nothing more.

**Product Manager**
- The problem and the success criteria are testable; every Done-when item is tagged `[auto]` or `[human]`.
- `## Out of Scope` is written.
- Named, or marked "none": backend / API impact, auth and validation needs, security surface,
  data / migration impact.
- The plan is the smallest version that delivers the full value — no forced alternatives, no gold-plating.
- **Every step names its files and is concrete enough for a Worker to run without asking**: no "TBD",
  "handle errors appropriately", "same as the other screen".
- The project's own checks in `docs/project/plan-checks.md`, when that file exists.

**Overlap** (every time, also on a brief that is not a plan yet)
- Run `node scripts/plan-name-similarity.mjs --name="<the draft's title>" --related --scope="<the draft's
  scope globs, comma-separated>"`. It searches open and closed plans: by title (`PLAN_SIMILARITY`), by
  text (`PLAN_RELATED`), and the open plans' Read-Write Scope for the same files (`PLAN_SCOPE_OVERLAP`).
  For a brief, use its one-line goal as the title. No scope yet: leave out `--scope`.
- Read each plan it lists. Keep a plan as an `open:` line only when it may be the same work ("same work as
  `<path>`?") or shares a file with the draft ("shares `<files>` with `<path>` (Status: …)"), unless the draft
  already names it. List every other plan you read on one line: `checked: <plan numbers>`.

**Output** — one block, printed before the plan is saved. One line per gap:

```
ARCHITECT + PM REVIEW
fixed: <gap> → <what you changed>
open: <gap> — <question for the Human>
checked: <plan numbers the overlap search listed that are not the same work>
```

- `fixed:` is a gap you closed in the draft yourself. List every one, also on a plan you wrote.
- `open:` is a gap that needs the Human: a decision, a missing fact, or a possible overlap.
- Print `no gaps` only when there is no `fixed:` line and no `open:` line (a `checked:` line can stay).

**On a brief (option a at the `brief-detection` gate)** there is no plan file yet. Check only: what the brief
assumes about the codebase (files, behaviour, services exist on `origin/main`), the decisions
that belong to the Human, whether the result can be tested, and the overlap search. Plan sections (Read-Write
Scope, Architecture Impact, Out of Scope, `scope-check --arch`) are not gaps until `/plan` writes the plan. Print
`open:` and `checked:` lines only — no `fixed:` lines, because nothing is written.

A received plan is reviewed, not rewritten: the Planner fixes only the obvious mechanical gaps (paths,
titles, tags) as `fixed:` lines and asks the rest as `open:` lines. It applies the fixes the Human
accepts. A gap the Human rejects is noted in the plan's `## Execution Notes` (the gap, and "kept as is:
Human"); then continue. A decision that belongs to the Human is asked, never assumed.

## Planner protocol (pushing to `main`)

Only the Planner (main folder, checked out on `main`) runs this. It is the one place code
review docs allow a direct push to `main` — restricted to `plans/*.plan.md` and
`.claude/todo.md` by `scripts/branch-guard.sh` and `.husky/pre-push`.

0. `git fetch origin`, then run the **Architect + PM review** above against the fetched
   `origin/main` and print its block. `open:` lines → wait for the Human's answer and apply the
   accepted fixes before step 4. A plan the Planner wrote and already reviewed in this
   session is not reviewed twice; print the block it got.
1. Main must be clean and on `main`: `git status --porcelain` empty, `git branch
   --show-current` = `main`. Otherwise STOP and ask the Human. Then `git pull --ff-only`.
2. Run `node scripts/todo-query.mjs sync --merged`, then `node scripts/todo-archive.mjs` (the todo-sync
   Action already does both after every merge; running them again is a no-op),
   then `node scripts/free-merged-slots.mjs` (detaches any `wt-N` whose branch already
   merged into `origin/main` back to idle), then `node scripts/lib/slot.mjs --list` to see
   current slot occupancy.
3. Ask: "Will this plan run in parallel with other active plans?" If yes, run
   `node scripts/scope-check.mjs --overlap --plan=<path>` — it must report `OVERLAP: none`
   before saving; a real overlap means narrowing the `## Read-Write Scope` first.
   Every plan carries a `Depends-on:` header line (`Depends-on: none` when nothing comes first):
   `node scripts/scope-check.mjs --deps --plan=<path>` must print `DEPENDS_ON: ok`. For a set of plans,
   `node scripts/plan-order.mjs <NNN …>` prints the run order — waves (what can run in parallel), lanes, lock
   groups from scope overlap, and the reason of every edge (`--json` for tools).
4. Save via `.claude/skills/save-plan/SKILL.md` with `Status: draft`. Leave `Snapshot:` as
   the author wrote it (the SHA they verified the plan against) — only fill it with the
   current `origin/main` SHA if the draft left it empty. Never overwrite an already-filled
   `Snapshot:`; that value is what `scope-check.mjs --drift` diffs against at take-plan time,
   and overwriting it to "now" would hide drift between when the plan was written and when
   it was saved.
5. `git add` only the plan file and `.claude/todo.md` (never `-A`), then commit and push
   to `main` directly.
6. End with: `Plan NNN pushed. Open a free slot and say: execute plan NNN.`

A plan drafted outside the main folder (Claude.ai, another tool) is only a draft: the Planner reviews
it (step 0), saves it (assigns `NNN`, runs the ledger sync), commits, and pushes.

## Notes

- Planning is read-only against the app. No product-code changes happen in this path.
- Output of `/plan` is always a Plan Contract (or design doc), never application code.
- Implementation happens in a Worker slot after approval ("execute plan NNN"), or on the Human's explicit
  execute override.
- Live convention is `plans/NNN-slug.plan.md` only (`NNN-R-slug.plan.md` for refactor
  variants). Tooling (`save-plan`, `plan-write-guard.sh`, `plan-name-similarity.mjs`)
  recognizes that form exclusively.
