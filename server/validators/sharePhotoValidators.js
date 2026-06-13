// Input parsing and validation for share-photo routes. No DB access here.

export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n >= 1 ? n : null
}
