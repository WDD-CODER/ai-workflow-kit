# Error review

Kit freeze (Human, 2026-11-07): no new kit plans until 10 real plans have run through `scripts/run-plans.mjs`. A kit bug
found in a run gets one line here, not a plan. Real runs so far: 1 of 10.

| Date | Run | Plan | What failed | Why |
| --- | --- | --- | --- | --- |
| 2026-11-07 | first | 092 | `--dry-run` printed the builder with `--model sonnet`; the real builder call ran `--model opus` (727k input tokens). | The dry run used `MODELS.build`; the real call used the start tier, and `startTier()` sent every plan naming an invariant (`INV-1: preserves` too) to the judgment tier. Fixed before the freeze (merged f774da9, ADR 0020): one shared builder call, `preserves` starts on build. |
| 2026-11-08 | run-517 | — | The per-plan gate passed `kit-manifest-check`; the final gate failed it on the run branch, with no fix round left. | The per-plan gate runs the main folder's `kit-manifest-check.mjs` by absolute path, so it checks the main folder's tree, not the plan's (`first-run-audit-2026-11-08.md` Part 4 item 6). |
| 2026-11-08 | run-517 | — | An e2e check the builder wrote could not run in its folder and became a human card. | The app's Playwright `baseURL` is hard-coded instead of read from the environment (`E2E_BASE_URL`), so a builder folder or a served slot cannot point it elsewhere (Part 4 item 9). |
| 2026-11-08 | run-517 | — | `docs/agent/decision-review.md` sends the reader to `/orchestrate` step 5. | The command has 4 steps; the reference is dangling (Part 4 item 12). |
| 2026-11-08 | run-517 | — | A park reason said "replan needed … on the run branch". | Plans live on `main`; the replan wording in `docs/agent/orchestrator.md` names the wrong branch (Part 4 item 13). |
