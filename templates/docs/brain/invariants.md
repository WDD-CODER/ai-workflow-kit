# Architecture invariants

The load-bearing runtime rules of {{project.name}}, as a checklist. ADRs in `decisions/` keep
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

## INV-1 — <title>
- Rule: <one line>
- Source: <ADR / file>
- Touches: `<glob>`, `<glob>`
- Users lose if broken: <plain words>
- Test: <test file "INV-1 …" | none>
