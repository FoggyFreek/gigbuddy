// Link-page integration: content export for the decoupled link-page app (a
// separate repo) and the editor handoff for signed-in members.
import {
  getTenantBySlug,
  getTenantSlug,
  getTenantSlugState,
  listProfileLinks,
  listSongsWithLinks,
  listActiveProducts,
  listAnnouncedUpcomingGigs,
} from './linkpageRepository.js'
import { signPayload, verifyPayload, linkpageConfigured, linkpageEditorUrl } from './linkpageTokens.js'
import { TENANT_CAPABILITIES, tenantKindSupports } from '../../../shared/tenantCapabilities.js'
import { resolveTenantEntitlements } from '../../commerce/billing/entitlementService.js'
import { FEATURES, LIMITS } from '../../auth/entitlements.js'
import { badRequest, notFound, serviceError } from '../../platform/http/serviceErrors.js'
import { hasPendingSlugSync } from './linkpageSlugSyncRepository.js'
import { fetchLinkpagePages, fetchLinkpageStats } from './linkpageStatsClient.js'
import { logger } from '../../utils/logger.js'

const NOT_FOUND = notFound('Not found')
const NOT_CONFIGURED = serviceError(503, 'Link page integration is not configured')
const STATS_UNAVAILABLE = serviceError(502, 'Link page statistics are unavailable', {
  code: 'linkpage_stats_unavailable',
})
const PAGE_NOT_FOUND = notFound('Link page not found', { code: 'linkpage_page_not_found' })

// The windows the dashboard tile offers. A closed set, not a clamp: the link
// page app enforces the plan's rolling window itself, so anything outside this
// list is a client bug and is refused rather than quietly rounded.
export const LINKPAGE_STATS_WINDOWS = [7, 30]

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

// The plan-derived link-page entitlements shipped inside the export so the
// decoupled app can enforce them itself (public serving, release-page cap,
// statistics window). Ownerless legacy tenants skip enforcement everywhere,
// so they get the most permissive values.
async function linkpageEntitlements(db, tenantId) {
  const resolved = await resolveTenantEntitlements(db, tenantId)
  if (resolved === null) {
    return { enabled: true, maxReleasePages: null, statsRetentionDays: 90 }
  }
  const { features, limits } = resolved.entitlements
  const statsDays = limits[LIMITS.LINKPAGE_STATS_DAYS]
  return {
    enabled: features[FEATURES.LINKPAGE] === true,
    maxReleasePages: limits[LIMITS.LINKPAGE_PAGES] ?? 0,
    // The window is 30 or 90 days; unlimited (null) counts as the 90-day max.
    statsRetentionDays: statsDays === null || statsDays >= 90 ? 90 : 30,
  }
}

// Builds the full denormalized content snapshot the linkpage app syncs.
export async function buildExport(db, slug) {
  if (!linkpageConfigured()) return NOT_CONFIGURED
  const tenant = await getTenantBySlug(db, slug)
  // Link pages are a band surface. A personal workspace's slug is treated as
  // unknown here, the same as the editor mount refusing the capability.
  if (!tenant || !tenantKindSupports(tenant.kind, TENANT_CAPABILITIES.BAND_LINKPAGE)) return NOT_FOUND

  const [entitlements, links, songs, products, gigs] = await Promise.all([
    linkpageEntitlements(db, tenant.id),
    listProfileLinks(db, tenant.id),
    listSongsWithLinks(db, tenant.id),
    listActiveProducts(db, tenant.id),
    listAnnouncedUpcomingGigs(db, tenant.id, GIG_LIMIT),
  ])

  return {
    export: {
      entitlements,
      // Wire keys `band` / `name` are the link-page app's external contract and
      // stay put whatever the tenant's kind is — a solo artist's page reads the
      // same shape. Only the source column follows the internal rename.
      band: {
        slug: tenant.slug,
        name: nullable(tenant.display_name),
        // Wire key stays `bio` (the linkpage app reads it under that name); the
        // source is the 150-char short bio, not the long-form profile bio.
        bio: nullable(tenant.short_bio),
        logoUrl: imageUrl(tenant.logo_path),
        logoDarkUrl: imageUrl(tenant.logo_dark_path),
        avatarUrl: imageUrl(tenant.avatar_path),
        bannerUrl: imageUrl(tenant.banner_path),
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
        eventUrl: nullable(g.event_link),
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
  const state = await getTenantSlugState(db, tenantId)
  if (!state) return NOT_FOUND
  const exp = Math.floor(Date.now() / 1000) + HANDOFF_TTL_SECONDS
  const token = signPayload({
    t: 'handoff',
    slug: state.slug,
    slugRevision: Number(state.slug_revision),
    tenantId,
    exp,
  })
  // The token rides in the fragment so it never hits server logs on the way in.
  return { url: `${linkpageEditorUrl()}/edit#gbtoken=${encodeURIComponent(token)}` }
}

// Aggregate link-page statistics for the active tenant's page, read live from
// the decoupled app — nothing is mirrored into this database, so the tile can
// never show a stale copy of numbers the other app owns.
export async function getStats(tenantId, requestedDays, requestedPageId) {
  if (!linkpageConfigured()) return NOT_CONFIGURED
  const days = Number(requestedDays)
  if (!LINKPAGE_STATS_WINDOWS.includes(days)) {
    return badRequest('Unsupported statistics window', { code: 'invalid_window' })
  }
  // Absent means "the tenant's main page"; present must be a real id. The link
  // page app scopes the lookup to this tenant, so a foreign id is simply not
  // found there — nothing here has to trust the number.
  const pageId = requestedPageId === undefined || requestedPageId === null || requestedPageId === ''
    ? null
    : Number(requestedPageId)
  if (pageId !== null && (!Number.isSafeInteger(pageId) || pageId <= 0)) {
    return badRequest('Invalid link page id', { code: 'invalid_page' })
  }

  const result = await fetchLinkpageStats(tenantId, days, { pageId })
  if (!result.ok) {
    logger.warn('linkpage.stats.unavailable', { tenantId, errorCode: result.code })
    // A selection that no longer resolves is the caller's to fix (re-read the
    // page list), not an outage.
    if (result.code === 'page_not_found') return PAGE_NOT_FOUND
    return STATS_UNAVAILABLE
  }
  return result.stats
}

// The tenant's link pages, so the dashboard can offer a picker when there is
// more than one. Identity only — the editor owns everything else.
export async function listPages(tenantId) {
  if (!linkpageConfigured()) return NOT_CONFIGURED

  const result = await fetchLinkpagePages(tenantId)
  if (!result.ok) {
    logger.warn('linkpage.pages.unavailable', { tenantId, errorCode: result.code })
    return STATS_UNAVAILABLE
  }
  return { pages: result.pages }
}

export async function getStatus(db, tenantId) {
  if (!linkpageConfigured()) return { configured: false, publicUrl: null }
  const slug = await getTenantSlug(db, tenantId)
  if (!slug) return NOT_FOUND
  const pending = await hasPendingSlugSync(db, tenantId)
  return {
    configured: true,
    publicUrl: `${linkpageEditorUrl()}/${slug}`,
    linkpageSync: pending ? 'pending' : 'synced',
  }
}
