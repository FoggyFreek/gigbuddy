import dayjs from 'dayjs'

export function timeStringToDayjs(val) {
  if (!val) return null
  const d = dayjs(val, 'HH:mm')
  return d.isValid() ? d : null
}

export function dayjsToTimeString(d) {
  if (!d || !d.isValid()) return ''
  return d.format('HH:mm')
}

export function toDateInput(val) {
  if (!val) return ''
  return String(val).slice(0, 10)
}

export function toTimeInput(val) {
  if (!val) return ''
  return String(val).slice(0, 5)
}
