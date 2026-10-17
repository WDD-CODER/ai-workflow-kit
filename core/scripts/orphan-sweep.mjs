/**
 * Orphan sweep — kills this folder's orphaned dev chains: a `node --watch` watcher with no child process, plus
 * its npm / cmd.exe / cross-env parents, whose command line is inside this folder and that holds no port.
 * Runs at session start (session-startup.sh) in a slot and in the main folder, to clean up after a session
 * that crashed or closed before its SessionEnd hook ran. A server that holds a port is never touched, so the
 * Human's running main-folder servers (and a running QA harness) stay up.
 *
 * Usage: node scripts/orphan-sweep.mjs [--quiet]   # --quiet: print nothing when there is nothing to stop
 */
import { repoRoot, sweepOrphans } from './lib/slot-procs.mjs'

const lines = sweepOrphans(repoRoot)
for (const l of lines) console.log(`ORPHAN_SWEEP: ${l}`)
if (!lines.length && !process.argv.includes('--quiet')) console.log('ORPHAN_SWEEP: ok - no orphans')
