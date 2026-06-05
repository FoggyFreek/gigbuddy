// Format a duration in seconds as mm:ss, or h:mm:ss past an hour.
// Returns an empty string for null/undefined/invalid input so callers can hide it.
export function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || totalSeconds === '') return ''
  const n = Math.max(0, Math.floor(Number(totalSeconds)))
  if (!Number.isFinite(n)) return ''
  const hours = Math.floor(n / 3600)
  const minutes = Math.floor((n % 3600) / 60)
  const seconds = n % 60
  const pad = (v) => String(v).padStart(2, '0')
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`
  return `${minutes}:${pad(seconds)}`
}

// Parse a user-typed "mm:ss" / "h:mm:ss" / plain-seconds string into seconds.
// Returns null when the input is blank or unparseable.
export function parseDuration(value) {
  const s = String(value ?? '').trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  const parts = s.split(':').map((p) => p.trim())
  if (parts.some((p) => !/^\d+$/.test(p))) return null
  let total = 0
  for (const p of parts) total = total * 60 + Number(p)
  return total
}
