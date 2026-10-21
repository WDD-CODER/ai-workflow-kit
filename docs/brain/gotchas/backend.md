# backend gotchas

## An audit script built from the same derivation logic as the import can't catch the logic's own blind spots

**Status:** draft — generalized from a project lesson; review before relying on it.

An audit script built from the same derivation logic as the import cannot catch that logic's blind spots; write migration audits independently of the code under test.

---

## A legacy column that is constant across every row carries no information — deriving from it fabricates data

**Status:** draft — generalized from a project lesson; review before relying on it.

A source column that is constant across every row carries no information; deriving a field from it fabricates data.

---

## An app-required field the source never had will pass every migration audit and still break every save

**Status:** draft — generalized from a project lesson; review before relying on it.

A field the app requires but the source never had passes every migration audit yet breaks every save; audit against app-required fields, not just source fields.

---

## A server-side aggregation verified against a local DB copy can still be unusably slow against the real one

**Status:** draft — generalized from a project lesson; review before relying on it.

Verify aggregation/query performance against the real deployment early; a local copy of the data hides unusable latency.
