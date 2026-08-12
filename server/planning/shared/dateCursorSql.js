// Appends the shared (date, id) keyset predicate bindings. Callers still own
// the explicit SELECT, tenant scope, date column, ordering, and LIMIT.
export function appendDateCursor(params, cursor, dateColumn, idColumn) {
  if (!cursor) return ''
  params.push(cursor.date, cursor.id)
  return `AND (${dateColumn}, ${idColumn}) < ($${params.length - 1}, $${params.length})`
}
