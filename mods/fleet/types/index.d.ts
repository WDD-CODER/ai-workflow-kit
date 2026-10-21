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

declare module 'claude-code' {
  interface PluginState {
    fleet: { health: FleetHealth }
  }
}
