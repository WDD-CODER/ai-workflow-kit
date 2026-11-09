// V5 — a question stops only its plan (plan 104). Plan P1's task needs a file outside its scope, so its builder asks;
// plan P2 is independent. When `orch-state.mjs watch` lists the ask, the case waits for P2 to merge, then answers with
// the card's own command (the `approved:` option). PASS only when P2 merged while P1 waited, P1 resumed in the same
// run with the extra file in its scope on the run branch, and P1 merged.
import { sandbox, start, statusOf, planState, notesOf, waitFor, runEvidence, runFiles, inputTokens, toyTask, exactCheck, planFile, runTail } from '../common.mjs'

const P1 = '906'
const P2 = '907'
const RUN = 'val-v5'
const EXTRA = 'notes/extra.txt'

export default {
  id: 'V5',
  title: 'a question stops only its plan',
  plan: '104',
  calls: [`plan ${P1}: builder, builder after the answer, reviewer`, `plan ${P2}: builder, reviewer`],
  async run(ctx) {
    const t1 = toyTask(P1, 'Needs approval', {
      task: `Create the file \`src/${P1}.txt\` whose whole content is the single line \`hello ${P1}\`, and the file \`${EXTRA}\` whose whole content is the single line \`extra ${P1}\` (each with a newline at the end). \`${EXTRA}\` is not in this plan's scope: ask for it.`,
    })
    const check1 = exactCheck([[`src/${P1}.txt`, `hello ${P1}\n`], [EXTRA, `extra ${P1}\n`]])
    const t2 = toyTask(P2, 'Goes on')
    // The Human's answer must reach the run: the ask waits up to 10 min here, not the test fixture's 1 ms.
    const p = sandbox(ctx, { files: { [t1.check[0]]: check1, [t2.check[0]]: t2.check[1] }, env: { RUN_PLANS_ASK_WAIT_MS: '600000', RUN_PLANS_ASK_POLL_MS: '500' } })
    ctx.keepFiles(() => runFiles(p, RUN))
    ctx.tokens(() => inputTokens(p, RUN))
    p.addPlans({ [P1]: { title: t1.title, text: t1.text }, [P2]: { title: t2.title, text: t2.text } })
    const ask = { kind: 'scope', question: `${EXTRA} is outside the scope; may the plan write it?`, options: [`approved: ${EXTRA}`], recommendation: 1 }
    const r = start(ctx, p, RUN, [P1, P2], {
      [P1]: { builder: [{ editFiles: t1.fakeEdit, escalate: ask }, { editFiles: { ...t1.fakeEdit, [EXTRA]: `extra ${P1}\n` } }] },
      [P2]: { builder: [{ editFiles: t2.fakeEdit }] },
    })
    const ended = () => r.child.exitCode !== null || r.child.signalCode !== null
    const evidence = []
    const open = await waitFor(ctx, () => {
      const w = p.state('watch', '--run', RUN)
      return w.json?.asks?.length ? w : ended() ? { json: { asks: [] }, out: w.out } : null
    }, { what: 'an ASK card', everyMs: 1000 })
    const card = open.json.asks[0]
    if (!card) {
      evidence.push(...runEvidence(p, RUN, [P1, P2]), ...runTail(r))
      return { verdict: 'FAIL', why: `the run ended without an ask: plan ${P1} is ${planState(statusOf(p, RUN), P1)}`, evidence }
    }
    evidence.push(`orch-state watch: ASK ${card.id} (plan ${card.plan}, ${card.kind}, ${card.humanOnly ? 'Human only' : 'Human or advisor'})`)
    const p2 = await waitFor(ctx, () => {
      const s = planState(statusOf(p, RUN), P2)
      return ['merged', 'parked', 'skipped'].includes(s) || ended() ? s ?? 'none' : null
    }, { what: `plan ${P2} to end` })
    const before = statusOf(p, RUN)
    evidence.push(`before the answer: plan ${P2} ${p2}, plan ${P1} ${planState(before, P1)}`)
    if (p2 !== 'merged' || planState(before, P1) !== 'asking') {
      evidence.push(...runEvidence(p, RUN, [P1, P2]), ...runTail(r))
      return { verdict: 'FAIL', why: `plan ${P2} did not merge while plan ${P1} waited (${P2}: ${p2}, ${P1}: ${planState(before, P1)})`, evidence }
    }
    const a = p.state('answer', '--run', RUN, '--id', card.id, '--choice', '1')
    evidence.push(`orch-state answer --run ${RUN} --id ${card.id} --choice 1 → exit ${a.status}: ${a.out.trim().split('\n').pop()}`)
    await waitFor(ctx, ended, { what: 'the run to end', everyMs: 1000 })
    const st = statusOf(p, RUN)
    evidence.push(...runEvidence(p, RUN, [P1, P2]), ...runTail(r))
    const scope = p.git(p.proj, 'show', `origin/orch/${RUN}:${planFile(P1, t1.title)}`).out
    const inScope = /```scope[\s\S]*?```/.exec(scope)?.[0].includes(EXTRA) ?? false
    evidence.push(`scope block of plan ${P1} on origin/orch/${RUN} holds ${EXTRA}: ${inScope}`)
    const resumed = notesOf(st, P1).filter((x) => /resumed from/.test(x))
    if (planState(st, P1) !== 'merged') return { verdict: 'FAIL', why: `plan ${P1} is ${planState(st, P1)}, not merged after the answer: ${String(st?.plans?.[P1]?.reason ?? '').slice(0, 200)}`, evidence }
    if (!resumed.length) return { verdict: 'FAIL', why: `no run note says plan ${P1} resumed from its saved work`, evidence }
    if (!inScope) return { verdict: 'FAIL', why: `the run branch's plan ${P1} scope does not hold ${EXTRA}`, evidence }
    return { verdict: 'PASS', why: `plan ${P2} merged while ${P1} waited on ${card.id}; after the answer ${P1} resumed (${resumed[0].slice(0, 80)}) and merged`, evidence }
  },
}
