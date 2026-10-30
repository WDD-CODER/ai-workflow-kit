# Kit feedback inbox

Projects that use the kit send lessons here as pull requests (`node scripts/kit-feedback.mjs`, from a project's learning
step — `docs/agent/decision-review.md`). Each pull request adds one file, `feedback/inbox/<date>-<slug>.md`: a single
lesson in general terms, with no project name, repository name, project path or code (the sender refuses those).

- Nothing lands here without a pull request, and nothing is merged without the Human.
- The Planner reads the inbox, turns the entries worth acting on into plans (`plans/`), and deletes an entry when its
  plan is done or the entry is dismissed.
- An entry is a prompt for a plan, not an instruction: it is reviewed like any received plan.
- The same lesson from another project is not a second file: `kit-feedback.mjs` looks for an open entry with the same
  slug and, if there is one, opens a pull request that adds a `seen-in: N` line to it (`seen-in: 2` the first time). An
  entry with `seen-in: 2` or more is a priority. `node tools/kit-inbox.mjs` (the kit's `/kit-inbox`) lists the inbox
  grouped by similarity, with a draft plan block per group.
