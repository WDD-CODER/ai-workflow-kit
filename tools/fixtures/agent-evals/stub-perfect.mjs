// Stub runner that answers every case with its own expected.json — no model call. It proves a case set parses and
// scores (recall 1, precision 1) before any tokens are spent:
//   node tools/agent-eval.mjs --agent .claude/agents/orch-check-bugs.md --cases docs/agent-evals/cases --runner tools/fixtures/agent-evals/stub-perfect.mjs
import { makeStub } from '../../test/fixtures/agent-eval-stub.mjs'

export default makeStub('perfect')
