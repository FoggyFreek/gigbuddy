// Resolves a stored layout against the synced content snapshot into the
// payload the public page renders. Widgets referencing content that has since
// disappeared (deleted song, archived product) are dropped silently — the
// public page must never break because gigbuddy content moved on.
import { detectPlatform } from './platforms.js'

function resolveWidget(widget, content) {
  switch (widget.type) {
    case 'song': {
      const song = (content.songs || []).find((s) => s.id === widget.songId)
      if (!song || !song.links?.length) return null
      return {
        id: widget.id,
        type: 'song',
        title: song.title,
        artist: song.artist,
        coverUrl: song.coverUrl,
        links: song.links,
      }
    }
    case 'platforms': {
      const song = (content.songs || []).find((s) => s.id === widget.songId)
      if (!song || !song.links?.length) return null
      return {
        id: widget.id,
        type: 'platforms',
        title: widget.title,
        platforms: song.links.map((link) => {
          const platform = detectPlatform(link.url, link.label)
          return { ...platform, url: link.url }
        }),
      }
    }
    case 'gigs': {
      const gigs = (content.gigs || []).slice(0, widget.limit || 10)
      return {
        id: widget.id,
        type: 'gigs',
        title: widget.title || 'Upcoming Gigs',
        gigs,
      }
    }
    case 'merch': {
      const products = []
      for (const item of widget.items) {
        const product = (content.products || []).find((p) => p.id === item.productId)
        if (!product) continue
        products.push({
          id: product.id,
          name: product.name,
          priceCents: product.priceCents,
          imageUrl: item.imageUrl,
          badge: item.badge,
        })
      }
      if (!products.length) return null
      return { id: widget.id, type: 'merch', title: widget.title, shopUrl: widget.shopUrl || null, products }
    }
    case 'link':
      return { ...widget }
    default:
      return null
  }
}

// `release` is the page's stored release snapshot ({songId, title, artist})
// for release landing pages; null for the main page. The cover comes from the
// live content snapshot when the song still exists (fresh signed image URL).
export function resolvePage(content, layout, release = null) {
  const sections = (layout?.sections || [])
    .map((section) => ({
      id: section.id,
      title: section.title,
      widgets: section.widgets.map((w) => resolveWidget(w, content)).filter(Boolean),
    }))
    .filter((section) => section.widgets.length > 0)
  let resolvedRelease = null
  if (release) {
    const song = (content.songs || []).find((s) => s.id === release.songId)
    resolvedRelease = {
      title: release.title,
      artist: release.artist || content.band?.name || null,
      coverUrl: song?.coverUrl || null,
    }
  }
  return {
    band: content.band || null,
    release: resolvedRelease,
    sections,
  }
}
