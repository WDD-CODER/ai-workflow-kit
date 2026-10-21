/**
 * Write guards — the one implementation behind scope-guard.sh and branch-guard.sh (PreToolUse hooks).
 *
 *   node scripts/lib/guard.mjs scope    plan Read-Write Scope (+ kit-owned files)
 *   node scripts/lib/guard.mjs branch   no code writes on main
 *
 * Input: the hook's JSON on stdin ({ tool_name, tool_input, cwd }). Output: one JSON decision on stdout, in both
 * formats (Cursor reads "permission", Claude Code reads hookSpecificOutput). Exit code is always 0.
 *
 * A guard decides from the file being written, never from where the session was started:
 *   - the file's own worktree is found by walking up to its `.git`; a sibling worktree of the same repository is
 *     judged by that worktree's own guard (its branch, its plan), a file outside every worktree of this repo is
 *     not this guard's business;
 *   - a Bash command is read for the files it writes (redirects, heredocs, tee, sed -i / perl -i, cp/mv/install
 *     targets, touch; `cd` and `bash -c` are followed) and each target gets the same rule. This is best-effort — it
 *     cannot parse every shell construct — so a target it cannot resolve (a `$VAR` or `$(...)` path) is refused
 *     wherever a write would need a check (fail closed). /ship's scope gate and CI drift-check stay the backstop.
 *
 * Plan scope applies in a slot with an active plan (.worktree-port + .worktree-plan) and, outside a slot, on any
 * branch other than main that names a plan: `.worktree-plan` (a run's merge folder, e.g. orch/<run>) or a
 * `<type>/NNN-<slug>` branch — the same rule /ship's scope gate uses (ship-prep.mjs, lib/slot.mjs scopedPlanPath).
 *
 * Speed (the hook limit is 10 s; Git Bash start-up on Windows is slow): one node process, the branch and git dirs
 * read from files, no git call on the allow path. KIT_GUARD_TRACE=1 prints `GUARD_GIT_CALLS: <n>` to stderr.
 */
import { readFileSync, existsSync, statSync } from 'fs'
import { spawnSync } from 'child_process'
import { join, resolve, dirname, relative, isAbsolute, basename } from 'path'
import { fileURLToPath } from 'url'
import { OPEN_PLAN_RE, findOpenPlan } from './plan-paths.mjs'

const MAIN_BRANCHES = ['main', 'master']
// Gitignored runtime files the workflow writes on main: never a branch decision.
const RUNTIME_ON_MAIN = [/^\.claude\/sessions\//, /^\.claude\/\.session-state-path$/, /^\.claude\/\.plan-write-ack$/]
const DEV_SINKS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty', 'nul', 'NUL'])
const WIN = process.platform === 'win32'

let gitCalls = 0
const toPosix = (p) => String(p).replace(/\\/g, '/')
const same = (a, b) => (WIN ? toPosix(a).toLowerCase() === toPosix(b).toLowerCase() : toPosix(a) === toPosix(b))
const inside = (root, p) => {
  const rel = relative(root, p)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

// ---------- git facts from files (no git process) ----------

/** { root, gitDir, commonDir } of the worktree holding `p` (walks up to the first `.git`), or null. */
export function worktreeOf(p) {
  let dir = resolve(p)
  for (;;) {
    const dotGit = join(dir, '.git')
    if (existsSync(dotGit)) {
      let gitDir = dotGit
      try {
        if (statSync(dotGit).isFile()) {
          const m = readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m)
          if (!m) return null
          gitDir = resolve(dir, m[1])
        }
      } catch {
        return null
      }
      let commonDir = gitDir
      try {
        commonDir = resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim())
      } catch {}
      return { root: dir, gitDir, commonDir }
    }
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

function git(cwd, ...args) {
  gitCalls++
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.replace(/\r?\n+$/, '') : ''
}

/** The checked-out branch ('' when detached), from HEAD; one git call only if HEAD cannot be read. */
export function currentBranch(wt) {
  try {
    const head = readFileSync(join(wt.gitDir, 'HEAD'), 'utf8').trim()
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/)
    return m ? m[1] : ''
  } catch {
    return git(wt.root, 'branch', '--show-current')
  }
}

function readTrim(p) {
  try {
    return readFileSync(p, 'utf8').replace(/\r?\n+$/, '').trim()
  } catch {
    return ''
  }
}

/**
 * The plan whose scope governs writes in this folder, or null. Mirrors lib/slot.mjs activePlanPath/scopedPlanPath,
 * without git calls: a slot uses .worktree-plan (the branch's plan wins when they differ); outside a slot, a branch
 * other than main uses .worktree-plan, else the plan a <type>/NNN-<slug> branch names.
 */
export function scopedPlan(root, branch) {
  const slot = existsSync(join(root, '.worktree-port'))
  const marked = readTrim(join(root, '.worktree-plan'))
  const m = (branch || '').match(/^[\w.-]+\/(\d{3})-/)
  const fromBranch = m ? findOpenPlan(root, m[1]) : null
  if (slot) {
    if (!marked) return null
    const num = (f) => basename(f || '').slice(0, 4)
    const stale = num(marked) !== num(fromBranch) || !existsSync(join(root, marked))
    return fromBranch && stale ? fromBranch : marked
  }
  if (!branch || MAIN_BRANCHES.includes(branch)) return null
  if (marked && existsSync(join(root, marked))) return marked
  return fromBranch
}

// ---------- Bash: which files does a command write? ----------

/** The command without its heredoc bodies (and their closing delimiter lines). A body is data, never a target — and
 *  it may hold quotes or parens (a commit message) that would confuse the lexer. */
export function stripHeredocs(src) {
  const out = []
  const pending = []
  for (const line of src.split('\n')) {
    if (pending.length) {
      const { delim, tabs } = pending[0]
      if ((tabs ? line.replace(/^\t+/, '') : line).trim() === delim) pending.shift()
      continue
    }
    out.push(line)
    for (const m of line.matchAll(/(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z_][\w.-]*)\2/g)) pending.push({ delim: m[3], tabs: m[1] === '-' })
  }
  return out.join('\n')
}

/** The end index (exclusive) of a `$(...)` that opens at src[i] === '$', skipping quoted parts. */
function substEnd(src, i) {
  let depth = 0
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j]
    if (c === "'") {
      const e = src.indexOf("'", j + 1)
      j = e < 0 ? src.length : e
    } else if (c === '"') {
      for (j++; j < src.length && src[j] !== '"'; j++) if (src[j] === '\\') j++
    } else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return j + 1
  }
  return src.length
}

/** Shell words and operators of a command (heredoc bodies removed first). Each word: { w, dyn } — dyn when it has
 *  an unquoted/double-quoted `$` or a backtick. Operators: { op }. */
export function lex(cmd) {
  const src = stripHeredocs(cmd)
  const out = []
  let i = 0
  let word = null
  const pushWord = () => {
    if (word) out.push(word)
    word = null
  }
  const ensure = () => (word ??= { w: '', dyn: false })
  while (i < src.length) {
    const c = src[i]
    if (c === '\n') {
      pushWord()
      out.push({ op: '\n' })
      i++
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      pushWord()
      i++
      continue
    }
    if (c === '#' && !word) {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1)
      ensure().w += src.slice(i + 1, end < 0 ? src.length : end)
      i = end < 0 ? src.length : end + 1
      continue
    }
    if (c === '"') {
      let j = i + 1
      let s = ''
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length && '"\\$`'.includes(src[j + 1])) {
          s += src[j + 1]
          j += 2
          continue
        }
        if (src[j] === '$' && src[j + 1] === '(') {
          const e = substEnd(src, j)
          ensure().dyn = true
          s += src.slice(j, e)
          j = e
          continue
        }
        if (src[j] === '$' || src[j] === '`') ensure().dyn = true
        s += src[j++]
      }
      ensure().w += s
      i = j + 1
      continue
    }
    if (c === '\\') {
      if (src[i + 1] === '\n') {
        i += 2
        continue
      }
      ensure().w += src[i + 1] ?? ''
      i += 2
      continue
    }
    if (c === '$' || c === '`') {
      ensure().dyn = true
      // Keep $(...) / `...` / ${...} inside one word.
      if (c === '$' && src[i + 1] === '(') {
        const e = substEnd(src, i)
        word.w += src.slice(i, e)
        i = e
        continue
      }
      if (c === '$' && src[i + 1] === '{') {
        const e = src.indexOf('}', i)
        word.w += src.slice(i, e < 0 ? src.length : e + 1)
        i = e < 0 ? src.length : e + 1
        continue
      }
      if (c === '`') {
        const end = src.indexOf('`', i + 1)
        word.w += src.slice(i, end < 0 ? src.length : end + 1)
        i = end < 0 ? src.length : end + 1
        continue
      }
      word.w += c
      i++
      continue
    }
    // Redirections: [n]> [n]>> >| &> &>> [n]>&m  <  << <<- <<< (an fd number glued to the operator).
    const rest = src.slice(i)
    const redir = rest.match(/^(&>>|&>|>>|>\||>&|>|<<<|<<-|<<|<&|<>|<)/)
    if (redir) {
      if (word && /^\d+$/.test(word.w) && !word.dyn) word = null // the fd number belongs to the operator
      else pushWord()
      const op = redir[1]
      i += op.length
      if (op === '<<' || op === '<<-') {
        const m = src.slice(i).match(/^\s*(['"]?)([^\s'"<>;|&()]+)\1/)
        if (m) i += m[0].length // the delimiter; its body was stripped
        out.push({ op: '<<' })
        continue
      }
      out.push({ op: op === '>>' || op === '&>>' ? '>>' : op === '>&' ? '>&' : op.startsWith('<') ? '<' : '>' })
      continue
    }
    const sep = rest.match(/^(&&|\|\||;;|[;|&()])/)
    if (sep) {
      pushWord()
      out.push({ op: sep[1] })
      i += sep[1].length
      continue
    }
    ensure().w += c
    i++
  }
  pushWord()
  return out
}

const SEPARATORS = new Set(['\n', '&&', '||', ';', ';;', '|', '&', '(', ')'])
const PREFIXES = new Set(['sudo', 'command', 'builtin', 'exec', 'nohup', 'time', 'env', 'xargs', 'nice'])

/** Absolute path for a shell word, or null when it cannot be resolved (a variable or command substitution left). */
export function resolveWord(word, cwd, env = process.env) {
  let w = word.w
  if (word.dyn) {
    w = w.replace(/\$(?:\{(HOME|TMPDIR|TMP|TEMP|PWD)\}|(HOME|TMPDIR|TMP|TEMP|PWD)(?![A-Za-z0-9_]))/g, (m, a, b) => {
      const v = a || b
      return v === 'PWD' ? cwd : env[v] ?? m
    })
    if (/[$`]/.test(w)) return null
  }
  if (w === '~' || w.startsWith('~/')) w = (env.HOME || env.USERPROFILE || '~') + w.slice(1)
  return resolve(nativePath(cwd, env), nativePath(w, env))
}

/** A Git Bash path (/c/x, /tmp/x) as a Windows path; unchanged elsewhere. */
export function nativePath(p, env = process.env) {
  if (!WIN) return p
  const drive = p.match(/^\/([a-zA-Z])(\/|$)/)
  if (drive) return `${drive[1]}:/${p.slice(3)}`
  if (/^\/tmp(\/|$)/.test(p) && (env.TEMP || env.TMP)) return (env.TEMP || env.TMP) + p.slice(4)
  return p
}

/** Files a Bash command writes: [{ path }] or [{ unresolved: '<word>' }]. */
export function bashWrites(command, cwd, env = process.env) {
  const targets = []
  let dir = nativePath(cwd, env)
  const add = (word, d) => {
    if (!word || DEV_SINKS.has(word.w)) return
    const p = resolveWord(word, d, env)
    targets.push(p ? { path: p } : { unresolved: word.w })
  }
  const toks = lex(command)
  let cmd = []
  const flush = () => {
    const words = cmd
    cmd = []
    if (!words.length) return
    let k = 0
    while (k < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[k].w) || PREFIXES.has(words[k].w))) k++
    const argv = words.slice(k)
    if (!argv.length) return
    const name = basename(argv[0].w)
    const args = argv.slice(1)
    const plain = args.filter((a) => !a.w.startsWith('-') || a.w === '-')
    if (name === 'cd' || name === 'pushd') {
      const p = plain[0] ? resolveWord(plain[0], dir, env) : env.HOME
      if (p) dir = p
      return
    }
    if ((name === 'bash' || name === 'sh') && args.some((a) => a.w === '-c')) {
      const body = args[args.findIndex((a) => a.w === '-c') + 1]
      if (body) for (const t of bashWrites(body.w, dir, env)) targets.push(t)
      return
    }
    if (name === 'tee' || name === 'touch' || name === 'truncate') {
      for (const a of plain) if (a.w !== '-') add(a, dir)
      return
    }
    if (name === 'sed' || name === 'perl') {
      const inPlace = args.some((a) => /^-[a-zA-Z]*i/.test(a.w) || a.w.startsWith('--in-place'))
      if (!inPlace) return
      const files = []
      let script = name === 'perl' || args.some((a) => /^(-e|-f|--expression|--file)/.test(a.w) || /^-[a-zA-Z]*[ef]$/.test(a.w))
      for (let j = 0; j < args.length; j++) {
        const a = args[j]
        if (/^(-e|-f|--expression|--file)$/.test(a.w) || /^-[a-zA-Z]*[ef]$/.test(a.w)) {
          j++ // its argument is the script, not a file
          continue
        }
        if (a.w.startsWith('-') && a.w !== '-') continue
        if (!script) {
          script = true // the first plain word is the sed script
          continue
        }
        files.push(a)
      }
      for (const f of files) add(f, dir)
      return
    }
    if (name === 'cp' || name === 'mv' || name === 'install' || name === 'ln') {
      const t = args.findIndex((a) => a.w === '-t' || a.w.startsWith('--target-directory'))
      let dest = null
      let sources = plain
      if (t >= 0) {
        const a = args[t]
        dest = a.w.includes('=') ? { w: a.w.slice(a.w.indexOf('=') + 1), dyn: a.dyn } : args[t + 1]
        sources = plain.filter((p) => p !== dest)
      } else if (plain.length >= 2) {
        dest = plain[plain.length - 1]
        sources = plain.slice(0, -1)
      }
      if (!dest) return
      const d = resolveWord(dest, dir, env)
      let isDir = false
      try {
        isDir = !!d && statSync(d).isDirectory()
      } catch {}
      if (isDir && t < 0 && sources.length) for (const s of sources) targets.push({ path: join(d, basename(s.w)) })
      else if (isDir && t >= 0) for (const s of sources) targets.push({ path: join(d, basename(s.w)) })
      else add(dest, dir)
      if (name === 'mv') for (const s of sources) add(s, dir) // the source is removed
    }
  }
  let inTest = false
  for (let j = 0; j < toks.length; j++) {
    const t = toks[j]
    if (t.op && SEPARATORS.has(t.op)) {
      flush()
      inTest = false
      continue
    }
    if (t.op === '>' || t.op === '>>') {
      const next = toks[j + 1]
      if (!inTest && next && !next.op) {
        add(next, dir)
        j++
      }
      continue
    }
    if (t.op === '>&') {
      const next = toks[j + 1]
      if (next && !next.op) {
        if (!/^(\d+|-)$/.test(next.w)) add(next, dir)
        j++
      }
      continue
    }
    if (t.op === '<') {
      if (toks[j + 1] && !toks[j + 1].op) j++
      continue
    }
    if (t.op) continue
    if (!cmd.length && (t.w === '[[' || t.w === '((')) inTest = true
    cmd.push(t)
  }
  flush()
  return targets
}

// ---------- decisions ----------

const allow = (msg = '') => ({ decision: 'allow', msg })
const deny = (msg) => ({ decision: 'deny', msg })

function emit({ decision, msg }) {
  const esc = JSON.stringify(msg || '')
  if (decision === 'deny') {
    process.stdout.write(`{"permission":"deny","agent_message":${esc},"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":${esc}}}\n`)
  } else if (msg) {
    process.stdout.write(`{"permission":"allow","agent_message":${esc}}\n`)
  } else {
    process.stdout.write('{"permission":"allow"}\n')
  }
}

/** Ask the guard of another worktree of this repository about one file. */
function delegate(mode, targetRoot, file) {
  const input = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file }, cwd: targetRoot })
  const env = { ...process.env, KIT_GUARD_DEPTH: String(Number(process.env.KIT_GUARD_DEPTH || 0) + 1) }
  const own = join(targetRoot, 'scripts', 'lib', 'guard.mjs')
  const r = existsSync(own)
    ? spawnSync(process.execPath, [own, mode], { input, env, encoding: 'utf8', timeout: 8000 })
    : spawnSync('bash', [join(targetRoot, 'scripts', `${mode}-guard.sh`)], { input, env, encoding: 'utf8', timeout: 8000 })
  const out = r.stdout || ''
  let d = null
  try {
    d = JSON.parse(out.trim().split(/\r?\n/).pop())
  } catch {}
  if (!d) return allow(mode === 'scope' ? `SCOPE_GUARD: check failed (no answer from ${targetRoot}) - /ship scope gate will verify` : '')
  return d.permission === 'deny' ? deny(d.agent_message || `${mode} guard of ${targetRoot} denied ${file}`) : allow(d.agent_message || '')
}

function kitOwned(root, file) {
  const checker = join(root, 'scripts', 'kit-owned.mjs')
  if (!existsSync(checker)) return { owned: false, out: '' }
  const r = spawnSync(process.execPath, [checker, `--file=${file}`], { cwd: root, encoding: 'utf8' })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  return { owned: /^KIT_OWNED: yes/m.test(out), out }
}

const approvedRoute = (rel) => `STOP and tell the Human: file, exact change, why it can't be done in-scope. Wait for "approved: ${rel}", then append the path to the plan's scope block and retry.`

function scopeRule(here, file, branch) {
  const rel = toPosix(relative(here.root, file))
  const plan = scopedPlan(here.root, branch)
  const kit = kitOwned(here.root, file)
  const kitDeny = () => deny(kit.out.trim() || 'KIT_OWNED: yes - owned by the workflow kit')
  if (!plan) return kit.owned ? kitDeny() : allow()
  const r = spawnSync(process.execPath, [join(here.root, 'scripts', 'scope-check.mjs'), `--file=${toPosix(file)}`, `--plan=${plan}`], { cwd: here.root, encoding: 'utf8' })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  if (r.status === 0) {
    return kit.owned
      ? allow(`SCOPE_GUARD: ${rel} is kit-owned but in this plan's scope - allowed. Make the same change in the workflow kit and release it (the kit's docs/CHANGE-LOOP.md), or the next kit-sync reports a conflict.`)
      : allow()
  }
  if (/^SCOPE: upstream/m.test(out)) {
    return deny(`SCOPE_GUARD: ${rel} is upstream-owned (ownership.upstreamPaths in kit.config.json), not an "approved:" decision: the upstream repo owns it and no plan scope covers it. Reading is fine; do not edit it here. An app change goes to the upstream owner as a written brief.`)
  }
  if (/^SCOPE: out/m.test(out)) {
    return deny(`SCOPE_GUARD: ${rel} is outside this plan's Read-Write Scope (${plan}, branch ${branch || 'detached'}). Reading is fine; writing is not. ${approvedRoute(rel)}`)
  }
  return kit.owned ? kitDeny() : allow(`SCOPE_GUARD: check failed (${out.trim()}) - /ship scope gate will verify`)
}

function branchRule(here, file, branch, tool) {
  if (!MAIN_BRANCHES.includes(branch)) return allow()
  const rel = toPosix(relative(here.root, file))
  if (OPEN_PLAN_RE.test(rel) || rel === '.claude/todo.md') return allow(`BRANCH_GUARD: Planner admin bypass - ${rel} stays on ${branch}.`)
  if (RUNTIME_ON_MAIN.some((re) => re.test(rel))) return allow()
  if (!existsSync(join(here.root, '.worktree-port'))) {
    return deny(`BRANCH_GUARD: the Planner folder stays on ${branch} - only plans/*.plan.md and .claude/todo.md are written here${tool === 'Bash' ? ` (a shell command writes ${rel})` : ''}. Do code work in a wt-N slot (take-plan). If the Human explicitly wants it done in this folder, create the branch first (git switch -c <type>/<slug>) and tell them every session in this folder moves with it.`)
  }
  // A slot on main: move it to a session branch before writing.
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  let target = `feat/session-${day}`
  if (git(here.root, 'rev-parse', '--verify', '--quiet', `refs/heads/${target}`)) {
    target = `feat/session-${day}-${new Date().toISOString().slice(11, 16).replace(':', '')}`
  }
  git(here.root, 'checkout', '-b', target)
  const msg = `BRANCH_GUARD: Auto-switched from ${branch} to new branch ${target} before writing code. Tell the user: Moved to branch \`${target}\` before making any changes.`
  process.stderr.write(`${msg}\n`)
  return allow(msg)
}

/** The decision for one file (absolute path). */
function decideFile(mode, here, file, tool) {
  const wt = worktreeOf(existingAncestor(file))
  if (!wt) return allow()
  if (!same(wt.root, here.root)) {
    // Another worktree of this repository: its own guard decides. Another repository: not ours.
    if (same(wt.commonDir, here.commonDir) && Number(process.env.KIT_GUARD_DEPTH || 0) < 2) return delegate(mode, wt.root, file)
    return allow()
  }
  const branch = currentBranch(here)
  return mode === 'scope' ? scopeRule(here, file, branch) : branchRule(here, file, branch, tool)
}

function existingAncestor(p) {
  let d = p
  while (!existsSync(d)) {
    const up = dirname(d)
    if (up === d) break
    d = up
  }
  return d
}

/** Would a write in this worktree need a check? (for a shell target that cannot be resolved) */
function folderGuarded(mode, wt) {
  const branch = currentBranch(wt)
  if (mode === 'scope') return !!scopedPlan(wt.root, branch)
  return MAIN_BRANCHES.includes(branch) && !existsSync(join(wt.root, '.worktree-port'))
}

function filesOf(ti) {
  if (!ti || typeof ti !== 'object') return []
  const p = ti.file_path || ti.path || ti.filePath || ti.notebook_path
  if (p) return [p]
  if (Array.isArray(ti.edits) && ti.edits.length) {
    const e = ti.edits[0]
    const q = e && (e.file_path || e.path)
    if (q) return [q]
  }
  return []
}

export function decide(mode, input, here) {
  let d
  try {
    d = JSON.parse(input)
  } catch {
    return null
  }
  const ti = d.tool_input || d.input || d
  const tool = d.tool_name || (typeof ti?.command === 'string' && !filesOf(ti).length ? 'Bash' : '')
  const cwd = nativePath(typeof d.cwd === 'string' && d.cwd ? d.cwd : process.cwd())
  let targets
  if (tool === 'Bash' || (typeof ti?.command === 'string' && !filesOf(ti).length)) {
    targets = bashWrites(String(ti.command || ''), cwd)
  } else {
    targets = filesOf(ti).map((p) => ({ path: resolve(cwd, nativePath(p)) }))
    if (!targets.length) return null
  }
  const notes = []
  for (const t of targets) {
    let r
    if (t.unresolved !== undefined) {
      const cwdWt = worktreeOf(existingAncestor(resolve(cwd)))
      const wt = cwdWt && same(cwdWt.commonDir, here.commonDir) ? cwdWt : here
      r = folderGuarded(mode, wt)
        ? deny(`${mode === 'scope' ? 'SCOPE_GUARD' : 'BRANCH_GUARD'}: cannot tell which file this shell command writes (${t.unresolved}). Write to a literal path, or use the Write/Edit tool so the guard can check it.`)
        : allow()
    } else {
      r = decideFile(mode, here, t.path, tool)
    }
    if (r.decision === 'deny') return r
    if (r.msg) notes.push(r.msg)
  }
  return allow(notes.join('\n'))
}

function readStdin(ms) {
  return new Promise((res) => {
    if (process.stdin.isTTY) return res('')
    let buf = ''
    const done = () => {
      clearTimeout(timer)
      res(buf)
    }
    const timer = setTimeout(done, ms)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (buf += c))
    process.stdin.on('end', done)
    process.stdin.on('error', done)
  })
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const mode = process.argv[2] === 'branch' ? 'branch' : 'scope'
  const scriptsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  let result
  try {
    const input = await readStdin(1000)
    const here = worktreeOf(scriptsRoot) || { root: scriptsRoot, gitDir: join(scriptsRoot, '.git'), commonDir: join(scriptsRoot, '.git') }
    const inSlot = existsSync(join(scriptsRoot, '.worktree-port')) && existsSync(join(scriptsRoot, '.worktree-plan'))
    result = input.trim() ? decide(mode, input, here) : null
    if (!result) {
      // No tool input / no file in it: nothing to judge. In a slot the /ship scope gate is the backstop.
      result = mode === 'scope' && inSlot ? allow('SCOPE_GUARD: check failed (no file path in tool input) - /ship scope gate will verify') : allow()
    }
  } catch (e) {
    result = allow(`${mode === 'scope' ? 'SCOPE_GUARD' : 'BRANCH_GUARD'}: check failed (${e && e.message}) - /ship scope gate will verify`)
  }
  emit(result)
  if (process.env.KIT_GUARD_TRACE === '1') process.stderr.write(`GUARD_GIT_CALLS: ${gitCalls}\n`)
  process.exit(0)
}
