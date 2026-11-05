# Follow-ups

Defects and gaps agents saw outside their job (`seen:` decisions, and `behaviour:` ones the triage called follow-up), kept after the Human graded them (`docs/agent/decision-review.md` §5). Written by `node scripts/decision-log.mjs grade` — never by hand. `/plan`'s review lists the open ones for the files a new plan touches; a plan that takes one writes `- follow-up: <run> <id>` in its Execution Notes.

| Date | Run | Plan | Id | File:line | Decision | Human |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-05 | run-065 | 065 | D6 | - | seen: tools/test/orchestrator.test.mjs test 'final gate: PROJECT_CHECKS, then the manifest check, then orchestrator.ciMirror' already fails on main since commit 332c5e9 (the kit's own ciMirror list); it is not in `npm run test`. Not touched. | ok |
| 2026-11-05 | run-065 | 065 | D9 | tools/test/orchestrator.test.mjs:2200 | seen: tools/test/orchestrator.test.mjs:2200 — on Windows the temp-folder cleanup (rmSync) of the "relaunch that never reaches its final gate" test hit EPERM in my rerun. That is a test-harness cleanup problem, not a 065 change. | ok |
