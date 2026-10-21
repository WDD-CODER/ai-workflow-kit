export function readPort(env) {
  if (!env || typeof env.PORT !== 'string') return 8080
  const n = Number.parseInt(env.PORT, 10)
  return Number.isInteger(n) && n > 0 ? n : 8080
}
