# /plan — Planning Path

Use this path for product planning, PRDs, HLDs, and technical design decisions.
In the three-agent workflow, planning is the **Architect** role (Claude.ai by default;
Claude Code / Cursor may plan when the Human Director explicitly overrides).

## Loads

- `.claude/references/prd-template.md` — product requirements / Plan Contract template
- `.claude/references/hld-template.md` — high-level design template (when present)
- `/_shared/tech-stack.md` + `/_shared/current-state.md` — stack + capsule
- `docs/agent/` — path-scoped standards (loaded when the plan touches matching areas)

## Invokes

- Architect (Human-directed) — writes / updates a Plan Contract in
  `plans/NNN-slug.plan.md` (via `.claude/skills/save-plan/SKILL.md`)
- Does **not** invoke the retired `(retired)` or `(retired)` agents

## Typical flow

1. User describes the problem or feature area.
2. Architect runs structured scoping (forcing questions, landscape, premise challenge).
3. Output: a Plan Contract under `plans/NNN-slug.plan.md` with numbered milestones
   and a Verify command per milestone. Persist with save-plan (never invent a
   parallel naming scheme).
4. User approves the plan → save via the Planner protocol below → say "execute plan NNN"
   in a free `{{slots.nameFormat}}` slot to start work (`.claude/commands/take-plan.md`) → `/review-it`.

## Planner protocol (pushing to `main`)

Only the Planner (main folder, checked out on `main`) runs this. It is the one place code
review docs allow a direct push to `main` — restricted to `plans/*.plan.md` and
`.claude/todo.md` by `scripts/branch-guard.sh` and `.husky/pre-push`.

1. Main must be clean and on `main`: `git status --porcelain` empty, `git branch
   --show-current` = `main`. Otherwise STOP and ask the Human. Then `git pull --ff-only`.
2. Run `node scripts/todo-query.mjs sync --merged`, then `node scripts/todo-archive.mjs`,
   then `node scripts/free-merged-slots.mjs` (detaches any `{{slots.nameFormat}}` whose branch already
   merged into `origin/{{git.mainBranch}}` back to idle), then `node scripts/lib/slot.mjs --list` to see
   current slot occupancy.
3. Ask: "Will this plan run in parallel with other active plans?" If yes, run
   `node scripts/scope-check.mjs --overlap --plan=<path>` — it must report `OVERLAP: none`
   before saving; a real overlap means narrowing the `## Read-Write Scope` first.
4. Save via `.claude/skills/save-plan/SKILL.md` with `Status: draft`. Leave `Snapshot:` as
   the Architect wrote it (the SHA they verified the plan against) — only fill it with the
   current `origin/{{git.mainBranch}}` SHA if the draft left it empty. Never overwrite an already-filled
   `Snapshot:`; that value is what `scope-check.mjs --drift` diffs against at take-plan time,
   and overwriting it to "now" would hide drift between when the plan was written and when
   it was saved.
5. `git add` only the plan file and `.claude/todo.md` (never `-A`), then commit and push
   to `main` directly.
6. End with: `Plan NNN pushed. Open a free slot and say: execute plan NNN.`

A Claude.ai Architect only drafts the plan body — Claude Code in the main folder is what
saves it (assigns `NNN`, runs the ledger sync), commits, and pushes.

## Notes

- Planning is read-only against the app. No product-code changes happen in this path.
- Output of `/plan` is always a Plan Contract (or design doc), never application code.
- Use Cursor (Contractor) or an explicit execute override to implement after approval.
- Live convention is `plans/NNN-slug.plan.md` only (`NNN-R-slug.plan.md` for refactor
  variants). Tooling (`save-plan`, `plan-write-guard.sh`, `plan-name-similarity.mjs`)
  recognizes that form exclusively.
