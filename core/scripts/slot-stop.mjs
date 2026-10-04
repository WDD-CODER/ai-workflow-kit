/**
 * Slot stop — stops this slot's dev servers (recorded PIDs plus any leftover dev
 * server on the slot's own ports) and clears .claude/.slot-pids. Safe to run any
 * time; take-plan.mjs and free-merged-slots.mjs call the same logic.
 *
 * Usage: node scripts/slot-stop.mjs
 * Cross-platform: use this instead of taskkill/kill by hand (Git Bash rewrites `/PID`).
 */
import { isSlot } from './lib/slot.mjs'
import { stopSlotServers } from './lib/slot-procs.mjs'

if (!isSlot()) {
  console.error('SLOT_STOP: not a slot - nothing to stop')
  process.exit(1)
}
const lines = stopSlotServers()
for (const l of lines) console.log(`SLOT_STOP: ${l}`)
console.log(lines.length ? `SLOT_STOP: ok - ${lines.length} action(s)` : 'SLOT_STOP: ok - nothing running')
