/**
 * Headless Claude Code calls — one agent file run once with `claude -p` (docs/agent/orchestrator.md "Model calls").
 * Shared by scripts/run-plans.mjs (the builder and the reviewer) and the kit's agent eval (tools/lib/agent-eval/run.mjs).
 *
 *   import { readAgent, claudeArgs, runAgent } from './lib/claude-run.mjs'
 *   const r = await runAgent({ agentFile, model: 'sonnet', cwd: worktree, prompt, timeoutMs })
 *   // r = { ok, text, result, usage, tokens: { input, output }, costUsd, exit, seconds, error, rateLimited, timedOut }
 *
 * Every call passes the four context-saving flags (CONTEXT_FLAGS: no user or project settings, no MCP servers, no slash
 * commands, no saved session — a call then loads a few thousand tokens of context instead of tens of thousands),
 * `--output-format json`, `--model` (none for "inherit"), `--system-prompt-file` with the agent's body, and `--tools`
 * from the agent's front matter; an agent without a write tool also gets `--disallowedTools` for the write tools.
 * Tools are pre-approved (`--allowedTools`) only when the caller asks (`allow`), and a read-only agent then gets no
 * Bash at all; a writing agent gets a bare Bash only with a `settings` file (`--settings`: the guard hooks, which run
 * under -p and whose deny wins over --allowedTools) and is refused (a throw) without one. `trustCwdSettings: false` (the reviewer) refuses a folder that holds its own
 * `.claude/settings.local.json`, the one settings file `--setting-sources local` still reads.
 * `bin` is the claude command (RUN_PLANS_CLAUDE or "claude"); a `.mjs`/`.js` file is run with node (tests' fake).
 * On Windows `claude` is a .cmd shim: it runs through the shell with every argument quoted. Node built-ins only.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'

/** Tools that let an agent change files. */
export const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

/** The four flags that keep a headless call's context small: no settings, no MCP, no slash commands, no session. */
export const CONTEXT_FLAGS = ['--setting-sources', 'local', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']

/** A rate or usage limit in a failed call's output: the run pauses and retries once instead of counting a failure. */
export const RATE_LIMIT_RE = /rate[ _-]?limit|usage limit|hit your (?:[\w-]+ )?limit|\b429\b|too many requests|overloaded/i

/** Parse an agent file: front matter fields and the body (the prompt). */
export function readAgent(agentFile) {
  const text = readFileSync(agentFile, 'utf8')
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) throw new Error(`${agentFile}: no front matter (--- name/tools/model ---)`)
  const fields = Object.fromEntries(m[1].split(/\r?\n/).map((l) => /^(\w+):\s*(.*)$/.exec(l)).filter(Boolean).map((x) => [x[1], x[2].trim()]))
  if (!fields.name) throw new Error(`${agentFile}: front matter has no name:`)
  const tools = fields.tools === undefined ? null : fields.tools.split(',').map((t) => t.trim()).filter(Boolean)
  return { file: resolve(agentFile), name: fields.name, model: fields.model ?? null, effort: fields.effort ?? null, tools, body: m[2], text }
}

/** True when the agent may change files (a write tool in `tools:`). */
export const canWrite = (agent) => Boolean(agent.tools?.some((t) => WRITE_TOOLS.includes(t)))

/**
 * The Bash commands a read-only agent may run without a prompt: none. A prefix pattern cannot refuse an
 * argument — `Bash(git diff:*)` still allows `git diff --output=<file>` (a write) and `--no-index` (any file outside
 * the repo), `Bash(node --test:*)` runs any test file the diff under review brings — and the reviewer gets its diff
 * and the gate receipt inline in the prompt, so it reads with Read/Grep/Glob only.
 */
export const READ_ONLY_BASH = []

/**
 * What `--allowedTools` pre-approves for an agent. A writing agent (the builder) gets its own tools with a bare Bash,
 * and only when `guarded` (a `--settings` file brings the project's PreToolUse guard hooks into the call): an
 * unguarded writing agent throws, so a run never starts a builder no hook watches. A read-only agent gets its read
 * tools and no Bash (READ_ONLY_BASH).
 */
export function allowedTools(agent, { guarded = false } = {}) {
  const tools = agent.tools ?? []
  if (canWrite(agent) && !guarded) throw new Error(`${agent.name}: a writing agent is pre-approved its tools only with the guard hooks (--settings); refusing to start it unguarded`)
  const bash = canWrite(agent) ? ['Bash'] : READ_ONLY_BASH
  return [...tools.filter((t) => t !== 'Bash'), ...(tools.includes('Bash') ? bash : [])]
}

/**
 * Arguments for `claude -p` (no model is called here). `allow` (off by default): the call may use tools without a
 * permission prompt — `--allowedTools` from allowedTools(): the whole list only for an agent that writes (run-plans'
 * builder, and only with `settings`), the read tools without Bash for a read-only one. An agent without a write tool always gets `--disallowedTools`.
 */
export function claudeArgs({ agent, model, systemPromptFile, allow = false, settings = null }) {
  const args = ['-p', '--output-format', 'json', '--system-prompt-file', systemPromptFile, ...CONTEXT_FLAGS]
  // `--settings`: a kit-written file (outside the agent's folder) with the guard hooks; it is read whatever
  // --setting-sources says, and a hook's deny wins over --allowedTools.
  if (settings) args.push('--settings', settings)
  // "inherit" is a kit model tier (the main session's model), not a model name: no --model, Claude Code's default.
  if (model && model !== 'inherit') args.push('--model', model)
  if (agent.tools?.length) {
    args.push('--tools', agent.tools.join(','))
    if (allow) args.push('--allowedTools', allowedTools(agent, { guarded: Boolean(settings) }).join(','))
  }
  if (!canWrite(agent)) args.push('--disallowedTools', WRITE_TOOLS.join(','))
  return args
}

/** The model a call was given: the value after `--model` in its argv, else `fallback` ("inherit" passes none). */
export function passedModel(argv, fallback = '') {
  const i = Array.isArray(argv) ? argv.indexOf('--model') : -1
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

/**
 * `--setting-sources local` still loads `.claude/settings.local.json` from the call's folder. In a folder the caller does
 * not trust (the reviewer's: the branch under review, written by the builder) that file could pre-approve tools or add
 * hooks, so the call is refused when it exists. Returns the reason, or null.
 */
export function untrustedSettings(cwd) {
  const f = join(cwd, '.claude', 'settings.local.json')
  return existsSync(f) ? `${f.replace(/\\/g, '/')} exists in the folder under review — a branch may not bring its own local settings into a headless call` : null
}

/** Sum every numeric *_tokens field of a Claude Code usage object. */
export function usageTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0
  return Object.entries(usage).filter(([k, v]) => /_tokens$/.test(k) && Number.isFinite(v)).reduce((s, [, v]) => s + v, 0)
}

/** Input (fresh + cache) and output tokens of a usage object. */
export function tokensOf(usage) {
  const n = (k) => (Number.isFinite(usage?.[k]) ? usage[k] : 0)
  return { input: n('input_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens'), output: n('output_tokens') }
}

/** The system prompt of an agent: its body, plus docs/agent/agent-roles.md when it sits next to the agent's repo. */
export function systemPromptOf(agent) {
  const roles = join(dirname(agent.file), '..', '..', 'docs', 'agent', 'agent-roles.md')
  return existsSync(roles) ? `${agent.body}\n\n---\n# docs/agent/agent-roles.md\n\n${readFileSync(roles, 'utf8')}` : agent.body
}

/** Kill a child and its children (Windows: the shell started claude.cmd, which started node). */
function killTree(child) {
  try {
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    else child.kill('SIGKILL')
  } catch { /* gone */ }
}

/** The newest modification time (ms) of any file under `dir`, `node_modules` and `.git` left out; 0 when there is none. */
export function newestChange(dir) {
  let newest = 0
  const walk = (d) => {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        try {
          newest = Math.max(newest, statSync(p).mtimeMs)
        } catch { /* removed meanwhile */ }
      }
    }
  }
  walk(dir)
  return newest
}

/**
 * Spawn `bin args…` in `cwd` with `input` on stdin. Resolves { stdout, stderr, code, timedOut, idle, error } — never
 * rejects. A `.mjs`/`.js` bin runs with this node; on Windows any other bin runs through the shell with quoted arguments.
 * `timeoutMs` is a wall-clock limit (0 = none). `idleMs` with `watchDir` is an idle limit instead: every `pollMs` the
 * newest file change under `watchDir` (and any output) counts as activity, and the call is stopped only after `idleMs`
 * with none (`idle: true`) — a call that keeps changing files is never stopped.
 */
export function spawnClaude({ bin, args, cwd, input = '', timeoutMs = 600_000, idleMs = 0, watchDir = null, pollMs = 30_000, env = process.env }) {
  return new Promise((done) => {
    const script = /\.m?js$/i.test(bin) && existsSync(bin)
    const win = process.platform === 'win32' && !script
    let child
    try {
      child = script
        ? spawn(process.execPath, [bin, ...args], { cwd, env, windowsHide: true })
        : spawn(bin, win ? args.map((a) => `"${String(a).replace(/"/g, '\\"')}"`) : args, { cwd, env, shell: win, windowsHide: true })
    } catch (e) {
      done({ stdout: '', stderr: '', code: null, timedOut: false, error: e.message })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let idle = false
    const timer = timeoutMs > 0 && Number.isFinite(timeoutMs) ? setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs) : null
    let lastActive = Date.now()
    let lastSeen = idleMs > 0 && watchDir ? newestChange(watchDir) : 0
    const watch = idleMs > 0 && watchDir ? setInterval(() => {
      const seen = newestChange(watchDir)
      if (seen > lastSeen) {
        lastSeen = seen
        lastActive = Date.now()
      } else if (Date.now() - lastActive >= idleMs) {
        idle = true
        killTree(child)
      }
    }, Math.max(10, pollMs)) : null
    const stop = () => {
      if (timer) clearTimeout(timer)
      if (watch) clearInterval(watch)
    }
    child.stdout.on('data', (d) => { stdout += d; lastActive = Date.now() })
    child.stderr.on('data', (d) => { stderr += d; lastActive = Date.now() })
    child.on('error', (e) => {
      stop()
      done({ stdout, stderr, code: null, timedOut, idle, error: e.message })
    })
    child.on('close', (code) => {
      stop()
      done({ stdout, stderr, code, timedOut, idle, error: null })
    })
    child.stdin.on('error', () => { /* the child closed stdin early */ })
    child.stdin.end(input)
  })
}

/**
 * Run one agent once. `agent` (from readAgent) or `agentFile`; `prompt` goes on stdin; cwd is the folder the agent works
 * in. Returns { ok, text, usage, tokens, costUsd, exit, seconds, error, rateLimited, timedOut, argv }: `text` is the
 * agent's final reply (its JSON result inside), `ok` false on a non-zero exit, a timeout, an `is_error` answer or
 * unreadable output; `rateLimited` when the failure names a rate or usage limit.
 */
export async function runAgent({ agent = null, agentFile = null, model = null, cwd, prompt, timeoutMs = 600_000, idleMs = 0, watchDir = null, pollMs = 30_000, bin = process.env.RUN_PLANS_CLAUDE || 'claude', allow = false, settings = null, trustCwdSettings = true, env = process.env }) {
  const a = agent ?? readAgent(agentFile)
  // An untrusted folder with its own local settings: refused before anything is spawned.
  const planted = trustCwdSettings ? null : untrustedSettings(cwd)
  if (planted) return { ok: false, refused: true, error: `refused: ${planted}`, rateLimited: false, text: '', usage: null, tokens: { input: 0, output: 0 }, costUsd: 0, exit: null, seconds: 0, timedOut: false, argv: [], agent: a.name, model: model ?? a.model }
  const tmp = mkdtempSync(join(tmpdir(), 'claude-run-'))
  const started = Date.now()
  try {
    const systemPromptFile = join(tmp, 'system.md')
    writeFileSync(systemPromptFile, systemPromptOf(a))
    const args = claudeArgs({ agent: a, model, systemPromptFile, allow, settings })
    const r = await spawnClaude({ bin, args, cwd, input: prompt, timeoutMs, idleMs, watchDir, pollMs, env })
    const seconds = Math.round((Date.now() - started) / 100) / 10
    let json = null
    try {
      json = JSON.parse(r.stdout)
    } catch { /* not JSON: an error before the answer */ }
    const text = json && typeof json.result === 'string' ? json.result : ''
    const usage = json?.usage ?? null
    const base = { text, usage, tokens: tokensOf(usage), costUsd: Number(json?.total_cost_usd) || 0, exit: r.code, seconds, timedOut: r.timedOut || r.idle, idle: r.idle, argv: args, agent: a.name, model: model ?? a.model }
    const tail = (s) => String(s ?? '').trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')
    let error = null
    if (r.error) error = `claude could not start: ${r.error}`
    else if (r.idle) error = `claude idle for ${Math.round(idleMs / 60000)} min (no file changed in its folder)`
    else if (r.timedOut) error = `claude timed out after ${Math.round(timeoutMs / 60000)} min`
    else if (r.code !== 0) error = `claude exited ${r.code}: ${tail(text || r.stderr || r.stdout)}`
    else if (!json) error = `claude printed no JSON: ${tail(r.stdout || r.stderr)}`
    else if (json.is_error === true) error = `claude answered an error: ${tail(text || json.subtype)}`
    const rateLimited = Boolean(error) && (RATE_LIMIT_RE.test(`${text}\n${r.stderr}\n${r.stdout}`) || Number(json?.api_error_status) === 429)
    return { ok: !error, error, rateLimited, ...base }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* left in the OS temp folder */ }
  }
}

/** The JSON object in an agent's reply: the last ```json fence, else the whole text. Throws on invalid JSON. */
export function parseResult(text) {
  const fences = [...String(text).matchAll(/```json\s*\n([\s\S]*?)```/g)]
  return JSON.parse(fences.length ? fences[fences.length - 1][1] : String(text).trim())
}
