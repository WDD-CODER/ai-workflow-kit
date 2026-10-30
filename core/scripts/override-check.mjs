#!/usr/bin/env node
/**
 * override-check — does a project's own copy of a kit workflow still keep every step the kit requires?
 *
 *   node scripts/override-check.mjs [--root <dir>] [--list]
 *
 * A project may keep its own copy of a kit file for good (kit.config.json `overrides`). The kit marks the steps of
 * its workflows that every copy must keep (`# KIT:required`) and records them in .kit/install.json `required`.
 * This script reads both and fails by name when an overridden workflow lacks one. It reads two project files and
 * runs nothing. `--list` prints the required steps per workflow instead.
 *
 * Exit 0 = ok or skipped, 1 = a required step is missing.
 */
import { readFileSync, existsSync } from 'fs'
import { resolve, join } from 'path'
import { missingSteps } from './lib/override-steps.mjs'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const rootAt = argv.indexOf('--root')
const root = resolve(rootAt >= 0 ? argv[rootAt + 1] ?? '.' : '.')
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''))
const say = (m) => console.log(`OVERRIDE_CHECK: ${m}`)

const dotKit = join(root, '.kit', 'config.json')
if (existsSync(join(root, 'kit.json')) && existsSync(dotKit)) {
  say("skipped — the kit's own checkout")
  process.exit(0)
}
const instFile = join(root, '.kit', 'install.json')
if (!existsSync(instFile)) {
  say('skipped — no .kit/install.json')
  process.exit(0)
}

let required
let overrides
try {
  required = readJson(instFile).required ?? {}
  const cfgFile = existsSync(dotKit) ? dotKit : join(root, 'kit.config.json')
  const list = existsSync(cfgFile) ? readJson(cfgFile).overrides ?? [] : []
  if (!Array.isArray(list)) throw new Error('"overrides" must be a list of { "path", "reason" }')
  overrides = list.filter((o) => o && typeof o.path === 'string').map((o) => o.path.trim().replace(/\\/g, '/').replace(/^\.\//, ''))
} catch (e) {
  say(`FAIL — ${e.message}`)
  process.exit(1)
}

if (flag('--list')) {
  const dests = Object.keys(required).sort()
  if (dests.length === 0) say('no required steps recorded in .kit/install.json')
  for (const d of dests) console.log(`${d}${overrides.includes(d) ? ' (declared override)' : ''}\n${required[d].map((n) => `  - ${n}`).join('\n')}`)
  process.exit(0)
}

let checked = 0
let found = 0
let bad = 0
for (const dest of overrides) {
  const names = required[dest]
  if (!Array.isArray(names) || names.length === 0) continue
  checked++
  const file = join(root, dest)
  const missing = existsSync(file) ? missingSteps(readFileSync(file, 'utf8'), names) : names
  found += names.length - missing.length
  for (const n of missing) {
    bad++
    say(`FAIL — ${dest} lacks required step "${n}" (declared override; add the step back, or ask the kit to drop the requirement)`)
  }
}
if (bad > 0) process.exit(1)
say(checked === 0 ? 'ok — 0 override(s) checked' : `ok — ${checked} override(s) checked, ${found} required step(s) found`)
