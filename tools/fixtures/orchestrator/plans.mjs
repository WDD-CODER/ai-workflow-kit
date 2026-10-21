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
 */
const plan = ({ nnn, title, deps = [], inv = 'INV-none: preserves — a toy plan' }) => `# Plan ${nnn} — ${title}

Status: active
Depends-on: ${deps.length ? deps.join(', ') : 'none'}

## Goals & Success Criteria
- [auto] work/${nnn}.txt exists
- [human] Open work/${nnn}.txt and see the line "attempt"

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
}

export const fileName = (nnn) => {
  const slug = PLANS[nnn].match(/^# Plan \d+ — (.+)$/m)[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `plans/${nnn}-${slug}.plan.md`
}
