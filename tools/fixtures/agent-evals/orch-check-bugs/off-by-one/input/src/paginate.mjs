export function pageItems(items, page, size) {
  const start = page * size
  const out = []
  for (let i = start; i <= start + size && i < items.length; i++) out.push(items[i])
  return out
}
