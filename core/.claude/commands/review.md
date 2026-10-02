---
description: Judgment-only review against docs/agent standards (no CI duplication)
allowed-tools: Read, Grep, Glob, Bash, Edit
---

# /review — Judgment review (no CI duplication)

Standalone review command. Used by `/ship` Phase 2 and invokable alone.

## What to read

1. Current diff against the base branch, excluding noisy generated/report paths (keep `{{project.i18nFile}}`):
   ```bash
   git fetch origin main 2>/dev/null || true
   git diff origin/{{git.mainBranch}}...HEAD -- . ':(exclude)package-lock.json' ':(exclude).claude/reports/**' ':(exclude).claude/todo-archive/**' ':(exclude).claude/techdebt-reports/**'
   # fallback if origin/{{git.mainBranch}} missing:
   git diff main...HEAD -- . ':(exclude)package-lock.json' ':(exclude).claude/reports/**' ':(exclude).claude/todo-archive/**' ':(exclude).claude/techdebt-reports/**'
   ```
   Then show what changed in the excluded paths without the hunks, so the reviewer knows they moved:
   ```bash
   git diff origin/{{git.mainBranch}}...HEAD --stat -- package-lock.json .claude/reports .claude/todo-archive .claude/techdebt-reports
   ```
   Also include unstaged/staged working-tree changes relevant to this session.
2. `docs/agent/standards-security.md`
3. `docs/agent/conventions.md`
4. If a brief with a **"Done when"** section is in context this session — check the diff against those criteria explicitly. If none is in context, skip the brief-match check and note: `Brief-match: SKIPPED (no Done-when brief in context)`.

## What to check (judgment only)

- Contextual security CI cannot pattern-match (e.g. whether a specific `innerHTML` use is safe given what populates it; auth / persisted-data handling in context).
- Convention judgment calls (structure, interface shape, right-to-left and translation intent) that are not pure lint.
- Spec / brief mismatch when a Done-when brief is present.

## What to skip (CI already covers)

Do **not** re-check: semicolons, quotes, `no-explicit-any`, unused vars, secret-shaped strings, npm audit, semgrep OWASP patterns, or other mechanical lint/CI gates from Brief 2.

## Output format (required)

```
REVIEW: PASS | ISSUES FOUND

Brief-match: PASS | FAIL | SKIPPED (reason)

Issues:
- [spec-mismatch] ...
- [security] ...
- [convention] ...
```

If no issues: `REVIEW: PASS` and an empty Issues list (or `Issues: none`).
