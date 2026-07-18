// Streaming-platform detection from a link URL. Used to turn a song's links
// into "choose your platform" buttons on release landing pages, and to label
// click events for conversion statistics.

const RULES = [
  { id: 'spotify', label: 'Spotify', test: (h) => h === 'open.spotify.com' || h === 'spotify.com' },
  { id: 'apple', label: 'Apple Music', test: (h) => h === 'music.apple.com' || h === 'itunes.apple.com' || h === 'geo.music.apple.com' },
  { id: 'youtube-music', label: 'YouTube Music', test: (h) => h === 'music.youtube.com' },
  { id: 'youtube', label: 'YouTube', test: (h) => h === 'youtube.com' || h === 'youtu.be' },
  { id: 'deezer', label: 'Deezer', test: (h) => h === 'deezer.com' || h === 'deezer.page.link' },
  { id: 'tidal', label: 'TIDAL', test: (h) => h === 'tidal.com' || h === 'listen.tidal.com' },
  { id: 'amazon', label: 'Amazon Music', test: (h) => h === 'music.amazon.com' || (h.startsWith('music.amazon.') && h.split('.').length === 3) || h === 'amazon.com' },
  { id: 'soundcloud', label: 'SoundCloud', test: (h) => h === 'soundcloud.com' || h === 'on.soundcloud.com' },
  { id: 'bandcamp', label: 'Bandcamp', test: (h) => h === 'bandcamp.com' || h.endsWith('.bandcamp.com') },
]

// Returns { id, label } — falls back to a generic entry using the link's own
// label (or hostname) so unknown platforms still get a button.
export function detectPlatform(url, linkLabel = null) {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return { id: 'other', label: linkLabel || 'Listen' }
  }
  for (const rule of RULES) {
    if (rule.test(host)) return { id: rule.id, label: rule.label }
  }
  return { id: 'other', label: linkLabel || host }
}

// Click targets are stored in statistics — keep them short, printable, and
// impossible to abuse as a free-text channel.
export function sanitizeClickTarget(raw) {
  if (typeof raw !== 'string') return null
  const target = raw.trim().toLowerCase().slice(0, 80)
  if (!target || !/^[\w :./+-]+$/.test(target)) return null
  return target
}
