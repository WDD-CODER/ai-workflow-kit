# CURRENT STATE — ai-workflow-kit
> Updated when a kit plan merges. Feeds the Context Capsule "Current State" section.
- How work runs here (solo flow): `/plan` → plan saved and pushed on `main` → `git switch -c feat/NNN-<slug>`
  → build in this folder → `/ship` (build, lint, test, review, validation hand-off, PR) → Dandan merges →
  `git switch main` and `git pull`. No slots, no `.claude/todo.md`; the plan's own checkboxes are the record.
- Last completed: the kit installed into itself (solo flow, drift check in CI).
- Next: the orchestrator plans (011 plan order, 013 role agents, 014 orchestrator; then 017 guards, 018 UI tier,
  019 agent evals).
- Open bugs: —
- Key files: `tools/lib/kit.mjs` (render engine), `tools/install.mjs`, `tools/sync.mjs`, `tools/drift-check.mjs`,
  `.kit/config.json` (this repo's own config; `kit.config.json` is the scaffold every project starts from).
