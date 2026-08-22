import { describe, expect, it } from 'vitest'
import { extractTokens, findUnresolvable, mergeBlocks, mergeTokens } from '../../../../shared/outreachMerge.js'
import { fieldsForTemplate } from '../../../../shared/outreachFields.js'
import { formatOutreachValue } from '../../../../server/promotion/outreach/fields/formatters.js'
import { resolveOutreachRawValues } from '../../../../server/promotion/outreach/fields/resolvers.js'

describe('outreach merge pipeline', () => {
  it('escapes scalar HTML without escaping trusted block fragments', () => {
    const html = '<p>{{venue.name}}</p>{{#venue.address}}'
    const scalars = mergeTokens(html, { 'venue.name': 'Bar & Grill <Rotterdam>' }, { escape: true })
    expect(mergeBlocks(scalars, { 'venue.address': '<p>Coolsingel 1</p>' }))
      .toBe('<p>Bar &amp; Grill &lt;Rotterdam&gt;</p><p>Coolsingel 1</p>')
  })

  it('extracts unique inline and block tokens and reports missing values', () => {
    const tokens = extractTokens('{{band.name}} {{band.name}} {{#band.address}}')
    expect(tokens).toEqual(['band.name', '#band.address'])
    expect(findUnresolvable(tokens, { 'band.name': 'Example' })).toEqual(['#band.address'])
  })

  it('resolves a current social handle inside an image link', () => {
    expect(mergeTokens(
      '<a href="https://instagram.com/{{band.instagram_handle}}">Instagram</a>',
      { 'band.instagram_handle': 'current-handle' },
    )).toBe('<a href="https://instagram.com/current-handle">Instagram</a>')
  })

  it('formats locale-sensitive money and dates', () => {
    expect(formatOutreachValue(125000, 'money', { locale: 'nl', currency: 'EUR' })).toContain('1.250,00')
    expect(formatOutreachValue('2027-03-14', 'date', { locale: 'en' })).toContain('14 March 2027')
  })

  it('drives the venue-email picker from the catalogue', () => {
    const keys = fieldsForTemplate().map((entry) => entry.key)
    expect(keys).toContain('band.name')
    expect(keys).toContain('venue.name')
    expect(keys).not.toContain('gig.date')
  })

  it('exposes and resolves the tenant profile fields for venue templates', () => {
    const profileFields = [
      'band.short_bio',
      'band.spotify_handle',
      'band.youtube_handle',
      'band.tiktok_handle',
      'band.instagram_handle',
      'band.facebook_handle',
      'band.bandsintown_artist_id',
    ]
    const keys = fieldsForTemplate().map((entry) => entry.key)
    expect(keys).toEqual(expect.arrayContaining(profileFields))
    expect(keys).not.toContain('band.spotify')
    expect(keys).not.toContain('band.website')

    const raw = resolveOutreachRawValues({ tenant: {
      short_bio: 'Short profile',
      spotify_handle: 'spotify-id',
      youtube_handle: '@video',
      tiktok_handle: '@shorts',
      instagram_handle: '@photos',
      facebook_handle: 'example-band',
      bandsintown_artist_id: '15556138',
    } })
    expect(raw).toMatchObject({
      'band.short_bio': 'Short profile',
      'band.spotify_handle': 'spotify-id',
      'band.youtube_handle': '@video',
      'band.tiktok_handle': '@shorts',
      'band.instagram_handle': '@photos',
      'band.facebook_handle': 'example-band',
      'band.bandsintown_artist_id': '15556138',
    })
    expect(raw).not.toHaveProperty('band.spotify')
    expect(raw).not.toHaveProperty('band.website')
  })
})
