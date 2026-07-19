import { describe, it, expect } from 'vitest'
import { detectEmbed } from '../server/embeds.js'

describe('detectEmbed', () => {
  it('detects Spotify content with the right heights, inline display', () => {
    expect(detectEmbed('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toEqual({
      type: 'spotify',
      display: 'inline',
      src: 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC',
      height: 152,
    })
    expect(detectEmbed('https://open.spotify.com/album/abc123?si=xyz').height).toBe(352)
    expect(detectEmbed('https://open.spotify.com/intl-nl/track/abc123').src).toContain('/embed/track/abc123')
    expect(detectEmbed('https://open.spotify.com/episode/abc123').height).toBe(232)
    expect(detectEmbed('https://open.spotify.com/user/someone')).toBeNull()
  })

  it('detects YouTube in all URL shapes, overlay display on the nocookie host', () => {
    const expected = {
      type: 'youtube',
      display: 'overlay',
      src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1',
    }
    expect(detectEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual(expected)
    expect(detectEmbed('https://youtu.be/dQw4w9WgXcQ')).toEqual(expected)
    expect(detectEmbed('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toEqual(expected)
    expect(detectEmbed('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual(expected)
    expect(detectEmbed('https://www.youtube.com/@somechannel')).toBeNull()
  })

  it('detects SoundCloud as an inline player', () => {
    const embed = detectEmbed('https://soundcloud.com/band/track-name')
    expect(embed.type).toBe('soundcloud')
    expect(embed.display).toBe('inline')
    expect(embed.src).toContain('w.soundcloud.com/player')
  })

  it('returns null for non-embeddable or malformed URLs', () => {
    expect(detectEmbed('https://example.com/music')).toBeNull()
    expect(detectEmbed('not a url')).toBeNull()
    expect(detectEmbed('ftp://open.spotify.com/track/abc')).toBeNull()
  })
})
