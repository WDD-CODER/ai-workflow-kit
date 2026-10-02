# PR check fix loop

Tool-neutral procedure for fixing failing GitHub PR checks on the current branch.
Use plain `gh` / `git` / `npx` / `npm` shell only — identical from Claude Code and Cursor.

**Hard caps**
- Maximum **2** full diagnose → fix → push → re-check rounds. Never a third.
- Never disable, skip, or weaken a check (do not edit `.github/workflows/*.yml`, ESLint config, or delete/skip tests to force green).
- `[security-scan]` findings are **never** auto-fixed or auto-dismissed — always surface to the user, including on round 1.

**Check names** (from workflows)

| GitHub check (job) | Workflow | Classify failures by failed step |
| --- | --- | --- |
| `lint` | `.github/workflows/ci.yml` | ESLint → `[lint]` |
| `build` | `.github/workflows/ci.yml` | Build → `[build]` |
| `test` | `.github/workflows/ci.yml` | Unit tests → `[test]` |
| `gitleaks` | `.github/workflows/ci.yml` | Secret scan (gitleaks) → `[security-scan]` |
| `ci` | `.github/workflows/ci.yml` | Aggregator — if red, inspect failed dependency (`lint` / `build` / `test` / `gitleaks`). Docs-only PRs may skip `lint`/`build`/`test` while `gitleaks` + `ci` still run. |
| `security` | `.github/workflows/security.yml` | npm audit (root/server) → `[audit]`; Semgrep OWASP Top Ten → `[security-scan]` |

---

## 1. Detect

```bash
gh pr checks
```

- Resolve the PR for the current branch if needed (`gh pr view --json number,url,headRefName`).
- If every check is green → report all green and **stop**.
- If any check is pending → wait with `gh pr checks --watch`, then re-evaluate.
- If any check failed → continue to Diagnose.

---

## 2. Diagnose

For each failing check:

```bash
git branch --show-current
gh run list --branch <branch> --limit 5
gh run view <run-id> --log-failed
```

Classify each failure into exactly one bucket:

### `[lint]`

ESLint / prettier errors in the `lint` job (step **ESLint**).

- Auto-fixable: `npx eslint --fix` on the reported files.
- Hand-fix remaining violations per project conventions (`AGENTS.md`, `docs/agent/conventions.md`).
- Do **not** change ESLint config to silence rules.

### `[build]`

`npm run {{commands.build}}` / compile errors in the `build` job (step **Build**).

- Fix the compile error in application code directly.
- Re-verify locally with `npm run {{commands.build}}` before committing.

### `[test]`

Failing unit specs in the `test` job (step **Unit tests**).

- Fix the test **or** the production code, whichever the failure log shows is wrong.
- **Never** delete, skip, or weaken a test (`xit`, `xdescribe`, `pending`, empty expectations) to make CI green.

### `[audit]`

`npm audit` findings in the `security` job (steps **npm audit (root)** / **npm audit (server)**).

- Run non-breaking fix only:
  - root: `npm audit fix`
  - server: `npm audit fix` with `working-directory` / `cd server` as appropriate
- If the finding requires `npm audit fix --force` or a major upgrade → **do not fix**. Surface the advisory to the user with the advisory link and stop auto-handling that finding.

### `[security-scan]`

gitleaks (`gitleaks` job step **Secret scan (gitleaks)**) or Semgrep (security step **Semgrep OWASP Top Ten**).

- **NEVER auto-fix** and **NEVER auto-dismiss**, even on round 1.
- Stop the fix loop for that finding: present the hit (file, rule/secret type, snippet location) to the user and wait for human judgment.
- Other non-security buckets may still be fixed in the same round only if the user has not halted the loop; if any `[security-scan]` hit exists, prefer handing the full summary to the user before pushing unrelated “fixes” that might obscure the finding.

---

## 3. Fix + push

For auto-fixable buckets only (`[lint]`, `[build]`, `[test]`, safe `[audit]`):

1. Apply fixes in the failing code (not in workflow/config gates).
2. Commit with:

```text
fix(ci): <check> — <one-line cause>
```

Example: `fix(ci): lint — unused import in user.service.ts`

3. Push to the PR branch:

```bash
git push
```

Do not commit secrets, `.env`, or unrelated dirty files. Do not force-push.

If the only failures are `[security-scan]` (or `[audit]` that needs `--force`) → do **not** push a “fix”; hand back to the user.

---

## 4. Re-check

```bash
gh pr checks --watch
```

- All green → report success and **stop**.
- Still red → if rounds used < 2, return to **Diagnose** (next round).
- After round **2** still red → go to **Handback**.

---

## 5. Loop cap / handback

After at most **2** diagnose → fix → push → re-check rounds, if anything is still red:

1. **Stop.** Do not start a third round.
2. Output a summary table:

| Check | Root cause | Why not auto-fixed | Suggested next step |
| --- | --- | --- | --- |
| … | … | … | … |

3. Hand control back to the user.

Never weaken gates to force green.
