const TIME_PARTS_RE = /^(\d{2}):(\d{2})/

export function timeToMinutes(value) {
  const match = TIME_PARTS_RE.exec(String(value ?? ''))
  if (!match) return null
  return (Number(match[1]) * 60) + Number(match[2])
}

export function nextIsoDate(isoDate) {
  const date = new Date(`${isoDate}T12:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== isoDate) return isoDate
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export function resolveEventEndDate(startDate, endDate, startTime, endTime) {
  const effectiveEndDate = endDate || startDate
  if (!startDate || effectiveEndDate !== startDate) return effectiveEndDate

  const startMinutes = timeToMinutes(startTime)
  const endMinutes = timeToMinutes(endTime)
  if (startMinutes === null || endMinutes === null || endMinutes >= startMinutes) {
    return effectiveEndDate
  }
  return nextIsoDate(startDate)
}
