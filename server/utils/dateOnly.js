// Calendar dates live in DATE columns and come back from pg as raw
// 'YYYY-MM-DD' strings (see the type parser in server/db/index.js), so day
// comparisons are plain lexical string comparisons. This normalizes the odd
// Date or timestamp that still reaches a caller onto that same form.
export function toDateStr(val) {
  if (!val) return null
  if (val instanceof Date) return val.toISOString().slice(0, 10)
  return String(val).slice(0, 10)
}
