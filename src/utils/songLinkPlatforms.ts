/**
 * Music/streaming platforms a song link can point to. `host` is the canonical
 * host (matched ignoring protocol and a leading `www.`); `prefix` is the
 * canonical URL shown in placeholders and validation messages.
 */
export interface SongLinkPlatform {
  key: string
  name: string
  prefix: string
  host: string
}

export const SONG_LINK_PLATFORMS: readonly SongLinkPlatform[] = [
  { key: 'spotify', name: 'Spotify', prefix: 'https://open.spotify.com/', host: 'open.spotify.com' },
  { key: 'soundcloud', name: 'SoundCloud', prefix: 'https://soundcloud.com/', host: 'soundcloud.com' },
  { key: 'apple_music', name: 'Apple Music', prefix: 'https://music.apple.com/', host: 'music.apple.com' },
  { key: 'deezer', name: 'Deezer', prefix: 'https://www.deezer.com/', host: 'deezer.com' },
  { key: 'tidal', name: 'Tidal', prefix: 'https://listen.tidal.com/', host: 'listen.tidal.com' },
  { key: 'youtube', name: 'YouTube', prefix: 'https://www.youtube.com/', host: 'youtube.com' },
  { key: 'youtube_music', name: 'YouTube Music', prefix: 'https://music.youtube.com/', host: 'music.youtube.com' },
]

export function platformByKey(key: string): SongLinkPlatform | null {
  return SONG_LINK_PLATFORMS.find((p) => p.key === key) ?? null
}

/** Strip protocol and a leading `www.`; null when not an http(s) URL. */
function normalizeUrl(url: string): string | null {
  const m = /^https?:\/\/(.+)$/i.exec(url.trim())
  if (!m) return null
  const rest = m[1].toLowerCase()
  return rest.startsWith('www.') ? rest.slice(4) : rest
}

export function urlMatchesPlatform(platform: SongLinkPlatform, url: string): boolean {
  const rest = normalizeUrl(url)
  if (rest === null) return false
  return rest === platform.host || rest.startsWith(`${platform.host}/`)
}

/** Classify a URL to one of the known platforms, or null for freeform "other". */
export function matchPlatform(url: string): SongLinkPlatform | null {
  return SONG_LINK_PLATFORMS.find((p) => urlMatchesPlatform(p, url)) ?? null
}
