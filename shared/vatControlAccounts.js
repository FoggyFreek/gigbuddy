export const VAT_CONTROL_ACCOUNT_FIELDS = [
  'input_vat_account_code',
  'output_vat_account_code',
]

export function vatControlAccountCodes(settings) {
  return new Set(VAT_CONTROL_ACCOUNT_FIELDS.map((field) => settings?.[field]).filter(Boolean))
}

export function isVatControlAccount(settings, code) {
  return Boolean(code) && vatControlAccountCodes(settings).has(code)
}

export function findVatControlAccountConflict(settings) {
  const assignments = Object.entries(settings || {})
    .filter(([field, code]) => field.endsWith('_account_code') && Boolean(code))

  for (const field of VAT_CONTROL_ACCOUNT_FIELDS) {
    const code = settings?.[field]
    if (!code) continue
    const conflicting = assignments.find(([otherField, otherCode]) => (
      otherField !== field && otherCode === code
    ))
    if (conflicting) {
      return { field, conflictingField: conflicting[0], accountCode: code }
    }
  }
  return null
}
