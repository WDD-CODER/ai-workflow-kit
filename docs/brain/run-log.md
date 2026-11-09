# Run log

One row per orchestrator run, written by `node scripts/orch-state.mjs finish` from the run's `status.json` — never by hand. The `✗` columns of a run are filled by the next `finish`, from `decision-log.md` (a log row belongs to the run whose plan list holds its plan number); the newest run's stay `-` until then. The table keeps the 20 newest rows; older ones are rolled into one `Earlier (N runs): …` line above it.

| Date | Run | Plans | Merged | Parked | Parked reasons | Fix rounds | Escalations | Gate fails | Final gate | ✗ | Checker misses | ✗ per plan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-05 | run-065 | 065 | 0 | 0 | - | 1 | 0 | 1 | ok | 0 | 0 | 0 |
| 2026-11-07 | first | 092 | 1 | 0 | - | 0 | 0 | 0 | ok | 0 | 0 | 0 |
| 2026-11-08 | run-095 | 095,098,099 | 1 | 1 | same-reason-twice | 1 | 1 | 0 | ok | 0 | 0 | 0 |
| 2026-11-08 | run-100 | 100,101,102,103,104 | 1 | 1 | environment | 1 | 1 | 0 | ok | - | - | - |
