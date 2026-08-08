// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  parseSpotifyArtistUrl,
  parseWebsiteUrl,
  websiteKey,
  parseBandProfileCreate,
  parseBandProfilePatch,
  hasLink,
  parseRemovalMode,
} from '../../../server/validators/bandProfileValidators.js'

const ARTIST_ID = '4Z8W4fKeB5YxbusRsdQVPb'

describe('parseSpotifyArtistUrl', () => {
  it('extracts the artist id and rebuilds a canonical URL', () => {
    expect(parseSpotifyArtistUrl(`https://open.spotify.com/artist/${ARTIST_ID}`))
      .toEqual({ url: `https://open.spotify.com/artist/${ARTIST_ID}`, artistId: ARTIST_ID })
  })

  // The share button appends ?si=<token>. Two musicians sharing the same artist
  // must not create two profiles, so the token never reaches storage.
  it('strips share tokens and locale prefixes', () => {
    const shared = `https://open.spotify.com/intl-nl/artist/${ARTIST_ID}?si=abc123&nd=1`
    expect(parseSpotifyArtistUrl(shared).url).toBe(`https://open.spotify.com/artist/${ARTIST_ID}`)
  })

  it('accepts the spotify: URI form people paste from the desktop app', () => {
    expect(parseSpotifyArtistUrl(`spotify:artist:${ARTIST_ID}`).artistId).toBe(ARTIST_ID)
  })

  it('refuses anything that is not an artist page', () => {
    for (const bad of [
      'https://open.spotify.com/album/4Z8W4fKeB5YxbusRsdQVPb',
      'https://open.spotify.com/artist/tooshort',
      'https://example.com/artist/4Z8W4fKeB5YxbusRsdQVPb',
      'https://open.spotify.com.evil.test/artist/4Z8W4fKeB5YxbusRsdQVPb',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(parseSpotifyArtistUrl(bad)).toEqual({ error: 'invalid_spotify_url' })
    }
  })

  it('treats absent as absent, not as an error', () => {
    for (const empty of [undefined, null, '', '   ']) {
      expect(parseSpotifyArtistUrl(empty)).toEqual({ url: null, artistId: null })
    }
  })
})

describe('websiteKey', () => {
  it('is host + path, so one platform can host many bands', () => {
    expect(websiteKey('https://facebook.com/bandA')).toBe('facebook.com/bandA')
    expect(websiteKey('https://facebook.com/bandB')).toBe('facebook.com/bandB')
  })

  it('folds the parts that are genuinely equivalent', () => {
    const canonical = 'myband.example'
    expect(websiteKey('https://www.myband.example/')).toBe(canonical)
    expect(websiteKey('https://MYBAND.EXAMPLE')).toBe(canonical)
    expect(websiteKey('http://myband.example/#gigs')).toBe(canonical)
    expect(websiteKey('https://myband.example/?utm_source=x&fbclid=y')).toBe(canonical)
  })

  // Many servers serve these as different resources; folding them would merge
  // two bands that are not the same band.
  it('preserves path case', () => {
    expect(websiteKey('https://example.com/MyBand')).not.toBe(websiteKey('https://example.com/myband'))
  })

  // Some sites really do put the page identity in the query string.
  it('keeps non-tracking query params, in a stable order', () => {
    expect(websiteKey('https://example.com/page?id=7&utm_medium=mail')).toBe('example.com/page?id=7')
    expect(websiteKey('https://example.com/p?b=2&a=1')).toBe(websiteKey('https://example.com/p?a=1&b=2'))
  })
})

describe('parseWebsiteUrl', () => {
  it('rejects non-web protocols', () => {
    expect(parseWebsiteUrl('javascript:alert(1)')).toEqual({ error: 'invalid_website_url' })
    expect(parseWebsiteUrl('mailto:band@example.com')).toEqual({ error: 'invalid_website_url' })
  })

  it('caps absurd lengths', () => {
    expect(parseWebsiteUrl(`https://example.com/${'a'.repeat(600)}`))
      .toEqual({ error: 'website_url_too_long' })
  })
})

describe('parseBandProfileCreate', () => {
  const valid = { name: 'Off Platform', countryCode: 'NL', websiteUrl: 'https://offplatform.example' }

  it('normalizes the country to the stored lowercase form', () => {
    expect(parseBandProfileCreate(valid).profile.country_code).toBe('nl')
  })

  it('requires at least one link', () => {
    expect(parseBandProfileCreate({ name: 'X', countryCode: 'nl' }))
      .toEqual({ error: 'band_profile_needs_link' })
  })

  it('rejects an unknown country', () => {
    expect(parseBandProfileCreate({ ...valid, countryCode: 'zz' })).toEqual({ error: 'invalid_country' })
    expect(parseBandProfileCreate({ ...valid, countryCode: 'nederland' })).toEqual({ error: 'invalid_country' })
  })

  it('rejects a blank or oversized name', () => {
    expect(parseBandProfileCreate({ ...valid, name: '   ' })).toEqual({ error: 'name_required' })
    expect(parseBandProfileCreate({ ...valid, name: 'a'.repeat(201) })).toEqual({ error: 'name_too_long' })
  })

  it('rejects a malformed contact email', () => {
    expect(parseBandProfileCreate({ ...valid, contactEmail: 'not-an-email' }))
      .toEqual({ error: 'invalid_email' })
  })

  it('leaves an omitted contact email null rather than empty', () => {
    expect(parseBandProfileCreate(valid).profile.contact_email).toBeNull()
  })
})

describe('parseBandProfilePatch', () => {
  it('mentions only the fields the body did', () => {
    expect(parseBandProfilePatch({ name: 'Renamed' })).toEqual({ patch: { name: 'Renamed' } })
  })

  // A stored dedup key without its URL would silently stop matching, and the
  // database pair CHECKs refuse it outright.
  it('drags the derived dedup key along with its URL', () => {
    expect(parseBandProfilePatch({ websiteUrl: 'https://www.new.example/x/' }).patch)
      .toEqual({ website_url: 'https://www.new.example/x/', website_key: 'new.example/x' })

    expect(parseBandProfilePatch({ spotifyUrl: null }).patch)
      .toEqual({ spotify_url: null, spotify_artist_id: null })
  })

  it('distinguishes clearing a field from not mentioning it', () => {
    expect(Object.hasOwn(parseBandProfilePatch({ websiteUrl: null }).patch, 'website_url')).toBe(true)
    expect(Object.hasOwn(parseBandProfilePatch({ name: 'x' }).patch, 'website_url')).toBe(false)
  })

  it('rejects an empty or non-object patch', () => {
    expect(parseBandProfilePatch({})).toEqual({ error: 'no_fields_to_update' })
    expect(parseBandProfilePatch(null)).toEqual({ error: 'invalid_body' })
    expect(parseBandProfilePatch([])).toEqual({ error: 'invalid_body' })
  })

  // The validator cannot see the stored row, so it must NOT reject this on its
  // own — the merged-row check in the service is what catches it.
  it('accepts clearing a link, leaving the rule to the merged-row check', () => {
    expect(parseBandProfilePatch({ websiteUrl: null }).error).toBeUndefined()
    expect(hasLink({ spotify_url: null, website_url: null })).toBe(false)
    expect(hasLink({ spotify_url: 'x', website_url: null })).toBe(true)
  })
})

describe('parseRemovalMode', () => {
  it('defaults to keeping the events', () => {
    expect(parseRemovalMode(undefined)).toEqual({ mode: 'keep' })
  })

  it('accepts only the two known modes', () => {
    expect(parseRemovalMode('delete')).toEqual({ mode: 'delete' })
    expect(parseRemovalMode('purge')).toEqual({ error: 'invalid_mode' })
  })
})
