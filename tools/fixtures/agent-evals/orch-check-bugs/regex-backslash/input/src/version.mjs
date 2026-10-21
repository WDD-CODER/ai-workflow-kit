export function parseVersion(tag) {
  const m = new RegExp('^v(\d+)\.(\d+)$').exec(tag)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]) }
}
