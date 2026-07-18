import { describe, it, expect } from 'vitest'
import { resolvePage } from '../server/resolve.js'

const content = {
  band: { slug: 'woods', name: 'The Woods', socials: {} },
  songs: [
    {
      id: 1,
      title: 'Good To See You',
      artist: null,
      coverUrl: 'https://gb.example/img?t=abc',
      links: [
        { label: 'Spotify', url: 'https://open.spotify.com/track/x' },
        { label: null, url: 'https://music.apple.com/album/x' },
      ],
    },
    { id: 2, title: 'No Links', artist: null, coverUrl: null, links: [] },
  ],
  products: [{ id: 7, name: 'CD', priceCents: 999 }],
  gigs: [
    { id: 1, date: '2026-08-01', title: 'Festival', venue: 'Vera', city: 'Groningen' },
    { id: 2, date: '2026-08-02', title: 'Club night', venue: null, city: null },
  ],
}

describe('resolvePage', () => {
  it('resolves widgets against the content snapshot', () => {
    const layout = {
      sections: [
        {
          id: 's1',
          title: 'Music',
          widgets: [
            { id: 'w1', type: 'song', songId: 1 },
            { id: 'w2', type: 'gigs', title: null, limit: 1 },
            { id: 'w3', type: 'merch', title: 'CDs', shopUrl: null, items: [{ productId: 7, imageUrl: null, badge: 'NEW' }] },
          ],
        },
      ],
    }
    const page = resolvePage(content, layout)
    expect(page.band.name).toBe('The Woods')
    const widgets = page.sections[0].widgets
    expect(widgets[0]).toMatchObject({ type: 'song', title: 'Good To See You' })
    expect(widgets[1].title).toBe('Upcoming Gigs')
    expect(widgets[1].gigs).toHaveLength(1)
    expect(widgets[2].products[0]).toMatchObject({ name: 'CD', badge: 'NEW' })
  })

  it('drops widgets whose content disappeared, and empty sections', () => {
    const layout = {
      sections: [
        {
          id: 's1',
          title: 'Gone',
          widgets: [
            { id: 'w1', type: 'song', songId: 99 },
            { id: 'w2', type: 'song', songId: 2 },
            { id: 'w3', type: 'merch', title: null, shopUrl: null, items: [{ productId: 404, imageUrl: null, badge: null }] },
          ],
        },
      ],
    }
    const page = resolvePage(content, layout)
    expect(page.sections).toHaveLength(0)
  })

  it('resolves platforms widgets with detected platforms', () => {
    const layout = {
      sections: [{ id: 's', title: null, widgets: [{ id: 'w', type: 'platforms', songId: 1, title: null }] }],
    }
    const page = resolvePage(content, layout)
    const widget = page.sections[0].widgets[0]
    expect(widget.type).toBe('platforms')
    expect(widget.platforms).toEqual([
      { id: 'spotify', label: 'Spotify', url: 'https://open.spotify.com/track/x' },
      { id: 'apple', label: 'Apple Music', url: 'https://music.apple.com/album/x' },
    ])
  })

  it('resolves a release header from the stored snapshot + live cover', () => {
    const layout = { sections: [{ id: 's', title: null, widgets: [{ id: 'w', type: 'platforms', songId: 1, title: null }] }] }
    const page = resolvePage(content, layout, { songId: 1, title: 'Good To See You', artist: null })
    expect(page.release).toEqual({
      title: 'Good To See You',
      artist: 'The Woods',
      coverUrl: 'https://gb.example/img?t=abc',
    })
    // Song deleted in gigbuddy: title survives (snapshot), cover degrades.
    const gone = resolvePage(content, layout, { songId: 99, title: 'Old Single', artist: 'X' })
    expect(gone.release).toEqual({ title: 'Old Single', artist: 'X', coverUrl: null })
    // Main pages carry no release.
    expect(resolvePage(content, layout).release).toBeNull()
  })

  it('survives an empty snapshot', () => {
    const page = resolvePage({}, { sections: [{ id: 's', title: null, widgets: [{ id: 'w', type: 'gigs', limit: 5 }] }] })
    expect(page.sections[0].widgets[0].gigs).toEqual([])
  })
})
