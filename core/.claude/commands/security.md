# /security — Security Path

Use this path for security audits, hardening, authentication review, and vulnerability assessment.

## Loads

- `docs/agent/standards-security.md` — OWASP top 10, auth patterns, API security, input validation
<!-- PACK:loads:security -->

## Invokes

- The automated checks: the pre-commit secret scan (`scripts/pre-commit-secret-scan.mjs`, plus any stack pack's
  pre-commit checks) and the CI security workflow (`.github/workflows/security.yml`)
- Official plugin `security-guidance@claude-plugins-official` (when available) as a complement

## Typical flow

1. User specifies scope: full audit / auth subsystem / API routes / frontend guards.
2. Read the source files in that scope against `docs/agent/standards-security.md`, and check what the
   automated checks above already flag.
3. Findings are classified: Critical / High / Medium / Low.
4. Default: **report only**. Fix Critical/High only when the Human
   Director explicitly asks (or when this path is invoked as an execute override).
5. Medium/Low findings are added to `.claude/todo.md` / a Plan Contract for scheduled remediation.
6. Recommend `/cso` (if your skill set has it) for infrastructure-level security review.

## Hard rules

- Critical findings block APPROVE / session close — must be fixed (or explicitly deferred by Human) before merge.
- Never log secrets, tokens, or PII — even in debug output.
<!-- KIT:if stack.authSkill -->
- All auth changes must pass the `{{stack.authSkill}}` audit checklist before commit.
<!-- KIT:else -->
- All auth changes must be checked against `docs/agent/standards-security.md` before commit.
<!-- KIT:end -->
- Match the file's existing style; never reformat untouched lines.
<!-- PACK:style:security -->
- Human commits by default (`git-agent` prep only).

## Related commands

- `/cso` — Chief pre-commit security grep + CI mode (infrastructure, ports, dependencies)
- `docs/agent/standards-security.md` — full security standards reference
- `/review-it` — Reviewer pass; auto-invokes `pre-commit security grep + CI security workflow` on auth/security-sensitive milestones
