# TECH STACK — AUTHORITATIVE SOURCE — {{project.name}}
> `AGENTS.md` and `CLAUDE.md` defer to this file. Edit HERE only.

## Stack
- Frontend / framework: {{stack.name}}
- Backend: {{stack.backend}}
- Deploy: {{deploy.host}} (database: {{deploy.dbHost}})

## Hard conventions
- State: {{stack.stateRules}}
- Build gate: `npm run {{commands.build}}` must pass before any commit.
- Lint gate: `npm run {{commands.lint}}` must pass before milestone sign-off.
- Test gate: `npm run {{commands.test}}`.
- Add the rules that are specific to this project below; stack-wide rules live in `docs/agent/standards-*.md`.

## Approved dependencies
Anything already in `package.json` is approved. New dependencies need explicit Plan Contract approval before they are installed.
