# /security — Security Path

Use this path for security audits, hardening, authentication review, and vulnerability assessment.

## Loads

- `docs/agent/standards-security.md` — OWASP top 10, auth patterns, API security, input validation
- `auth-and-logging` skill — authentication guards, mutation logging, auth audit checklist
- `auth-crypto` skill — hashing, encryption, token handling, secrets management

## Invokes

- `pre-commit security grep + CI security workflow` — runs the security audit pipeline, flags violations, recommends remediations
- Official plugin `security-guidance@claude-plugins-official` (when available) as a complement

## Typical flow

1. User specifies scope: full audit / auth subsystem / API routes / frontend guards.
2. `pre-commit security grep + CI security workflow` reads relevant source files against `docs/agent/standards-security.md`.
3. Findings are classified: Critical / High / Medium / Low.
4. Default under three-agent: **report only**. Fix Critical/High only when the Human
   Director explicitly asks (or when this path is invoked as an execute override).
5. Medium/Low findings are added to `.claude/todo.md` / a Plan Contract for scheduled remediation.
6. Recommend `/cso` ({{tools.browser}}) for infrastructure-level security review.

## Hard rules

- Critical findings block APPROVE / session close — must be fixed (or explicitly deferred by Human) before merge.
- Never log secrets, tokens, or PII — even in debug output.
- All auth changes must pass the `auth-and-logging` audit checklist before commit.
- No semicolons in any `.ts` file touched.
- Human commits by default (`git-agent` prep only).

## Related commands

- `/cso` — Chief pre-commit security grep + CI mode (infrastructure, ports, dependencies)
- `docs/agent/standards-security.md` — full security standards reference
- `/review-it` — Reviewer pass; auto-invokes `pre-commit security grep + CI security workflow` on auth/security-sensitive milestones
