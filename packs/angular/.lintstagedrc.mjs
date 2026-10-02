import path from 'path'

const EXCLUDED = new Set([
  'src/main.ts',
  'src/app/app.config.ts',
  '{{paths.hotspots}}'
])

function normalizeAppPath(f) {
  const rel = f.replace(/\\/g, '/')
  const idx = rel.indexOf('src/app/')
  return idx >= 0 ? rel.slice(idx) : rel
}

export default {
  'src/app/**/*.{ts,html}': (filenames) => {
    const files = filenames.filter((f) => !EXCLUDED.has(normalizeAppPath(f)))
    if (files.length === 0) return []
    return [`eslint --fix ${files.map((f) => `"${f}"`).join(' ')}`]
  },
  'src/app/**/*.{ts,html,scss}': (filenames) => {
    const files = filenames.filter((f) => !EXCLUDED.has(normalizeAppPath(f)))
    if (files.length === 0) return []
    return [`prettier --write ${files.map((f) => `"${f}"`).join(' ')}`]
  }
}
