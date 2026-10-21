/**
 * Toy plans for tools/orchestrator-e2e.mjs. Each writes one file of its own (work/<NNN>.txt), so no two plans share
 * scope; the dependencies make the waves.
 *
 *   run "alpha" — a diamond: 101 → 102, 103 → 104
 *     102  its first gate fails; the same builder fixes it in round 1
 *     103  its first builder reports an environment failure (disk); retried once with no fix round
 *     104  its first bug finder says pass: true next to a major problem → treated as a fail, fixed in round 1
 *   run "beta" — fix rounds, escalation, the wave gate and a relaunch
 *     201  names INV-1 in Architecture Impact → its builder starts on the judgment tier
 *     202  its gate fails on every build in the first launch → parked after maxFixRounds; passes on the relaunch
 *     203  depends on 201 → wave 2, not started while wave 1 parked a plan
 *     204  its first builder returns ESCALATE → a fresh judgment-tier builder with the hand-off file
 *   run "gamma" — the UI step on (args.ui), escalation then a judgment failure, auth code in a plain path
 *     301  its first builder returns ESCALATE, then its gate fails → parked at round 1 (judgment + escalated)
 *     302  adds an auth-token line to work/302.txt → orch-security runs; its UI card lands in the report by page
 *   the [ui] tier (plan 018), each against a local test server the e2e starts:
 *     401  run "delta": three [ui] cards — one script passes (never reaches the browser agent), one script fails (the
 *          browser agent gets it with the pre-checked list and calls it plan drift), one has no script (browser: pass)
 *     402  run "ui-down": its card's page server does not answer → stops before the browser agent, no fix round
 *     403  run "ui-login": the QA login answers 401 → stops before the browser agent, no fix round
 *     404  run "ui-cors": the backend does not allow the page's origin → stops before the browser agent, no fix round
 *     405  run "epsilon" (UI step off): the builder reports a card for one of its two [ui] items only → the left-out
 *          item is still recorded (`unchecked`) and reaches the Human in the run report
 *   run "zeta" (security follow-up)
 *     501  extra check commands allowlisted; its first gate leaves a check out (a fail); its builder reports [ui] card
 *          values that must not be recorded (a title starting with "-", a non-http page, an unsafe screenshot path)
 */
const plan = ({ nnn, title, deps = [], inv = 'INV-none: preserves — a toy plan', ui = [] }) => `# Plan ${nnn} — ${title}

Status: active
Depends-on: ${deps.length ? deps.join(', ') : 'none'}

## Goals & Success Criteria
- [auto] work/${nnn}.txt exists
- [human] Open work/${nnn}.txt and see the line "attempt"
${ui.map((u) => `- [ui] ${u}
`).join('')}
## Read-Write Scope

\`\`\`scope
work/${nnn}.txt
\`\`\`

## Architecture Impact
- ${inv}

## Atomic Sub-tasks
- [ ] A1: write work/${nnn}.txt

## Execution Notes
`

export const PLANS = {
  '101': plan({ nnn: '101', title: 'Diamond root' }),
  '102': plan({ nnn: '102', title: 'Diamond left, gate fails once', deps: ['101'] }),
  '103': plan({ nnn: '103', title: 'Diamond right, environment failure', deps: ['101'] }),
  '104': plan({ nnn: '104', title: 'Diamond bottom, pass true with a major', deps: ['102', '103'] }),
  '201': plan({ nnn: '201', title: 'Starts on judgment', inv: 'INV-1: preserves — touches the toy invariant' }),
  '202': plan({ nnn: '202', title: 'Keeps failing then passes' }),
  '203': plan({ nnn: '203', title: 'Second wave', deps: ['201'] }),
  '204': plan({ nnn: '204', title: 'Escalates' }),
  '301': plan({ nnn: '301', title: 'Escalates then fails on judgment' }),
  '302': plan({ nnn: '302', title: 'UI checked and auth code' }),
  '401': plan({ nnn: '401', title: 'UI cards scripted then browser', ui: ['Save shows Saved', 'Error shows Error', 'The colour looks right'] }),
  '402': plan({ nnn: '402', title: 'UI page server down', ui: ['Home shows Hello'] }),
  '403': plan({ nnn: '403', title: 'UI login failing', ui: ['Account shows the name'] }),
  '404': plan({ nnn: '404', title: 'UI backend cross origin', ui: ['List shows items'] }),
  '405': plan({ nnn: '405', title: 'UI item the builder left out', ui: ['Save shows Saved', 'Profile shows the avatar'] }),
  '501': plan({ nnn: '501', title: 'Security follow-up inputs' }),
}

export const fileName = (nnn) => {
  const slug = PLANS[nnn].match(/^# Plan \d+ — (.+)$/m)[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `plans/${nnn}-${slug}.plan.md`
}
