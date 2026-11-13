# Plan 116 — Make the kit repository private, with its CI on a self-hosted runner on the Human's PC

Status: draft
Parked: 2026-11-13 — the Human: "save it as a plan to be done ahead"; the CI change is ready in PR #139
Depends-on: none
Snapshot: 7ba17ad
Source: the Human, 2026-11-12: make the repository private without paying for GitHub Actions, and keep working the
way they do today. Their choices: `go self-hosted, e2e on releases`.

## Problem Statement

**Goal.** The repository `WDD-CODER/ai-workflow-kit` should be private. The way of working stays the same: plan →
branch → PR → CI → merge gate → release tag → `kit-sync` in projects.

**Why not just flip it.** GitHub-hosted minutes are free only on a public repository. Use measured from the run
history, 2026-10-13 → 2026-11-12:
- 576 runs: 191 from pull requests and 385 from pushes to main (many of them plan-only commits).
- A PR run is about 10 Linux minutes. A push to main is about 11 Linux minutes plus about 6 Windows minutes, and
  Windows counts double.
- That is about **11,000 billable minutes a month**, against 2,000 included in a free private repository (check the
  billing page before relying on that figure).

**What each CI job is worth** (last 30 days):

| Job | What it checks | Time | Real failures | Decision |
| --- | --- | --- | --- | --- |
| `leak-check` | leaks, drift, installer renders working CI | ~1 min | 14 | every PR |
| `kit-tests` | all `tools/test` + orchestrator validation (fake) | ~5 min | 1 | every PR |
| `e2e` | a fresh project through plan → ship → merge; three fixture projects | ~5 min per OS | Ubuntu 8; Windows 36, mostly two recurring cases (`orchestrator-folders`, `guards`) | release tags and by hand only |

e2e runs only on releases because projects take only released versions, and part of it repeats `kit-tests`.

**What going private changes besides CI.**
- **FoodVibe's `kit-sync` and installs** fetch `github:WDD-CODER/ai-workflow-kit` over git. They work on the Human's
  PC through its GitHub login; any machine without that login can no longer fetch the kit.
- **The mods marketplace** (`extraKnownMarketplaces` → `WDD-CODER/ai-workflow-kit`) installs through the same login.
  Its background auto-update may need a `GITHUB_TOKEN` environment variable (unconfirmed; check after the switch).
- **Public links, forks and stars** stop working for anyone else.

## What is already done (PR #139, branch `chore/self-hosted-ci`, open, not merged)
- **Runners:** every job runs on `[self-hosted, Windows]`.
- **Triggers:** a PR runs `leak-check` + `kit-tests`; a `v*` tag also runs `e2e`; `workflow_dispatch` starts any job
  by hand; a push to main runs nothing.
- **Windows setup:**
  - Git Bash goes first on PATH, because `C:\WINDOWS\system32\bash.exe` is WSL's;
  - actionlint is the pinned Windows build, checksum `7f12f180…a731`;
  - the fixture repositories get a git identity, because the service account has none.
- **Security** (from an automated review):
  - `permissions: contents: read`;
  - a pull request whose branch is not in this repository (a fork) never runs on the runner.
- **Docs and test:** `docs/CHANGE-LOOP.md`, `README.md`, `tools/test/ci-coverage.test.mjs` and a CHANGELOG line.
- **Checked:** actionlint passes on the workflow, and the CI-shape test passes. The PR's own checks have not run:
  they wait for the runner.

## Goals & Success Criteria
- [human] The runner shows **Idle** under Settings → Actions → Runners, and PR #139's checks (`leak-check`,
  `kit-tests`) pass on it.
- [human] After the merge and the switch, the repository page shows **Private**, and Settings → Actions → General →
  "Fork pull request workflows" is off.
- [human] In FoodVibe, `kit-sync` still fetches the kit, and Claude Code still loads the mods (fleet, guards,
  ship-pilot).
- [auto] A test release tag (or a hand-started run from the Actions tab) runs `e2e` on the runner and passes.

## Execution Mode
- Parallel: no. Concurrent plans: none. Isolated DB: no.
- Run: steps 1, 3 and 4 are the Human's (GitHub login); step 2 is the agent's (merge PR #139 once its checks pass).

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots
`CHANGELOG.md` and `docs/brain/error-review.md`.

```scope
.github/workflows/leak-check.yml
tools/test/ci-coverage.test.mjs
docs/CHANGE-LOOP.md
README.md
CHANGELOG.md
```

## Read Scope
Entire repo.

## Escalation Protocol
Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside the
`## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append the
path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — CI configuration only; no model, tier or agent change.

## Step 0 — Reality Check
1. PR #139 is still open and its branch still merges cleanly into main. If main moved, merge main into it (no
   force-push: it is blocked), resolve, and re-run actionlint and `node --test tools/test/ci-coverage.test.mjs`.
2. Re-check the cost figures if the plan waited long: the free minutes and the run count change.

## Atomic Sub-tasks
- [ ] P1: The Human installs the GitHub runner on the PC as a Windows service — open https://github.com/WDD-CODER/ai-workflow-kit/settings/actions/runners/new?arch=x64&os=win, open PowerShell as Administrator, run `cd C:\` then `mkdir actions-runner; cd actions-runner`, then paste the page's lines **without the leading `$ `** (download, hash check, unzip, `./config.cmd --url … --token …`; the token expires one hour after the page opens); Enter for group, name, labels and work folder, `Y` to run as service, Enter for `NT AUTHORITY\NETWORK SERVICE`
- [ ] P2: Merge the CI change once its checks pass on the runner — watch PR #139 (`leak-check`, `kit-tests`), merge it, and keep the `e2e` check for the next release tag — .github/workflows/leak-check.yml
- [ ] P3: The Human makes the repository private — Settings → General → Danger Zone → Change visibility → Private (or the agent runs `gh repo edit WDD-CODER/ai-workflow-kit --visibility private --accept-visibility-change-consequences` on the Human's yes); then confirm that "Fork pull request workflows" is off
- [ ] P4: Check that projects still get the kit and the mods after the switch — `kit-sync` in FoodVibe between orchestrator runs; Claude Code loads fleet, guards and ship-pilot; if the mods' auto-update fails, record whether `GITHUB_TOKEN` is needed

## Technical Considerations
- CI runs only while the PC is on and the runner service is running. One runner means jobs wait in line.
- A CI run shares the CPU with any orchestrator run going at the same time.
- A self-hosted runner on a **public** repository would let anyone's PR run code on the PC. The fork guard covers the
  time before the switch; after it, only invited people can open PRs.

## Out of Scope
- An Ubuntu leg (no Linux machine); a second or ephemeral runner.
- Moving projects' own CI (a project's CI is its own).

## Critical Questions
1. After the switch, does the mods marketplace auto-update need a `GITHUB_TOKEN`? Answer in P4.

## Execution Notes
- 2026-11-12 Planner: PR #139 made the change and hardened it after an automated security review. The Human's first
  runner attempt failed only because the lines were pasted with GitHub's `$ ` prompt marker; nothing was installed.
- 2026-11-13 Planner: saved parked at the Human's request.
