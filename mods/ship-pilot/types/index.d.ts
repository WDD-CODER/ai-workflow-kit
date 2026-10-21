export type ShipCheck = { name: string; state: 'pass' | 'fail' | 'pending' | 'skipped' }

export type ShipPr = {
  number: number
  url: string
  title: string
  state: string
  isDraft: boolean
  mergeable: string
  mergeState: string
  review: string
  checks: ShipCheck[]
  behindMain: number
  branch: string
  fetchedAt: number
}

export type ShipStep = { id: string; text: string; done: boolean; section: string }

export type ShipProgress = {
  plan: string
  planNo: string
  title: string
  steps: ShipStep[]
  doneWhen: { tag: 'auto' | 'human'; text: string }[]
  /** From the model's TaskUpdate/TodoWrite, when it names one; else the first open step. */
  current: string | null
}

export type ShipState = {
  pr: ShipPr | null
  progress: ShipProgress | null
  /** The last checks summary notified, so a transition is announced once. */
  lastChecksKey: string
  /** The turn id a dismissed band hides for. */
  dismissedTurn: string | null
  lastTurn: string | null
  /** The plan panel under the dock is open (toggled by the plan chip or `p`). */
  panelOpen: boolean
  /** Why the agent is waiting on the Human, from deterministic signals; null when it is not. */
  waiting: string | null
  /** Open plans that wait on this one ("must run after plan NNN"), one hop further: ['391', '392']. */
  after: string[]
  /** When this plan was first seen in this folder, and when the current step became current (epoch ms). */
  planStartedAt: number | null
  stepStartedAt: number | null
  stepId: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'ship-pilot': { state: ShipState }
  }
}
