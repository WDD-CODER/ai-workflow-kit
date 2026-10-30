// The 38 decisions of the real orchestrator run 499-502 (kit v1.12.0), as the agents worded them: product names and file
// paths are replaced by neutral words (`file-<n>.<ext>`, line numbers kept), every other word is the original. Pass 1 of the
// run is D1-D19 (plans 499 and 500), pass 2 (the relaunch) is D20-D38 (plans 500, 501 and 502). The Human found these
// duplicates by hand: D20 = D19, D21 = D11, D22 = D17, D23 = D19, D31 = D18.
export const DECISIONS = [
  {
    "id": "D1",
    "plan": "499",
    "text": "behaviour: a tap on the box while the number is already focused does nothing extra, and a disabled, read-only or locked number is not focused (as the readiness answers say) — reverse: remove the activeElement and disabled checks in file-1.ts targetInput_()"
  },
  {
    "id": "D2",
    "plan": "499",
    "text": "behaviour: the directive ignores presses on buttons, anchors, selects, textareas, other inputs and .c-chip inside the box — reverse: shrink the INTERACTIVE selector in file-1.ts"
  },
  {
    "id": "D3",
    "plan": "499",
    "text": "behaviour: the directive also cancels mousedown (not only pointerdown) when it focuses the number, so the browser does not move focus away again — reverse: remove the (mousedown) host binding"
  },
  {
    "id": "D4",
    "plan": "499",
    "text": "behaviour: the reuse-lint rule is line-based — it warns on any added type=\"number\" line in a src/app html that has no appNumberBox on the same line; a new input inside an existing box also warns — reverse: delete the number-input-outside-number-box entry in file-2.mjs"
  },
  {
    "id": "D5",
    "plan": "499",
    "text": "behaviour: appNumberBox sits on the existing container (label, c-input-stack, .relative-input, etc.), so no new wrapper markup and no style changes were made — reverse: remove the attribute from the templates"
  },
  {
    "id": "D6",
    "plan": "499",
    "text": "behaviour: recipe-ingredients-table has it on .col-quantity only; the unit column is a custom-select dropdown and is left alone — reverse: n/a, add the attribute to another container if wanted"
  },
  {
    "id": "D7",
    "plan": "499",
    "text": "seen: file-3.html:114 — the deposit amount number box is not wired because the file is outside the plan scope"
  },
  {
    "id": "D8",
    "plan": "499",
    "text": "seen: file-4.html:33 — the inline price boxes are not wired because the file is outside the plan scope"
  },
  {
    "id": "D9",
    "plan": "499",
    "text": "seen: file-5.html:85 — the time cells are type=\"text\" mm:ss inputs, not type=number, so the number-box rule does not apply"
  },
  {
    "id": "D10",
    "plan": "499",
    "text": "seen: file-6.html:215 — the purchase qty shares a row with a text input, so it is not wired"
  },
  {
    "id": "D11",
    "plan": "500",
    "text": "behaviour: extended the shared counter with a hold directive rather than moving page steppers onto app-counter; each page keeps its own input and skin (cook-view ink, menu paper pill) - reverse: replace the page buttons with app-counter and delete the directive attributes"
  },
  {
    "id": "D12",
    "plan": "500",
    "text": "behaviour: labor-minutes and cook-time steppers keep their fixed step (1 minute / 30 seconds) while held, and the new repeat does not speed up - reverse: pass continuousPress in the labor and cook-time handlers"
  },
  {
    "id": "D13",
    "plan": "500",
    "text": "behaviour: a keyboard-activated button (click with detail 0) does one step; pointer clicks are handled on pointerdown only - reverse: remove the click handler from file-7.ts"
  },
  {
    "id": "D14",
    "plan": "500",
    "text": "behaviour: the cook-view banner minimum is 0.01 and the edit-row minimum is 0, as today; no maximum and no new messages - reverse: change the [stepHoldStop] bindings in file-8.html"
  },
  {
    "id": "D15",
    "plan": "500",
    "text": "behaviour: ran log-query from the plan-500 start time (2026-10-29T20:16:58Z) and left the stale, ignored .claude/.slot-plan-start alone, because take-plan owns that stamp — reverse: rewrite the stamp to the plan start and rerun with --since=plan-start"
  },
  {
    "id": "D16",
    "plan": "500",
    "text": "seen: file-9.ts - onSettingAmountKeydown and onEditAmountKeydown duplicate the step rules of the arrow keys; I left them alone"
  },
  {
    "id": "D17",
    "plan": "500",
    "text": "seen: file-10.ts — the real MasterPushService was used in the specs, so tests depended on the signed-in user state; fixed here by stubbing it (in scope as a test hardening). Reverse: remove the MasterPushService provider from the spec."
  },
  {
    "id": "D18",
    "plan": "500",
    "text": "seen: file-11.js:157 (main checkout's server) — 6 'CORS origin not allowed' errors at 2026-10-29T09:03Z on /api/v1/data/DICTIONARY_OVERRIDES/global from an origin not in ALLOWED_ORIGINS; outside plan 500, not fixed"
  },
  {
    "id": "D19",
    "plan": "500",
    "text": "seen: file-12.md:21 — the [auto] log-query item uses --since=plan-start, which only resolves inside a slot; it needs an explicit ISO time (e.g. 2026-10-28T12:03:38.160Z) to run as [auto:main]"
  },
  {
    "id": "D20",
    "plan": "500",
    "text": "seen: .claude/.slot-plan-start in wt-1 still holds 2026-10-28T12:03:38Z from an earlier plan, and main has no stamp, so the gate's '--since=plan-start' from main always fails — the orchestrator should write the stamp at build start, or pass an ISO time"
  },
  {
    "id": "D21",
    "plan": "500",
    "text": "behaviour: the hold is one shared directive, appStepHold, so the page skins (cook-view ink, menu-intelligence paper) stay as they are and no sibling component was added — reverse: re-inline the hold in each page and revert the directive"
  },
  {
    "id": "D22",
    "plan": "500",
    "text": "behaviour: file-13.ts now stubs MasterPushService because test:ci hung on an admin save (test-only change, scope extended and logged in the plan) — reverse: remove the stub"
  },
  {
    "id": "D23",
    "plan": "500",
    "text": "seen: .claude/.slot-plan-start is stale (2026-10-28, an earlier plan) and missing in main, so log-query --since=plan-start does not work for this plan"
  },
  {
    "id": "D24",
    "plan": "501",
    "text": "behaviour: the undo toast is dismissed when the owning component is destroyed (Planner decision applied) — reverse: drop the owner argument at the call sites"
  },
  {
    "id": "D25",
    "plan": "501",
    "text": "behaviour: event-note undo re-creates the note via addNote, so it gets a new time and author (Planner decision) — reverse: hold the server delete until the toast ends (needs pipeline and server files)"
  },
  {
    "id": "D26",
    "plan": "501",
    "text": "behaviour: I added dictionary keys line_removed, note_removed and photo_removed, and left the now-unused notes_confirm_delete key (the dictionary is append-only) — reverse: delete the three new keys"
  },
  {
    "id": "D27",
    "plan": "501",
    "text": "behaviour: recipe-builder ingredient undo removes the placeholder blank row that removeIngredient had auto-added to an empty list — reverse: restore the row without removing the placeholder"
  },
  {
    "id": "D28",
    "plan": "501",
    "text": "behaviour: a menu item removed from a section is restored only if that section still exists — reverse: drop the includes() guard in menu-intelligence.page removeItem"
  },
  {
    "id": "D29",
    "plan": "501",
    "text": "seen: file-14.html:81 - the scaling-chip (remove) output is handled in recipe-header, which is outside this plan's scope, so that removal still gets no undo toast"
  },
  {
    "id": "D30",
    "plan": "501",
    "text": "seen: ai-draft-editor has one row-delete handler (removeIngredient), not the 3 the plan lists"
  },
  {
    "id": "D31",
    "plan": "501",
    "text": "seen: server log, CORS origin not allowed on /api/v1/data/DICTIONARY_OVERRIDES/global (HTTP 500) — shows in the log-query check but is not from plan 501"
  },
  {
    "id": "D32",
    "plan": "502",
    "text": "behaviour: percent display goes through the engine's formatPct1 / formatPctInt, which print the same output as the old toFixed, so no displayed value changes; `| number` and `| formatQuantity` stay as they were (quantity -> formatQuantity pipe) — reverse: restore toFixed in the 3 spots"
  },
  {
    "id": "D33",
    "plan": "502",
    "text": "behaviour: the menu page date chip is now a plain app-date-field, so the digit-buffer typing, the showPicker call and the Enter/Tab/Arrow focus hop on the date chip are gone — reverse: restore onDateKeydown and the chip markup from git history"
  },
  {
    "id": "D34",
    "plan": "502",
    "text": "behaviour: the textarea directive selector is now every `textarea`; boxes in components that do not import it (equipment forms, venue form, event notes log, supplier-orders, search-combobox) stay fixed-height — reverse: set the selector back to textarea[appTextareaAutoGrow]"
  },
  {
    "id": "D35",
    "plan": "502",
    "text": "behaviour: not-closed, deposit-paid and paste-ingredients dialogs lock their own save button after the first click (the parent closes them); unit-edit and inline-rename take an `isSaving` input that the parent has to set — reverse: remove the isSaving_ signal or input from each dialog"
  },
  {
    "id": "D36",
    "plan": "502",
    "text": "behaviour: the legacy saving flag names (isLoading_, isBusy_, isSubmitting_) were not renamed; `isSaving_` is the name for new code — reverse: n/a, nothing was renamed"
  },
  {
    "id": "D37",
    "plan": "502",
    "text": "seen: file-15.html:165 — the parent of unit-edit-dialog and inline-rename-field does not bind [isSaving] yet (out of scope), so the busy state there only applies once the parent sets it"
  },
  {
    "id": "D38",
    "plan": "502",
    "text": "seen: file-16.md:15 — still describes the removed date chip keyboard handling"
  }
]
export const PASS_1_LAST = 19
export const DUPLICATES = { D20: 'D19', D21: 'D11', D22: 'D17', D23: 'D19', D31: 'D18' }
// SYNTHETIC (not part of the real run): an exact repeat of D11 in the relaunch, to prove code merges a near-identical line
// across launches. Every real line above is untouched.
export const SYNTHETIC_REPEAT = { synthetic: true, of: 'D11', plan: '500', text: "behaviour: extended the shared counter with a hold directive rather than moving page steppers onto app-counter; each page keeps its own input and skin (cook-view ink, menu paper pill) - reverse: replace the page buttons with app-counter and delete the directive attributes" }
