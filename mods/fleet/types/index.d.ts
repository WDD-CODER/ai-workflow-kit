/** One live Claude Code session as the registry records it (one $.store key per session). */
export type FleetSession = {
  id: string
  cwd: string
  slot: number | null
  fe: number | null
  be: number | null
  branch: string
  plan: string | null
  dirty: number
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
  dirty: number
  unpushed: number
  branch: string
  /** The turn id the band was dismissed in; it shows again on the next turn. */
  dismissedTurn: string | null
  /** The turn id of the last turn, so a dismissal expires. */
  lastTurn: string | null
  /** 'idle', or what fleet is running: the handoff fork, a compact, or the pull-main button. */
  busy: 'idle' | 'handoff' | 'compact' | 'pulling main'
}

/** One live /orchestrate run of this checkout, as the dock chip and panel draw it. */
export type FleetRunView = {
  /** The run's folder name under .claude/orchestrator-runs. */
  name: string
  /** (sum of each plan's stage weight) / plan count, 0..100. */
  percent: number
  /** The watch line starts with STUCK. */
  stuck: boolean
  /** One plain line per plan: `506 · checks (gate 506 · 20 s ago) · 3 min`. */
  plans: string[]
  /** The current agent when its label names no plan of the run (`now: preflight · 5 s ago`). */
  agent: string | null
  /** The latest `orch-state.mjs watch` line; '' when it could not run. */
  watch: string
}

/** The live runs and whether their panel is open. */
export type FleetRuns = {
  list: FleetRunView[]
  panelOpen: boolean
  /** $.clock.now() until which fleet keeps looking for a run a Workflow call may have started. */
  watchingUntil: number
}

declare module 'claude-code' {
  interface PluginState {
    fleet: { health: FleetHealth; runs: FleetRuns }
  }
}
