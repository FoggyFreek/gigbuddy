export function getRequiredErrors(form: Record<string, unknown>, fields: string[]): Record<string, string> {
  const errs: Record<string, string> = {}
  for (const f of fields) {
    const v = form[f]
    if (v == null || (typeof v === 'string' && v.trim() === '')) {
      errs[f] = 'Required'
    }
  }
  return errs
}

export function hasRequiredErrors(form: Record<string, unknown>, fields: string[]): boolean {
  for (const f of fields) {
    const v = form[f]
    if (v == null || (typeof v === 'string' && v.trim() === '')) return true
  }
  return false
}
