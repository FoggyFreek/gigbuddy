import { describe, it, expect } from 'vitest'
import { validateLayout, sanitizeUrl } from '../server/layout.js'

const song = (songId) => ({ type: 'song', songId })

describe('sanitizeUrl', () => {
  it('accepts http(s) and rejects other schemes', () => {
    expect(sanitizeUrl('https://example.com/x')).toBe('https://example.com/x')
    expect(sanitizeUrl('http://example.com')).toBe('http://example.com/')
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeUrl('data:text/html,hi')).toBeNull()
    expect(sanitizeUrl('not a url')).toBeNull()
  })
})

describe('validateLayout', () => {
  it('normalizes a full valid layout and assigns ids', () => {
    const result = validateLayout({
      sections: [
        {
          title: '  Listen to our music  ',
          widgets: [
            song(3),
            { type: 'gigs', title: 'Upcoming Gigs', limit: 5 },
            {
              type: 'merch',
              title: 'CDs',
              shopUrl: 'https://shop.example.com',
              items: [{ productId: 9, imageUrl: 'https://cdn.example.com/a.jpg', badge: 'NEW' }],
            },
            { type: 'link', label: 'Our website', url: 'https://band.example.com', icon: 'globe' },
          ],
        },
      ],
    })
    expect(result.error).toBeUndefined()
    const [section] = result.layout.sections
    expect(section.title).toBe('Listen to our music')
    expect(section.id).toBeTruthy()
    expect(section.widgets).toHaveLength(4)
    expect(section.widgets[0]).toMatchObject({ type: 'song', songId: 3 })
    expect(section.widgets[2].shopUrl).toBe('https://shop.example.com/')
    expect(section.widgets[3].icon).toBe('globe')
    for (const widget of section.widgets) expect(widget.id).toBeTruthy()
  })

  it('rejects unknown widget types and malformed shapes', () => {
    expect(validateLayout(null).error).toBeTruthy()
    expect(validateLayout({}).error).toBeTruthy()
    expect(validateLayout({ sections: [{ widgets: [{ type: 'iframe', url: 'https://x' }] }] }).error).toBeTruthy()
    expect(validateLayout({ sections: [{ widgets: [song(0)] }] }).error).toBeTruthy()
  })

  it('rejects link widgets with unsafe urls', () => {
    const result = validateLayout({
      sections: [{ widgets: [{ type: 'link', label: 'x', url: 'javascript:alert(1)' }] }],
    })
    expect(result.error).toMatch(/valid http/)
  })

  it('drops unknown fields instead of storing them', () => {
    const result = validateLayout({
      sections: [{ widgets: [{ ...song(1), onclick: 'evil()' }], evil: true }],
    })
    expect(result.layout.sections[0].widgets[0].onclick).toBeUndefined()
    expect(result.layout.sections[0].evil).toBeUndefined()
  })

  it('enforces collection caps', () => {
    const sections = Array.from({ length: 21 }, () => ({ widgets: [] }))
    expect(validateLayout({ sections }).error).toMatch(/Too many sections/)
  })

  it('coerces gig limits into range and defaults bad icons', () => {
    const result = validateLayout({
      sections: [
        {
          widgets: [
            { type: 'gigs', limit: 9999 },
            { type: 'link', label: 'x', url: 'https://x.example', icon: 'marquee' },
          ],
        },
      ],
    })
    expect(result.layout.sections[0].widgets[0].limit).toBe(50)
    expect(result.layout.sections[0].widgets[1].icon).toBe('globe')
  })
})
