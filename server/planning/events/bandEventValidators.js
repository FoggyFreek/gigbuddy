// Input parsing and validation for band-event routes. No DB access here.
import { parsePositiveId as parseId } from '../../validators/common.js'

// my_band_id is only meaningful in a personal workspace; the route gates the
// field on the MY_BANDS capability and the service validates it against my_bands.
export const EDITABLE_FIELDS = ['title', 'start_date', 'end_date', 'start_time', 'end_time', 'location', 'notes', 'my_band_id']

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
