# /fix — Bug Fix Path

Use this path for fixing bugs, errors, and broken behavior.

## Usage

```
/fix                    — general bug fix (prompts for area)
/fix css                — CSS layout or styling bug
/fix auth               — authentication or authorization bug
/fix data               — data service, {{stack.backend}}, or API data bug
/fix ui                 — UI component or interaction bug
/fix api                — backend route, server, or integration bug
/fix other              — anything that doesn't fit the above
```

## Loads by area

| Area | Standards loaded |
|------|-----------------|
<!-- KIT:if stack.styleSkill -->
<!-- KIT:if stack.cssSection -->
| `css` | `{{stack.standardsDoc}}` ({{stack.cssSection}} section) + `{{stack.styleSkill}}` skill |
<!-- KIT:else -->
| `css` | `{{stack.styleSkill}}` skill |
<!-- KIT:end -->
<!-- KIT:else -->
| `css` | the project's styling rules (no stack pack styling skill: skip) |
<!-- KIT:end -->
<!-- KIT:if stack.authSkill -->
| `auth` | `docs/agent/standards-security.md` + `{{stack.authSkill}}` skill (covers crypto) |
<!-- KIT:else -->
| `auth` | `docs/agent/standards-security.md` |
<!-- KIT:end -->
<!-- KIT:if stack.backendDoc -->
| `data` | `{{docs.domainStandards}}` + `{{stack.backendDoc}}` |
<!-- KIT:else -->
| `data` | `{{docs.domainStandards}}` (no backend standards: skip) |
<!-- KIT:end -->
<!-- KIT:if stack.componentsSection -->
| `ui` | `{{stack.standardsDoc}}` ({{stack.componentsSection}} section) + `{{docs.domainStandards}}` |
<!-- KIT:else -->
| `ui` | `{{docs.domainStandards}}` |
<!-- KIT:end -->
<!-- KIT:if stack.backendDoc -->
| `api` | `{{stack.backendDoc}}` + `docs/agent/standards-security.md` |
<!-- KIT:else -->
| `api` | `docs/agent/standards-security.md` (no backend standards: skip) |
<!-- KIT:end -->
| `other` | `docs/agent/` (path-scoped) + `CLAUDE.md` |

## Invokes

- `investigate` — root cause analysis before any fix is applied
- After a working fix exists, refine it to production quality against `{{stack.standardsDoc}}` (naming, shared pure helpers instead of one-off copies, no nested async chains, units under 300 lines)

## Typical flow

1. User describes the bug (area + symptom).
2. `investigate` traces the root cause (checks recent changes, failure history, source).
3. Fix is implemented atomically — one targeted change.
<!-- KIT:if stack.styleSkill -->
4. Review the fix for code quality, edge cases, and consistency against `{{stack.standardsDoc}}`; a stylesheet touched → `{{stack.styleSkill}}`.
<!-- KIT:else -->
4. Review the fix for code quality, edge cases, and consistency against `{{stack.standardsDoc}}`.
<!-- KIT:end -->
5. `npm run {{commands.build}}` / `npm run {{commands.lint}}` pass. Human commits via `git-agent` prep.

## Hard rules

- NEVER fix a symptom without identifying the root cause first.
- `npm run {{commands.build}}` must pass before committing.
- Match the file's existing style; never reformat untouched lines.
<!-- PACK:style:fix -->
- 3-strike rule: at most 3 autonomous fix attempts in scoped files; then STOP and report.
