export function getRequiredErrors(form, fields) {
  const errs = {}
  for (const f of fields) {
    const v = form[f]
    if (v == null || (typeof v === 'string' && v.trim() === '')) {
      errs[f] = 'Required'
    }
  }
  return errs
}

export function hasRequiredErrors(form, fields) {
  for (const f of fields) {
    const v = form[f]
    if (v == null || (typeof v === 'string' && v.trim() === '')) return true
  }
  return false
}
