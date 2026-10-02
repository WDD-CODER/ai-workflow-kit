# Brain Capture Playbook

> Load this file when: proposing or writing any `docs/brain/` entry — `/ship` Phase 4/4.5, the Post-push Merge Gate, or an explicit "save to brain" request.

Goal: every proposal extracts the **judgment that made the session expensive**, not a label that restates the diff. The bar: *a future agent, cold on this area, avoids a wrong choice after reading only this entry.* If a draft can't clear that bar, skipping is the correct outcome — `none durable` is a valid and common answer, especially for chores.

---

## Extraction procedure (run in order, before drafting)

1. **What surprised us or cost rework this session?** Mine `sessions/YYYY-MM-DD.md` ("Decisions", "Reviewer should scrutinize"), review findings, and the conversation — not the diff alone. The diff shows *what* changed; the brain wants *why the obvious path was wrong*.
2. **What rule would have prevented that?** Phrase it as an instruction to a future agent ("gate login reload with `hasLoaded()`"), never as a fact about the code ("uses `ensureLoaded`").
3. **Pick the artifact type** — and split when more than one applies (a costly session often yields a pattern *and* its paired gotcha):
   - **Pattern** — the happy path we'd repeat. Shape: **Problem / Solution / When to use**.
   - **Gotcha** — the trap that looked like success. Shape: **What hurt / Why the obvious fix is wrong / What to do instead**.
   - **Decision (ADR)** — a choice between real alternatives. Shape: **Context / Decision / Consequences** + frontmatter. One decision per file; supersede, never edit in place.
4. **Draft the full file body** from the matching template: `docs/brain/patterns/_TEMPLATE.md`, `docs/brain/decisions/_TEMPLATE.md`, or the gotcha shape stated in `docs/brain/gotchas.md`. Match the length of the good examples ([[defer-singleton-data-ensureLoaded]], [[tombstone-soft-delete]]) — one screen or less, never a session dump. Cross-link related entries with `[[wiki-links]]`. A gotcha's domain file (which `gotchas/<domain>.md` to append to) comes from the routing table in `docs/brain/gotchas.md`.
5. **Write a one-line title** for the banner. The title names the entry; it is **never** the entry.

## Reuse tracking (session logs)

Whenever a session's decision was actually shaped by an existing `docs/brain/` entry — a specific entry that changed what the agent did, not merely "this area is covered by brain" — add one line under `### Decisions` in that day's `sessions/YYYY-MM-DD.md`:

`Informed by: [[entry-name]]`

Cite only entries that changed a choice. Most sessions will have none, and that is expected. Forward-only: do not rewrite past session logs to backfill citations. A future audit can `grep -r "Informed by:" sessions/` instead of re-deriving reuse from commit archaeology.

## Usefulness gate (all must pass, or expand / skip)

- [ ] Would this change a future agent's wrong default? If it only describes what we did, `sessions/` already holds it — skip.
- [ ] Is the trap or exception named explicitly — the audit rule, the "looks done but isn't" case — not just the API name?
- [ ] Does it say when **not** to apply it?
- [ ] Is it more than a restatement of the commit subject / visible diff?
- [ ] Is it the right layer? Coding rules → `AGENTS.md` / `docs/agent/`; status → session-state / todo; changelog → `sessions/`; plan criteria → `plans/`.

**A one-liner-only proposal is invalid.** If there isn't enough judgment to fill the required shape, there is nothing durable — propose `none durable` instead of a slogan.

## Bypass escalation (gotchas)

If the *same* documented gate (script/hook naming a specific bypass) is reported bypassed a second time via a new path, name that explicitly in the new gotcha's **Why the obvious fix is wrong** section as a **structural-fix signal**, not just another instruction restated. Worked example: [[Existing save-plan mitigations still let a plan skip plans/]] (second bypass after the pasted-plans gotcha → Plan 291 structural hardening).

## Proposal format (ship tree / Merge Gate banner)

- The banner or tree line stays short: **path + quoted one-line title** (keeps the ASCII box readable).
- The **full draft body** follows directly *below* the tree/banner as a fenced markdown block — one fence per entry.
- Two entries in one proposal are allowed and often right (pattern + paired gotcha): one banner line + one fenced draft each.
- `brain approve` writes the fenced body **verbatim** (for a gotcha: append to the matching `docs/brain/gotchas/<domain>.md`, routed per `docs/brain/gotchas.md`; new file under `patterns/`; next-numbered file under `decisions/`). `brain edit …` revises the draft and re-shows it.

## Constraints (auto-write on the gate reply is the default)

- **Auto-writes by default, opt-out per ship.** The full draft is always shown before it lands — that hasn't changed — but it no longer needs its own separate `brain approve` reply. It writes as part of the reply that closes the surrounding gate (`Y` at `/ship` Phase 4; `merge` / `later` / `open-pr-only` at the Post-push Merge Gate). Say `no brain` / `skip brain` alongside that reply to opt out for this ship, or `brain edit …` to revise first. This supersedes ADR 0003's confirm-to-write clause only — auto-evoke and the ADR 0004 usefulness gate below are unchanged.
- Don't move coding rules into the brain; don't duplicate plan Done-when lists or session logs.
