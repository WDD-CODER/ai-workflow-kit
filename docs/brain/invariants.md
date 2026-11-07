# Architecture invariants

The load-bearing runtime rules of ai-workflow-kit, as a checklist. ADRs in `decisions/` keep
the reasoning; this file is what the gate checks.

Enforced from plan: 1

Every plan fills `## Architecture Impact` with one line per invariant its scope touches
(`node scripts/scope-check.mjs --arch --plan=<p>` blocks a plan that doesn't). Changing or
deviating from a rule needs the Human's explicit `approve arch change INV-n` in chat, an
`Arch-approved: Human YYYY-MM-DD` line, and for a change, a superseding ADR.

Each section below is parsed by `scripts/lib/invariants.mjs` — keep the exact shape:
`## INV-n — <title>`, then the five `- Field:` lines. `Touches` globs are backticked.
Add only rules whose breakage users would feel; workflow choices stay prose ADRs.
Delete this file to switch the gate off.

## INV-1 — Judgment roles run on a pinned strong model
- Rule: models.judgment names a model (default opus), never inherit; a failed plan's fresh builder and the first builder of a plan that names an invariant run on it; if that builder fails, the plan stops for the Human
- Source: docs/brain/decisions/0016-judgment-roles-run-on-a-pinned-strong-model.md
- Touches: `core/docs/agent/model-routing.md`, `core/scripts/run-plans.mjs`
- Users lose if broken: a hard plan is judged or rebuilt by whatever model the session uses, so a weak model can approve or merge wrong work unnoticed
- Test: tools/test/orchestrator.test.mjs "INV-1 …"
