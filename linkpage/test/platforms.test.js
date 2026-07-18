import { describe, it, expect } from 'vitest'
import { detectPlatform, sanitizeClickTarget } from '../server/platforms.js'

describe('detectPlatform', () => {
  it('recognizes the major streaming platforms', () => {
    expect(detectPlatform('https://open.spotify.com/track/x')).toEqual({ id: 'spotify', label: 'Spotify' })
    expect(detectPlatform('https://music.apple.com/nl/album/x')).toEqual({ id: 'apple', label: 'Apple Music' })
    expect(detectPlatform('https://www.youtube.com/watch?v=x')).toEqual({ id: 'youtube', label: 'YouTube' })
    expect(detectPlatform('https://music.youtube.com/watch?v=x')).toEqual({ id: 'youtube-music', label: 'YouTube Music' })
    expect(detectPlatform('https://youtu.be/x')).toEqual({ id: 'youtube', label: 'YouTube' })
    expect(detectPlatform('https://www.deezer.com/track/1')).toEqual({ id: 'deezer', label: 'Deezer' })
    expect(detectPlatform('https://tidal.com/browse/track/1')).toEqual({ id: 'tidal', label: 'TIDAL' })
    expect(detectPlatform('https://music.amazon.nl/albums/x')).toEqual({ id: 'amazon', label: 'Amazon Music' })
    expect(detectPlatform('https://soundcloud.com/band/track')).toEqual({ id: 'soundcloud', label: 'SoundCloud' })
    expect(detectPlatform('https://theband.bandcamp.com/album/x')).toEqual({ id: 'bandcamp', label: 'Bandcamp' })
  })

  it('falls back to the link label or hostname for unknown platforms', () => {
    expect(detectPlatform('https://myband.example.com/song', 'Our site')).toEqual({ id: 'other', label: 'Our site' })
    expect(detectPlatform('https://myband.example.com/song')).toEqual({ id: 'other', label: 'myband.example.com' })
    expect(detectPlatform('garbage', null)).toEqual({ id: 'other', label: 'Listen' })
  })
})

describe('sanitizeClickTarget', () => {
  it('accepts platform-style targets and normalizes case', () => {
    expect(sanitizeClickTarget('platform:spotify')).toBe('platform:spotify')
    expect(sanitizeClickTarget('Link:Our Website')).toBe('link:our website')
    expect(sanitizeClickTarget('social:instagram')).toBe('social:instagram')
  })

  it('rejects garbage and free-text abuse', () => {
    expect(sanitizeClickTarget('')).toBeNull()
    expect(sanitizeClickTarget(null)).toBeNull()
    expect(sanitizeClickTarget('<script>alert(1)</script>')).toBeNull()
    expect(sanitizeClickTarget('a'.repeat(200))).toBe('a'.repeat(80))
  })
})
