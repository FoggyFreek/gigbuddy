// The linkpage HTTP app: public page API + view/click beacons, and the
// token-authenticated editor API (main link page + release landing pages).
// Exported as a factory so tests can build it against a test pool without
// binding a port.
import express from 'express'
import crypto from 'node:crypto'
import { signPayload, verifyPayload } from './tokens.js'
import { fetchExport } from './gigbuddy.js'
import {
  upsertMainPage,
  getPageBySlug,
  getPageForTenant,
  listPagesForTenant,
  insertReleasePage,
  deleteReleasePage,
  saveDraftLayout,
  publishDraft,
  saveContent,
} from './pagesRepo.js'
import { insertView, insertClick, aggregateStats } from './statsRepo.js'
import { classifyDevice, classifySource, resolveCountry, visitorHash } from './classify.js'
import { validateLayout } from './layout.js'
import { resolvePage } from './resolve.js'
import { sanitizeClickTarget } from './platforms.js'
import { pageEntitlements } from './entitlements.js'
import { fetchLinkMetadata } from './unfurl.js'
import { createConcurrencyGate } from './concurrencyGate.js'

// Bound concurrent editor unfurls: at most a few in flight globally and a
// couple per tenant, so the endpoint's remote fetches can't fan out into
// memory/socket pressure even though each is already byte- and time-capped.
const UNFURL_MAX_GLOBAL = 6
const UNFURL_MAX_PER_TENANT = 2

const SESSION_TTL_SECONDS = 12 * 60 * 60

// URL/namespace design: a band's main page lives at /<mainSlug> (the band's
// GigBuddy slug); each release page lives one segment deeper at
// /<mainSlug>/<releaseTail>. A main slug can never contain '/', so the stored
// slugs 'foo' (main) and 'foo/bar' (release) occupy separate namespaces and
// can NEVER collide — a release page can no longer shadow, or be mistaken for,
// another band's main page. Both are validated segment-by-segment.
export const MAIN_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/
export const RELEASE_TAIL_RE = /^[a-z0-9][a-z0-9-]{0,60}$/

// Builds the stored slug from 1 (main) or 2 (release) public path segments,
// each validated. Returns null for anything that isn't a well-formed page path.
export function slugFromSegments(segments) {
  const parts = (Array.isArray(segments) ? segments : [segments])
    .filter((s) => typeof s === 'string' && s.length > 0)
    .map((s) => s.toLowerCase())
  if (parts.length === 1 && MAIN_SLUG_RE.test(parts[0])) return parts[0]
  if (parts.length === 2 && MAIN_SLUG_RE.test(parts[0]) && RELEASE_TAIL_RE.test(parts[1])) {
    return `${parts[0]}/${parts[1]}`
  }
  return null
}

// The band's main slug for any stored page: a release slug is '<main>/<tail>',
// so its main slug is the first segment.
export function mainSlugOf(page) {
  return page.page_type === 'main' ? page.slug : page.slug.split('/')[0]
}

function contentTtlMs() {
  const minutes = Number(process.env.LINKPAGE_CONTENT_TTL_MINUTES)
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60 * 1000
}

function statsEnabled() {
  return process.env.STATS_DISABLED !== '1'
}

export function createApp(pool) {
  const app = express()
  app.set('trust proxy', true)
  app.use(express.json({ limit: '256kb' }))

  // Content exports are fetched per band (by the band's main slug) and stored
  // per page, so release pages resolve against the same fresh snapshot.
  async function syncContent(page, mainSlug) {
    const result = await fetchExport(mainSlug)
    if (result.notFound) return page
    await saveContent(pool, page.id, result.content)
    return { ...page, content: result.content, content_synced_at: new Date() }
  }

  function maybeRefreshContent(page) {
    const syncedAt = page.content_synced_at ? new Date(page.content_synced_at).getTime() : 0
    if (Date.now() - syncedAt < contentTtlMs()) return
    syncContent(page, mainSlugOf(page)).catch((err) => {
      console.error(`content refresh failed for ${page.slug}:`, err.message)
    })
  }

  // Shared beacon dimension derivation — the ONLY place raw request data is
  // touched; everything stored is coarse and anonymous (PRIVACY.md).
  function beaconDimensions(req) {
    const ua = req.get('user-agent') || ''
    const device = classifyDevice(ua)
    return {
      device,
      source: classifySource(
        typeof req.body?.referrer === 'string' ? req.body.referrer : req.get('referer'),
        typeof req.body?.utmSource === 'string' ? req.body.utmSource : null,
        req.hostname || null,
      ),
      country: resolveCountry((name) => req.get(name)),
      visitorHash: visitorHash(req.ip, ua, process.env.GIGBUDDY_SYNC_SECRET),
    }
  }

  // Slug from the public path's 1 or 2 segments (main / release).
  function publicSlug(req) {
    return slugFromSegments([req.params.s1, req.params.s2])
  }

  async function publishedPageForBeacon(req) {
    if (!statsEnabled()) return null
    const slug = publicSlug(req)
    if (!slug) return null
    const page = await getPageBySlug(pool, slug)
    if (!page || !page.published_layout) return null
    if (!pageEntitlements(page.content).enabled) return null
    return page
  }

  // ---------- public ----------
  //
  // Public routes accept one path segment (main page, /<slug>) or two (release
  // page, /<mainSlug>/<tail>); each action is registered for both arities.

  // Resolved published page. No cookies are set anywhere on the public
  // surface — the privacy stance depends on it.
  async function handleGetPage(req, res, next) {
    try {
      const slug = publicSlug(req)
      if (!slug) return res.status(404).json({ error: 'Not found' })
      const page = await getPageBySlug(pool, slug)
      if (!page || !page.published_layout) return res.status(404).json({ error: 'Not found' })
      maybeRefreshContent(page)
      // A lapsed plan (content sync reported the linkpage feature off) takes
      // the page offline — same 404 as an unpublished page.
      if (!pageEntitlements(page.content).enabled) return res.status(404).json({ error: 'Not found' })
      res.set('Cache-Control', 'public, max-age=60')
      res.json(resolvePage(page.content, page.published_layout, page.release))
    } catch (err) {
      next(err)
    }
  }
  app.get('/api/pages/:s1', handleGetPage)
  app.get('/api/pages/:s1/:s2', handleGetPage)

  // View beacon, fired once per public page load.
  async function handleView(req, res, next) {
    try {
      const page = await publishedPageForBeacon(req)
      if (page) {
        const dims = beaconDimensions(req)
        if (dims.device !== 'bot') await insertView(pool, page.id, dims)
      }
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  }
  app.post('/api/pages/:s1/view', handleView)
  app.post('/api/pages/:s1/:s2/view', handleView)

  // Outbound click beacon (conversion statistics): which platform button or
  // widget was clicked, in the same anonymous dimensions as views.
  async function handleClick(req, res, next) {
    try {
      const page = await publishedPageForBeacon(req)
      const target = sanitizeClickTarget(req.body?.target)
      if (page && target) {
        const dims = beaconDimensions(req)
        if (dims.device !== 'bot') await insertClick(pool, page.id, { target, ...dims })
      }
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  }
  app.post('/api/pages/:s1/click', handleClick)
  app.post('/api/pages/:s1/:s2/click', handleClick)

  // ---------- editor ----------

  function editorPagePayload(page) {
    return {
      id: page.id,
      slug: page.slug,
      pageType: page.page_type,
      release: page.release,
      draftLayout: page.draft_layout,
      publishedAt: page.published_at,
      contentSyncedAt: page.content_synced_at,
      content: page.content,
      publicUrl: `${(process.env.LINKPAGE_PUBLIC_URL || '').replace(/\/$/, '')}/${page.slug}`,
    }
  }

  function pageListPayload(pages) {
    return pages.map((p) => ({
      id: p.id,
      slug: p.slug,
      pageType: p.page_type,
      release: p.release,
      publishedAt: p.published_at,
    }))
  }

  // Exchange a gigbuddy handoff token for an editor session bound to the
  // band (tenant), covering the main page and all its release pages.
  app.post('/api/editor/session', async (req, res, next) => {
    try {
      const handoff = verifyPayload(req.body?.token)
      if (
        !handoff ||
        handoff.t !== 'handoff' ||
        typeof handoff.slug !== 'string' ||
        !MAIN_SLUG_RE.test(handoff.slug) ||
        !Number.isInteger(handoff.tenantId)
      ) {
        return res.status(401).json({ error: 'Invalid or expired editor link — reopen it from GigBuddy' })
      }
      let page = await upsertMainPage(pool, handoff.slug, handoff.tenantId)
      // null → the slug is already held by another tenant or a release page
      // (the global slug namespace is shared). Refuse rather than open a
      // session onto a foreign/corrupted row.
      if (!page) {
        return res.status(409).json({
          error: 'This link-page address is already in use — contact support to resolve it',
          code: 'slug_conflict',
        })
      }
      try {
        page = await syncContent(page, handoff.slug)
      } catch (err) {
        console.error(`content sync failed for ${page.slug}:`, err.message)
        return res.status(502).json({ error: 'Could not load content from GigBuddy — try again' })
      }
      const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
      const session = signPayload({
        t: 'session',
        tenantId: handoff.tenantId,
        mainSlug: handoff.slug,
        exp,
        n: crypto.randomUUID(),
      })
      const pages = await listPagesForTenant(pool, handoff.tenantId)
      res.json({ session, pages: pageListPayload(pages), page: editorPagePayload(page) })
    } catch (err) {
      next(err)
    }
  })

  const requireSession = (req, res, next) => {
    const header = req.get('authorization') || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    const session = verifyPayload(token)
    if (!session || session.t !== 'session' || !Number.isInteger(session.tenantId)) {
      return res.status(401).json({ error: 'Session expired — reopen the editor from GigBuddy' })
    }
    req.editorSession = session
    next()
  }

  // Loads req.page for :pageId, scoped to the session's tenant: a foreign
  // page id 404s, existence must not leak.
  const loadPage = async (req, res, next) => {
    try {
      const pageId = Number(req.params.pageId)
      if (!Number.isInteger(pageId) || pageId <= 0) return res.status(404).json({ error: 'Not found' })
      const page = await getPageForTenant(pool, pageId, req.editorSession.tenantId)
      if (!page) return res.status(404).json({ error: 'Not found' })
      req.page = page
      next()
    } catch (err) {
      next(err)
    }
  }

  // Link enrichment for the editor: oEmbed / Open Graph metadata (title,
  // artwork, description) plus the embed descriptor for a pasted URL. Rate-
  // limited by in-flight concurrency (global + per tenant) → 429 when saturated.
  const unfurlGate = createConcurrencyGate({ max: UNFURL_MAX_GLOBAL, maxPerKey: UNFURL_MAX_PER_TENANT })
  app.post('/api/editor/unfurl', requireSession, async (req, res) => {
    const key = req.editorSession.tenantId
    if (!unfurlGate.tryAcquire(key)) {
      return res.status(429).json({ error: 'Too many link lookups at once — try again in a moment' })
    }
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
    try {
      res.json(await fetchLinkMetadata(url))
    } catch {
      res.status(422).json({ error: 'Could not read that link — check the URL' })
    } finally {
      unfurlGate.release(key)
    }
  })

  app.get('/api/editor/pages', requireSession, async (req, res, next) => {
    try {
      const pages = await listPagesForTenant(pool, req.editorSession.tenantId)
      res.json({ pages: pageListPayload(pages) })
    } catch (err) {
      next(err)
    }
  })

  // Create a release landing page for a song at /<mainSlug>/<tail>: the slug is
  // namespaced under the band's main slug (so it can never collide with any
  // band's main page), the layout starts with a platforms widget, and the
  // content snapshot is inherited so the page previews instantly.
  app.post('/api/editor/pages', requireSession, async (req, res, next) => {
    try {
      const { tenantId, mainSlug } = req.editorSession
      const main = await getPageBySlug(pool, mainSlug)
      if (!main || main.gigbuddy_tenant_id !== tenantId) {
        return res.status(401).json({ error: 'Session expired — reopen the editor from GigBuddy' })
      }
      const songId = Number(req.body?.songId)
      const song = (main.content?.songs || []).find((s) => s.id === songId)
      if (!song) return res.status(400).json({ error: 'Pick a song that has streaming links' })

      // Plan cap on smart link pages (silver 3, gold 30; the main page is free).
      const { maxReleasePages } = pageEntitlements(main.content)
      if (maxReleasePages !== null) {
        const existing = await listPagesForTenant(pool, tenantId)
        const releaseCount = existing.filter((p) => p.page_type === 'release').length
        if (releaseCount >= maxReleasePages) {
          return res.status(403).json({
            error: `Your plan allows up to ${maxReleasePages} release pages — delete one or upgrade in GigBuddy`,
            code: 'limit_reached',
          })
        }
      }

      // The release path is '<mainSlug>/<tail>'. Accept either the full path or
      // a bare tail from the client; the stored slug is always the full path.
      const raw = String(req.body?.slug || '').toLowerCase()
      const prefix = `${mainSlug}/`
      const tail = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
      if (!RELEASE_TAIL_RE.test(tail)) {
        return res.status(400).json({ error: `Address must be "${mainSlug}/<name>"` })
      }
      const slug = `${mainSlug}/${tail}`

      const release = { songId: song.id, title: song.title, artist: song.artist }
      const layout = {
        sections: [
          {
            id: crypto.randomUUID(),
            title: null,
            widgets: [{ id: crypto.randomUUID(), type: 'platforms', songId: song.id, title: null }],
          },
        ],
      }
      const page = await insertReleasePage(pool, slug, tenantId, release, layout, main.content)
      if (!page) return res.status(409).json({ error: 'That slug is already taken' })
      res.status(201).json({ page: editorPagePayload(page) })
    } catch (err) {
      next(err)
    }
  })

  app.get('/api/editor/pages/:pageId', requireSession, loadPage, (req, res) => {
    res.json(editorPagePayload(req.page))
  })

  app.delete('/api/editor/pages/:pageId', requireSession, loadPage, async (req, res, next) => {
    try {
      const deleted = await deleteReleasePage(pool, req.page.id, req.editorSession.tenantId)
      if (!deleted) return res.status(400).json({ error: 'The main page cannot be deleted' })
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  })

  app.put('/api/editor/pages/:pageId/draft', requireSession, loadPage, async (req, res, next) => {
    try {
      const result = validateLayout(req.body?.layout)
      if (result.error) return res.status(400).json({ error: result.error })
      await saveDraftLayout(pool, req.page.id, result.layout)
      res.json({ draftLayout: result.layout })
    } catch (err) {
      next(err)
    }
  })

  // Preview-as-visitor: the draft resolved exactly like the public endpoint
  // resolves the published layout.
  app.get('/api/editor/pages/:pageId/preview', requireSession, loadPage, (req, res) => {
    res.json(resolvePage(req.page.content, req.page.draft_layout, req.page.release))
  })

  app.post('/api/editor/pages/:pageId/publish', requireSession, loadPage, async (req, res, next) => {
    try {
      const page = await publishDraft(pool, req.page.id)
      res.json({ publishedAt: page.published_at })
    } catch (err) {
      next(err)
    }
  })

  app.post('/api/editor/pages/:pageId/refresh-content', requireSession, loadPage, async (req, res, next) => {
    try {
      const page = await syncContent(req.page, req.editorSession.mainSlug)
      res.json(editorPagePayload(page))
    } catch (err) {
      next(err)
    }
  })

  app.get('/api/editor/pages/:pageId/stats', requireSession, loadPage, async (req, res, next) => {
    try {
      // The plan's rolling window (30 or 90 days) caps how far back stats go.
      const retentionDays = pageEntitlements(req.page.content).statsRetentionDays
      const days = Math.min(Math.max(Number(req.query.days) || 30, 1), retentionDays)
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      const stats = await aggregateStats(pool, req.page.id, since)
      res.json({ days, retentionDays, enabled: statsEnabled(), ...stats })
    } catch (err) {
      next(err)
    }
  })

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err)
    res.status(500).json({ error: 'Internal error' })
  })

  return app
}
