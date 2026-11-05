// Removing a test's temp folder on Windows can hit EPERM or EBUSY while a just-ended git or node child still holds a
// handle. rmWithRetry tries again a few times with a short pause, and throws the last error when every try failed.
//   import { rmWithRetry } from './lib/rm-retry.mjs'
import { rmSync } from 'node:fs'

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY'])
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** rm(path, { recursive, force }) up to `tries` times; only EPERM / EBUSY / ENOTEMPTY are retried. */
export function rmWithRetry(path, rm = rmSync, { tries = 5, waitMs = 100 } = {}) {
  for (let i = 1; ; i++) {
    try {
      rm(path, { recursive: true, force: true })
      return
    } catch (e) {
      if (!RETRY_CODES.has(e?.code) || i >= tries) throw e
      pause(waitMs * i)
    }
  }
}
