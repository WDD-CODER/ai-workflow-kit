/**
 * Headless `claude -p` runner. Sums stream-json usage into the meter, kills the child the moment the meter
 * reaches its limit and throws BudgetError. Calls run lean (no user hooks, plugins, MCP or slash commands, no session
 * file) from a folder outside any repo, so one call costs a couple of thousand tokens, not the whole project context.
 * SKILL_IMPROVER_CLAUDE overrides the binary (tests).
 */
import { spawn } from 'child_process'
import { BudgetError } from './budget.mjs'

export const LEAN_FLAGS = ['--setting-sources', 'local', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']

/** Returns { text, tokens }. */
export function runClaude({ prompt, cwd, meter, model, appendSystem, allowedTools = 'Read Write Edit Glob Grep', addDirs = [], maxMs = 20 * 60 * 1000 }) {
  meter.announce()
  const bin = process.env.SKILL_IMPROVER_CLAUDE || 'claude'
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', allowedTools, ...LEAN_FLAGS]
  for (const d of addDirs) args.push('--add-dir', d)
  if (model) args.push('--model', model)
  if (appendSystem) args.push('--append-system-prompt', appendSystem)
  return new Promise((resolve, reject) => {
    const [cmd, cmdArgs] = bin.endsWith('.mjs') ? [process.execPath, [bin, ...args]] : [bin, args]
    const child = spawn(cmd, cmdArgs, { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false })
    let buf = ''
    let text = ''
    const before = meter.total
    let killed = false
    const timer = setTimeout(() => child.kill(), maxMs)
    child.stdout.on('data', (chunk) => {
      buf += chunk
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        let ev
        try {
          ev = JSON.parse(line)
        } catch {
          continue
        }
        if (ev.type === 'assistant') meter.add(ev.message?.id, ev.message?.usage)
        if (ev.type === 'result') {
          if (typeof ev.result === 'string') text = ev.result
          meter.addUsd(ev.total_cost_usd)
        }
        if (meter.over() && !killed) {
          killed = true
          child.kill()
        }
      }
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', () => {
      clearTimeout(timer)
      if (killed || meter.over()) return reject(new BudgetError(meter.total, meter.limit))
      resolve({ text, tokens: meter.total - before })
    })
    child.stdin.end(prompt)
  })
}

/** Strip YAML front matter from a command/agent file. */
export const body = (md) => md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
