// Input parsing and validation for band-event routes. No DB access here.
import { parsePositiveId as parseId } from './common.js'

export const EDITABLE_FIELDS = ['title', 'start_date', 'end_date', 'start_time', 'end_time', 'location', 'notes']

export { parseId }

export function buildEventUpdateFields(body) {
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
