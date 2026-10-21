/** A file the scope guard refused this session, waiting for the Human's "approved: <path>". */
export type GuardsPending = {
  /** Repo-relative, posix. */
  path: string
  plan: string
  reason: 'scope' | 'kit-owned' | 'similar-plan'
}

export type GuardsRole = 'planner' | 'idle-slot' | 'worker' | 'unknown'

declare module 'claude-code' {
  interface PluginState {
    guards: { pending: GuardsPending | null; role: GuardsRole }
  }
}
