---
status: accepted
date: 2026-07-12
review-by: 2027-01-12
---

# 0002 — File-based project memory over a memory tool/service

## Context

Durable project knowledge (past decisions, proven patterns, gotchas) needs somewhere to live that survives context compaction and works identically across Claude Code and Cursor. Tool-backed memory (vector stores, MCP memory servers) is an option but adds infra and isn't visible in a plain `git diff`.

## Decision

Store project memory as plain Markdown under `docs/brain/` (`index.md`, `projectbrief.md`, `decisions/`, `patterns/`, `gotchas.md`, `glossary.md`), committed to the repo like any other doc — not in an external memory tool or database.

## Consequences

- Memory is reviewable in PRs, greppable, and tool-agnostic — both Claude Code and Cursor read the same files.
- No new infrastructure, no extra free-tier budget spent, consistent with the project's free-tier constraint (see `projectbrief.md`).
- Staleness has to be checked deliberately (`scripts/brain-review-check.mjs`) rather than relying on a tool's own recency/relevance scoring — this is an accepted tradeoff, not an oversight.
- Capture is deliberately rare: entries are proposed only at `/ship` time when something durable actually happened, folded into the existing commit-approval prompt — see [[0001-lean-native-workflow]].

## Review

Revisit if cross-session recall needs semantic search over a large volume of entries that flat-file grep stops handling well.
