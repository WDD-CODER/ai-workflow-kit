/**
 * Orchestrator validation — stages each behaviour plans 100–104 shipped in a throwaway sandbox, runs it, and decides
 * PASS or FAIL from the run's own files (status.json, run notes, calls.csv, git log), never from a model's opinion.
 * Run from the kit root (docs/agent/kit-validation.md):
 *
 *   node tools/validate-orchestrator.mjs [--mode fake|real] [--kit-ref <tag>] [--cases V1,V3] [--keep]
 *                                        [--report <path>] [--max-input-tokens <n>] [--timeout-s <n>] [--dry-run]
 *
 *   --mode fake (default)  the fake builder and reviewer (tools/test/fixtures/fake-claude.mjs); no model call
 *   --mode real            real `claude -p` calls on Sonnet in the sandbox; stops at --max-input-tokens (default 3,000,000)
 *   --kit-ref <tag>        install the kit from that tag instead of this working tree (v2.1.0 is the negative control:
 *                          every case must FAIL there, or the case does not test its behaviour)
 *   --dry-run              print each case's model calls, the token cap and the sandbox folder; run nothing
 *   --report <path>        also write the report there (it is always printed and written to the temp folder)
 *
 * Exit 0 = every case PASS, 1 = a case FAIL, 2 = a usage error.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { CASE_IDS, selectCases, runCases } from './lib/validate/run.mjs'
import { report, verdictLine } from './lib/validate/report.mjs'
import v1 from './lib/validate/cases/v1-session.mjs'
import v2 from './lib/validate/cases/v2-sibling.mjs'
import v3 from './lib/validate/cases/v3-plan-edit.mjs'
import v4 from './lib/validate/cases/v4-packages.mjs'
import v5 from './lib/validate/cases/v5-ask.mjs'

export const CASES = [v1, v2, v3, v4, v5]
const kit = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_CAP = 3_000_000

function args(argv) {
  const o = { mode: 'fake', kitRef: null, cases: null, keep: false, dryRun: false, report: null, cap: DEFAULT_CAP, timeoutS: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`)
      return v
    }
    if (a === '--mode') o.mode = val()
    else if (a === '--kit-ref') o.kitRef = val()
    else if (a === '--cases') o.cases = val()
    else if (a === '--report') o.report = val()
    else if (a === '--max-input-tokens') o.cap = Number(val())
    else if (a === '--timeout-s') o.timeoutS = Number(val())
    else if (a === '--keep') o.keep = true
    else if (a === '--dry-run') o.dryRun = true
    else throw new Error(`unknown flag ${a}`)
  }
  if (!['fake', 'real'].includes(o.mode)) throw new Error(`--mode is fake or real, not ${o.mode}`)
  if (!(o.cap > 0)) throw new Error('--max-input-tokens takes a positive number')
  if (o.timeoutS !== null && !(o.timeoutS > 0)) throw new Error('--timeout-s takes a positive number')
  return o
}

async function main() {
  let o
  let cases
  try {
    o = args(process.argv.slice(2))
    cases = selectCases(CASES, o.cases)
  } catch (e) {
    console.error(`usage: node tools/validate-orchestrator.mjs [--mode fake|real] [--kit-ref <tag>] [--cases ${CASE_IDS.join(',')}] [--keep] [--report <path>] [--max-input-tokens <n>] [--dry-run] — ${e.message}`)
    process.exit(2)
  }
  if (o.kitRef && spawnSync('git', ['rev-parse', '--verify', '--quiet', `${o.kitRef}^{commit}`], { cwd: kit }).status !== 0) {
    console.error(`validate-orchestrator: no tag or commit ${o.kitRef} in ${kit}`)
    process.exit(2)
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const out = join(tmpdir(), 'kit-validation', `${stamp}-${o.mode}${o.kitRef ? `-${o.kitRef}` : ''}`)
  const timeoutMs = (o.timeoutS ?? (o.mode === 'real' ? 1800 : 300)) * 1000
  if (o.dryRun) {
    console.log(`VALIDATE DRY RUN — mode ${o.mode}, kit ${o.kitRef ?? 'working tree'}, ${cases.length} case(s), no model is called`)
    for (const c of cases) {
      for (const line of c.calls) {
        const [plan, roles] = line.split(': ')
        for (const role of roles.split(', ')) console.log(`${c.id}  ${plan} ${role}: ${o.mode === 'real' ? `claude -p --output-format json --system-prompt-file .claude/agents/${role === 'reviewer' ? 'plan-reviewer' : 'orch-builder'}.md --model sonnet` : 'node tools/test/fixtures/fake-claude.mjs (no model)'}`)
      }
    }
    console.log(`token cap: ${o.mode === 'real' ? `${o.cap} input tokens for the whole run (--max-input-tokens)` : 'none (fake mode)'}`)
    console.log(`time limit: ${timeoutMs / 1000} s per case`)
    console.log(`sandbox folder: ${join(tmpdir(), 'kit-rp-<random>')} (one per case, removed after it${o.keep ? '; kept: --keep' : ''})`)
    console.log(`report: ${join(out, 'report.md')}${o.report ? ` and ${o.report}` : ''}`)
    process.exit(0)
  }
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: kit, encoding: 'utf8' }).stdout.trim()
  const rows = await runCases(cases, { mode: o.mode, kit, kitRef: o.kitRef, keep: o.keep, timeoutMs, maxInputTokens: o.mode === 'real' ? o.cap : Infinity, logsDir: join(out, 'logs'), log: (l) => console.log(l) })
  const tokens = rows.reduce((a, r) => a + (r.tokens ?? 0), 0)
  const text = report(rows, { mode: o.mode, kit: o.kitRef ? `tag ${o.kitRef}` : `working tree at ${head}`, tokens: o.mode === 'real' ? tokens : null, cap: o.mode === 'real' ? o.cap : null })
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'report.md'), text)
  if (o.report) {
    mkdirSync(dirname(resolve(o.report)), { recursive: true })
    writeFileSync(resolve(o.report), text)
  }
  console.log('')
  console.log(text)
  console.log(`report: ${join(out, 'report.md')}${o.report ? ` and ${o.report}` : ''}`)
  console.log(verdictLine(rows))
  process.exit(rows.every((r) => r.verdict === 'PASS') ? 0 : 1)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
