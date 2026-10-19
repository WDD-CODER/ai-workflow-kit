# Plan 004 — Kit Stack-Neutral Core Part 2: CI, Commands and Tech-Debt Rules by Pack

Status: done
Snapshot: b0ba42501af952fc23566a1885fab53af57e6686

## Problem Statement
Second half of making the kit stack-neutral (first half: plan 003; release in 005). Source: hand-off `handoff/2026-10-18-react-vite-adoption.md` (local only, never commit). Core CI assumes a backend and dependencies the project owns; core commands carry Angular style rules and point at files only the Angular/Express packs ship; the tech-debt report ignores `.tsx` and can't show a trend on an old codebase.

Hand-off issues in this plan:
- **I-6** CI/security render `npm ci --prefix ` (empty) and a `server-tests` job without a backend; whole-repo lint and app `npm audit` the project can't fix keep CI red.
- **I-15** core `feat/fix/refactor/security.md` hard-code "no semicolons", quotes, Signals, BEM, CSS layers, `auth-crypto.ts`; pre-commit runs the no-semi check for every stack.
- **I-16** core commands reference pack-only files (`conventions.md`, `standards-backend.md`, `cssLayer`, `auth-and-logging`, `breadcrumbs`) that dangle with `packs: []`.
- **I-18** `techdebt-report.mjs` skips `.tsx/.jsx`; the techdebt skill has an unfilled `PACK:stack` marker; no baseline mode.
- **I-21** `.prettierrc.json` seed forces no-semi + single quotes on every project; **I-23** `gh` targets the fork parent; **I-24** `gh pr edit` fails on Projects (classic); **I-25** `fix.md` "Loads by area" names Angular doc sections.
- Hand-off §5 tool: **workflow-link-check** (every backticked path, `node scripts/…`, `npm run <x>` in commands/skills/agents/docs exists) — needed here to prove I-16.

## Prerequisites
- Plan 003 merged into kit `main`.

## Goals & Success Criteria
- [auto] `install-check` renders with `paths.serverRoot: ""` contain no `--prefix ` followed by end of line and no `server-tests` job; `actionlint` passes on every rendered workflow.
- [auto] New config keys `ci.install` (default `npm ci`), `ci.lintScope` (`all` | `changed`), `ci.appAuditMode` (`enforce` | `report`) render as documented; `report` mode uses `set +e` and writes to `$GITHUB_STEP_SUMMARY`.
- [auto] `git grep -n -i "semicolon\|single quote\|BehaviorSubject\|auth-crypto\|BEM" -- core/.claude/commands` finds nothing; those rules live in `packs/angular` (FoodVibe gets them back through the pack, same wording).
- [auto] `node tools/workflow-link-check.mjs` reports 0 missing on install-check renders for packs `[]` and `[angular, node-express]`; `pack-check` fails when a core reference has no provider.
- [auto] `techdebt-report.mjs scan` counts `.ts/.tsx/.js/.jsx/.html/.css/.scss` with pack rules and compares to `docs/project/techdebt-baseline.json` (`NEW_DEBT: yes|no`); Angular pack rules reproduce today's FoodVibe categories.
- [auto] Kit `leak-check`, `pack-check`, `install-check`, `e2e-check` pass. No release (CHANGELOG `[Unreleased]`).
- [auto] FoodVibe safety: local-source `kit-sync` dry-run into FoodVibe → 0 `conflict`; FoodVibe's rendered `ci.yml` still has the `server-tests` job and full lint; `/fix` still lists the Angular rules (via pack fragment).

## Execution Mode
- **Parallel:** no. Session opened in the kit folder; FoodVibe read and scratch-cloned only.
- **Concurrent plans:** no other kit plan; 005 starts after this merges.
- **Isolated DB:** no.
- **Kit edits:** kit branch `feat/004-neutral-core-ci-commands` + kit PR; Dandan merges. No tag.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/**
packs/**
templates/**
tools/**
kit.config.json
docs/**
CHANGELOG.md
README.md
.github/workflows/**
```

**Outside this repo:** FoodVibe: read only, plus a scratch clone under the session scratchpad for the safety test (M8); notes go in this plan file. No FoodVibe commit.

## Read Scope
Kit repo, FoodVibe repo (its current `ci.yml`, `security.yml`, techdebt reports for the category baseline), the hand-off (§3 I-6/15/16/18/21/23/24/25, §5).

## Escalation Protocol
Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append the path to the scope block and retry. Anything that would change FoodVibe's rendered CI behaviour or command rules: STOP and show the diff.

## Architecture Impact
- INV-none: preserves — kit CI templates, commands and tooling only.

## Step 0 — Reality Check
- 003 merged; kit `main` clean; re-read each issue against `main`, one line each.
- List every core → pack reference (the pack contract): which file/skill each core command loads, and which pack provides it today.

## Design
- **CI (I-6):** backend job/steps inside block markers rendered only when `paths.serverRoot` is set; `ci.install`, `ci.lintScope` (changed = ESLint on changed `*.ts *.tsx *.js *.jsx *.mjs *.cjs` vs PR base; push uses `github.event.before`, fallback `HEAD~1`, none → pass), `ci.appAuditMode` (report = `set +e`, summary + `::warning`); `scripts/` deps audit enforced at `critical`. Defaults keep today's FoodVibe behaviour.
- **Style rules to packs (I-15):** core says "Match the file's existing style; never reformat untouched lines" and inserts a `PACK:style` fragment; Angular pack fragment holds today's rules; no-semi pre-commit becomes an Angular-pack hook fragment.
- **Pack contract (I-16):** `pack.json` declares which core references it satisfies (conventions doc, backend standards or "no backend", styling skill, auth skill, optional docs-map skill); core falls back to "(no stack pack: skip)"; `pack-check` fails on a missing provider. **I-25:** packs declare the section names `fix.md` "Loads by area" cites.
- **Link check (§5):** `tools/workflow-link-check.mjs` (node built-ins, allowlist for runtime paths/examples), run in kit CI over each install-check render.
- **Tech debt (I-18):** generic `scan` subcommand + baseline file in core; rule sets come from packs (Angular rules = today's categories); `.tsx/.jsx` included; skill `PACK:stack` filled by packs.
- **I-21:** `.prettierrc.json` moves to the Angular pack seed (skipped when the project has a style config). **I-23:** `standards-git.md` and `/ship` use `gh … -R <owner>/<repo>` from `origin`. **I-24:** document the `gh api -X PATCH …/pulls/<n> -F body=@file` fallback.

## Atomic Sub-tasks
- [x] M0: Check the issues are still open and map every core-to-pack reference — Step 0 + pack contract list — `plans/004-kit-stack-neutral-core-part-2-ci-commands-tech-debt-rules-by-pack.plan.md`
- [x] M1: Render backend CI jobs only when the project has a backend — serverRoot block markers in ci and security workflows, actionlint on renders — `core/.github/workflows/{ci,security}.yml`, `tools/install-check.mjs`
- [x] M2: Let projects choose how CI installs, lints and audits — ci.install, ci.lintScope, ci.appAuditMode keys, changed-files lint, report-only audit, scripts audit — `core/.github/workflows/{ci,security}.yml`, `kit.config.json`, `docs/**`
- [x] M3: Move Angular style rules out of core commands into the Angular pack — match-existing-style line in core, PACK:style fragments, no-semi hook fragment, prettier seed — `core/.claude/commands/{feat,fix,refactor,security}.md`, `core/.husky/pre-commit`, `packs/angular/**`, `templates/**`
- [x] M4: Make packs declare which core references they provide and fail when one is missing — pack.json contract, core fallbacks, pack-check rule, fix.md section names — `packs/*/pack.json`, `tools/pack-check.mjs`, `core/.claude/commands/**`
- [x] M5: Add a link check that proves every path the workflow docs mention exists — workflow-link-check tool + kit CI job over renders — `tools/workflow-link-check.mjs`, `.github/workflows/**`
- [x] M6: Make the tech-debt scan work for any stack and compare against a baseline — scan subcommand, baseline file, tsx/jsx, pack rule sets, skill PACK:stack — `core/scripts/techdebt-report.mjs`, `core/.claude/skills/techdebt/SKILL.md`, `packs/angular/**`
- [x] M7: Make git commands work in forks and when PR edit is blocked — gh -R from origin, PATCH fallback documented — `core/docs/agent/standards-git.md`, `core/.claude/commands/ship.md`
- [x] M8: Prove FoodVibe still renders the same CI and rules before merging — local-source dry-run, rendered ci.yml and fix.md compared; notes — this plan file
- [x] M9: Run all kit checks and open the kit PR — leak-check, pack-check, install-check, e2e-check, link check; CHANGELOG Unreleased — kit repo

## Out of Scope
React-Vite pack, upstream-owned layer, adoption tools, release (005); porting Python scripts to node.

## Execution Notes

Run under plan 006 (autonomous run): branch `feat/004-neutral-core-ci-commands` from `feat/003-neutral-core-runtime`
(`8517efb`, PR #25, not merged yet), stacked PR. Plan 006 replaces "003 merged" and "Dandan merges": no tag, no
release, no `kit.json` bump; CHANGELOG `### 004 — …` under `## [Unreleased]`. No scope paths added.

### M0 — Reality check (against the 003 branch)
- I-6 open: `ci.yml` rendered `npm ci --prefix ` / `npm test --prefix ` and a `server-tests` job with an empty
  `paths.serverRoot`; `security.yml` hard-coded `working-directory: server`; no `ci.*` keys. (I-7 gitleaks permissions:
  already fixed in 001.)
- I-15 open: `feat.md` "No semicolons … Single quotes in TS", `fix.md`/`refactor.md`/`security.md` "No semicolons …",
  `refactor.md` "BEM naming", `security.md` "`auth-crypto.ts`"; `review.md` "semicolons, quotes"; `core/.husky/pre-commit`
  listed `pre-commit-no-semi.mjs` and `pre-commit-security-grep.mjs` (dropped by `trimHusky` without the angular pack,
  which is why the adopting project's render lacked it).
- I-16 open. `node tools/workflow-link-check.mjs --target <003-branch install, packs []>` →
  `docs-refresh.md:21` `.claude/skills/breadcrumbs/SKILL.md` + `node scripts/breadcrumbs-check.mjs`, `fix.md:23,25`
  `docs/agent/standards-backend.md`, `review.md:25` and `pr-check-fix-loop.md:54` `docs/agent/conventions.md`,
  `workflow-map.md:142` `npm run (not set)` (7 missing). Skill names the link check can't see (no slash): `cssLayer`
  (`fix.md`, `refactor.md`), `auth-and-logging` (`fix.md`, `security.md`), `breadcrumbs` (techdebt skill).
- I-18 open: working-tree filter `/\.(ts|html|<ext>|js|mjs)$/`; skill had an unfilled `<!-- PACK:stack … -->`; no scan,
  no baseline. I-21 open: `templates/.prettierrc.json` (no-semi, single quotes) seeded into every project.
  I-23 / I-24 open: no `-R` guidance, no PATCH fallback. I-25 open: `fix.md` cited "(CSS section)" and "(Components)";
  the angular standards doc has neither heading (its sections: "Angular 19 & Reactivity", "UI, CSS & Folder Structure",
  "Test Standards").
- Pack contract (core reference → what provides it now):

  | core file | reference | provider (`provides` key → value) |
  | --- | --- | --- |
  | `review.md`, `pr-check-fix-loop.md` | conventions doc | angular `conventionsDoc` → `docs/agent/conventions.md` |
  | `fix.md` (data, api) | backend standards | node-express `backendDoc` → `docs/agent/standards-backend.md`; none = "no backend standards: skip" |
  | `fix.md` (css, flow step 4) | styling skill | angular `styleSkill` → `cssLayer` |
  | `fix.md` (auth), `security.md` hard rule | auth skill | angular `authSkill` → `auth-and-logging`; none = `standards-security.md` |
  | `docs-refresh.md`, techdebt skill | docs-map skill + check | angular `docsMapSkill` → `breadcrumbs`, `docsMapCheck` → `scripts/breadcrumbs-check.mjs` |
  | `fix.md` (css, ui) | standards-doc sections (I-25) | angular `cssSection` → "UI, CSS & Folder Structure", `componentsSection` → "Angular 19 & Reactivity" |
  | `feat/fix/refactor/security.md` style rules, `refactor.md`/`security.md` skill lines, pre-commit, techdebt greps | fragments | angular `FRAGMENTS.md` (`style:<cmd>`, `loads:refactor`, `loads:security`, `pre-commit:fix`, `pre-commit:check`, `techdebt`) |
  | `templates/cursor/…/auth-and-logging-must-use-skill.mdc` | auth skill rule | unchanged: installed only with the skill (`REQUIRES`) |

### Decisions
- **Block markers = line directives** `KIT:if <key>` / `KIT:else` / `KIT:end` as `# …` (YAML, shell) or `<!-- … -->`
  (Markdown) lines, applied in `planFiles` before placeholders (`key`, `!key`, `key=value`, `key!=value`; an unknown key
  or an unbalanced block is a render error). Used for the backend job/steps, the `ci.*` modes and every pack-contract
  fallback. Chosen over per-file special cases (the engine already special-cased AGENTS/CLAUDE/husky).
- **Pack fragments** (`pack.json` `fragments` → `FRAGMENTS.md`, not installed): `## <name>` sections fill `PACK:<name>`
  marker lines anywhere. Per-command style sections (`style:feat`, `style:fix`, …) instead of one `PACK:style`, so each
  command keeps today's exact Angular wording (STOP rule); the core line "Match the file's existing style; never
  reformat untouched lines." comes first in all four.
- **Pre-commit:** two markers, `# PACK:pre-commit:fix` (before the secret scan) and `# PACK:pre-commit:check` (after it),
  so the angular hook order is byte-identical to before (`no-semi`, secret scan, `security-grep`, ledger check).
- **Contract keys** are config keys `stack.<key>` filled from `pack.json` `provides` (first pack wins, a project may
  set its own), with kind checks in `pack-check` (doc/script file, skill folder, standards-doc `## ` heading).
  `pack-check` also fails on an unguarded `{{stack.<key>}}`, a used key no pack provides, a fragment section no marker
  uses, and a literal pack-only workflow path or backticked pack skill name in core/layers/templates.
- **Loads descriptions** in `/feat` and `/refactor` lost their Angular words ("Signals, Components, CSS (Layers)" →
  "(state, components, styling)"): a description, not a rule. The `cssLayer` and `auth-and-logging` Loads lines come
  verbatim from the pack. `/review` "Do not re-check: semicolons, quotes" → "formatting (punctuation, quote style)".
- **`ci.lintScope: changed`** runs `npx --no-install eslint --no-error-on-unmatched-pattern <files>` on
  `git diff --name-only --diff-filter=d $BASE HEAD -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs'` (checkout with full
  history); event values come through `env:` (no `${{ }}` inside the script). **`ci.appAuditMode` covers root and server**
  (both "the app"); report mode = `set +e`, `npm audit --omit=dev` per folder, summary + `::warning`, exit 0.
  **`ci.install`** is used for every app install (root and server). The `scripts/` audit (`--audit-level=critical`) and
  the `scripts/` install in the lint job run only when `scripts/package-lock.json` is committed (`hashFiles`), so a
  project without that lockfile yet (FoodVibe today) is unaffected; install inside `scripts/` (not `--prefix`, 003).
- **`server-tests`** runs with `defaults.run.working-directory: <serverRoot>` instead of `npm --prefix`.
- **actionlint 1.7.7** (released January 2025): kit CI downloads the linux_amd64 release tarball and checks its
  SHA-256 (`023070a2…0757`, from the release's checksums file) — no unpinned script or action. install-check runs it
  on every rendered workflow when present (`ACTIONLINT` or PATH) and requires it with `KIT_REQUIRE_ACTIONLINT=1`
  (kit CI). The ubuntu runner's shellcheck is picked up by actionlint; locally verified with shellcheck 0.10.0. It
  found one real issue in the core `ci.yml`: SC2221/SC2222, `*.md` already covered `AGENTS.md|agent.md|CLAUDE.md` in
  the docs-only filter — removed (same behaviour).
- **Link check scope:** commands, skills, agents, `docs/agent`, `.cursor/commands`, `.cursor/rules`, `AGENTS.md`,
  `AGENTS.workflow.md`, `CLAUDE.md`, `README_WORKFLOW.md`. A backticked token is a path when it has a `/` and its first
  folder is one the kit installed into; examples (`<…>`, `*`, `{…}`, `$`, `NNN`, `YYYY`) and a short runtime list are
  skipped; `paths.planChecks` and the techdebt baseline are optional. `npm run x` must be a `package.json` script, or
  (no `package.json`) a configured `commands.*` name; `npm run (not set)` counts as missing (fixed:
  `workflow-map.md` backend line is now `KIT:if commands.devLocal`).
- **Tech-debt scan:** core rules `any`, `ts-ignore`, `eslint-disable`, `console-log`, `todo`, `big-file` (>300 lines);
  pack `techdebtRules` (angular: `legacy-decorator` `@(Input|Output)\(`, `behavior-subject`, `semicolon` `;\s*$`, specs
  and `main`/`app.config`/`app.routes` excluded like the no-semi hook). Tests are excluded for `any`, `console-log` and
  `big-file` (FoodVibe's reports treat spec files as not a style violation). Scope = tracked files under
  `paths.srcRoot` (whole repo when empty), kit-managed files (`.kit/install.json`) left out. No baseline →
  `NEW_DEBT: unknown`; a rule the baseline does not know is shown as "new rule", never counted as new debt.
- **I-21:** `.prettierrc.json` is an angular pack seed with `skipWhenPresent` (any other prettier config file or a
  `package.json` `prettier` key): install `SKIP-PRESENT`, sync `NOTE`. Seeds are never deleted, so existing projects keep
  their copy (CHANGELOG item 6).
- **I-23/I-24:** literal `-R <owner>/<repo>` read once from `git remote get-url origin` (no `$(…)` in the command: the
  standards file already asks for commands Claude Code's Bash check can parse).

### Evidence (`[auto]` Done-when)
- No backend → no server job, actionlint: `ACTIONLINT=<scratch>/actionlint.exe KIT_REQUIRE_ACTIONLINT=1 node
  tools/install-check.mjs` → `INSTALL_CHECK: ok — 4 fixtures, actionlint on 16 rendered workflows, CI renders, link check,
  …, 0 problems`. `ciProblems` asserts per fixture: no `--prefix` at end of line; `server-tests` job, gate `needs` entry
  and gate check present only with node-express (`paths.serverRoot`); no server step in `security.yml` without it.
- `ci.*` keys: the core fixture sets `ci.install "npm install --no-audit --no-fund"`, `lintScope changed`,
  `appAuditMode report`; asserted: the install command in all three ci jobs and security, ESLint on changed files
  (PR base, push `before`, `HEAD~1` fallback, nothing-to-lint pass, `fetch-depth: 0`), report mode with `set +e`,
  `>> "$GITHUB_STEP_SUMMARY"`, `::warning` and no enforced app audit; the other fixtures keep `npm ci`, `npm run lint`
  and `npm audit --omit=dev --audit-level=critical`; every fixture enforces the `scripts/` audit and installs `scripts/`
  inside `scripts/`.
- Style rules: `git grep -n -i "semicolon\|single quote\|BehaviorSubject\|auth-crypto\|BEM" -- core/.claude/commands` →
  no output (exit 1); same for `layers templates`. install-check: `/feat` has the match-existing-style line in every
  fixture and the Angular line only with the angular pack; `.prettierrc.json` only with angular; the pre-commit order.
- Link check: `node tools/workflow-link-check.mjs` → `WORKFLOW_LINK_CHECK: ok — 4 fixtures (packs [], angular,
  node-express, angular + node-express), 0 missing`; install-check runs it on its 4 fixtures (0 problems). Before
  (003 branch, packs []): 7 missing (M0).
- `pack-check` fails on a missing provider: `provides` removed from `packs/node-express/pack.json` (temporary) →
  `core uses {{stack.backendDoc}}, but no pack provides "backendDoc"` / `PACK_CHECK: FAIL`; `docs/agent/conventions.md`
  written into `review.md` without its `KIT:if` → `{{stack.conventionsDoc}} outside a "KIT:if stack.conventionsDoc"
  block` and `names docs/agent/conventions.md, which only pack angular ships`. Restored →
  `PACK_CHECK: ok — 2 packs, 8 contract keys used by core (each provided), 0 problems`. Before the M6 edit it also
  caught the techdebt skill's `` `breadcrumbs` ``.
- Tech-debt scan: install-check (core and angular) — a `.ts`, `.tsx`, `.jsx`, `.html`, `.css` file each; counts
  `any 1, console-log 1, todo 3, eslint-disable 1, big-file 1` (+ angular `legacy-decorator 1, behavior-subject 1,
  semicolon 1`; none of those without the pack), `SCAN: 5 source files` (kit scripts left out), `NEW_DEBT: unknown` →
  `--write-baseline` writes `docs/project/techdebt-baseline.json` → `--strict` `NEW_DEBT: no` exit 0 → one more `any` →
  `NEW_DEBT: yes (any +1)` exit 1. FoodVibe (scratch clone, rendered script): `SCAN: 493 source files under src/app` —
  `any 0, console-log 1, todo 3, big-file 28, legacy-decorator 0, behavior-subject 0, semicolon 0` (matches
  `grep -rn "@Input()\|BehaviorSubject" src/app --include=*.ts` minus specs: none left since the 2026-09-27 report);
  baseline written to `_shared/techdebt-baseline.json`; a probe line `@Input() a = 1;` + `BehaviorSubject` →
  `NEW_DEBT: yes (legacy-decorator +1, behavior-subject +1, semicolon +1)`, the categories of FoodVibe's reports.
- Kit checks (local, Windows): leak-check ×3 ok (152 / 38 / 3 files), `PACK_CHECK: ok — 2 packs, 8 contract keys used by core`, `INSTALL_CHECK: ok — 4 fixtures, actionlint on 16 rendered workflows, … 0 problems`, `E2E_CHECK: ok — 42 cases passed`, `WORKFLOW_LINK_CHECK: ok — 4 fixtures …, 0 missing`. PR #26 CI (`c84fc9d`): leak-check (actionlint tarball checksum OK, `actionlint on 16 rendered workflows`, link check 0 missing), e2e ubuntu-latest and windows-latest all pass.

### M8 — FoodVibe safety (read-only; renders and a scratch clone under the session scratchpad)
- `node tools/sync.mjs --target ../foodVibe1.0 --source .` → `KIT_SYNC: dry-run — 3 new, 26 kit-update, 2 conflicts,
  26 local-only, 0 deleted-locally, 0 removed-from-kit, 20 overrides`. Conflicts: exactly
  `.claude/references/hld-template.md` and `prd-template.md` (002). FoodVibe `git status` clean.
- Render diff, FoodVibe config + install record, this branch vs `feat/003-neutral-core-runtime` (temporary worktree):
  12 files differ. Not overridden (sync writes them): `feat.md`, `refactor.md`, `security.md` — the Angular rules
  byte-identical, plus the new first line "Match the file's existing style; never reformat untouched lines." and the
  neutral Loads descriptions; `review.md` skip-list wording; `ship.md` and `standards-git.md` (the `gh -R` / PATCH
  text); `security.yml` — `working-directory: server` → `server/` (same folder), same `npm ci` installs, same two
  `--omit=dev --audit-level=critical` audits, plus a **report-only** `scripts/` audit step (never fails the job; runs
  only once `scripts/package-lock.json` is committed — none yet), so FoodVibe gets no new blocking CI gate;
  `scripts/techdebt-report.mjs` (scan added). Identical:
  `.husky/pre-commit` (same hook order), `docs-refresh.md`, `pr-check-fix-loop.md`, `.prettierrc.json`, every other file.
  Overridden (sync never writes them): `.github/workflows/ci.yml` (render keeps `server-tests`, full `npm run lint`,
  `npm ci`; it moves to `working-directory`), `.claude/commands/fix.md` (Angular rules via the pack, real section
  names), `.claude/commands/commands.md`, `.claude/skills/techdebt/SKILL.md`.
- No CI behaviour or command-rule change for FoodVibe; no new override needed.
- **Done-when "0 `conflict`" — accepted exception:** the dry-run shows 2 conflicts, the PRD/HLD templates. They come from
  plan 002 by design (seeds promoted to managed; plan 006 notes them and A7 resolves them), not from 004. 004 adds no
  conflict. Re-checked after the review fixes: same `3 new, 26 kit-update, 2 conflicts` and the same 12 differing
  renders; `security.yml`'s only addition is the report-only `scripts/` audit.

### PR #26 review fixes
1. (medium) `ci.lintScope: changed` linted kit-managed files (e.g. `scripts/*.mjs` in a sync PR) → the step drops every
   path recorded in `.kit/install.json` (read with `node -p`, no `jq` dependency). Verified with a stub `npx` in a
   scratch repo: a PR merge commit and a push both lint `src/a.ts` and `src/b c.ts`, never the kit file `scripts/x.mjs`.
2. (medium) `scripts/package-lock.json` is the project's, `scripts/package.json` the kit's (Planner decision):
   (a) `sync --apply` that writes `scripts/package.json` runs `npm install --no-audit --no-fund` inside `scripts/` (same
   shell spawn as install, never `--prefix`) when that lockfile exists, and logs it; on failure it prints the exact
   command. install-check: no lockfile → no install; with a lockfile, offline with an empty npm cache → the failure NOTE
   naming `cd scripts && npm install --no-audit --no-fund`. (b) The `scripts/` audit in `security.yml` is report-only
   (`set +e`, summary, `::warning`, `exit 0`): kit dependencies are fixed by a kit release. FoodVibe gets no new blocking
   gate. (c) CHANGELOG item 4.
3. (low) PR path compares the merge commit with `HEAD^1`; the diff is `git -c core.quotePath=false diff -z` written to a
   file (a failing diff fails the step under `set -e`), read NUL-separated (names with spaces survive). Verified: outside
   a repo the step exits 128 instead of "nothing to lint".
4. (low) `ci.lintScope` / `ci.appAuditMode` outside `all|changed` / `enforce|report` → install and sync `STOP`, exit 2
   (install-check case).
5. (low) `server/package.json` with an empty `paths.serverRoot` → install and sync `NOTE` (install-check case);
   CHANGELOG item 3 says a project with a backend must set the key.
6. (low) `PACK:<name>` fragment lines take the marker line's indentation.
7. Done-when wording: the accepted exception above.
- Checks after the fixes: leak-check ×3, pack-check, workflow-link-check (0 missing), install-check with actionlint
  (16 rendered workflows) and e2e — see the PR body.
