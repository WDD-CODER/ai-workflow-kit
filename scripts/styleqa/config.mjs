/**
 * Style QA settings — the project's `styleqa.*` keys of kit.config.json, rendered here by install and sync (which
 * validate them first), plus the two stack values the engine reuses. The page map is not a setting: it is the
 * project-owned docs/qa/styleqa-pages.json (pages.mjs reads and validates it).
 *
 *   import { SETTINGS, loadSettings, origins, parseWidths } from './config.mjs'
 *
 * loadSettings(file) lays a JSON file of the same keys over the rendered values (run.mjs --settings=<file>: a trial
 * run or a test with other settings, nothing written). Node built-ins only.
 */
import { readFileSync } from 'fs'
import { ports } from '../lib/slot.mjs'

export const SETTINGS = Object.freeze({
  appOrigin: "",
  apiOrigin: "",
  signIn: "",
  uiFontToken: "",
  tokenPrefixes: { color: "", fontSize: "", radius: "" },
  tokenFiles: [],
  breakpointPattern: "",
  stylesheets: [],
  loaderText: [],
  blockedSteps: { words: [], selectors: [] },
  outDir: ".claude/styleqa",
  widths: ["375x812","620x900","768x1024","1024x768","1366x768"],
  // Reused stack keys: the stylesheet extension (the default glob) and the UI direction (report wording).
  stylesheetExt: "css",
  uiDirection: "",
  // The stack pack's route reader and the router file it reads (the map check, --changed); '' = none.
  routesFile: "",
  mainBranch: "main",
  routesReader: '',
})

/** The page map, relative to the project root. */
export const PAGE_MAP = 'docs/qa/styleqa-pages.json'

const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : [])

/** The rendered settings with a JSON file's keys laid over them (nested tokenPrefixes / blockedSteps merged by key). */
export function loadSettings(file = null) {
  const over = file ? JSON.parse(readFileSync(file, 'utf8')) : {}
  const s = { ...SETTINGS, ...over }
  s.tokenPrefixes = { ...SETTINGS.tokenPrefixes, ...(over.tokenPrefixes ?? {}) }
  s.blockedSteps = { ...SETTINGS.blockedSteps, ...(over.blockedSteps ?? {}) }
  for (const k of ['tokenFiles', 'stylesheets', 'loaderText', 'widths']) s[k] = list(s[k])
  if (!s.outDir) s.outDir = '.claude/styleqa'
  return s
}

/** "375x812" → { width: 375, height: 812 }; a bad entry is dropped. */
export function parseWidths(values) {
  const out = []
  for (const v of list(values)) {
    const m = /^(\d+)x(\d+)$/.exec(String(v).trim())
    if (m) out.push({ width: Number(m[1]), height: Number(m[2]) })
  }
  return out
}

/**
 * The app and API origins: the configured ones, else http://localhost:<port> with this checkout's frontend and
 * backend port (scripts/lib/slot.mjs: a slot's own ports, the main folder's base ports otherwise).
 */
export function origins(settings, slotPorts = ports() ?? { fe: 4200, be: 3000 }) {
  return {
    app: settings.appOrigin || `http://localhost:${slotPorts.fe}`,
    api: settings.apiOrigin || `http://localhost:${slotPorts.be}`,
  }
}
