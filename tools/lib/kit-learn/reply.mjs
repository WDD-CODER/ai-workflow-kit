/**
 * The Human's one-line reply to the cards (plan 046, K4/K5):
 *
 *   ok                               accept every card's recommendation
 *   I1 plan · I2 lesson builder · I3 dismiss covered by 040 · I4 later
 *   ok · I3 dismiss not worth it     `ok` plus an override (the override wins for its card)
 *
 * Items are separated by `·`, `|`, `;`, a new line, or a comma before the next `I<n>`/`ok`.
 */
import { KIT_LESSON_ROLES } from './lessons.mjs'

export const ACTIONS = ['plan', 'amend', 'lesson', 'enforce', 'dismiss', 'later']
export const ALLOWED = 'ok | I<n> plan | I<n> amend <NNN> | I<n> lesson <role> | I<n> enforce | I<n> dismiss <why> | I<n> later'

const SPLIT = /\s*(?:[·|;\n]|,(?=\s*(?:I\d+|ok)\b))\s*/

/**
 * { items: [{ id, action, arg }] } or { error }. `known` = the ledger ids the reply may name; `recommend` = { id: "plan" |
 * "amend 040" | … } the cards recorded (what a bare `ok` accepts).
 */
export function parseReply(reply, { known = [], recommend = {} } = {}) {
  const parts = String(reply ?? '').split(SPLIT).map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return { error: `empty reply — allowed: ${ALLOWED}` }
  const items = new Map()
  let ok = false
  for (const part of parts) {
    if (/^ok$/i.test(part)) {
      ok = true
      continue
    }
    const m = /^(I\d+)\s+(\S+)(?:\s+(.+))?$/.exec(part)
    if (!m) return { error: `unknown token "${part}" — allowed: ${ALLOWED}` }
    const [, id, action, arg = ''] = m
    if (!ACTIONS.includes(action.toLowerCase())) return { error: `unknown token "${part}" — allowed: ${ALLOWED}` }
    if (known.length && !known.includes(id)) return { error: `${id} is not a card or ledger issue (${known.join(', ')})` }
    if (items.has(id)) return { error: `${id} is answered twice` }
    const a = action.toLowerCase()
    const e = checkArg(id, a, arg.trim())
    if (e) return { error: e }
    items.set(id, { id, action: a, arg: arg.trim() })
  }
  if (ok) {
    for (const [id, text] of Object.entries(recommend)) {
      if (items.has(id)) continue
      const m = /^(\S+)(?:\s+(.+))?$/.exec(String(text ?? '').trim())
      if (!m || !ACTIONS.includes(m[1])) return { error: `${id} has no usable recommendation to accept (${JSON.stringify(text)}) — name it: I<n> plan | amend | lesson | enforce | dismiss | later` }
      const e = checkArg(id, m[1], (m[2] ?? '').trim())
      if (e) return { error: e }
      items.set(id, { id, action: m[1], arg: (m[2] ?? '').trim(), accepted: true })
    }
    if (!Object.keys(recommend).length) return { error: '`ok` needs the cards the session recorded (.kit-learn/cards.json): none found' }
  }
  return { items: [...items.values()] }
}

function checkArg(id, action, arg) {
  if (action === 'amend' && !/^\d{3}$/.test(arg)) return `${id} amend needs a plan number (three digits), e.g. "${id} amend 040"`
  if (action === 'lesson' && !KIT_LESSON_ROLES.includes(arg)) return `${id} lesson needs a role: ${KIT_LESSON_ROLES.join(', ')}`
  if (action === 'dismiss' && !arg) return `${id} dismiss needs the reason: "${id} dismiss <why>"`
  if (['plan', 'enforce', 'later'].includes(action) && arg) return `unknown token "${id} ${action} ${arg}" — allowed: ${ALLOWED}`
  return null
}
