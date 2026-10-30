/**
 * Budget meter: sums tokens, dollars and the billing mode across every model call of a run.
 * Tokens = input + cache-creation + output (cache reads are cheap re-reads, not counted).
 * Dollars come from the `total_cost_usd` of each call's final stream-json `result` line.
 */
export class BudgetError extends Error {
  constructor(used, limit) {
    super(`budget reached (${used}/${limit})`)
    this.used = used
    this.limit = limit
  }
}

/** `api-key` when ANTHROPIC_API_KEY is set for the child (pay per token); `plan-limits` when signed in with the Claude plan. */
export const billingMode = (env = process.env) => (env.ANTHROPIC_API_KEY ? 'api-key' : 'plan-limits')

export class Meter {
  constructor(limit, env = process.env) {
    this.limit = limit
    this.total = 0
    this.usd = 0
    this.mode = billingMode(env)
    this.announced = false
    this.seen = new Set()
  }
  /** Print the billing mode once, before the first model call. */
  announce() {
    if (this.announced) return
    this.announced = true
    console.log(`SKILL_IMPROVER: billing ${this.mode}`)
  }
  /** Add one assistant message's usage once (stream-json repeats the same message id per content block). */
  add(messageId, usage) {
    if (!usage || (messageId && this.seen.has(messageId))) return
    if (messageId) this.seen.add(messageId)
    this.total += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.output_tokens || 0)
  }
  addUsd(usd) {
    if (typeof usd === 'number' && Number.isFinite(usd)) this.usd += usd
  }
  over() {
    return this.total >= this.limit
  }
}
