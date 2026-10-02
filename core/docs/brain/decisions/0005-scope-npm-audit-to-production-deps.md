# Scope CI `npm audit` to production dependencies only

**Status:** draft — generalized from a project decision; review before relying on it.

Scope `npm audit` CI gates to `--omit=dev`; dev-tooling churn is noise for a never-shipped tree.
