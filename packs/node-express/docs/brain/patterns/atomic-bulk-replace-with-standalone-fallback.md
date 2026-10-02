# Pattern: Mongo bulk replace — transaction first, pending-flag swap when standalone rejects it

**Status:** draft — generalized from a project pattern; review before relying on it.

Bulk replace = transaction first, pending-flag swap fallback when the DB is standalone.
