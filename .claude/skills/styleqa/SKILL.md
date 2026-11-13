---
name: styleqa
description: Style QA - runs the measured style audit and a bounded visual review of screenshots into one report, and prints a short summary. Use when the Human types /styleqa, asks for a style or visual QA of a page, or wants to re-check a page after a style fix. Reports only; never fixes.
argument-hint: "[page ...] [--no-review] [--widths=375,1366] [--states=menu] [--changed]"
allowed-tools: Read, Glob, Bash(node scripts/styleqa/*), Bash(node scripts/slot-serve.mjs *), Task
---

# /styleqa - measured audit + bounded visual review, one report

Runs inline on the main model. Adoption, the page map and the cost: `docs/agent/styleqa.md`. It reports; it never edits code.

## Flow

1. **Pages.** Map the arguments to `--pages=<words>` for the engine. An unknown word, or none known: run
   `node scripts/styleqa/run.mjs --list`, show the list and stop. Pass `--widths=`, `--states=` and `--changed` through.
2. **Servers.** The sweep needs the app. In the main folder run `node scripts/slot-serve.mjs --main`; in a slot run
   `node scripts/slot-serve.mjs`. If the app still does not answer, use the `preflight` skill and stop with its `FAIL` line.
3. **Measured run.** `node scripts/styleqa/run.mjs --layers=static,sweep <flags>`. A non-zero exit or `status: failed`
   stops here: show the last lines, never review screenshots of a failed run.
4. **Visual review** (skip with `--no-review`).
   - `node scripts/styleqa/queue.mjs --pages=<same pages>` writes one queue file per page and prints the image counts
     (and how many were skipped over 24).
   - Start one `styleqa-reviewer` per page with a queue, **at most 3 at once** (the next page starts when one returns).
     Task text: `Review the queue file <path>.` Nothing else; the agent reads the rubric and theme facts itself.
   - `node scripts/styleqa/merge.mjs --pages=<same pages>`. A `skipped <file>: <reason>` line means that page has no
     visual findings this run: say so in the summary.
5. **Summary**, in the Human's language: status, pages covered, counts by severity (measured / visual), the top 5
   components with their pages, new / known / gone, the report path - from the `summary` lines the merge prints (with
   `--no-review`, from the `STYLEQA:` lines of the run). Then one line offering fix plans for the top components. Stop.
