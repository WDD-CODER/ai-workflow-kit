---
description: Propose workflow trims from real usage data — reports only, applies nothing
allowed-tools: Read, Glob, Bash
---

# /tune-workflow — Usage-driven workflow trims

Replaces `/evaluate-me`. Proposes concrete edits to this repo's workflow files based on
real friction/heavy-usage data, not guesswork. Never applies anything itself.

## Steps

1. Ask the Human to run `/insights` and `/usage` (7-day view) first, and paste back the
   `/usage` attribution breakdown and any flags it raises. Stop and wait for that paste —
   do not proceed on assumption.
2. Read the newest `~/.claude/usage-data/report*.html`.
3. Map each friction point or heavy item to the specific repo file it implicates —
   `AGENTS.md`, a `.claude/commands/*.md`, a `.claude/skills/*/SKILL.md`, or a hook in
   `.claude/settings.json` / `scripts/`. No implication → drop it, don't force a mapping.
4. Output **at most 5** proposed edits, each as:
   `file / problem / exact change / expected saving`.
5. Apply nothing without explicit Human approval, one edit at a time.
