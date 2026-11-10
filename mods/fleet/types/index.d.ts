/** One live Claude Code session as the registry records it (one $.store key per session). */
export type FleetSession = {
  id: string
  cwd: string
  slot: number | null
  fe: number | null
  be: number | null
  branch: string
  plan: string | null
  /** Changed files this session changed (or that changed since it started). */
  dirty: number
  /** Changed files in the folder that were already changed when the session started and it has not touched; absent in older rows. */
  other?: number
  unpushed: number
  startedAt: number
  lastSeen: number
  title: string
}

/** What the health band and status line draw from. */
export type FleetHealth = {
  /** $.clock.now() of the last turn end; the cache countdown anchors here. 0 before the first turn. */
  cacheAnchor: number
  ctxPercent: number
  fiveHour: number | null
  sevenDay: number | null
  /** When the five-hour window resets (ISO 8601, from $.session.usage()); null until the session's first reply. */
  fiveHourResetsAt: string | null
  /** When the seven-day window resets (ISO 8601); null until known. */
  sevenDayResetsAt: string | null
  usd: number
  /** This session's changed files. */
  dirty: number
  /** The folder's other changed files (not this session's). */
  other: number
  unpushed: number
  branch: string
  /** The turn id the band was dismissed in; it shows again on the next turn. */
  dismissedTurn: string | null
  /** The turn id of the last turn, so a dismissal expires. */
  lastTurn: string | null
  /** 'idle', or what fleet is running: the handoff fork, a compact, or the pull-main button. */
  busy: 'idle' | 'handoff' | 'compact' | 'pulling main'
}

/** One step of a plan's bar (build · gate · review · merge). */
export type FleetStep = {
  name: string
  /** Closed time spent in this step (ms). */
  ms: number
  /** When the running step started (epoch ms, its earlier closed time folded in); null when it is not running. */
  runningSince: number | null
  /** The plan has been in this step at least once. */
  seen: boolean
}

/** A gate check running now. */
export type FleetCheck = { index: number; total: number; command: string; startedAt: number | null }

/** One plan of a live run, as the panel draws it (clocks are drawn from the times at each tick). */
export type FleetPlanView = {
  nnn: string
  state: string
  /** The state in plain words: `checks`, `merged ✓`, `parked: <reason>`. */
  words: string
  /** merged, parked, skipped or left the run. */
  final: boolean
  steps: FleetStep[]
  model: string | null
  round: number
  /** Builder and reviewer tokens (in + out) from calls.csv, plus the running builder's so far. */
  tokens: number
  /** The gate check running now (live-<NNN>.json). */
  gate: FleetCheck | null
  /** What the running builder is doing (live-<NNN>.json). */
  builder: { tools: number; lastTool: string; lastTarget: string; tokens: number; at: number | null } | null
}

/** One live /orchestrate run of this checkout, as the dock chip and panel draw it. */
export type FleetRunView = {
  /** The run's folder name under .claude/orchestrator-runs. */
  name: string
  /** (sum of each plan's stage weight) / plan count, 0..100; a gate counts its checks done. */
  percent: number
  /** The watch line starts with STUCK. */
  stuck: boolean
  /** status.json startedAt (epoch ms); null when unknown. */
  startedAt: number | null
  /** Every call's tokens in calls.csv, plus the running builders'. */
  tokens: number
  plans: FleetPlanView[]
  /** The run's final gate check running now (live-final.json). */
  finalGate: FleetCheck | null
  /** The latest `orch-state.mjs watch` line; '' when it could not run. */
  watch: string
}

/** The live runs and whether their panel is open. */
export type FleetRuns = {
  list: FleetRunView[]
  panelOpen: boolean
  /** $.clock.now() until which fleet keeps looking for a run a command may have started. */
  watchingUntil: number
  /** $.clock.now() of the last redraw tick (the panel's clocks tick every second while it is open). */
  tick: number
}

declare module 'claude-code' {
  interface PluginState {
    fleet: { health: FleetHealth; runs: FleetRuns }
  }
}
