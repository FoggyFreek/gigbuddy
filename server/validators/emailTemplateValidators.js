// Input parsing and validation for email-template routes. No DB access here.

export const EDITABLE_FIELDS = ['name', 'subject', 'body_html']

export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function buildTemplateUpdateFields(body) {
  const fields = []
  const values = []
  let idx = 1
  for (const key of EDITABLE_FIELDS) {
    if (key in body) {
      fields.push(`${key} = $${idx++}`)
      values.push(body[key])
    }
  }
  return { fields, values }
}
