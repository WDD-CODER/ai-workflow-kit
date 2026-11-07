# 087 — false-positive sample

Source: the plan-reviewer + orch-verify arm (Sonnet, redact-gate), 2026-11-07 — not the opus-redact-gate arm.

- Report: `docs/agent-evals/runs/plan-reviewer-verify-sonnet-redact-gate/plan-reviewer.json` (25 cases × 2 runs, `--role all`, same case list as plan 087).
- A finding is **fp** when the eval scorer's own matching (`matchFindings` in `tools/lib/agent-eval/compare.mjs`, the
  function `compareCase` uses: same file, rule category and severity, line within ±3) pairs it with no expected
  finding of its case. "Before verify" = the reviewer's raw problems; "after verify" = the problems orch-verify kept
  (verdict `keep` with confidence ≥ 80, at orch-verify's severity).
- Population: 75 fp before verify (55 kept, 20 dropped); 55 fp after verify.
- Sampling: mulberry32 PRNG + Fisher–Yates shuffle, first 10; seed **87** for table 1, **88** for table 2. Both groups have more than 10 findings.
- Finding text = the reviewer's `rule`, then its `reasoning` cut at 180 characters. Expected findings: `file:line severity [first accepted rules]`.

## 1. Ten fp findings before verify, with orch-verify's decision

| # | Case | File | Line | Severity | Finding | orch-verify | Expected findings of the case |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | orch-check-rules/planted-installed-copy-edited (run 1) | plan.md | 4 | major | installed copy: D1 is ticked [x] but the change is only in the rendered copy scripts/lib/slot-procs.mjs, not in core/scripts/lib/slot-procs.mjs — Sub-task D1 names the source 'core/scripts/lib/slot-procs.mjs' as the file to change. The diff touches only 'scripts/lib/slot-procs.mjs', which AGENTS.md says is rendered from core… | kept (keep 90) | scripts/lib/slot-procs.mjs:? major [agents.md / installed copy / …] |
| 2 | orch-check-bugs/fixed-018-ui-items-capital-x (run 2) | core/scripts/lib/done-when.mjs | 1 | major | done-when: the lint is not wired into scope-check.mjs --tags — The header says the module is shared by scripts/scope-check.mjs --tags, which is the save-plan shape lint. The diff does not change core/scripts/scope-check.mjs or the save-plan sk… | kept (keep 80) | core/scripts/lib/done-when.mjs:9 minor [logic / regex / …] |
| 3 | orch-verify/fixed-018-capital-x-and-crlf (run 1) | plan.md | 60 | major | A2: ticked sub-task only partly done — A2 covers save-plan SKILL.md, ship.md and done.md. None of them is in the diff, so the ship command is not taught about `[ui]`. The plan also names `tools/test/ui-tier.test.mjs` as… | kept (keep 90) | core/scripts/lib/done-when.mjs:9 minor [logic / wrong result / …] |
| 4 | orch-verify/fixed-010-lockfile-and-false-alarms (run 1) | plan.md | 1 | major | D3: Tests for the four install cases are ticked but absent from the diff — Atomic Sub-task D3 is ticked [x] ('Prove the four install cases with a small test — tools/test/slot-procs-install.test.mjs'), and Functional Requirement 5 requires that file. The d… | kept (keep 88) | core/scripts/lib/slot-procs.mjs:499 major [logic / wrong result / …] |
| 5 | orch-check-bugs/planted-inverted-comparison (run 2) | core/scripts/orch-preflight.mjs | 59 | blocker | A3: disk check condition is inverted — The code reads `if (free > MIN_FREE_GB) return bad('disk', ...)`. The header and the plan say the check passes when free disk >= orchestrator.minFreeDiskGb. With 100 GB free and a… | kept (keep 97) | core/scripts/orch-preflight.mjs:59 major [logic / inverted condition / …] |
| 6 | orch-check-bugs/fixed-017-cd-unknown-folder (run 2) | core/scripts/lib/guard.mjs | 586 | major | done-when: deny never exits 2 — Done-when item 1 expects a denied write to give 'output contains `SCOPE_GUARD:` and exit 2'. guard.mjs always calls process.exit(0) after emit(). No changed wrapper in the diff map… | dropped (keep 55) | core/scripts/lib/guard.mjs:330 major [logic / security / …] |
| 7 | orch-verify/fixed-018-capital-x-and-crlf (run 2) | plan.md | 24 | major | done-when: [ui] tag not added to the four named files — The criterion is '[auto] `grep -l "\[ui\]" core/docs/agent/job-validation.md core/.claude/skills/save-plan/SKILL.md core/.claude/references/prd-template.md core/.claude/commands/sh… | kept (keep 88) | core/scripts/lib/done-when.mjs:9 minor [logic / wrong result / …] |
| 8 | orch-verify/fixed-018-capital-x-and-crlf (run 1) | plan.md | 59 | major | A1: ticked sub-task has no change in the diff — A1 is ticked [x] ('Define the UI tag ... core/docs/agent/job-validation.md, core/.claude/references/prd-template.md'). The diff adds only core/scripts/lib/done-when.mjs and touches… | kept (keep 92) | core/scripts/lib/done-when.mjs:9 minor [logic / wrong result / …] |
| 9 | orch-verify/fixed-017-short-path-and-home (run 1) | plan.md | 121 | major | A4: ticked sub-tasks whose changes are not in the diff (hook wiring and sync) — A2, A3, A4, A5, A6 and A7 are ticked [x] and name core/scripts/scope-guard.sh, branch-guard.sh, plan-write-guard.sh, ship-prep.mjs, core/.claude/settings.json, standards-git.md and… | kept (keep 85) | core/scripts/lib/guard.mjs:44 major [security / wrong result / …] |
| 10 | orch-check-bugs/clean-011-plan-graph (run 1) | core/scripts/lib/plan-graph.mjs | 59 | major | A3: plan-scope.mjs and the config hotspots are not wired in — A3 names core/scripts/lib/plan-scope.mjs, and the done-when says the config hotspots (`paths.hotspots`, `project.i18nFile`) are left out of the overlap. The diff adds no plan-scope… | kept (keep 80) | (none — clean case) |

## 2. Ten fp findings that survived verify

| # | Case | File | Line | Severity | Finding | Expected findings of the case |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | orch-check-bugs/clean-013-agent-result (run 2) | plan.md | 1 | major | done-when: contract test tools/test/agent-contracts.test.mjs is missing — The [auto] criterion 'A contract test (`tools/test/agent-contracts.test.mjs`) feeds each agent file's documented JSON schema example to the shared result validator and passes' (and… | (none — clean case) |
| 2 | orch-check-bugs/planted-lost-escape (run 1) | plan.md | 88 | major | A2: ticked sub-tasks have no change in the diff — The diff adds only core/scripts/lib/plan-deps.mjs. A2, A3, A5, A6 and A7 are ticked [x]. They need core/scripts/plan-order.mjs, lib/plan-scope.mjs, the scope-check --deps flag, the… | core/scripts/lib/plan-deps.mjs:85 major [logic / regex / …] |
| 3 | orch-check-bugs/fixed-018-ui-items-capital-x (run 2) | plan.md | 70 | major | A7: ticked sub-task has no change in the diff — A7 is ticked [x] and promises 'tag lint tests', the orchestrator fixture, tools/orchestrator-e2e.mjs, tools/test/ui-tier.test.mjs, a CHANGELOG entry and a sync. The diff adds only… | core/scripts/lib/done-when.mjs:9 minor [logic / regex / …] |
| 4 | orch-check-bugs/clean-011-plan-graph (run 1) | plan.md | 1 | major | A1: the shared Depends-on parser and template changes are missing — P0 requires '`Depends-on: NNN, MMM` (or `none`) ... read by `scripts/lib/` (one shared parser...)'. P1 requires legacy 'Prerequisite: plan 007 merged' prose to be read as a depende… | (none — clean case) |
| 5 | orch-check-bugs/fixed-017-cd-unknown-folder (run 1) | plan.md | 27 | major | done-when: tools/test/guards.test.mjs is not in the diff — The first [auto] criterion is 'node --test tools/test/guards.test.mjs passes', and A1 is ticked [x] with 'tools/test/guards.test.mjs' as its file. The diff adds only core/scripts/l… | core/scripts/lib/guard.mjs:330 major [logic / security / …] |
| 6 | orch-verify/fixed-018-capital-x-and-crlf (run 2) | plan.md | 27 | major | done-when: lint tests missing and lint not wired into scope-check --tags — The criterion says the save-plan shape lint is 'tested in `tools/test/ui-tier.test.mjs`'. That test file is not in the diff. The new done-when.mjs says it is shared by scope-check.… | core/scripts/lib/done-when.mjs:9 minor [logic / wrong result / …] |
| 7 | orch-verify/fixed-017-short-path-and-home (run 1) | plan.md | 30 | major | done-when: the guards.test.mjs criterion has no test in the diff — The first [auto] item says 'node --test tools/test/guards.test.mjs passes' with cases (1)-(5). A1 is ticked [x] and names tools/test/guards.test.mjs as the file to add. The diff ad… | core/scripts/lib/guard.mjs:44 major [security / wrong result / …] |
| 8 | orch-verify/fixed-018-capital-x-and-crlf (run 2) | plan.md | 34 | major | done-when: blocked-environment preflight not implemented — The criterion needs a dev-server, login or cross-origin failure to stop before the browser agent, with the reason in status.json and no fix round consumed. The diff has no change t… | core/scripts/lib/done-when.mjs:9 minor [logic / wrong result / …] |
| 9 | orch-verify/fixed-018-capital-x-and-crlf (run 1) | plan.md | 59 | major | A1: ticked sub-task has no change in the diff — A1 is ticked [x] ('Define the UI tag ... core/docs/agent/job-validation.md, core/.claude/references/prd-template.md'). The diff adds only core/scripts/lib/done-when.mjs and touches… | core/scripts/lib/done-when.mjs:9 minor [logic / wrong result / …] |
| 10 | orch-check-bugs/fixed-017-cd-unknown-folder (run 2) | plan.md | 98 | major | A4: Bash PreToolUse wiring not in the diff — A4 is ticked [x] and lists core/scripts/scope-guard.sh and core/.claude/settings.json. Neither file changes in the diff. guard.mjs claims to be 'the one implementation behind scope… | core/scripts/lib/guard.mjs:330 major [logic / security / …] |

## Counts behind the sample (all fp, not only the sampled ones)

- 57 of the 75 fp before verify, and 46 of the 55 that survived, sit on `plan.md`: "a ticked sub-task or Done-when
  item has no change in the diff". A case's `diff.patch` holds only the slice of the real commit around the labelled
  bug, so those parts really are absent from what the reviewer sees, and orch-verify confirms them (keep, 80–92).
- Two sampled fp name the labelled bug itself but miss the scorer's match: table 1 #5 (right file and line, `blocker`
  where the label says `major`) and table 1 #1 (the installed-copy edit reported on `plan.md`, not on
  `scripts/lib/slot-procs.mjs`).
