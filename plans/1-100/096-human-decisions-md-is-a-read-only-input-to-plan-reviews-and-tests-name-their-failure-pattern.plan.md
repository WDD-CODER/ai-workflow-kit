# Plan 096 — human-decisions.md is a read-only input to plan reviews, and tests name their failure pattern

Status: done
Depends-on: none
Snapshot: b2fd7b5
Source: Human, 2026-11-07 — "Add docs/brain/human-decisions.md … as a read-only input to the workflow." Docs + plan text only; no new agent, no model call. Allowed in the freeze (no new capability; the brain stays frozen until plan 090's bar).

## Problem Statement
The Human's past decisions (D01–D30) live only in chats. `/plan`'s Architect + PM review asks the Human `open:` questions
that an `in force` decision already answers, and the reliability plans' tests do not say which failure pattern
(F01–F10) each one reproduces.

## Goals & Success Criteria
**Primary:** `/plan` answers a question from an `in force` row of `docs/brain/human-decisions.md` with `default per D<n>`
instead of asking; tests of plans 058, 083, 084, 086, 087 name the F id they cover.

- [auto] `docs/brain/human-decisions.md` exists with the Human's pasted text, plans 086, 087 and 088 marked done.
- [auto] `core/.claude/commands/plan.md` and its installed copy `.claude/commands/plan.md` hold the lookup paragraph
  (`grep -c "default per D18" .claude/commands/plan.md` → 1).
- [auto] Plans 058, 083, 084, 086, 087: each `[auto]` test line that reproduces a pattern of section 3 carries `(F<nn>)`;
  no test's command, assertion or logic changed (`git diff` shows only the added `(F<nn>)` tokens on those lines).
- [auto] Plan 097 (the runner lookup and two hard limits) is saved as `Status: draft`.
- [auto] `npm run build` passes; `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` report no drift.

## Execution Mode
- Solo kit flow: `feat/096-human-decisions-input`, then `/ship`. Freeze exception: docs and plan text only.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot `CHANGELOG.md`.

```scope
docs/brain/human-decisions.md
core/.claude/commands/plan.md
.claude/commands/plan.md
plans/058-orchestrator-preflight-starts-the-main-folder-servers-itself.plan.md
plans/1-100/083-the-preflight-stops-a-plan-that-will-fail-before-any-builder-starts.plan.md
plans/1-100/084-cleanup-after-the-reliability-run.plan.md
plans/1-100/086-four-cheap-fixes-blind-checkers-clean-base-escalation-guards-at-write-time-idempotent-park.plan.md
plans/1-100/087-one-blinded-reviewer-measured-against-the-five-checkers-on-the-kits-cases.plan.md
plans/097-the-runner-checks-human-decisions-md-before-choosing-a-default-with-two-hard-limits.plan.md
CHANGELOG.md
```

## Read Scope

Entire repo.

## Escalation Protocol

If a step needs a file outside the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer
`approved: <path>`; then append the path to the scope block and retry.

## Architecture Impact
- No invariant changed. `human-decisions.md` is read, never written, by the workflow; the brain's frozen files
  (`readiness-answers.jsonl`, lessons, other `docs/brain/` entries) are untouched.

## Atomic Sub-tasks
- [x] H1: Add the public copy of the decision corpus (names, chat titles, the app project's name and non-English quotes left out so the leak check passes; the full original stays outside the repo), 086–088 marked done — docs/brain/human-decisions.md
- [x] H2: `/plan` review looks up an `in force` decision before writing an `open:` line and writes `default per D<n>` — core/.claude/commands/plan.md, .claude/commands/plan.md (by sync)
- [x] H3: Name the F id on each test that reproduces a section 3 pattern, logic unchanged — plans 058, 083, 084, 086, 087
- [x] H4: Save plan 097 as a draft — plans/097-…
- [x] H5: Sync, drift-check, build, changelog — CHANGELOG.md

## Out of Scope
Changing `run-plans.mjs` (plan 097); `readiness-answers.jsonl`, lessons and every other brain file (frozen until plan
090); a new agent or any model call; rewriting tests of done plans.

## Critical Questions
None open — the Human answered option A on 2026-11-07 (reliability plan = 083; F pointers on 083 and 084 too).

## Execution Notes
- review: checkers kept 0 dropped 0 rechecked 0 minutes 2 models check-plan=sonnet,check-bugs=sonnet,check-rules=sonnet,verify=sonnet (1 minor candidate kept at confidence 30, below the 80 bar: (F01) tag on 058 A1)
- privacy: the committed human-decisions.md is the public copy; the full original stays outside the repo (Human, 2026-11-08).
