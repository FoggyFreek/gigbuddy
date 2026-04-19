export const GIG_STATUS_COLORS = {
  option: 'grey.500',
  confirmed: 'primary.main',
  announced: 'success.main',
}

export const REHEARSAL_STATUS_COLORS = {
  option: 'grey.400',
  planned: 'secondary.main',
}

export function toIsoDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function normalizeIsoDate(val) {
  if (!val) return ''
  if (typeof val === 'string') {
    if (val.length >= 10 && val[4] === '-' && val[7] === '-' && !val.includes('T')) {
      return val.slice(0, 10)
    }
  }
  return toIsoDate(new Date(val))
}

export function getMemberColor(slot, members) {
  if (slot.band_member_id === null) return '#9e9e9e'
  const m = members.find((m) => m.id === slot.band_member_id)
  return m?.color || '#9e9e9e'
}
