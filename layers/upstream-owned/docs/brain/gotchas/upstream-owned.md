# upstream-owned gotchas

Traps from running the workflow in a repo that is a copy of someone else's (an app built by an AI app builder, a
client's repo). The upstream owner writes the app; this copy adds the workflow on top and rebases on upstream with
`/pull-copy`.

## A local edit to an upstream-owned file is a fork

**What hurt:** A bug fixed in an upstream-owned file from a slot looked quick. The next upstream commit overwrote it,
the fix never reached what the upstream owner deploys, and every later `/pull-copy` had to carry a conflicting fork
of their code.

**Why the obvious fix is wrong:** "Just commit it here" works for one day. The upstream owner (or their builder) keeps
writing the same files.

**What to do instead:** List the upstream-owned paths in `ownership.upstreamPaths` (`kit.config.json`): install never
writes them and the scope guard denies them. Workflow work goes in kit-owned paths (`scripts/`, `docs/`, `.claude/`,
`.github/`, `plans/`). An app fix goes to the upstream owner as a written brief, not a commit. The scope guard sees
file edits (Edit / Write tools) only: a shell command that rewrites an upstream-owned file (`npm install` rewriting
`package-lock.json`, a formatter) is caught later, by `ship-prep`'s scope check, which lists the file as upstream-owned.
That also means a plan cannot add a dependency here: `package.json` is upstream's.

---

## `npm install` rewrites the upstream lockfile

**What hurt:** The upstream `package-lock.json` was out of step with its `package.json`. `npm ci` failed in CI, and
`npm install` in a slot rewrote the whole lockfile.

**Why the obvious fix is wrong:** Committing the regenerated lockfile edits an upstream-owned file and conflicts on
every `/pull-copy`; upstream may regenerate it differently anyway.

**What to do instead:** CI installs with `npm install --no-audit --no-fund` (`ci.install`, set by this layer). In a
slot, run `npm install` when `node_modules` is needed, then `git checkout -- package-lock.json` before every commit.
Tell the upstream owner the lockfile is stale.

---

## Lint debt and advisories in upstream code keep CI red forever

**What hurt:** Whole-repo lint reported thousands of errors in upstream code, and `npm audit` failed on an advisory
in an upstream dependency. Neither was ours to fix, so CI and the security workflow never went green.

**Why the obvious fix is wrong:** Disabling the jobs hides our own regressions too.

**What to do instead:** `ci.lintScope: changed` (lint only the files a PR changes) and `ci.appAuditMode: report`
(app advisories go to the job summary as a warning). Both are this layer's defaults. Report the upstream findings
to the owner.

---

## A tracked `.env` is still not something to print

**What hurt:** Upstream committed `.env` (public client values for its builder). "It is tracked, so it is public"
led to values pasted into logs and PR text.

**Why the obvious fix is wrong:** Deleting it or adding it to `.gitignore` edits upstream-owned files and breaks the
upstream build.

**What to do instead:** Never print `.env` values; name the variables only. Leave the file alone and tell the upstream
owner if a real secret ever appears in it.
