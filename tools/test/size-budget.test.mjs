// The kit's size budget (tools/size-budget.json): how many commands and agents core ships, how long each may be,
// AGENTS.md, the standing instruction load and the orchestrator keys. A limit is raised only by a plan that names it.
//   node --test tools/test/size-budget.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { instructionLoad, lineCount } from '../instruction-load.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const budget = JSON.parse(readFileSync(join(kit, 'tools', 'size-budget.json'), 'utf8'))
const mdIn = (dir) => readdirSync(join(kit, dir)).filter((f) => f.endsWith('.md')).sort()
const lines = (path) => lineCount(readFileSync(join(kit, path), 'utf8'))

test('every limit has a numeric max and a one-line reason; a target is never above its max', () => {
  const entries = Object.entries(budget).filter(([k]) => k !== '$comment')
  const all = [...entries, ...Object.entries(budget.commandLinesExcept).map(([k, v]) => [`commandLinesExcept.${k}`, v])].filter(([k]) => k !== 'commandLinesExcept')
  for (const [k, v] of all) {
    assert.ok(Number.isInteger(v.max) && v.max > 0, `${k}: max`)
    assert.ok(typeof v.reason === 'string' && v.reason.trim() && !v.reason.includes('\n'), `${k}: one-line reason`)
    if (v.target !== undefined) assert.ok(Number.isInteger(v.target) && v.target <= v.max, `${k}: target ≤ max`)
  }
})

test('core/.claude/commands: at most commandFiles files, each within its line limit', () => {
  const files = mdIn('core/.claude/commands')
  assert.ok(files.length <= budget.commandFiles.max, `${files.length} command files > ${budget.commandFiles.max}: ${files.join(', ')}`)
  for (const f of files) {
    const max = budget.commandLinesExcept[f]?.max ?? budget.commandLines.max
    const n = lines(`core/.claude/commands/${f}`)
    assert.ok(n <= max, `${f}: ${n} lines > ${max}`)
  }
})

test('core/.claude/agents: at most agentFiles files, each within agentLines', () => {
  const files = mdIn('core/.claude/agents')
  assert.ok(files.length <= budget.agentFiles.max, `${files.length} agent files > ${budget.agentFiles.max}: ${files.join(', ')}`)
  for (const f of files) {
    const n = lines(`core/.claude/agents/${f}`)
    assert.ok(n <= budget.agentLines.max, `${f}: ${n} lines > ${budget.agentLines.max}`)
  }
})

test('AGENTS.md within agentsMdLines', () => {
  const n = lines('AGENTS.md')
  assert.ok(n <= budget.agentsMdLines.max, `AGENTS.md: ${n} lines > ${budget.agentsMdLines.max}`)
})

test('the standing instruction load (tools/instruction-load.mjs) within instructionLoad', () => {
  const r = instructionLoad(kit, budget.instructionLoad.max)
  assert.deepEqual(r.missing, [])
  assert.ok(!r.over, `instruction load ${r.total} lines > ${budget.instructionLoad.max}`)
})

test('kit.config.json orchestrator: at most orchestratorKeys keys', () => {
  const keys = Object.keys(JSON.parse(readFileSync(join(kit, 'kit.config.json'), 'utf8')).orchestrator ?? {})
  assert.ok(keys.length <= budget.orchestratorKeys.max, `${keys.length} orchestrator keys > ${budget.orchestratorKeys.max}: ${keys.join(', ')}`)
})
