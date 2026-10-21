/**
 * Agent eval — measure one agent file on a folder of cases before trusting it (contract: docs/agent/agent-evals.md).
 * Run from the kit root (or any repo that has the agent file and the cases):
 *
 *   node tools/agent-eval.mjs --agent .claude/agents/orch-check-bugs.md --cases tools/fixtures/agent-evals --runs 2
 *     [--model <id>]            run the agent on this model instead of its `model:` (compare one file across models)
 *     [--min-recall 0.9]        exit 1 when the total recall is below this
 *     [--min-precision 0.8]     exit 1 when the total precision is below this
 *     [--runner <module.mjs>]   a module whose default export is the runner (tests use a stub; default: Claude Code)
 *     [--allow-write]           run an agent that can edit files (refused by default)
 *     [--json]                  print the report as JSON instead of the table
 *
 * The default runner calls `claude -p` once per case and run, and spends tokens. Prints a table (case, recall,
 * precision, noise, tokens, cost) with a total line. Exit 0 = thresholds met, 1 = below a threshold, 2 = usage error
 * or a refused agent. Node built-ins only.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { evaluate, formatTable, claudeRunner } from './lib/agent-eval/run.mjs'

const USAGE = 'usage: node tools/agent-eval.mjs --agent <agent.md> --cases <dir> [--runs 2] [--model <id>] [--min-recall x] [--min-precision y] [--runner <module.mjs>] [--allow-write] [--json]'

function parseArgs(argv) {
  const opts = { runs: 2, model: null, minRecall: null, minPrecision: null, runner: null, allowWrite: false, json: false }
  const value = (i, name) => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} needs a value`)
    return v
  }
  const num = (v, name) => {
    const n = Number(v)
    if (!Number.isFinite(n)) throw new Error(`${name} must be a number (got ${v})`)
    return n
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--agent') opts.agent = value(i++, a)
    else if (a === '--cases') opts.cases = value(i++, a)
    else if (a === '--runs') opts.runs = num(value(i++, a), a)
    else if (a === '--model') opts.model = value(i++, a)
    else if (a === '--min-recall') opts.minRecall = num(value(i++, a), a)
    else if (a === '--min-precision') opts.minPrecision = num(value(i++, a), a)
    else if (a === '--runner') opts.runner = value(i++, a)
    else if (a === '--allow-write') opts.allowWrite = true
    else if (a === '--json') opts.json = true
    else throw new Error(`unknown argument ${a}`)
  }
  if (!opts.agent || !opts.cases) throw new Error('--agent and --cases are required')
  return opts
}

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`AGENT_EVAL: ${e.message}\n${USAGE}`)
    return 2
  }
  let runner
  try {
    runner = opts.runner ? (await import(pathToFileURL(resolve(opts.runner)).href)).default : claudeRunner()
    if (typeof runner !== 'function') throw new Error(`${opts.runner} has no default-exported runner function`)
  } catch (e) {
    console.error(`AGENT_EVAL: ${e.message}`)
    return 2
  }
  let report
  try {
    report = await evaluate({ agentFile: resolve(opts.agent), casesDir: resolve(opts.cases), runs: opts.runs, model: opts.model, runner, allowWrite: opts.allowWrite })
  } catch (e) {
    console.error(`AGENT_EVAL: refused — ${e.message}`)
    return 2
  }
  const { total } = report
  const below = []
  if (opts.minRecall !== null && total.recall < opts.minRecall) below.push(`recall ${total.recall.toFixed(2)} < ${opts.minRecall}`)
  if (opts.minPrecision !== null && total.precision < opts.minPrecision) below.push(`precision ${total.precision.toFixed(2)} < ${opts.minPrecision}`)
  if (opts.json) console.log(JSON.stringify({ ...report, below }, null, 2))
  else {
    console.log(formatTable(report))
    console.log(below.length ? `AGENT_EVAL: FAIL — ${below.join(', ')}` : 'AGENT_EVAL: ok')
  }
  return below.length ? 1 : 0
}

process.exitCode = await main()
