// The linkpage HTTP app: public page API + view beacon, and the
// token-authenticated editor API. Exported as a factory so tests can build it
// against a test pool without binding a port.
import express from 'express'
import crypto from 'node:crypto'
import { signPayload, verifyPayload } from './tokens.js'
import { fetchExport } from './gigbuddy.js'
import {
  upsertPage,
  getPageBySlug,
  saveDraftLayout,
  publishDraft,
  saveContent,
} from './pagesRepo.js'
import { insertView, aggregateStats } from './statsRepo.js'
import { classifyDevice, classifySource, resolveCountry, visitorHash } from './classify.js'
import { validateLayout } from './layout.js'
import { resolvePage } from './resolve.js'

const SESSION_TTL_SECONDS = 12 * 60 * 60
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/

function contentTtlMs() {
  const minutes = Number(process.env.LINKPAGE_CONTENT_TTL_MINUTES)
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60 * 1000
}

function statsEnabled() {
  return process.env.STATS_DISABLED !== '1'
}

// Refresh the page's content snapshot from gigbuddy when it's older than the
// TTL. Fire-and-forget from public reads (stale content is served instantly);
// awaited from editor entry so the editor always sees fresh content.
async function syncContent(pool, page) {
  const result = await fetchExport(page.slug)
  if (result.notFound) return page
  await saveContent(pool, page.id, result.content)
  return { ...page, content: result.content, content_synced_at: new Date() }
}

function maybeRefreshContent(pool, page) {
  const syncedAt = page.content_synced_at ? new Date(page.content_synced_at).getTime() : 0
  if (Date.now() - syncedAt < contentTtlMs()) return
  syncContent(pool, page).catch((err) => {
    console.error(`content refresh failed for ${page.slug}:`, err.message)
  })
}

export function createApp(pool) {
  const app = express()
  app.set('trust proxy', true)
  app.use(express.json({ limit: '256kb' }))

  // ---------- public ----------

  // Resolved published page for one band. No cookies are set anywhere on the
  // public surface — the privacy stance depends on it (see PRIVACY.md).
  app.get('/api/pages/:slug', async (req, res, next) => {
    try {
      const slug = String(req.params.slug || '').toLowerCase()
      if (!SLUG_RE.test(slug)) return res.status(404).json({ error: 'Not found' })
      const page = await getPageBySlug(pool, slug)
      if (!page || !page.published_layout) return res.status(404).json({ error: 'Not found' })
      maybeRefreshContent(pool, page)
      res.set('Cache-Control', 'public, max-age=60')
      res.json(resolvePage(page.content, page.published_layout))
    } catch (err) {
      next(err)
    }
  })

  // View beacon, fired once per public page load. Only coarse anonymous
  // dimensions are derived and stored; the raw request data is discarded.
  app.post('/api/pages/:slug/view', async (req, res, next) => {
    try {
      if (!statsEnabled()) return res.status(204).end()
      const slug = String(req.params.slug || '').toLowerCase()
      if (!SLUG_RE.test(slug)) return res.status(204).end()
      const page = await getPageBySlug(pool, slug)
      if (!page || !page.published_layout) return res.status(204).end()

      const ua = req.get('user-agent') || ''
      const device = classifyDevice(ua)
      if (device !== 'bot') {
        const ownHost = req.hostname || null
        const source = classifySource(
          typeof req.body?.referrer === 'string' ? req.body.referrer : req.get('referer'),
          typeof req.body?.utmSource === 'string' ? req.body.utmSource : null,
          ownHost,
        )
        await insertView(pool, page.id, {
          device,
          source,
          country: resolveCountry((name) => req.get(name)),
          visitorHash: visitorHash(req.ip, ua, process.env.GIGBUDDY_SYNC_SECRET),
        })
      }
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  })

  // ---------- editor ----------

  // Exchange a gigbuddy handoff token for a linkpage editor session. Creates
  // the page row on first use and syncs content so the editor opens with the
  // band's current profile, songs, products and gigs.
  app.post('/api/editor/session', async (req, res, next) => {
    try {
      const handoff = verifyPayload(req.body?.token)
      if (!handoff || handoff.t !== 'handoff' || typeof handoff.slug !== 'string') {
        return res.status(401).json({ error: 'Invalid or expired editor link — reopen it from GigBuddy' })
      }
      let page = await upsertPage(pool, handoff.slug, handoff.tenantId)
      try {
        page = await syncContent(pool, page)
      } catch (err) {
        console.error(`content sync failed for ${page.slug}:`, err.message)
        return res.status(502).json({ error: 'Could not load content from GigBuddy — try again' })
      }
      const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
      const session = signPayload({ t: 'session', slug: page.slug, exp, n: crypto.randomUUID() })
      res.json({ session, page: editorPagePayload(page) })
    } catch (err) {
      next(err)
    }
  })

  // Everything below requires the editor session bearer.
  const requireSession = async (req, res, next) => {
    const header = req.get('authorization') || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    const session = verifyPayload(token)
    if (!session || session.t !== 'session' || typeof session.slug !== 'string') {
      return res.status(401).json({ error: 'Session expired — reopen the editor from GigBuddy' })
    }
    try {
      const page = await getPageBySlug(pool, session.slug)
      if (!page) return res.status(401).json({ error: 'Session expired — reopen the editor from GigBuddy' })
      req.page = page
      next()
    } catch (err) {
      next(err)
    }
  }

  function editorPagePayload(page) {
    return {
      slug: page.slug,
      draftLayout: page.draft_layout,
      publishedAt: page.published_at,
      contentSyncedAt: page.content_synced_at,
      content: page.content,
      publicUrl: `${(process.env.LINKPAGE_PUBLIC_URL || '').replace(/\/$/, '')}/${page.slug}`,
    }
  }

  app.get('/api/editor/page', requireSession, (req, res) => {
    res.json(editorPagePayload(req.page))
  })

  app.put('/api/editor/draft', requireSession, async (req, res, next) => {
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
  app.get('/api/editor/preview', requireSession, (req, res) => {
    res.json(resolvePage(req.page.content, req.page.draft_layout))
  })

  app.post('/api/editor/publish', requireSession, async (req, res, next) => {
    try {
      const page = await publishDraft(pool, req.page.id)
      res.json({ publishedAt: page.published_at })
    } catch (err) {
      next(err)
    }
  })

  app.post('/api/editor/refresh-content', requireSession, async (req, res, next) => {
    try {
      const page = await syncContent(pool, req.page)
      res.json(editorPagePayload(page))
    } catch (err) {
      next(err)
    }
  })

  app.get('/api/editor/stats', requireSession, async (req, res, next) => {
    try {
      const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365)
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      const stats = await aggregateStats(pool, req.page.id, since)
      res.json({ days, enabled: statsEnabled(), ...stats })
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
