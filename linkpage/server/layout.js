// Validation + normalization of editor-submitted layouts. A layout is a stack
// of sections, each holding an ordered list of widgets that reference synced
// content by id (songs, products) or carry their own data (links).
//
// Everything client-submitted is whitelisted field-by-field: unknown widget
// types are rejected, unknown fields dropped, strings capped, and URLs
// restricted to http(s).
import crypto from 'node:crypto'

const MAX_SECTIONS = 20
const MAX_WIDGETS_PER_SECTION = 30
const MAX_MERCH_ITEMS = 50
const MAX_TITLE = 120
const MAX_LABEL = 160
const MAX_URL = 2000

export const LINK_ICONS = new Set([
  'globe', 'instagram', 'facebook', 'youtube', 'tiktok', 'spotify', 'calendar', 'music', 'shop',
])

function fail(message) {
  return { error: message }
}

function cleanString(value, max) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export function sanitizeUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_URL) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href
  } catch {
    return null
  }
}

function widgetId(raw) {
  return typeof raw === 'string' && /^[\w-]{1,40}$/.test(raw) ? raw : crypto.randomUUID()
}

function parseWidget(raw) {
  if (!raw || typeof raw !== 'object') return fail('Invalid widget')
  const id = widgetId(raw.id)
  switch (raw.type) {
    case 'song': {
      const songId = Number(raw.songId)
      if (!Number.isInteger(songId) || songId <= 0) return fail('Song widget needs a songId')
      return { widget: { id, type: 'song', songId } }
    }
    // One button per streaming platform for a song's links — the core widget
    // of a release landing page, but usable on any page.
    case 'platforms': {
      const songId = Number(raw.songId)
      if (!Number.isInteger(songId) || songId <= 0) return fail('Platforms widget needs a songId')
      return { widget: { id, type: 'platforms', songId, title: cleanString(raw.title, MAX_TITLE) } }
    }
    case 'gigs': {
      const limit = Number.isInteger(Number(raw.limit)) && Number(raw.limit) > 0
        ? Math.min(Number(raw.limit), 50)
        : 10
      return { widget: { id, type: 'gigs', title: cleanString(raw.title, MAX_TITLE), limit } }
    }
    case 'merch': {
      if (!Array.isArray(raw.items) || raw.items.length === 0) {
        return fail('Merch widget needs at least one item')
      }
      if (raw.items.length > MAX_MERCH_ITEMS) return fail('Too many merch items')
      const items = []
      for (const item of raw.items) {
        const productId = Number(item?.productId)
        if (!Number.isInteger(productId) || productId <= 0) return fail('Merch item needs a productId')
        items.push({
          productId,
          imageUrl: item.imageUrl ? sanitizeUrl(item.imageUrl) : null,
          badge: cleanString(item.badge, 20),
        })
      }
      // Products carry no URL of their own in gigbuddy; an optional widget-level
      // shop URL (e.g. the band's Shopify store) makes the cards clickable.
      const shopUrl = raw.shopUrl ? sanitizeUrl(raw.shopUrl) : null
      return { widget: { id, type: 'merch', title: cleanString(raw.title, MAX_TITLE), shopUrl, items } }
    }
    // Rich embed card for a pasted URL: metadata (title/image/description) is
    // snapshotted from the editor's unfurl; the player descriptor itself is
    // recomputed server-side at resolve time — never stored from the client.
    case 'embed': {
      const url = sanitizeUrl(raw.url)
      if (!url) return fail('Embed widget needs a valid http(s) URL')
      return {
        widget: {
          id,
          type: 'embed',
          url,
          title: cleanString(raw.title, MAX_LABEL),
          description: cleanString(raw.description, 300),
          imageUrl: raw.imageUrl ? sanitizeUrl(raw.imageUrl) : null,
        },
      }
    }
    case 'link': {
      const label = cleanString(raw.label, MAX_LABEL)
      const url = sanitizeUrl(raw.url)
      if (!label) return fail('Link widget needs a label')
      if (!url) return fail('Link widget needs a valid http(s) URL')
      const icon = LINK_ICONS.has(raw.icon) ? raw.icon : 'globe'
      const sublabel = cleanString(raw.sublabel, MAX_LABEL)
      const imageUrl = raw.imageUrl ? sanitizeUrl(raw.imageUrl) : null
      return { widget: { id, type: 'link', label, sublabel, url, icon, imageUrl } }
    }
    default:
      return fail('Unknown widget type')
  }
}

// Returns { layout } (normalized, safe to store) or { error }.
export function validateLayout(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sections)) {
    return fail('Layout must have a sections array')
  }
  if (raw.sections.length > MAX_SECTIONS) return fail('Too many sections')
  const sections = []
  for (const rawSection of raw.sections) {
    if (!rawSection || typeof rawSection !== 'object' || !Array.isArray(rawSection.widgets)) {
      return fail('Invalid section')
    }
    if (rawSection.widgets.length > MAX_WIDGETS_PER_SECTION) return fail('Too many widgets in a section')
    const widgets = []
    for (const rawWidget of rawSection.widgets) {
      const parsed = parseWidget(rawWidget)
      if (parsed.error) return parsed
      widgets.push(parsed.widget)
    }
    sections.push({ id: widgetId(rawSection.id), title: cleanString(rawSection.title, MAX_TITLE), widgets })
  }
  return { layout: { sections } }
}
