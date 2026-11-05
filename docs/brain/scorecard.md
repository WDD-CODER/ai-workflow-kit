# Run scorecard

One row per run of any kind (orchestrator or worker), in any project. Hand-kept: every run, orchestrator or `/ship`, adds
one row before its lessons are read. `?` = not measured yet. Project names are not written here (CI's leak-check
scans `docs/brain/`): write `kit` for this repository and `app project` (or another neutral label) for any other.

| Date | Project | Kit version | Mode (orchestrator/worker) | Plans merged/total | Tokens | Minutes to merge | Human minutes | Technical stops |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-04 | app project | v2.0.0 | orchestrator | 1/2 | 755k | 45 | ? | 1 (run-513-516c) |
| 2026-11-04 | kit | v2.0.0 | orchestrator | 1/1 | 633k | 74+ | ? | 1 (run-065) |
| 2026-11-05 | kit | v2.0.0 | worker (plan 075, /ship) | 1/1 | ? | ? | 0 | 0 |
