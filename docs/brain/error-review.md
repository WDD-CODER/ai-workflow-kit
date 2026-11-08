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
| 2026-11-08 | run-095 | 095, 098 | Three builder calls were stopped at the 20-min limit with 0 tokens recorded; each stop was escalated to the judgment model, which was stopped at the same limit. | The builder shared `gateTimeoutMin` (a wall clock); a working builder looks the same as a hung one. Fixed in 098: an idle limit on the folder's file changes, no wall clock. |
| 2026-11-08 | run-095 | — | The harness stopped the background run for low memory 35 min in; status stayed `running`. | A run in a background shell dies with memory pressure; `/orchestrate` now relaunches once (098), the Human had to free memory. |
| 2026-11-08 | run-095 | 095 | A plan that passed its gate parked: "review folder: git worktree add: fatal: Could not reset index file to revision 'HEAD'". | Windows path limit: the review folder name plus the kit's longest plan path (194 characters) reached 260. `git config core.longpaths true` fixed it on this machine; the kit does not set it or check for it. |
| 2026-11-08 | run-095 | 095 | A relaunch built 095 again from the start although its branch already held the built commit: three builder calls for one plan. | A relaunch reuses `feat/<NNN>` but starts the plan at round 0 with a fresh builder. |
| 2026-11-08 | run-095 | 098 | A builder ran 20 min (421k input tokens), left a plan change made after the first build undone and wrote a plan number into CHANGELOG.md, so the gate failed lint and tests. | The builder does not run lint before it answers, and a plan edited mid-run reaches it only as a merged plan file. The Planner finished 098 by hand. |
| 2026-11-08 | run-095 | — | One gate took about 10 min of checks (`run-plans.test.mjs` alone 6–8 min); a builder that runs it twice spends most of its time waiting. | The runner's own test file is slow; no split or focus option for a builder. |
