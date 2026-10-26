---
description: Send one general lesson to the kit as a pull request on the kit repository — checked for project names, paths and code first
allowed-tools: Read, Bash
---

# /kit-feedback — send a lesson to the kit

Usually the learning step does this by itself after a graded `✗` (`docs/agent/decision-review.md`). Use the command for a
lesson you want to send by hand.

1. Write the lesson in **general terms**: what went wrong, what the workflow should do instead. No project name, no
   repository name, no file paths of this project, no code.
2. Dry run first:

   ```bash
   node scripts/kit-feedback.mjs --title "<short title>" --text "<the lesson>" --dry-run
   ```

   It prints the entry, the branch `feedback/<date>-<slug>` and the `gh` calls, and pushes nothing. Exit 2 means the
   text was refused (it named the project or repository, a project path, or held a code fence) — rewrite and retry.
3. Show the Human the entry. On their yes, run it again without `--dry-run`: it opens a pull request on the kit
   repository (`.kit/install.json` `source`) with one file under `feedback/inbox/`. Report the pull request link.

Never push to the kit's main branch; the kit's Planner reads the inbox.
