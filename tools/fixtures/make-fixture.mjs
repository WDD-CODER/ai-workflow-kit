/**
 * Fixture projects for the acceptance check (tools/acceptance-check.mjs): small, dependency-free stand-ins for the
 * stacks the kit supports, each a git repo with a bare `origin` next to it.
 *
 *   node tools/fixtures/make-fixture.mjs <kind> <parent folder>      # prints the project folder
 *
 *   angular         Angular app + Express backend in server/ (detected: packs angular, node-express)
 *   react-vite      React 18 + Vite + TypeScript app with Supabase-like folders, no server/ (detected: pack react-vite,
 *                   layer supabase); the project owns every file
 *   upstream-owned  the same app as a copy of someone else's repo: an `upstream` remote, upstream-owned .gitignore,
 *                   package.json and AGENTS.md, double quotes + semicolons, no husky (detected: pack react-vite, layer
 *                   supabase; upstream-owned only suggested — the `upstream` remote)
 *
 * Nothing is installed from the network: `npm run dev` starts a stand-in Vite (tools/vite.mjs: a strict-port HTTP server
 * whose command line names vite), build / lint / test are no-op scripts. Node built-ins only.
 */
import { writeFileSync, mkdirSync, realpathSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'

export const KINDS = {
  angular: { packs: ['angular', 'node-express'], layers: [], detected: 'packs=[angular, node-express] layers=[]' },
  'react-vite': { packs: ['react-vite'], layers: ['supabase'], detected: 'packs=[react-vite] layers=[supabase]' },
  'upstream-owned': { packs: ['react-vite'], layers: ['upstream-owned'], detected: 'packs=[react-vite] layers=[supabase]', suggested: 'suggested layer upstream-owned — git remote "upstream" exists; not included' },
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'kit-fixture', GIT_AUTHOR_EMAIL: 'kit-fixture@example.invalid',
  GIT_COMMITTER_NAME: 'kit-fixture', GIT_COMMITTER_EMAIL: 'kit-fixture@example.invalid',
  GIT_TERMINAL_PROMPT: '0',
}
export const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}
const json = (v) => JSON.stringify(v, null, 2) + '\n'
function write(dir, files) {
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true })
    writeFileSync(join(dir, f), text)
  }
}

// A strict-port dev server standing in for Vite. Like the real binary, the listening process carries its absolute path
// (the slot tools recognise a slot's processes by their folder) and its name matches the react-vite pack's matcher.
const VITE = `import { createServer } from 'http'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
const args = process.argv.slice(2)
if (!args.includes('--serve')) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve', ...args], { stdio: 'inherit' })
  child.on('exit', (code) => process.exit(code ?? 1))
} else {
  const port = Number(args[args.indexOf('--port') + 1])
  createServer((req, res) => res.end('ok'))
    .on('error', (e) => { console.error(e.message); process.exit(1) })
    .listen(port, () => console.log('  VITE ready on port ' + port))
}
`
const NOOP = 'node -e ""'

// The app source: double quotes and semicolons, the way an AI app builder writes it.
const REACT_SRC = {
  'index.html': '<!doctype html>\n<html lang="en">\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n',
  'vite.config.ts': 'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nimport path from "path";\n\nexport default defineConfig({\n  server: { host: "::", port: 8080 },\n  plugins: [react()],\n  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },\n});\n',
  'tsconfig.json': json({ compilerOptions: { strict: false, jsx: 'react-jsx', baseUrl: '.', paths: { '@/*': ['./src/*'] } }, include: ['src'] }),
  'src/main.tsx': 'import { createRoot } from "react-dom/client";\nimport App from "./App";\n\ncreateRoot(document.getElementById("root")!).render(<App />);\n',
  'src/App.tsx': 'import { lazy, Suspense } from "react";\nimport { BrowserRouter, Route, Routes } from "react-router-dom";\n\nconst Home = lazy(() => import("./pages/Home"));\n\nconst App = () => (\n  <BrowserRouter>\n    <Suspense fallback={null}>\n      <Routes>\n        <Route path="/" element={<Home />} />\n      </Routes>\n    </Suspense>\n  </BrowserRouter>\n);\n\nexport default App;\n',
  'src/pages/Home.tsx': 'import { useQuery } from "@tanstack/react-query";\nimport { supabase } from "@/integrations/supabase/client";\n\nexport default function Home() {\n  const { data } = useQuery({ queryKey: ["items"], queryFn: async () => (await supabase.from("items").select("*")).data });\n  return <main className="ps-4">{data?.length ?? 0}</main>;\n}\n',
  'src/integrations/supabase/client.ts': 'import { createClient } from "@supabase/supabase-js";\n\nexport const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);\n',
  'src/index.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n:root {\n  --primary: 222 47% 11%;\n}\n',
  'supabase/config.toml': 'project_id = "fixture"\n\n[functions.hello]\nverify_jwt = false\n',
  'supabase/functions/hello/index.ts': 'Deno.serve(async (req) => {\n  if (req.method === "OPTIONS") return new Response("ok");\n  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });\n});\n',
  'supabase/migrations/20260101000000_init.sql': 'create table if not exists public.items (id uuid primary key default gen_random_uuid(), name text not null);\nalter table public.items enable row level security;\n',
  'tools/vite.mjs': VITE,
}
const reactPkg = (name) => json({
  name, private: true, version: '0.0.0', type: 'module',
  scripts: { dev: 'node tools/vite.mjs', build: 'node -e "console.log(\'vite build ok\')"', lint: NOOP, test: NOOP, preview: NOOP },
  dependencies: { '@supabase/supabase-js': '^2.45.0', '@tanstack/react-query': '^5.56.0', react: '^18.3.1', 'react-dom': '^18.3.1', 'react-router-dom': '^6.26.0' },
  devDependencies: { '@vitejs/plugin-react': '^4.3.0', typescript: '^5.5.0', vite: '^5.4.0' },
})

/** Create fixture `kind` under `parent`. Returns { dir, origin, upstream?, ...KINDS[kind] }. */
export function makeFixture(kind, parent) {
  if (!KINDS[kind]) throw new Error(`unknown fixture "${kind}" (${Object.keys(KINDS).join(', ')})`)
  parent = realpathSync.native(resolve(parent))
  const name = `${kind}-app`
  const dir = join(parent, name)
  const origin = join(parent, `${name}-origin.git`)
  // Our own config: a project name, unusual base ports (a dev server on this machine is never in the way), and the
  // stack left out, so the installer's detection is what proposes it.
  const kitConfig = json({
    project: { name, repoName: name },
    slots: { fePorts: kind === 'angular' ? 47400 : 47300, bePorts: 47500 },
    hooks: { shellPath: 'bash' },
  })
  git(parent, 'init', '-q', '--bare', '-b', 'main', origin)
  const out = { dir, origin, ...KINDS[kind] }
  if (kind === 'angular') {
    git(parent, 'init', '-q', '-b', 'main', dir)
    write(dir, {
      'package.json': json({ name, private: true, scripts: { start: NOOP, build: NOOP, lint: NOOP, test: NOOP }, dependencies: { '@angular/core': '^19.0.0' } }),
      'server/package.json': json({ name: `${name}-server`, private: true, scripts: { test: NOOP }, dependencies: { express: '^4.21.0' } }),
      'src/app/app.routes.ts': "export const routes = []\n",
      'kit.config.json': kitConfig,
      '.gitignore': 'node_modules/\n',
    })
  } else if (kind === 'react-vite') {
    git(parent, 'init', '-q', '-b', 'main', dir)
    write(dir, { ...REACT_SRC, 'package.json': reactPkg(name), 'kit.config.json': kitConfig, '.gitignore': 'node_modules/\ndist/\n' })
  } else {
    // The upstream repo (someone else's), then our copy of it: origin = our repo, upstream = theirs (push disabled).
    const upstream = join(parent, `${name}-upstream.git`)
    const up = join(parent, `${name}-upstream-work`)
    git(parent, 'init', '-q', '--bare', '-b', 'main', upstream)
    git(parent, 'init', '-q', '-b', 'main', up)
    write(up, {
      ...REACT_SRC,
      'package.json': reactPkg(name),
      '.gitignore': 'node_modules\ndist\n.env.local\n.vscode/*\n!.vscode/extensions.json\n',
      'AGENTS.md': '# Project rules (upstream)\n\n- Read data through the shared Supabase client in `src/integrations/supabase/client.ts`.\n',
    })
    git(up, 'add', '-A')
    git(up, 'commit', '-q', '-m', 'upstream: the app')
    git(up, 'push', '-q', upstream, 'main')
    git(parent, 'clone', '-q', '-b', 'main', upstream, dir)
    git(dir, 'remote', 'rename', 'origin', 'upstream')
    git(dir, 'remote', 'set-url', '--push', 'upstream', 'DISABLED')
    git(dir, 'fetch', '-q', 'upstream')
    write(dir, { 'kit.config.json': kitConfig })
    out.upstream = upstream
  }
  // An existing project: its files are committed before the kit arrives.
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', kind === 'upstream-owned' ? 'chore: our kit config' : 'the app')
  git(dir, 'remote', 'add', 'origin', origin)
  return out
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [kind, parent] = process.argv.slice(2)
  if (!kind || !parent) {
    console.error(`usage: node tools/fixtures/make-fixture.mjs <${Object.keys(KINDS).join('|')}> <parent folder>`)
    process.exit(1)
  }
  mkdirSync(parent, { recursive: true })
  console.log(makeFixture(kind, parent).dir)
}
export const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url))
