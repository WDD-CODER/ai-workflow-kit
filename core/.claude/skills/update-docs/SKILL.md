---
name: update-docs
description: Refreshes breadcrumb navigation maps and project documentation after feature completion in {{project.name}}.
---

# Skill: update-docs

**Trigger:** After completing a significant development task, adding new features/components/services, or before a PR.
**Standard:** Breadcrumb placement and Major Seam definitions are in the stack pack's standards doc (`docs/agent/standards-*.md`).

---

## Phase 1: Structural Scan `[Procedural — Haiku/Composer (Fast/Flash)]`

**Detect Changes:** Identify new directories, moved files, or deleted subtrees since the last session.

**Seam Verification:** Ensure `breadcrumbs.md` files exist **only** at Major Seams as defined in the project's standards doc (the top-level subtrees of `{{paths.srcRoot}}`).

<!-- PACK:stack — the concrete seam folders for this stack (core / shared / pages and their sub-folders) come from the stack pack -->

> **Rule:** No `breadcrumbs.md` in leaf folders. Delete any found outside these seam locations.

---

## Phase 2: Map Maintenance `[Procedural — Haiku/Composer (Fast/Flash)]`

**Sync Content:** Update the internal directory maps within each breadcrumb file.

**Prune:** Delete breadcrumb files no longer at a Major Seam or in empty directories.

**API / Interface Update:** If a core service or model changed, update the "Key Exports" section of the relevant breadcrumb.

---

## Phase 3: Agent Handoff 

> **Only invoke Phase 3 if the project has undergone a major architectural shift. Otherwise stay in Flash.**

**Complex Reorg:** Invoke the Breadcrumb Navigator agent (Section 0.3) to redefine the seams.

**Doc Refinement:** Improve "Context/Purpose" descriptions in breadcrumbs if the file content has significantly evolved.

---

## Completion Gate

Output: `"Documentation refreshed. Breadcrumbs updated at [List of Seams]."`

Trigger the Breadcrumb Navigator (Section 0.3) if the user asks for a structural overview after the update.

