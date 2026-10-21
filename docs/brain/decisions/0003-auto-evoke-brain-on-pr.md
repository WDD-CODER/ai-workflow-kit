---
status: accepted
date: 2026-07-13
review-by: 2027-01-13
supersedes: 0002 (capture-timing consequence only)
---

# 0003 — Auto-evoke brain capture on push / PR / Merge Gate

## Context

ADR 0002 keeps project memory as plain Markdown under `docs/brain/` and deliberately avoids tool-backed memory. Its capture-timing consequence said entries are proposed only at `/ship` time. That meant durable learnings were easy to miss on ad-hoc Cursor commit+push paths and on PR merge without a full `/ship` run. Free-tier constraints still rule out calling an LLM from GitHub Actions to draft entries.

## Decision

**Auto-evoke** brain capture whenever a `feature/` / `fix/` / `chore/` branch is pushed or a mergeable PR is opened/updated — via the agent Post-push Merge Gate and a non-blocking GitHub sticky PR comment — not only when `/ship` runs.

**Confirm-to-write** remains mandatory: never silent-write to `docs/brain/`. The Human (or agent after an explicit Human reply) must `brain approve`, `brain skip` / `brain:none`, or `brain edit …` before any brain file changes land.

**No LLM in GitHub Actions.** CI may only upsert a sticky reminder and optionally paste advisory `brain-review-check.mjs --scope=dead-refs` findings. Drafting stays with the AI session that already did the work.

This supersedes the “capture only at `/ship`” consequence of [[0002-file-based-memory-over-tool-memory]]; the file-based memory decision itself stands.

## Consequences

- Agents always show a Brain capture block at Merge Gate / PR time (omit only when nothing durable).
- GitHub posts/updates a sticky `<!-- brain-capture-bot -->` comment so the Human is reminded even if the agent session ended.
- Writing still requires `brain approve` (or an edited re-approve); `brain skip` / `brain:none` is an explicit no-op.
- No new API secrets or Actions LLM spend — aligns with free-tier and ADR 0002’s infra stance.

## Review

Revisit if silent auto-commit of agent-drafted brain text becomes desirable under a required-label gate, or if free-tier budget later allows a CI drafting step.
