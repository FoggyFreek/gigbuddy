// Platform embed detection: turns a link URL into an embeddable player
// descriptor, or null when the platform has no (supported) embed. Pure and
// server-side only — the resolver recomputes descriptors from stored URLs so
// clients never dictate iframe sources.
//
// Presentation contract (`display`):
//   'inline'  — compact audio players designed for feeds (Spotify, SoundCloud)
//               expand in place in the widget stack.
//   'overlay' — video players (YouTube) open in a lightbox overlay.
//
// Privacy contract: embeds are ALWAYS click-to-play — the public page renders
// a facade first and only mounts the third-party iframe after the visitor
// clicks (see PRIVACY.md). YouTube uses the privacy-enhanced
// youtube-nocookie.com host.

// track 152px; episode/show 232px; album/playlist/artist 352px — the standard
// Spotify embed heights.
const SPOTIFY_HEIGHTS = { track: 152, episode: 232, show: 232, album: 352, playlist: 352, artist: 352 }

const YOUTUBE_ID = /^[\w-]{6,15}$/

function youtubeVideoId(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '')
  if (host === 'youtu.be') {
    const id = url.pathname.split('/')[1]
    return YOUTUBE_ID.test(id || '') ? id : null
  }
  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    const parts = url.pathname.split('/').filter(Boolean)
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v')
      return YOUTUBE_ID.test(id || '') ? id : null
    }
    if (['shorts', 'live', 'embed'].includes(parts[0]) && YOUTUBE_ID.test(parts[1] || '')) {
      return parts[1]
    }
  }
  return null
}

export function detectEmbed(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase().replace(/^www\./, '')

  if (host === 'open.spotify.com') {
    // Paths may carry a locale segment: /intl-nl/track/<id>.
    const match = /^\/(?:intl-[a-z-]+\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/.exec(
      url.pathname,
    )
    if (!match) return null
    const [, kind, id] = match
    return {
      type: 'spotify',
      display: 'inline',
      src: `https://open.spotify.com/embed/${kind}/${id}`,
      height: SPOTIFY_HEIGHTS[kind],
    }
  }

  const videoId = youtubeVideoId(url)
  if (videoId) {
    return {
      type: 'youtube',
      display: 'overlay',
      // Privacy-enhanced host; autoplay is fine because the iframe only
      // mounts after the visitor clicked play.
      src: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`,
    }
  }

  if (host === 'soundcloud.com' || host === 'on.soundcloud.com') {
    return {
      type: 'soundcloud',
      display: 'inline',
      src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url.href)}&visual=false&show_teaser=false`,
      height: 166,
    }
  }

  return null
}
