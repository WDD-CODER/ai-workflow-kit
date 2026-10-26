/**
 * Write guards — the one implementation behind scope-guard.sh and branch-guard.sh (PreToolUse hooks).
 *
 *   node scripts/lib/guard.mjs scope    plan Read-Write Scope (+ kit-owned files)
 *   node scripts/lib/guard.mjs branch   no code writes on main
 *   node scripts/lib/guard.mjs plan     a Bash command's new plans/*.plan.md files (the Bash half of plan-write-guard.sh)
 *
 * Input: the hook's JSON on stdin ({ tool_name, tool_input, cwd }). Output: one JSON decision on stdout, in both
 * formats (Cursor reads "permission", Claude Code reads hookSpecificOutput). Exit code is always 0.
 *
 * A guard decides from the file being written, never from where the session was started:
 *   - the file's own worktree is found by walking up to its `.git`; a sibling worktree of the same repository is
 *     judged by that worktree's own guard (its branch, its plan), a file outside every worktree of this repo is
 *     not this guard's business;
 *   - a Bash command is read for the files it writes (redirects, heredocs, tee, sed -i / perl -i, cp/mv/install
 *     targets, touch; `cd`, `bash -c` and `$(…)` / backtick substitutions are followed; `>` inside `[[ … ]]` and
 *     `(( … ))` is a comparison) and each target gets the same rule. This is best-effort — it
 *     cannot parse every shell construct — so a target it cannot resolve (a `$VAR` or `$(...)` path) is refused
 *     when this folder, the shell's folder or any worktree of the repository is guarded (fail closed). Strict mode
 *     (strictShell) is the backstop for the reader: a complex command ($(…), ${…}, backticks, <(…), [[, ((, $'…')
 *     that writes is refused there too unless every write is a top-level plain target the reader found, and it is
 *     deny by default (no shell/interpreter/wrapper word, no name inside ((…))/[[ … ]], no `>` in a $(…)). /ship's
 *     scope gate and CI drift-check stay the backstop.
 *   - a check that cannot run (empty/unparseable input, no file path, an error, a sibling guard with no answer, a
 *     scope check that crashes) refuses the write when the folder concerned is guarded, and allows it otherwise.
 *
 * Plan scope applies in a slot with an active plan (.worktree-port + .worktree-plan) and, outside a slot, on any
 * branch other than main that names a plan: `.worktree-plan` (a run's merge folder, e.g. orch/<run>) or a
 * `<type>/NNN-<slug>` branch — the same rule /ship's scope gate uses (ship-prep.mjs, lib/slot.mjs scopedPlanPath).
 *
 * Speed (the hook limit is 10 s; Git Bash start-up on Windows is slow): one node process, the branch and git dirs
 * read from files, no git call on the allow path. KIT_GUARD_TRACE=1 prints `GUARD_GIT_CALLS: <n>` to stderr.
 */
import { readFileSync, readdirSync, existsSync, statSync, realpathSync, unlinkSync } from 'fs'
import { spawnSync } from 'child_process'
import { join, resolve, dirname, relative, isAbsolute, basename } from 'path'
import { fileURLToPath } from 'url'
import { OPEN_PLAN_RE, findOpenPlan } from './plan-paths.mjs'

const MAIN_BRANCHES = ['main', 'master']
// Gitignored runtime files the workflow writes on main: never a branch decision.
const RUNTIME_ON_MAIN = [/^\.claude\/sessions\//, /^\.claude\/\.plan-write-ack$/]
const DEV_SINKS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty', 'nul', 'NUL'])
const WIN = process.platform === 'win32'

let gitCalls = 0
const toPosix = (p) => String(p).replace(/\\/g, '/')
// The long, real form of a path: Windows 8.3 short names (a profile folder shown as NAME~1) and symlinks expanded through the
// nearest existing ancestor, so a short temp path and git's long path compare equal.
const canonCache = new Map()
const canon = (p) => {
  const abs = resolve(String(p))
  if (canonCache.has(abs)) return canonCache.get(abs)
  let head = abs
  const rest = []
  let out = abs
  for (;;) {
    try {
      out = join(realpathSync.native(head), ...rest)
      break
    } catch {
      const up = dirname(head)
      if (up === head) break
      rest.unshift(basename(head))
      head = up
    }
  }
  canonCache.set(abs, out)
  return out
}
const same = (a, b) => {
  const x = toPosix(canon(a))
  const y = toPosix(canon(b))
  return WIN ? x.toLowerCase() === y.toLowerCase() : x === y
}
const inside = (root, p) => {
  const rel = relative(canon(root), canon(p))
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

/** { end, closed } of a `${…}` that opens at src[i] === '$': end is the index (exclusive) after its `}`. Like bash,
 *  only a nested `${` nests — a `{` right after an unescaped `$` (`\${` is a literal `$` and a literal `{`); quoted
 *  parts and `$(…)` / backtick substitutions inside are skipped whole. No closing `}`: closed false, end src.length
 *  (the caller fails closed). */
function braceEnd(src, i) {
  let depth = 1
  let dollar = false // the character before src[j] was an unescaped `$`
  for (let j = i + 2; j < src.length; j++) {
    const c = src[j]
    const afterDollar = dollar
    dollar = false
    if (c === '\\') j++
    else if (c === "'") {
      const e = src.indexOf("'", j + 1)
      j = e < 0 ? src.length : e
    } else if (c === '"') {
      for (j++; j < src.length && src[j] !== '"'; j++) if (src[j] === '\\') j++
    } else if (c === '`') {
      const e = src.indexOf('`', j + 1)
      j = e < 0 ? src.length : e
    } else if (c === '$' && src[j + 1] === '(') j = substEnd(src, j) - 1
    else if (c === '$') dollar = !afterDollar // `$$` is the PID: the `{` after it is literal
    else if (c === '{' && afterDollar) depth++
    else if (c === '}' && --depth === 0) return { end: j + 1, closed: true }
  }
  return { end: src.length, closed: false }
}

/** Is the `(` at src[open] the first of an arithmetic `((…))` (bash's rule: the `(` after it closes, then `)` follows
 *  at once)? Otherwise `((` opens nested subshells, whose commands are read as commands. */
function arithAt(src, open) {
  if (src[open] !== '(' || src[open + 1] !== '(') return false
  const e = substEnd(src, open) // the end of the inner ( … ), scanning from open + 1
  return e < src.length && src[e] === ')'
}

/** The commands of the `$(…)` / backtick substitutions inside an arithmetic body (`((…))` / `$((…))`): bash expands
 *  them before it evaluates, so `(( $(cat > f) ))` writes f. Quotes are not skipped — reading too much fails closed. */
function arithSubs(body) {
  const subs = []
  for (let j = 0; j < body.length; j++) {
    const c = body[j]
    if (c === '\\') j++
    else if (c === '$' && body[j + 1] === '(') {
      const e = substEnd(body, j)
      const inner = body.slice(j + 2, body[e - 1] === ')' ? e - 1 : e)
      if (arithAt(body, j + 1)) subs.push(...arithSubs(inner))
      else subs.push(inner)
      j = e - 1
    } else if (c === '`') {
      const end = body.indexOf('`', j + 1)
      subs.push(body.slice(j + 1, end < 0 ? body.length : end))
      j = end < 0 ? body.length : end
    }
  }
  return subs
}

/** Shell words and operators of a command (heredoc bodies removed first). Each word: { w, dyn, quoted?, subs? } — dyn
 *  when it has an unquoted/double-quoted `$` or a backtick; quoted when any part of it was quoted or escaped (`'[['`
 *  and `\[\[` are plain words, not the test keyword); subs: the commands of its `$(…)` / backtick substitutions,
 *  including those inside an arithmetic `$((…))`, read for writes like any other command. A `((…))` arithmetic
 *  command is one word (its substitutions in subs). Operators: { op }. */
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
  const addSub = (body) => (ensure().subs ??= []).push(body)
  // The body of the `$(…)` at src[j] (end e): a command substitution, or an arithmetic one whose nested ones count.
  const addSubst = (j, e) => {
    const body = src.slice(j + 2, src[e - 1] === ')' ? e - 1 : e)
    if (!arithAt(src, j + 1)) addSub(body)
    else for (const b of arithSubs(body)) addSub(b)
  }
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
      ensure().quoted = true
      word.w += src.slice(i + 1, end < 0 ? src.length : end)
      i = end < 0 ? src.length : end + 1
      continue
    }
    if (c === '"') {
      let j = i + 1
      let s = ''
      ensure().quoted = true
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length && '"\\$`'.includes(src[j + 1])) {
          s += src[j + 1]
          j += 2
          continue
        }
        if (src[j] === '$' && src[j + 1] === '(') {
          const e = substEnd(src, j)
          ensure().dyn = true
          addSubst(j, e)
          s += src.slice(j, e)
          j = e
          continue
        }
        if (src[j] === '`') {
          const end = src.indexOf('`', j + 1)
          ensure().dyn = true
          addSub(src.slice(j + 1, end < 0 ? src.length : end))
          s += src.slice(j, end < 0 ? src.length : end + 1)
          j = end < 0 ? src.length : end + 1
          continue
        }
        if (src[j] === '$') ensure().dyn = true
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
      ensure().quoted = true
      word.w += src[i + 1] ?? ''
      i += 2
      continue
    }
    if (c === '$' || c === '`') {
      ensure().dyn = true
      // Keep $(...) / `...` / ${...} inside one word.
      if (c === '$' && src[i + 1] === '(') {
        const e = substEnd(src, i)
        addSubst(i, e)
        word.w += src.slice(i, e)
        i = e
        continue
      }
      if (c === '$' && src[i + 1] === '{') {
        // `${x:-$(cmd)}` / `${x:-`cmd`}`: the nested substitutions run; nested `${…}` count toward the end.
        const { end: e, closed } = braceEnd(src, i)
        if (!closed) word.unclosed = true // where it ends is unknown: the word is judged unresolved (fail closed)
        for (const b of arithSubs(src.slice(i + 2, closed ? e - 1 : e))) addSub(b)
        word.w += src.slice(i, e)
        i = e
        continue
      }
      if (c === '`') {
        const end = src.indexOf('`', i + 1)
        addSub(src.slice(i + 1, end < 0 ? src.length : end))
        word.w += src.slice(i, end < 0 ? src.length : end + 1)
        i = end < 0 ? src.length : end + 1
        continue
      }
      word.w += c
      i++
      continue
    }
    // Process substitution `<(cmd)` / `>(cmd)`: part of a word (bash passes /dev/fd/N), its body a command of its own —
    // so `<((echo x > f))` is a subshell inside it, never arithmetic.
    // procsub: its text when it starts the word, else true — a word that is exactly that text is one process
    // substitution; one mixing it with anything else (`out<(true)`) is an unresolved target.
    if ((c === '<' || c === '>') && src[i + 1] === '(') {
      const e = substEnd(src, i)
      const starts = !word
      ensure().dyn = true
      word.procsub ??= starts ? src.slice(i, e) : true
      addSub(src.slice(i + 2, src[e - 1] === ')' ? e - 1 : e))
      word.w += src.slice(i, e)
      i = e
      continue
    }
    // An arithmetic command `(( a > b ))` / `for ((i=0; i<3; i++))`: one word, its `>` and `<` are comparisons.
    if (c === '(' && !word && arithAt(src, i)) {
      const e = substEnd(src, i) + 1
      const subs = arithSubs(src.slice(i + 2, e - 2))
      out.push({ w: src.slice(i, e), dyn: false, arith: true, ...(subs.length ? { subs } : {}) })
      i = e
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
// Reserved words that may come before a command (`if cp a b`, `then echo x > f`, `! cmd`): skipped like a prefix.
const RESERVED = new Set(['if', 'then', 'elif', 'else', 'do', 'while', 'until', '!', '{'])
// Inside `[[ … ]]` these join tests, not commands: they do not end the test.
const TEST_JOINERS = new Set(['&&', '||', '(', ')'])

/** Absolute path for a shell word, or null when it cannot be resolved (a variable or command substitution left, or a
 *  relative word while the shell's folder is unknown: cwd null after a `cd` the guard could not follow). */
export function resolveWord(word, cwd, env = process.env) {
  let w = word.w
  if (word.dyn) {
    w = w.replace(/\$(?:\{(HOME|TMPDIR|TMP|TEMP|PWD)\}|(HOME|TMPDIR|TMP|TEMP|PWD)(?![A-Za-z0-9_]))/g, (m, a, b) => {
      const v = a || b
      return (v === 'PWD' ? cwd : env[v]) ?? m
    })
    if (/[$`]/.test(w)) return null
  }
  if (w === '~' || w.startsWith('~/')) w = (env.HOME || env.USERPROFILE || '~') + w.slice(1)
  const native = nativePath(w, env)
  if (cwd == null) return isAbsolute(native) ? resolve(native) : null
  return resolve(nativePath(cwd, env), native)
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
  let dir = cwd == null ? null : nativePath(cwd, env) // null: unknown folder (a cd the guard could not follow)
  // from: the file a mv moves to this target (the plan-file rule tells a moved plan from a new one).
  const add = (word, d, from) => {
    if (!word || DEV_SINKS.has(word.w)) return
    // A word that is exactly one process substitution `>(cmd)` is no file: its body's writes are read as a command
    // (subWrites). A word mixing one with other text (`out<(true)`, `x>(cat)y`) is judged unresolved (fail closed).
    if (word.procsub) {
      if (word.w !== word.procsub) targets.push({ unresolved: word.w, dir: d })
      return
    }
    const p = resolveWord(word, d, env)
    // An unresolved target keeps the shell's folder at that point (null when unknown): the guard judges it too.
    targets.push(p ? { path: p, ...(from ? { from } : {}) } : { unresolved: word.w, dir: d })
  }
  const toks = lex(command)
  let cmd = []
  // A redirection in the current simple command: after one, `[[` is a plain word, not the test keyword.
  let cmdRedir = false
  const flush = () => {
    const words = cmd
    cmd = []
    cmdRedir = false
    if (!words.length) return
    let k = 0
    while (k < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[k].w) || PREFIXES.has(words[k].w) || RESERVED.has(words[k].w))) k++
    const argv = words.slice(k)
    if (!argv.length) return
    const name = basename(argv[0].w)
    const args = argv.slice(1)
    const plain = args.filter((a) => !a.w.startsWith('-') || a.w === '-')
    if (name === 'cd' || name === 'pushd') {
      // A target the guard cannot resolve makes the folder unknown: every later relative target is unresolved
      // (fail closed) until a cd to a path it can resolve.
      dir = (plain[0] ? resolveWord(plain[0], dir, env) : env.HOME) || null
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
      const from = (s) => (name === 'mv' ? resolveWord(s, dir, env) : null)
      const into = (s) => {
        const f = from(s)
        targets.push({ path: join(d, basename(s.w)), ...(f ? { from: f } : {}) })
      }
      if (isDir && (sources.length || t >= 0)) for (const s of sources) into(s)
      else add(dest, dir, sources.length === 1 ? from(sources[0]) : null)
      if (name === 'mv') for (const s of sources) add(s, dir) // the source is removed
    }
  }
  // A `$(…)` or backtick substitution is a command of its own: its writes count, read from the shell's folder there.
  // A word with an unclosed `${` hides where the next command starts: it counts as an unresolved target.
  const subWrites = (word) => {
    if (word?.unclosed) targets.push({ unresolved: word.w, dir })
    for (const body of word?.subs ?? []) for (const t of bashWrites(body, dir, env)) targets.push(t)
  }
  // inTest: inside `[[ … ]]` (after any reserved words: `if [[ $a > $b ]]`), where `>` and `<` compare strings.
  // Only a raw, unquoted `[[` opens a test and only a raw `]]` closes it. The words after a `>` inside it wait in
  // testOperands; a test the command or the input leaves unclosed fails closed: each of them counts as a write target.
  let inTest = false
  let testOperands = []
  const endTest = (closed) => {
    if (!closed) for (const w of testOperands) add(w, dir)
    testOperands = []
    inTest = false
  }
  for (let j = 0; j < toks.length; j++) {
    const t = toks[j]
    if (t.op && SEPARATORS.has(t.op)) {
      if (inTest && TEST_JOINERS.has(t.op)) continue
      if (inTest) endTest(false)
      flush()
      continue
    }
    if (t.op && !inTest) cmdRedir = true
    if (t.op === '>' || t.op === '>>') {
      const next = toks[j + 1]
      if (inTest) {
        if (next && !next.op && !(next.w === ']]' && !next.quoted)) testOperands.push(next)
        continue
      }
      if (next && !next.op) {
        subWrites(next)
        add(next, dir)
        j++
      }
      continue
    }
    if (t.op === '>&') {
      const next = toks[j + 1]
      if (next && !next.op) {
        subWrites(next)
        if (!/^(\d+|-)$/.test(next.w)) add(next, dir)
        j++
      }
      continue
    }
    if (t.op === '<') {
      if (toks[j + 1] && !toks[j + 1].op) {
        subWrites(toks[j + 1])
        j++
      }
      continue
    }
    if (t.op) continue
    subWrites(t)
    // `[[` is the test keyword only at the start of a simple command: nothing but unquoted reserved words before it,
    // and no redirection (`2>/dev/null [[ a > f ]]` runs a command named `[[` and writes f).
    if (t.w === '[[' && !t.quoted && !cmdRedir && cmd.every((w) => RESERVED.has(w.w) && !w.quoted)) inTest = true
    else if (t.w === ']]' && !t.quoted && inTest) endTest(true)
    cmd.push(t)
  }
  if (inTest) endTest(false)
  flush()
  return targets
}

// ---------- strict mode: a complex shell command that writes ----------
//
// bashWrites is best-effort: every review round found another construct that hid a write from it. Strict mode is a
// fail-closed backstop on top of it, for a command that is COMPLEX (its raw text holds `$(`, a backtick, `${`, `<(`,
// `>(`, `$'`, `$"`, `[[`, `((`, the word eval, or an odd number of ' or ") and WRITES (a `>` that is not a
// /dev/null-style or fd redirect, or one of the words tee cp mv install touch dd truncate ln sed perl eval and the
// shells). Both tests read the raw text and over-include on purpose. Such a command is judged DENY BY DEFAULT: it
// passes only when strictScan reads it whole with a small, deliberately narrow grammar and finds that
//   - every write is at the top level — a redirect, or tee/touch/truncate/cp/mv/install/ln/sed -i/perl -i as the
//     command name of a top-level simple command — never inside a `$(…)`, backticks, a `<(…)`/`>(…)` or an unquoted
//     here-document;
//   - every write target is a plain literal path (no `$`, backtick, glob or brace), and bashWrites found each one;
//   - no word anywhere (quoted or not, any level, path and .exe stripped) runs or hides other code: a shell (bash sh
//     zsh dash ksh fish busybox …), eval, source, `.`, exec, let, dd, sed, perl, awk, python*, node, ruby, xargs,
//     find, env, sudo, timeout, nice, nohup, command, builtin and similar wrappers/interpreters (DENY_WORDS), nor a
//     write command anywhere but the command name above — so no `bash -c` / `-ce` / `-o x -c` variant, no script
//     read from stdin, a here-document or /dev/fd, and no wrapper prefix can carry a write past the reader;
//   - every `((…))`, `$((…))`, `$[…]` and `[[ … ]]` is pure numbers and operators: an identifier there can name a
//     variable holding `a[$(cmd)]`, which bash runs while it evaluates the expression;
//   - every `$(…)` / backtick body has no `>` redirect (only a `N>&M` duplication), no `<(…)`/`>(…)`, and none of
//     the words above;
//   - nothing it cannot read for sure is present: `$'…'`, `$"…"`, `${…}` other than `${NAME}`, a `((…))` with
//     parens/quotes/substitutions inside, a process substitution glued to text, a command name built at run time or
//     holding a glob/subscript, an unclosed quote/construct or here-document.
// `<`/`>` that the reader took as comparisons inside `[[ … ]]` / `((…))` are not writes: a command that writes
// nothing once they are set aside (`if [[ $a > $b ]]; then :; fi`, `(( a > b ))`) passes.
// Anything else is refused on a guarded folder (decide): write the file with the Write/Edit tool, or use a plain
// redirect to a literal path. A command that is not complex is judged exactly as before.

const COMPLEX_RE = /\$\(|`|\$\{|<\(|>\(|\$'|\$"|\[\[|\(\(|(?:^|[^\w.-])eval(?![\w.-])/
const SINK_REDIR_RE = /\d*>&\s*(?:\d+|-)(?![\w./-])|(?:&>>?|\d*>>?|>\|)\s*(?:\/dev\/(?:null|stdout|stderr|tty)|nul|NUL)(?![\w./-])/g
const WRITE_WORD_RE = /(?:^|[^\w.-])(?:tee|cp|mv|install|touch|dd|truncate|ln|sed|perl|eval|bash|sh|zsh|dash|ksh|fish|busybox)(?![\w.-])/
const STRICT_WRITE_CMDS = new Set(['tee', 'touch', 'truncate', 'cp', 'mv', 'install', 'ln'])
// Words that run, or hide, other code in a complex command that writes: shells, eval-likes, interpreters, wrappers.
const DENY_WORDS = new Set([
  ...['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'busybox', 'ash', 'mksh', 'csh', 'tcsh', 'pwsh', 'powershell', 'cmd'],
  ...['eval', 'source', 'exec', 'let', 'dd', 'sed', 'perl', 'awk', 'gawk', 'mawk', 'nawk', 'node', 'nodejs', 'deno', 'bun'],
  ...['ruby', 'php', 'lua', 'tclsh', 'py', 'pypy', 'pypy3', 'xargs', 'find', 'env', 'sudo', 'doas', 'su', 'timeout'],
  ...['nice', 'ionice', 'nohup', 'command', 'builtin', 'stdbuf', 'setsid', 'chroot', 'flock', 'taskset', 'watch'],
  ...['parallel', 'script', 'unbuffer', 'strace', 'nsenter', 'unshare'],
])
const denyWord = (b) => DENY_WORDS.has(b) || STRICT_WRITE_CMDS.has(b) || /^python[0-9.]*w?$/.test(b)
// A word as a command name: no folder (/ or \), lower case, no .exe/.com/.bat/.cmd.
const cmdBase = (w) =>
  w
    .slice(Math.max(w.lastIndexOf('/'), w.lastIndexOf('\\')) + 1)
    .toLowerCase()
    .replace(/\.(?:exe|com|bat|cmd)$/, '')
const IDENT_RE = /[A-Za-z_]/
const odd = (s, ch) => (s.split(ch).length - 1) % 2 === 1

/** Does the raw command use a construct that can hide how it parses? */
export function complexShell(cmd) {
  const s = String(cmd)
  return COMPLEX_RE.test(s) || odd(s, "'") || odd(s, '"')
}

/** Could the raw command write a file? (over-includes: quoted text counts too) */
export function shellWrites(cmd) {
  const s = String(cmd)
  return />/.test(s.replace(SINK_REDIR_RE, '')) || WRITE_WORD_RE.test(s)
}

class StrictFail extends Error {}
const sfail = (why) => {
  throw new StrictFail(why)
}
const isSpace = (c) => c === ' ' || c === '\t' || c === '\r'
const isBreak = (c) => c === undefined || isSpace(c) || c === '\n' || ';&|()<>'.includes(c)

/**
 * Read a command with the strict grammar. Returns its top-level writes: [{ kind: 'redir', lit, abs }] and
 * [{ kind: 'cmd', name, args: [{ lit, abs }] }] (abs: the path from the shell's folder there, null when unknown);
 * throws StrictFail(<why>) on anything it cannot read for sure. level > 0: inside a substitution, where any write fails.
 * facts collects what strictShell judges after the scan: deny (the deny-by-default reasons, in order) and cmp (the
 * positions in the whole command of `<`/`>` read as comparisons); off: where src starts in the whole command.
 */
function strictScan(src, level, cwd, env, facts, off = 0) {
  const writes = []
  const deny = (why) => void facts.deny.push(why)
  const pending = [] // here-documents waiting for the next newline: { delim, quoted, tabs, level }
  let pos = 0
  let dir = cwd == null ? null : nativePath(cwd, env)
  const abs = (lit) => resolveWord({ w: lit, dyn: false }, dir, env)

  // $… at pos. inDq: inside "…" or an unquoted here-document, where $' and $" are plain text.
  const dollar = (lvl, inDq) => {
    const n = src[pos + 1]
    if (n === "'" || n === '"') {
      if (inDq) return void pos++
      sfail(n === "'" ? "ANSI-C quoting $'…'" : 'locale quoting $"…"')
    }
    if (n === '(' && src[pos + 2] === '(') {
      pos++
      return arith()
    }
    if (n === '(') {
      pos += 2
      return list(lvl + 1, ')')
    }
    if (n === '{') {
      const m = src.slice(pos).match(/^\$\{(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]|[@*#?$!-])\}/)
      if (!m) sfail('a ${…} expansion other than ${NAME}')
      return void (pos += m[0].length)
    }
    if (n === '[') deny('old-style arithmetic $[…]')
    const m = src.slice(pos).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/)
    pos += m ? m[0].length : 1
  }
  // `…` at pos: its body is read as a command of its own, one level down.
  const backtick = (lvl) => {
    const e = src.indexOf('`', pos + 1)
    if (e < 0) sfail('an unclosed backtick')
    const body = src.slice(pos + 1, e)
    if (body.includes('\\')) sfail('a backslash inside backticks')
    if (pending.length && body.includes('\n')) sfail('a here-document and a multi-line substitution')
    strictScan(body, lvl + 1, dir, env, facts, off + pos + 1)
    pos = e + 1
  }
  // `<`/`>` in src[from, to) read as comparisons, not redirects.
  const cmps = (from, to) => {
    for (let i = from; i < to; i++) if (src[i] === '<' || src[i] === '>') facts.cmp.push(off + i)
  }
  // ((…)) at pos (the first `(`): plain arithmetic only — no parens, quotes, substitutions or braces inside, and
  // (deny by default) no identifier: a variable holding `a[$(cmd)]` runs cmd when bash evaluates it.
  const arith = () => {
    const close = src.indexOf(')', pos + 2)
    if (close < 0 || src[close + 1] !== ')') sfail('a ((…)) that is not plain arithmetic')
    const body = src.slice(pos + 2, close)
    if (/[()'"`\\{}\n]/.test(body)) sfail('a ((…)) that is not plain arithmetic')
    if (IDENT_RE.test(body)) deny(`a name inside ((…)) (${body.trim()}): only numbers and operators`)
    cmps(pos + 2, close)
    pos = close + 2
  }
  // "…" from pos (after the opening quote).
  const dq = (lvl) => {
    let value = ''
    let dyn = false
    while (pos < src.length) {
      const c = src[pos]
      if (c === '"') {
        pos++
        return { value, dyn }
      }
      if (c === '\\') {
        const n = src[pos + 1] ?? ''
        if (!'"\\$`\n'.includes(n)) value += c
        if (n !== '\n') value += n
        pos += 2
        continue
      }
      if (c === '$' || c === '`') {
        if (c === '$') dollar(lvl, true)
        else backtick(lvl)
        dyn = true
        continue
      }
      if (c === '\n' && pending.length) sfail('a here-document and a multi-line string')
      value += c
      pos++
    }
    sfail('an unclosed double quote')
  }
  // One word from pos: { value, dyn (a $ or backtick), glob (an unquoted * ? [ { }), quoted, raw }.
  const word = (lvl) => {
    const start = pos
    let value = ''
    let dyn = false
    let glob = false
    let quoted = false
    while (pos < src.length && !isBreak(src[pos])) {
      const c = src[pos]
      if (c === "'") {
        const e = src.indexOf("'", pos + 1)
        if (e < 0) sfail('an unclosed single quote')
        value += src.slice(pos + 1, e)
        quoted = true
        pos = e + 1
      } else if (c === '"') {
        pos++
        const r = dq(lvl)
        value += r.value
        dyn ||= r.dyn
        quoted = true
      } else if (c === '\\') {
        if (src[pos + 1] !== '\n') {
          value += src[pos + 1] ?? ''
          quoted = true
        }
        pos += 2
      } else if (c === '$') {
        dollar(lvl, false)
        dyn = true
      } else if (c === '`') {
        backtick(lvl)
        dyn = true
      } else {
        if ('*?[]{}'.includes(c)) glob = true
        value += c
        pos++
      }
    }
    return { value, dyn, glob, quoted, raw: src.slice(start, pos) }
  }
  // The here-document bodies after a newline read at lvl: a quoted one is data; an unquoted one expands $(…)/`…`.
  const bodies = (lvl) => {
    if (pending.some((h) => h.level !== lvl)) sfail('a here-document across a substitution')
    while (pending.length) {
      const h = pending.shift()
      for (;;) {
        if (pos >= src.length) sfail(`an unterminated here-document (${h.delim})`)
        let nl = src.indexOf('\n', pos)
        if (nl < 0) nl = src.length
        const line = src.slice(pos, nl).replace(/\r$/, '')
        if ((h.tabs ? line.replace(/^\t+/, '') : line) === h.delim) {
          pos = nl + 1
          break
        }
        if (h.quoted) {
          pos = nl + 1
          continue
        }
        while (pos < src.length && src[pos] !== '\n') {
          const c = src[pos]
          if (c === '\\' && src[pos + 1] === '\n') sfail('a line continuation in a here-document')
          if (c === '\\') pos += 2
          else if (c === '$') dollar(lvl, true)
          else if (c === '`') backtick(lvl)
          else pos++
        }
        pos++
      }
    }
  }
  // A simple command's words, judged when it ends.
  const command = (words, lvl) => {
    let k = 0
    while (k < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[k].value) || PREFIXES.has(words[k].value) || RESERVED.has(words[k].value))) k++
    const argv = words.slice(k).filter((w) => !w.arith)
    const cmd0 = argv[0]
    if (cmd0 && (cmd0.dyn || cmd0.procsub)) sfail(`a command name built at run time (${cmd0.raw})`)
    const name = cmd0 ? cmdBase(cmd0.value) : ''
    const args = argv.slice(1)
    // Deny by default: the plain write commands (and sed -i / perl -i) pass only as the command name of a top-level
    // command no wrapper prefix runs; every other word that runs or hides code is refused, quoted or not.
    const inPlace = (name === 'sed' || name === 'perl') && args.some((a) => /^-[a-zA-Z]*i/.test(a.value) || a.value.startsWith('--in-place'))
    const plainWrite = lvl === 0 && (STRICT_WRITE_CMDS.has(name) || inPlace)
    for (const w of words) {
      if (w.arith || w.procsub) continue
      if (w === cmd0 && plainWrite) continue
      const b = cmdBase(w.value)
      if (denyWord(b)) deny(`${b}${lvl > 0 ? ' inside a substitution' : ''} — a shell, interpreter, wrapper or write the guard cannot follow`)
      else if (w === cmd0 && b === '.') deny('. (source)')
      else if (w === cmd0 && w.glob && w.value !== '[') deny(`a command name with a glob or subscript (${w.raw})`)
    }
    if (!cmd0) return
    if (name === 'cd' || name === 'pushd' || name === 'popd') {
      const to = args.find((a) => !a.value.startsWith('-') || a.value === '-')
      dir = name === 'popd' || (to && (to.dyn || to.glob || to.value === '-')) ? null : to ? abs(to.value) : env.HOME || null
      return
    }
    if (plainWrite) {
      const files = args.filter((a) => !a.procsub && !DEV_SINKS.has(a.value))
      const bad = files.find((a) => a.dyn || a.glob)
      if (bad) sfail(`${name} with a target that is not a plain path (${bad.raw})`)
      const argAbs = (v) => (v.startsWith('--target-directory=') ? abs(v.slice(19)) : v.startsWith('-') ? null : abs(v))
      writes.push({ kind: 'cmd', name, args: files.map((a) => ({ lit: a.value, abs: argAbs(a.value) })) })
    }
  }
  // Commands from pos until `closer` (')' ends a $(…) or <(…)) or the end of the text.
  const list = (lvl, closer) => {
    let words = []
    let redirected = false
    let test = false
    let testFrom = 0
    let parens = 0
    const end = () => {
      if (test) sfail('an unclosed [[')
      command(words, lvl)
      words = []
      redirected = false
    }
    while (pos < src.length) {
      const c = src[pos]
      if (c === '\n') {
        end()
        pos++
        bodies(lvl)
        continue
      }
      if (isSpace(c)) {
        pos++
        continue
      }
      if (c === '\\' && src[pos + 1] === '\n') {
        pos += 2
        continue
      }
      if (c === '#') {
        while (pos < src.length && src[pos] !== '\n') pos++
        continue
      }
      if ((c === '<' || c === '>') && src[pos + 1] === '(') {
        // A process substitution: a word of its own (never glued to text), its body a command one level down.
        if (!isBreak(src[pos - 1]) || src[pos - 1] === '<' || src[pos - 1] === '>') sfail('a process substitution glued to other text')
        if (lvl > 0) deny('a process substitution inside a substitution')
        pos += 2
        list(lvl + 1, ')')
        if (!isBreak(src[pos])) sfail('a process substitution glued to other text')
        if (!test) words.push({ value: '', procsub: true, raw: '<(…)' })
        continue
      }
      if (test && (c === '<' || c === '>')) {
        facts.cmp.push(off + pos)
        pos++ // a comparison inside [[ … ]]
        continue
      }
      if (c === '<' || c === '>' || (c === '&' && src[pos + 1] === '>')) {
        const op = src.slice(pos).match(/^(&>>|&>|>>|>\||>&|<<<|<<-|<<|<&|<>|>|<)/)[1]
        pos += op.length
        redirected = true
        if (op === '<<' || op === '<<-') {
          const m = src.slice(pos).match(/^[ \t]*(?:'([\w.-]+)'|"([\w.-]+)"|\\([\w.-]+)|([\w.-]+))(?=$|[\s;&|()<>])/)
          if (!m) sfail('a here-document delimiter the guard cannot read')
          pending.push({ delim: m[1] ?? m[2] ?? m[3] ?? m[4], quoted: m[4] === undefined, tabs: op === '<<-', level: lvl })
          pos += m[0].length
          continue
        }
        while (isSpace(src[pos])) pos++
        const t = word(lvl)
        if (!t.raw) sfail(`a ${op} redirect without a plain target`)
        if (op === '<' || op === '<<<' || op === '<&') continue
        if (op === '>&' && /^(\d+|-)$/.test(t.value) && !t.dyn) continue
        // Inside a substitution only a `N>&M` duplication passes; any other `>`, even to /dev/null, is refused.
        if (lvl > 0) deny(`a ${op} redirect inside a substitution (${op} ${t.raw})`)
        if (!t.dyn && DEV_SINKS.has(t.value)) continue
        if (lvl > 0) sfail(`a write inside a substitution (${op} ${t.raw})`)
        if (t.dyn || t.glob) sfail(`a write to a target that is not a plain path (${t.raw})`)
        writes.push({ kind: 'redir', lit: t.value, abs: abs(t.value) })
        continue
      }
      if (c === ';' || c === '&' || c === '|') {
        const two = src[pos + 1] === c || (c === '|' && src[pos + 1] === '&') || (c === ';' && src[pos + 1] === '&')
        if (test) {
          if (two && c !== ';') {
            pos += 2
            continue
          }
          sfail('a separator inside [[ … ]]')
        }
        pos += two ? 2 : 1
        end()
        continue
      }
      if (c === '(') {
        if (test) {
          pos++
          continue
        }
        if (src[pos + 1] === '(') {
          arith()
          words.push({ value: '((', arith: true, raw: '((…))' })
          continue
        }
        parens++
        end()
        pos++
        continue
      }
      if (c === ')') {
        pos++
        if (test) continue
        end()
        if (parens > 0) parens--
        else if (closer === ')') return
        continue
      }
      const w = word(lvl)
      // A word of digits right before a redirect is its fd number.
      if (/^\d+$/.test(w.raw) && (src[pos] === '>' || src[pos] === '<')) continue
      if (test) {
        if (w.value === ']]' && !w.quoted) {
          test = false
          // Deny by default: `[[ … ]]` evaluates names arithmetically (-eq, -v a[…]), which runs a[$(cmd)].
          const body = src.slice(testFrom, pos - w.raw.length)
          if (IDENT_RE.test(body)) deny(`a name inside [[ … ]] (${body.trim()}): only numbers and operators`)
        }
        continue
      }
      if (w.value === '[[' && !w.quoted && !redirected && words.every((x) => RESERVED.has(x.value) && !x.quoted)) {
        testFrom = pos
        test = true
        words.push(w)
        continue
      }
      words.push(w)
    }
    end()
    if (closer) sfail('an unclosed $(…) or process substitution')
    if (parens) sfail('an unclosed (')
    if (pending.length) sfail(`an unterminated here-document (${pending[0].delim})`)
  }
  list(level, null)
  return writes
}

/**
 * Strict mode for one Bash command: null when it is not complex, does not write, or passes; else the reason it is
 * refused. targets: what bashWrites found for it — every top-level write strictScan reads must be among them.
 */
export function strictShell(command, cwd, targets, env = process.env) {
  const cmd = String(command)
  if (!complexShell(cmd) || !shellWrites(cmd)) return null
  let writes
  const facts = { deny: [], cmp: [] }
  try {
    writes = strictScan(cmd, 0, cwd, env, facts)
  } catch (e) {
    if (e instanceof StrictFail) return e.message
    throw e
  }
  // `<`/`>` the reader took as comparisons inside [[ … ]] / ((…)) are not writes: with them set aside, a command
  // that no longer looks like it writes is not judged by strict mode (`if [[ $a > $b ]]; then :; fi`).
  if (!writes.length && facts.cmp.length) {
    const chars = cmd.split('') // UTF-16 units, as the positions are
    for (const i of facts.cmp) chars[i] = ' '
    if (!shellWrites(chars.join(''))) return null
  }
  if (facts.deny.length) return facts.deny[0]
  const paths = targets.filter((t) => t.path).map((t) => t.path)
  const found = (p, parentOk) => !!p && paths.some((t) => same(t, p) || (parentOk && same(dirname(t), p)))
  for (const w of writes) {
    if (w.kind === 'redir') {
      if (!found(w.abs, false)) return `the guard did not find the target ${w.lit}`
      continue
    }
    const files = w.args.filter((a) => !a.lit.startsWith('-') || a.lit === '-')
    if (w.name === 'tee' || w.name === 'touch' || w.name === 'truncate') {
      const miss = files.find((a) => a.lit !== '-' && !found(a.abs, false))
      if (miss) return `the guard did not find the target ${miss.lit}`
    } else if (w.name === 'sed' || w.name === 'perl') {
      if (!files.some((a) => found(a.abs, false))) return `the guard did not find the file ${w.name} -i writes`
    } else {
      // cp / mv / install / ln: the destination (the -t directory or the last plain word) — a file or its folder.
      const t = w.args.findIndex((a) => a.lit === '-t' || a.lit.startsWith('--target-directory'))
      const dest = t < 0 ? files[files.length - 1] : w.args[t].lit.includes('=') ? w.args[t] : w.args[t + 1]
      if (!dest || !found(dest.abs ?? null, true)) return `the guard did not find the ${w.name} target ${dest ? dest.lit : '(none)'}`
    }
  }
  return null
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
  // No answer (crash, timeout, garbage): judge the file by the local rule for that worktree (fail closed).
  if (!d) return localFallback(mode, worktreeOf(targetRoot) || { root: targetRoot, gitDir: join(targetRoot, '.git'), commonDir: join(targetRoot, '.git') }, file, `no answer from the guard of ${targetRoot}`)
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
  const rel = toPosix(relative(canon(here.root), canon(file)))
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
  // The scope check itself failed (crash, missing script, no verdict) on a folder with an active plan: fail closed.
  return kit.owned ? kitDeny() : deny(`SCOPE_GUARD: the scope check failed for ${rel} (${out.trim() || `exit ${r.status}`}) - write refused until it runs. Fix the check (scripts/scope-check.mjs, scripts/node_modules: npm ci) and retry.`)
}

/** Is this repo-relative path one that stays writable on main (plans, the todo list, runtime files)? */
const mainAllowed = (rel) => OPEN_PLAN_RE.test(rel) || rel === '.claude/todo.md' || RUNTIME_ON_MAIN.some((re) => re.test(rel))

/**
 * The decision when the real check could not run (another worktree's guard gave no answer, or the delegation depth
 * is used up): allow only when that worktree is not guarded, or the file is one main keeps writable (fail closed).
 */
function localFallback(mode, wt, file, why) {
  if (!folderGuarded(mode, wt)) return allow()
  if (mode === 'branch' && mainAllowed(toPosix(relative(canon(wt.root), canon(file))))) return allow()
  const tag = mode === 'scope' ? 'SCOPE_GUARD' : 'BRANCH_GUARD'
  return deny(`${tag}: cannot check ${toPosix(file)} (${why}) and ${wt.root} is guarded - write refused (fail closed). Retry from a session in that folder.`)
}

function branchRule(here, file, branch, tool) {
  if (!MAIN_BRANCHES.includes(branch)) return allow()
  const rel = toPosix(relative(canon(here.root), canon(file)))
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
    if (!same(wt.commonDir, here.commonDir)) return allow()
    if (Number(process.env.KIT_GUARD_DEPTH || 0) < 2) return delegate(mode, wt.root, file)
    return localFallback(mode, wt, file, 'delegation depth used up')
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

/** Every worktree of the repository whose git common dir is `commonDir`, read from files (no git process). */
function repoWorktrees(commonDir) {
  const out = []
  if (basename(commonDir) === '.git') out.push({ root: dirname(commonDir), gitDir: commonDir, commonDir })
  let names = []
  try {
    names = readdirSync(join(commonDir, 'worktrees'))
  } catch {}
  for (const n of names) {
    const gitDir = join(commonDir, 'worktrees', n)
    const dotGit = readTrim(join(gitDir, 'gitdir'))
    if (dotGit) out.push({ root: dirname(resolve(nativePath(dotGit))), gitDir, commonDir })
  }
  return out
}

/** A shell target the guard cannot resolve may land anywhere: refuse it when `here`, the shell's folder at that point
 *  or any worktree of this repository is guarded (fail closed). */
function unresolvedGuarded(mode, here, dir) {
  const guarded = (wt) => {
    try {
      return folderGuarded(mode, wt)
    } catch {
      return true
    }
  }
  if (guarded(here)) return true
  const dirWt = dir ? worktreeOf(existingAncestor(resolve(dir))) : null
  if (dirWt && same(dirWt.commonDir, here.commonDir) && guarded(dirWt)) return true
  return repoWorktrees(here.commonDir).some((wt) => existsSync(wt.root) && guarded(wt))
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
    const command = String(ti.command || '')
    targets = bashWrites(command, cwd)
    // Strict mode: a complex command that writes must use plain, top-level targets the reader found (fail closed).
    const why = strictShell(command, cwd, targets)
    if (why && unresolvedGuarded(mode, here, cwd)) {
      return deny(`${mode === 'scope' ? 'SCOPE_GUARD' : 'BRANCH_GUARD'}: this shell command writes and uses $(…)/\${…}/backticks/<(…)/[[/((/$'…' — the guard cannot verify every target (${why}). Write the file with the Write/Edit tool, or use a plain redirect to a literal path.`)
    }
  } else {
    targets = filesOf(ti).map((p) => ({ path: resolve(cwd, nativePath(p)) }))
    if (!targets.length) return null
  }
  const notes = []
  for (const t of targets) {
    let r
    if (t.unresolved !== undefined) {
      r = unresolvedGuarded(mode, here, t.dir)
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
/**
 * The plan-file rule for a Bash command (the Bash half of plan-write-guard.sh, which judges Edit/Write): every
 * plans/*.plan.md file the command writes gets the same rule as a Write of it — an existing plan is allowed, a new one
 * named in .claude/.plan-write-ack is allowed once (the ack is consumed), a new one with name-similar plans is denied.
 * A command that only names a plan (cat, git add, plan-name-similarity --file=…) writes none and is allowed. A target
 * the reader cannot resolve is left to the branch and scope guards (they fail closed); like plan-write-guard.sh, an
 * input that cannot be read is allowed.
 */
export function planWriteDecision(input, repo, similarity) {
  let d
  try {
    d = JSON.parse(input)
  } catch {
    return allow()
  }
  const ti = d.tool_input || d.input || d
  if (typeof ti?.command !== 'string') return allow()
  const cwd = nativePath(typeof d.cwd === 'string' && d.cwd ? d.cwd : process.cwd())
  const ackFile = join(repo, '.claude', '.plan-write-ack')
  const notes = []
  for (const t of bashWrites(ti.command, cwd)) {
    const norm = t.path ? toPosix(t.path) : ''
    if (!/plans\/.+\.plan\.md$/.test(norm) || existsSync(t.path)) continue
    // `mv plans/NNN-x.plan.md plans/done/NNN-x.plan.md`: an existing plan moved under its own name is no new plan.
    if (t.from && basename(t.from) === basename(t.path) && /plans\/.+\.plan\.md$/.test(toPosix(t.from)) && existsSync(t.from)) continue
    const ack = readTrim(ackFile).replace(/\\/g, '/')
    const rel = norm.replace(/^.*(plans\/.*\.plan\.md)$/, '$1')
    if (ack && (norm.endsWith(ack) || ack.endsWith(rel))) {
      try {
        unlinkSync(ackFile)
      } catch {}
      notes.push(`PLAN_WRITE_GUARD: ack consumed - write allowed for ${rel}`)
      continue
    }
    const out = similarity(rel)
    if (/no similar plans/.test(out)) continue
    if (/similar plan/.test(out)) {
      return deny(`PLAN_WRITE_GUARD: blocked new plan write from a shell command - similar plan(s) exist. Run: node scripts/plan-name-similarity.mjs --file=${rel} then ask Human: rewrite existing / save as new / cancel. On save-as-new: write the relative path to .claude/.plan-write-ack then retry. On rewrite: Edit the existing plan path instead.\n${out.trim()}`)
    }
    notes.push('PLAN_WRITE_GUARD: could not run similarity check - follow .claude/skills/save-plan/SKILL.md before writing plans/')
  }
  return allow(notes.join('\n'))
}

if (isMain && process.argv[2] === 'plan') {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const similarity = (rel) => {
    const r = spawnSync(process.execPath, [join(repo, 'scripts', 'plan-name-similarity.mjs'), `--file=${rel}`], { cwd: repo, encoding: 'utf8', timeout: 8000 })
    return `${r.stdout || ''}${r.stderr || ''}`
  }
  let result
  try {
    result = planWriteDecision(await readStdin(1000), repo, similarity)
  } catch {
    result = allow()
  }
  emit(result)
  process.exit(0)
}
if (isMain) {
  const mode = process.argv[2] === 'branch' ? 'branch' : 'scope'
  const scriptsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const tag = mode === 'scope' ? 'SCOPE_GUARD' : 'BRANCH_GUARD'
  const here = worktreeOf(scriptsRoot) || { root: scriptsRoot, gitDir: join(scriptsRoot, '.git'), commonDir: join(scriptsRoot, '.git') }
  // Nothing could be judged (empty or unparseable input, no file path, an error): refuse when this folder is guarded,
  // allow only when it is not (fail closed).
  const unjudged = (why) => {
    let guarded = true
    try {
      guarded = folderGuarded(mode, here)
    } catch {}
    return guarded ? deny(`${tag}: cannot check this write (${why}) and ${here.root} is guarded - write refused (fail closed).`) : allow()
  }
  let result
  try {
    const input = await readStdin(1000)
    result = input.trim() ? decide(mode, input, here) : null
    if (!result) result = unjudged(input.trim() ? 'unparseable tool input or no file path in it' : 'empty tool input')
  } catch (e) {
    result = unjudged(`check failed: ${e && e.message}`)
  }
  emit(result)
  if (process.env.KIT_GUARD_TRACE === '1') process.stderr.write(`GUARD_GIT_CALLS: ${gitCalls}\n`)
  process.exit(0)
}
