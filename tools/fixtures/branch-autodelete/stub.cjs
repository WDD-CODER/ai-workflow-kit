// Stub `gh` and `git` for tools/test/branch-autodelete-check.test.mjs. The test links the node binary into a scratch
// folder as `gh` / `git` and preloads this file through NODE_OPTIONS=--require; in any other node process it does
// nothing. Each call is appended to STUB_LOG as one JSON line, then answered from the STUB_* variables.
const { basename } = require('path')
const { appendFileSync } = require('fs')

const name = basename(process.execPath).replace(/\.exe$/i, '').toLowerCase()
if (name === 'gh' || name === 'git') {
  // node takes the first argument as its script path and resolves it: keep only its base name.
  const argv = [basename(process.argv[1] || ''), ...process.argv.slice(2)]
  if (process.env.STUB_LOG) appendFileSync(process.env.STUB_LOG, `${JSON.stringify({ name, argv, token: process.env.GITHUB_TOKEN ?? null })}\n`)
  const out = (text, code = 0) => {
    if (text) process.stdout.write(`${text}\n`)
    process.exit(code)
  }
  if (name === 'git') {
    if (argv[0] === 'rev-parse') out(process.cwd())
    if (argv[0] === 'remote') out(process.env.STUB_ORIGIN || '', process.env.STUB_ORIGIN ? 0 : 2)
    out('', 1)
  }
  if (process.env.STUB_GH_FAIL) {
    process.stderr.write(`${process.env.STUB_GH_FAIL}\n`)
    process.exit(1)
  }
  out(process.env.STUB_GH_ANSWER || 'false')
}
