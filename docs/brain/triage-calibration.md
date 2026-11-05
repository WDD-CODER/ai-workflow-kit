# Triage calibration

Written by `node scripts/decision-log.mjs stats --write` from `decision-grades.jsonl`. The triage agent reads it; never edit it by hand.

Agreement over the last 9 graded: 89%

| Kind | Graded | Agreement |
| --- | --- | --- |
| - | 2 | 100% |
| category-filter | 1 | 100% |
| gate-tail-source | 1 | 0% |
| kept-existing-lines | 1 | 100% |
| lesson-template | 1 | 100% |
| preexisting-test-failure | 1 | 100% |
| silence-over-category | 1 | 100% |
| windows-test-cleanup | 1 | 100% |

Where the Human disagreed (newest last):
- 2026-11-05 gate-tail-source: triage ask, Human ok — behaviour: the failing file of a final-gate failure is found only by the workflow's finish call (whi
