// Pure request/parameter validation for super-admin user routes. No DB access here.

export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}
