---
description: Weekly workflow scout — what is new in Claude Code and the community, judged against this project's setup, as one page and one pull request. Proposals only.
allowed-tools: Read, Write, Bash, Grep, Glob, WebFetch
---

# /scout — what is new for this workflow

Collects what changed since the last run, keeps only what fits **this project's** setup, and publishes it as one
short page (`docs/scout/<date>.html`) and one pull request. Nothing is applied. Usually a weekly cloud scheduled run
does this; run it by hand the same way.

The repository may be public: the page and the pull request never carry secrets, `.env` content or transcript text.
Never read `.env*` or `.claude/settings.local.json`.

## 1. Load what to scan

- Sources and caps: `docs/scout/sources.json` (the project edits it to add or remove a source or change a cap).
- What was already seen: state.json in docs/scout/ — the last Claude Code version and one cursor per source id. No
  file yet = first run: take only the last 30 days of each source.

Scan at most `caps.maxSources` sources and keep at most `caps.maxItemsPerSource` items from each. Skip a source of
type `template-only`. A source marked `network: custom` needs the run's network set beyond GitHub; when a fetch is
blocked, skip it and give it a `note` ("skipped: network") in the report. Never retry a blocked fetch.

## 2. Collect — only what is new since the cursor

| type | how | cursor |
| --- | --- | --- |
| `github-file` | `gh api repos/<repo>/commits?path=<path>&since=<last run>`; then read the file's new part (raw.githubusercontent.com) | the newest version heading (CHANGELOG) or commit sha |
| `github-commits` | `gh api repos/<repo>/commits?since=<last run>` | the newest commit sha |
| `github-releases` | `gh api repos/<repo>/releases?per_page=10`; the ones newer than the cursor | the newest tag |
| `web` | fetch the page; the entries dated after the cursor | the newest date |

A source marked `readOnly` (no license): read it and link to it; never copy its text. Write every line in your own
words. For a community item, record its license, stars and last commit date (`gh api repos/<repo>`).

## 3. Judge fit against this project

Read the setup: `CLAUDE.md`, `AGENTS.md`, `.claude/` (commands, skills, agents, hooks in `.claude/settings.json`),
`docs/agent/`, and when present the kit's ownership list under docs/workflow-kit/ and the decisions under
docs/brain/decisions/. For each new thing ask: does it change how this project works? Keep it only when you can name
the exact file it touches. Flag:

- **Native feature now replaces your custom part** — Claude Code now does natively what a project command, skill,
  hook or script does. Set `replaces` to that part.
- **A community skill beats ours** — it does the same job better or cheaper.

Sort by what is most worth adopting first. Categories: Adopt, Improve, Remove, Security, Parked (interesting, not now).
Keep at most `caps.maxItems` items; when a cap cut something, set `budgetReached: true`.

## 4. Write the report (JSON, never HTML)

Write `.claude/reports/scout-<date>.json`:

```json
{
  "date": "YYYY-MM-DD",
  "claudeCode": { "from": "<version in state.json>", "to": "<newest version seen>" },
  "budgetReached": false,
  "sources": [{ "id": "<source id>", "cursor": "<new cursor>", "items": 3, "note": "optional" }],
  "items": [{
    "category": "Adopt",
    "headline": "up to eight punchy words",
    "hook": "one line that makes the reader want to try it",
    "why": "what it does for this project, in one or two sentences",
    "file": "the project file it touches",
    "effort": "S",
    "source": { "name": "where it came from", "url": "https://..." },
    "replaces": "only when a native feature replaces a custom part",
    "community": { "license": "MIT", "stars": 1200, "lastCommit": "YYYY-MM-DD" }
  }]
}
```

Write like an advertiser: the headline sells, the hook pulls the reader in, `why` says what they get. No jargon.

## 5. Build the page and open the pull request

```bash
node scripts/scout/render.mjs --report .claude/reports/scout-<date>.json
```

- `SCOUT: nothing new since <version>` → stop. No page, no pull request.
- Exit 2 → the report was refused (the reason says which field, or that a line looked like a secret or a path);
  fix the report and run it again.

Then, from a clean tree on the default branch:

```bash
node scripts/scout/pr.mjs --report .claude/reports/scout-<date>.json --dry-run
node scripts/scout/pr.mjs --report .claude/reports/scout-<date>.json
```

It commits the page and state.json on `chore/scout-<date>`, pushes, and opens the pull request through `gh api`
(cloud scheduled runs reject `gh pr create`). The body lists the top items as text, links the page and has a
"Which were useful?" checkbox list the Human ticks. Report the pull request link and stop.

## Weekly cloud run

Create it with `/schedule` only after the Human's go — it is billed and pushes to the repository. Show them first:

- **Schedule:** weekly (cron hours are UTC).
- **Repository:** this project's; branch pushes to `chore/scout-*`.
- **Network:** GitHub only covers every `github-*` source; the `web` sources need custom network access that allows
  their hosts.
- **Prompt:** "Run the workflow scout: follow `.claude/commands/scout.md` from step 1 to step 5 in this repository.
  Proposals only — apply nothing."

Expected cost: about 100-200k tokens a run. Change the cadence in the schedule and the caps in `docs/scout/sources.json`.
