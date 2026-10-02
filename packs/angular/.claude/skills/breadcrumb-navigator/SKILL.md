---
name: breadcrumb-navigator
description: Creates and maintains breadcrumbs.md navigation files at major directory seams so agents and developers instantly understand any directory.
---

# Skill: breadcrumb-navigator
**Model Guidance:** Use Haiku/Flash for Phases 1 and 2. Use Sonnet for Phase 3 only when providing full project navigation advice.

**Trigger:** New `pages/<x>/` or top-level subtree added; structural changes; after `update-docs`; user is navigating an unfamiliar directory.

**Breadcrumb Rules (inline — no guide read required):**
- `breadcrumbs.md` lives at Major Seams ONLY: `core/`, `core/services/`, `core/models/`, `core/components/`, `shared/`, `pages/`
- Delete any `breadcrumbs.md` found outside these seams — leaf folders must stay clean
- Every file mentioned must exist and be verifiable from the actual code
- Every description must add navigational value — no generic filler
- A developer unfamiliar with the codebase should understand a directory's purpose within 30 seconds

---

## Phase 1: Structural Audit

**Map Verification:** Scan the current directory and neighbors for existing `breadcrumbs.md` files. Read before writing.

**Seam Validation:** Confirm the current location is a Major Seam: `core/`, `shared/`, `pages/`, `core/services/`, `core/models/`, `core/components/`. If not → do not create a breadcrumb here.

**Pruning:** Identify and delete `breadcrumbs.md` files in leaf folders or non-seam directories.

---

## Phase 2: Map Authoring

**Directory Indexing:** List all sub-directories and primary files (`.service.ts`, `.component.ts`, `.model.ts`).

**Context Extraction:** Read component headers or service class names to provide a one-line purpose for each major folder.

**File Write:** Generate or update `breadcrumbs.md` with a clean, hierarchical navigation table. Verify every file listed actually exists before saving.

---

## Phase 3: High-Level Navigation 

> **Only invoke if** the user is lost or requests a structural overview.

**Entry Point Discovery:** Analyze the project root and provide a "You Are Here" summary across the entire app tree.

**Structural Recommendations:** Suggest moving files or creating new seams if a folder exceeds 3 levels deep or 10+ files.

---

## Completion Gate

Output: `"Navigation map updated for [Directory]. Breadcrumbs active at [Major Seams]."`

If a new directory was created → remind the user to run `update-docs` for a global refresh.
