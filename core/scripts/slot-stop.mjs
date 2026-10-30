/**
 * Slot stop — stops this slot's dev servers: recorded chains, any leftover dev server on the slot's own ports,
 * and every other dev chain whose command line is inside this slot's folder (orphaned `node --watch` watchers
 * that hold no port included). Each chain is killed from its root, so no watcher is left behind. Clears
 * .claude/.slot-pids. Safe to run any time; take-plan.mjs and free-merged-slots.mjs use the same logic.
 *
 * Usage:
 *   node scripts/slot-stop.mjs            # in a slot; exit 1 elsewhere
 *   node scripts/slot-stop.mjs --if-slot  # SessionEnd hook: silent no-op (exit 0) outside a slot
 * Cross-platform: use this instead of taskkill/kill by hand (Git Bash rewrites `/PID`).
 */
import { isSlot, endValidating } from './lib/slot.mjs'
import { stopSlotServers, repoRoot } from './lib/slot-procs.mjs'

if (!isSlot()) {
  if (process.argv.includes('--if-slot')) process.exit(0)
  console.error('SLOT_STOP: not a slot - nothing to stop')
  process.exit(1)
}
const lines = stopSlotServers()
for (const l of lines) console.log(`SLOT_STOP: ${l}`)
// A slot that served a branch for validation (slot-serve.mjs --ref) is idle again once its servers are stopped.
const validated = endValidating(repoRoot)
if (validated) console.log(`SLOT_STOP: validating ${validated} ended`)
console.log(lines.length ? `SLOT_STOP: ok - ${lines.length} action(s)` : 'SLOT_STOP: ok - nothing running')
