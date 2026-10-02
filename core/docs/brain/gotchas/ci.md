# ci gotchas

## `npm audit fix --force` would force an unplanned {{stack.name}} major bump

**Status:** draft — generalized from a project lesson; review before relying on it.

Never run `npm audit fix --force`; scope audit gates to production deps and plan framework major bumps explicitly.
