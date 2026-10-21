# /fix — Bug Fix Path

Use this path for fixing bugs, errors, and broken behavior.

## Usage

```
/fix                    — general bug fix (prompts for area)
/fix css                — CSS layout or styling bug
/fix auth               — authentication or authorization bug
/fix data               — data service, none (no backend), or API data bug
/fix ui                 — UI component or interaction bug
/fix api                — backend route, server, or integration bug
/fix other              — anything that doesn't fit the above
```

## Loads by area

| Area | Standards loaded |
|------|-----------------|
| `css` | the project's styling rules (no stack pack styling skill: skip) |
| `auth` | `docs/agent/standards-security.md` |
| `data` | `(not set)` (no backend standards: skip) |
| `ui` | `(not set)` |
| `api` | `docs/agent/standards-security.md` (no backend standards: skip) |
| `other` | `docs/agent/` (path-scoped) + `CLAUDE.md` |

## Invokes

- `investigate` — root cause analysis before any fix is applied
- After a working fix exists, refine it to production quality against `(not set)` (naming, shared pure helpers instead of one-off copies, no nested async chains, units under 300 lines)

## Typical flow

1. User describes the bug (area + symptom).
2. `investigate` traces the root cause (checks recent changes, failure history, source).
3. Fix is implemented atomically — one targeted change.
4. Review the fix for code quality, edge cases, and consistency against `(not set)`.
5. `npm run build` / `npm run lint` pass. Human commits via `git-agent` prep.

## Hard rules

- NEVER fix a symptom without identifying the root cause first.
- `npm run build` must pass before committing.
- Match the file's existing style; never reformat untouched lines.
- 3-strike rule: at most 3 autonomous fix attempts in scoped files; then STOP and report.
