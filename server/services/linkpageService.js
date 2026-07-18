// Link-page integration: content export for the decoupled linkpage app and
// the editor handoff for signed-in members. See linkpage/README.md for the
// full integration contract (the linkpage app is the only consumer).
import {
  getTenantBySlug,
  getTenantSlug,
  listProfileLinks,
  listSongsWithLinks,
  listActiveProducts,
  listAnnouncedUpcomingGigs,
} from '../repositories/linkpageRepository.js'
import { signPayload, verifyPayload, linkpageConfigured, linkpageEditorUrl } from '../security/linkpageTokens.js'
import { notFound, serviceError } from './serviceErrors.js'

const NOT_FOUND = notFound('Not found')
const NOT_CONFIGURED = serviceError(503, 'Link page integration is not configured')

const GIG_LIMIT = 50
// Image tokens live inside the exported content snapshot; the linkpage app
// re-syncs far more often than this, so a generous TTL just has to outlast a
// stale snapshot, not act as a tight credential.
const IMAGE_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
const HANDOFF_TTL_SECONDS = 10 * 60

// Public URL for a stored image, routed through the signed public image
// endpoint. APP_URL is the app's public origin (also used for Mollie webhooks).
function imageUrl(objectKey) {
  if (!objectKey) return null
  const exp = Math.floor(Date.now() / 1000) + IMAGE_TOKEN_TTL_SECONDS
  const token = signPayload({ t: 'img', k: objectKey, exp })
  const base = (process.env.APP_URL || '').replace(/\/$/, '')
  return `${base}/api/public/linkpage/image?t=${encodeURIComponent(token)}`
}

const nullable = (v) => v || null

// Builds the full denormalized content snapshot the linkpage app syncs.
export async function buildExport(db, slug) {
  if (!linkpageConfigured()) return NOT_CONFIGURED
  const tenant = await getTenantBySlug(db, slug)
  if (!tenant) return NOT_FOUND

  const [links, songs, products, gigs] = await Promise.all([
    listProfileLinks(db, tenant.id),
    listSongsWithLinks(db, tenant.id),
    listActiveProducts(db, tenant.id),
    listAnnouncedUpcomingGigs(db, tenant.id, GIG_LIMIT),
  ])

  return {
    export: {
      band: {
        slug: tenant.slug,
        name: nullable(tenant.band_name),
        bio: nullable(tenant.bio),
        logoUrl: imageUrl(tenant.logo_path),
        socials: {
          instagram: nullable(tenant.instagram_handle),
          facebook: nullable(tenant.facebook_handle),
          tiktok: nullable(tenant.tiktok_handle),
          youtube: nullable(tenant.youtube_handle),
          spotify: nullable(tenant.spotify_handle),
        },
      },
      links: links.map((l) => ({ id: l.id, label: l.label, url: l.url })),
      songs: songs.map((s) => ({
        id: s.id,
        title: s.title,
        artist: nullable(s.artist),
        coverUrl: imageUrl(s.cover_image_path),
        links: s.links,
      })),
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        priceCents: p.default_price_incl_cents,
      })),
      gigs: gigs.map((g) => ({
        id: g.id,
        date: g.event_date instanceof Date ? g.event_date.toISOString().slice(0, 10) : g.event_date,
        startTime: nullable(g.start_time),
        title: g.event_description,
        venue: nullable(g.venue),
        city: nullable(g.city),
      })),
    },
  }
}

// Verifies a public image token and returns its object key. The key pattern
// check is defense in depth: tokens are only ever minted for tenant-owned
// image paths, but a valid signature must still never stream anything else.
export function resolveImageToken(token) {
  const payload = verifyPayload(token)
  if (!payload || payload.t !== 'img' || typeof payload.k !== 'string') return NOT_FOUND
  if (!/^tenants\/\d+\//.test(payload.k)) return NOT_FOUND
  return { objectKey: payload.k }
}

// Mints the short-lived token that lets a signed-in member open the linkpage
// editor for the active tenant, and the URL to send the browser to.
export async function createHandoff(db, tenantId) {
  if (!linkpageConfigured()) return NOT_CONFIGURED
  const slug = await getTenantSlug(db, tenantId)
  if (!slug) return NOT_FOUND
  const exp = Math.floor(Date.now() / 1000) + HANDOFF_TTL_SECONDS
  const token = signPayload({ t: 'handoff', slug, tenantId, exp })
  // The token rides in the fragment so it never hits server logs on the way in.
  return { url: `${linkpageEditorUrl()}/edit#gbtoken=${encodeURIComponent(token)}` }
}

export async function getStatus(db, tenantId) {
  if (!linkpageConfigured()) return { configured: false, publicUrl: null }
  const slug = await getTenantSlug(db, tenantId)
  if (!slug) return NOT_FOUND
  return { configured: true, publicUrl: `${linkpageEditorUrl()}/${slug}` }
}
