// V2 — a sibling test needs no scope line (plan 101). The scope lists only src/price.mjs; the task also needs a new
// test in src/price.test.mjs, beside it. PASS only when the plan merged, nothing parked it or called it out of scope,
// and the run branch's diff touches the test file.
import { planText, sandbox, start, statusOf, planState, notesOf, waitFor, runEvidence, runFiles, inputTokens, runTail } from '../common.mjs'

const N = '902'
const TITLE = 'Bulk price'
const RUN = 'val-v2'
const PRICE = 'export const price = (n) => n * 10\n'
const TEST = [
  "import { test } from 'node:test'",
  "import assert from 'node:assert/strict'",
  "import { price } from './price.mjs'",
  '',
  "test('one item costs 10', () => {",
  '  assert.equal(price(1), 10)',
  '})',
  '',
].join('\n')
const NEW_PRICE = 'export const price = (n) => (n >= 10 ? n * 9 : n * 10)\n'
const NEW_TEST = `${TEST}\ntest('ten or more items cost 9 each', () => {\n  assert.equal(price(10), 90)\n})\n`
const CHECK = [
  "import { pathToFileURL } from 'node:url'",
  "import { resolve } from 'node:path'",
  "import { readFileSync } from 'node:fs'",
  "const { price } = await import(pathToFileURL(resolve('src/price.mjs')).href)",
  "const test = readFileSync('src/price.test.mjs', 'utf8')",
  'const bad = []',
  "for (const [n, want] of [[1, 10], [9, 90], [10, 90], [12, 108]]) if (price(n) !== want) bad.push(`price(${n}) is ${price(n)}, want ${want}`)",
  "if (!test.includes(\"test('one item costs 10'\")) bad.push('the existing test is gone')",
  "if (!/price\\(1\\d\\)/.test(test)) bad.push('no test calls price() with 10 or more items')",
  "for (const b of bad) console.log(`CHECK: ${b}`)",
  'process.exit(bad.length ? 1 : 0)',
  '',
].join('\n')

export default {
  id: 'V2',
  title: 'a sibling test needs no scope line',
  plan: '101',
  calls: [`plan ${N}: builder, reviewer`],
  async run(ctx) {
    const p = sandbox(ctx, {
      files: { 'src/price.mjs': PRICE, 'src/price.test.mjs': TEST, [`scripts/check-${N}.mjs`]: CHECK },
      scripts: { test: 'node gate-check.mjs && node --test src/price.test.mjs' },
    })
    ctx.keepFiles(() => runFiles(p, RUN))
    ctx.tokens(() => inputTokens(p, RUN))
    p.addPlans({
      [N]: {
        title: TITLE,
        text: planText({
          nnn: N, title: TITLE,
          task: 'Give a bulk price: `price(n)` in `src/price.mjs` returns `n * 9` when `n` is 10 or more; below 10 it stays `n * 10`. Add a test for the bulk price to `src/price.test.mjs`, next to the existing test, and keep the existing test as it is.',
          scope: ['src/price.mjs', `src/${N}.txt`, `gate/${N}.txt`],
          check: `node scripts/check-${N}.mjs`,
          subtasks: ['- [ ] T1: Give ten or more items a bulk price and test it — src/price.mjs, src/price.test.mjs'],
        }),
      },
    })
    const step = { editFiles: { 'src/price.mjs': NEW_PRICE, 'src/price.test.mjs': NEW_TEST } }
    const r = start(ctx, p, RUN, [N], { [N]: { builder: [step, step] } })
    await waitFor(ctx, () => r.child.exitCode !== null || r.child.signalCode !== null, { what: 'the run to end' })
    const st = statusOf(p, RUN)
    const evidence = [...runEvidence(p, RUN, [N]), ...runTail(r)]
    const diff = p.git(p.proj, 'diff', '--name-only', 'origin/main', `origin/orch/${RUN}`).out.trim().split('\n').filter(Boolean)
    evidence.push(`git diff --name-only origin/main origin/orch/${RUN}: ${diff.join(', ') || '(none)'}`)
    const said = [...notesOf(st, N), String(st?.plans?.[N]?.reason ?? '')].filter((t) => /test-out|replan needed|test file|out of scope|outside/i.test(t))
    if (planState(st, N) !== 'merged') return { verdict: 'FAIL', why: `plan ${N} is ${planState(st, N) ?? 'not in status.json'}, not merged: ${String(st?.plans?.[N]?.reason ?? '').slice(0, 200)}`, evidence }
    if (said.length) return { verdict: 'FAIL', why: `the run called the test out of scope: ${said[0].slice(0, 200)}`, evidence }
    if (!diff.includes('src/price.test.mjs')) return { verdict: 'FAIL', why: 'the merged diff does not touch src/price.test.mjs', evidence }
    return { verdict: 'PASS', why: `plan ${N} merged with src/price.test.mjs changed and no scope line for it`, evidence }
  },
}
