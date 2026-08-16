import { isIsoDate } from '../../utils/periodQuery.js'
import { trimOrNull } from '../../platform/http/requestValidators.js'

export function normalizeAlbum(body = {}) {
  const title = trimOrNull(body.title)
  if (!title) return { error: 'title is required' }

  const releaseDate = trimOrNull(body.release_date)
  if (releaseDate && !isIsoDate(releaseDate)) return { error: 'Invalid release_date' }

  return { title, releaseDate }
}

export function buildAlbumUpdateFields(body = {}) {
  const fields = []
  const values = []
  let index = 1

  if ('title' in body) {
    const title = trimOrNull(body.title)
    if (!title) return { error: 'title is required' }
    fields.push(`title = $${index++}`)
    values.push(title)
  }
  if ('release_date' in body) {
    const releaseDate = trimOrNull(body.release_date)
    if (releaseDate && !isIsoDate(releaseDate)) return { error: 'Invalid release_date' }
    fields.push(`release_date = $${index++}`)
    values.push(releaseDate)
  }
  return { fields, values }
}
