# ci gotchas

## `npm audit fix --force` would force an unplanned {{stack.name}} major bump

**Status:** draft — generalized from a project lesson; review before relying on it.

Never run `npm audit fix --force`; scope audit gates to production deps and plan framework major bumps explicitly.

## An override of `ci.yml` can silently lose a step the kit relies on

**Status:** draft — generalized from a project lesson; review before relying on it.

A project's own copy of `ci.yml` (a declared override) lost the kit's **Install workflow script dependencies** step.
npm hoisting hid the gap; after the move to pnpm, CI `lint` failed with `Cannot find package 'picomatch'`. The kit now
marks load-bearing steps `# KIT:required`; `node scripts/override-check.mjs` (CI step **Kit override check**) and
`kit-drift` (`override-missing-step`) fail by name. Add the step back; never delete the marker.
