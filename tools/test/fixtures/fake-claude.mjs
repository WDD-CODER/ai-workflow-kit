// A fake `claude` for scripts/run-plans.mjs (RUN_PLANS_CLAUDE=<this file>): no model, scripted answers.
// It reads the agent from --system-prompt-file (orch-builder or plan-reviewer), the plan number from the prompt on stdin,
// and the next step for that plan and role from the scenario file (FAKE_CLAUDE_SCENARIO: { "<NNN>": { builder: [step…],
// reviewer: [step…] } }). Every call is logged as one JSON line in FAKE_CLAUDE_LOG: { role, plan, argv, cwd, start, end }.
//   builder step: { gate: "pass"|"fail", text?: "<failing output>", rateLimit?: true, sleepMs?: n, decisions?: [...],
//                   extraFile?: "<path outside the scope>", tamper?: true (rewrites scripts/scope-check.mjs to pass) }
//     → writes src/<NNN>.txt and gate/<NNN>.txt (the fixture's test script fails while one holds "fail"), commits, pushes
//   reviewer step: { verdict: "PASS"|"STOP", moveBranch?: true, rateLimit?: true }
//     → moveBranch pushes one more commit to the plan branch on origin (the branch moved after its checks)
// No step left: the builder passes, the reviewer says PASS.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)
const start = Date.now()
const sysFile = argv[argv.indexOf('--system-prompt-file') + 1]
const system = sysFile && existsSync(sysFile) ? readFileSync(sysFile, 'utf8') : ''
const role = /^# plan-reviewer\b/m.test(system) ? 'reviewer' : /^# orch-builder\b/m.test(system) ? 'builder' : 'other'
const model = argv.includes('--model') ? argv[argv.indexOf('--model') + 1] : 'default'
let prompt = ''
process.stdin.on('data', (d) => { prompt += d })
process.stdin.on('end', main)

const git = (...a) => {
  const r = spawnSync('git', a, { cwd: process.cwd(), encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`)
  return String(r.stdout).trim()
}
// reportModel (a step field): the answer names another model than the one passed after --model.
const answer = (obj, usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5 }, reportModel = null) => {
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: `Done.\n\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``, usage, total_cost_usd: 0.01, ...(reportModel ? { model: reportModel } : {}) }))
}

async function main() {
  const plan = (/(?:Build|Review) plan (\d+)/.exec(prompt) ?? [])[1] ?? '?'
  const logFile = process.env.FAKE_CLAUDE_LOG
  const prior = logFile && existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((c) => c.plan === plan && c.role === role).length : 0
  const scenario = process.env.FAKE_CLAUDE_SCENARIO && existsSync(process.env.FAKE_CLAUDE_SCENARIO) ? JSON.parse(readFileSync(process.env.FAKE_CLAUDE_SCENARIO, 'utf8')) : {}
  const step = scenario[plan]?.[role]?.[prior] ?? {}
  if (step.sleepMs) await new Promise((r) => setTimeout(r, step.sleepMs))
  const log = (extra = {}) => {
    if (logFile) appendFileSync(logFile, `${JSON.stringify({ role, plan, model, argv, cwd: process.cwd(), start, end: Date.now(), handoff: /HANDOFF: /.test(prompt), findings: /FINDINGS: /.test(prompt), ...extra })}\n`)
  }
  if (step.rateLimit) {
    log({ rateLimit: true })
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 429, result: "You've hit your 5-hour limit · resets 3pm" }))
    process.exit(1)
  }
  if (role === 'builder') {
    const branch = (/^BRANCH: (.*)$/m.exec(prompt) ?? [])[1]?.trim()
    mkdirSync('src', { recursive: true })
    mkdirSync('gate', { recursive: true })
    appendFileSync(join('src', `${plan}.txt`), `round ${prior} ${model}\n`)
    writeFileSync(join('gate', `${plan}.txt`), step.gate === 'fail' ? `fail\n${step.text ?? 'the toy check failed'}\n` : 'pass\n')
    // extraFile: a file outside the plan's scope (the gate's scope check must catch it: no hook runs in a headless call)
    if (step.extraFile) writeFileSync(step.extraFile, `${plan}\n`)
    // tamper: the branch's own scope checker is rewritten to always pass (the gate must not run that copy)
    if (step.tamper) writeFileSync(join('scripts', 'scope-check.mjs'), "console.log('SCOPE: ok'); process.exit(0)\n")
    git('add', '--', `src/${plan}.txt`, `gate/${plan}.txt`, ...(step.extraFile ? [step.extraFile] : []), ...(step.tamper ? ['scripts/scope-check.mjs'] : []))
    git('commit', '-q', '-m', `toy ${plan} round ${prior}`)
    git('push', '-q', '-u', 'origin', branch)
    log()
    answer({ role: 'orch-builder', model, effort: 'medium', status: 'built', branch, headSha: git('rev-parse', 'HEAD'), summary: 'toy', evidence: ['toy'], done: ['T1'], notDone: [], checksRun: [], decisions: step.decisions ?? [] }, undefined, step.reportModel)
    return
  }
  if (role === 'reviewer') {
    if (step.moveBranch) {
      const branch = ((/BRANCH: origin\/(\S+)/.exec(prompt) ?? [])[1] ?? '').trim()
      git('commit', '-q', '--allow-empty', '-m', 'moved after the checks')
      git('push', '-q', 'origin', `HEAD:refs/heads/${branch}`)
    }
    const stop = step.verdict === 'STOP'
    log({ verdict: stop ? 'STOP' : 'PASS' })
    answer({ role: 'plan-reviewer', model, effort: 'high', problems: stop ? [{ id: 'rev-1', file: `src/${plan}.txt`, line: 1, rule: 'done-when: the toy item is not met', reasoning: 'scripted STOP', severity: 'major' }] : [], pass: !stop, verdict: stop ? 'STOP' : 'PASS' })
    return
  }
  log()
  answer({ ok: true })
}
