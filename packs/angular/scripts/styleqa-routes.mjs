/**
 * Angular route reader for the Style QA engine (pack contract key `styleqaRoutes`).
 *
 *   readRoutes(text, routesFile)   the routes of an Angular routes file: [{ path: '/a/:id', lazy, folder? }]
 *   locateComponent(root, tag)     the source folder of the component whose selector is `tag`, or null
 *
 * Reads the text only (no TypeScript compiler): nested `children`, `loadComponent` / `loadChildren` (lazy), `:id`
 * params. A redirect, a `**` wildcard and a layout route that has children are not pages and are left out. `folder`
 * is the folder of a `loadComponent: () => import('./x/x.component')` target, or of a static `component:` import.
 * Node built-ins only.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, posix } from 'path'

const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

/** Tokens: strings, `{ } [ ] ( )`, `:` and words. */
function tokens(text) {
  const out = []
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`|([{}[\]():])|([A-Za-z_$][\w$]*)/g
  for (const m of text.matchAll(re)) {
    if (m[4]) out.push({ t: m[4] })
    else if (m[5]) out.push({ w: m[5] })
    else out.push({ s: m[1] ?? m[2] ?? m[3] })
  }
  return out
}

const join2 = (a, b) => `${a.replace(/\/+$/, '')}/${b.replace(/^\/+/, '')}`.replace(/\/+$/, '')

export function readRoutes(text, routesFile = 'src/app/app.routes.ts') {
  const toks = tokens(stripComments(String(text)))
  const dir = posix.dirname(String(routesFile).replace(/\\/g, '/'))
  // The import specifiers each component identifier comes from: import { X } from './a/x.component'
  const importOf = new Map()
  for (const m of String(text).matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const name of m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)) importOf.set(name, m[2])
  }
  const folderOf = (spec) => (spec && spec.startsWith('.') ? posix.dirname(posix.join(dir, spec)) : undefined)
  const top = []
  const stack = []
  for (let i = 0; i < toks.length; i++) {
    const k = toks[i]
    if (k.t === '{') stack.push({ kind: 'obj', path: null, kids: [], lazy: false, lazyKids: false, redirect: false, spec: undefined, comp: undefined })
    else if (k.t === '[') {
      const prev = toks[i - 2]
      const owner = toks[i - 1]?.t === ':' && prev?.w === 'children' ? stack.findLast((f) => f.kind === 'obj') : null
      stack.push({ kind: 'arr', owner })
    } else if (k.t === '(') stack.push({ kind: 'paren' })
    else if (k.t === ')' || k.t === ']') stack.pop()
    else if (k.t === '}') {
      const f = stack.pop()
      if (!f || f.kind !== 'obj') continue
      const mine = []
      if (f.path !== null && !f.redirect && f.path !== '**' && !f.kids.length) {
        mine.push({ path: f.path, lazy: f.lazy, ...(f.spec ? { folder: folderOf(f.spec) } : {}) })
      }
      for (const c of f.kids) mine.push({ ...c, path: join2(f.path ?? '', c.path) })
      const host = stack.findLast((x) => x.kind === 'arr')
      if (host?.owner) host.owner.kids.push(...mine)
      else if (host) top.push(...mine)
      // an object nested in a property value (data: {…}) belongs to its route object and carries no routes
    } else if (k.w && toks[i + 1]?.t === ':') {
      const f = stack.at(-1)
      if (!f || f.kind !== 'obj') continue
      const v = toks[i + 2]
      if (k.w === 'path' && v?.s !== undefined) f.path = v.s
      else if (k.w === 'redirectTo') f.redirect = true
      else if (k.w === 'loadComponent' || k.w === 'loadChildren') {
        f.lazy = true
        const imp = toks.slice(i + 2, i + 14).findIndex((x) => x.w === 'import')
        const spec = imp >= 0 ? toks[i + 2 + imp + 2] : null
        if (spec?.s !== undefined && k.w === 'loadComponent') f.spec = spec.s
      } else if (k.w === 'component' && v?.w) f.spec = importOf.get(v.w)
    }
  }
  return top.map((r) => ({ ...r, path: r.path === '' ? '/' : r.path.startsWith('/') ? r.path : `/${r.path}` }))
}

const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.angular'])

/** The folder (relative to root, forward slashes) of the component whose selector is `tag`; null when none. */
export function locateComponent(root, tag, srcRoot = 'src') {
  const re = new RegExp(`selector:\\s*['"\`]${String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`)
  const walk = (dir) => {
    let names
    try { names = readdirSync(dir) } catch { return null }
    for (const n of names) {
      if (SKIP.has(n) || n.startsWith('.')) continue
      const full = join(dir, n)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) {
        const hit = walk(full)
        if (hit) return hit
      } else if (n.endsWith('.ts') && !n.endsWith('.spec.ts') && re.test(readFileSync(full, 'utf8'))) return dir
    }
    return null
  }
  const hit = walk(join(root, srcRoot))
  return hit ? hit.slice(String(root).length).replace(/\\/g, '/').replace(/^\//, '') : null
}
