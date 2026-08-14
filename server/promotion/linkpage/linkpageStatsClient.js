// Read-side companion to linkpageSlugClient: pulls the aggregate statistics
// for a tenant's link page out of the decoupled app over the same shared
// secret. Everything the remote sends is untrusted input, so the payload is
// re-validated field by field before it reaches a service — a link-page app
// that starts returning garbage must degrade to "unavailable", never to a
// dashboard tile rendering nonsense.
const DEFAULT_TIMEOUT_MS = 4000
// Enough for a 90-day window plus slack; a longer series is a malfunctioning
// upstream, not a bigger chart.
const MAX_DAY_ROWS = 120
// A picker, not a catalogue: far more pages than any plan allows means the
// upstream is misbehaving, and the list is truncated rather than trusted.
const MAX_PAGES = 100
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
// Click kinds the tile knows how to categorize. An unknown kind is dropped
// here rather than silently folded, so the totals row and the chart can never
// disagree about what a category means.
const CLICK_KINDS = new Set(['platform', 'song', 'link', 'embed', 'share', 'social', 'shop', 'other'])

function integrationOrigin() {
  return process.env.LINKPAGE_URL || null
}

function configured() {
  return Boolean(process.env.LINKPAGE_SECRET && integrationOrigin())
}

function failureCode(status) {
  if (status === 401) return 'unauthorized'
  if (status === 400) return 'bad_request'
  if (status === 404) return 'page_not_found'
  if (status >= 500) return 'server_error'
  return `http_${status}`
}

const isId = (value) => Number.isSafeInteger(value) && value > 0

// One authenticated GET against the tenant's integration namespace. Transport
// and status handling live here so each reader only has to normalize its own
// payload shape.
async function integrationGet(path, tenantId, { fetchImpl, timeoutMs }) {
  if (!configured()) return { ok: false, code: 'not_configured' }
  if (!isId(tenantId)) return { ok: false, code: 'invalid_request' }

  const origin = integrationOrigin().replace(/\/$/, '')
  try {
    const response = await fetchImpl(`${origin}/api/integrations/gigbuddy/tenants/${tenantId}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.LINKPAGE_SECRET}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status !== 200) return { ok: false, code: failureCode(response.status) }
    return { ok: true, body: await response.json().catch(() => null) }
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return { ok: false, code: 'timeout' }
    }
    return { ok: false, code: 'network_error' }
  }
}

const isCount = (value) => Number.isInteger(value) && value >= 0

// A click bucket keyed by kind: unknown kinds and non-counts are dropped.
function normalizeClicks(clicks) {
  if (!clicks || typeof clicks !== 'object') return {}
  const out = {}
  for (const [kind, count] of Object.entries(clicks)) {
    if (CLICK_KINDS.has(kind) && isCount(count)) out[kind] = count
  }
  return out
}

function normalizeByDay(byDay) {
  if (!Array.isArray(byDay)) return null
  return byDay
    .filter((row) => row && typeof row === 'object' && DAY_RE.test(row.day) && isCount(row.views))
    .slice(0, MAX_DAY_ROWS)
    .map((row) => ({ day: row.day, views: row.views, clicks: normalizeClicks(row.clicks) }))
}

// null (no views yet, so no meaningful rate) is a legitimate value; anything
// else has to be a finite percentage.
function normalizeRate(value) {
  if (value === null) return null
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function normalizeStats(body) {
  if (!body || typeof body !== 'object') return null
  if (body.hasPage !== true) return body.hasPage === false ? { hasPage: false } : null

  const byDay = normalizeByDay(body.byDay)
  const clickThroughRate = normalizeRate(body.clickThroughRate)
  if (
    byDay === null ||
    clickThroughRate === undefined ||
    !isId(body.pageId) ||
    typeof body.slug !== 'string' ||
    !isCount(body.totalViews) ||
    !isCount(body.uniqueVisits) ||
    !isCount(body.totalClicks) ||
    !Number.isInteger(body.days) ||
    !Number.isInteger(body.retentionDays)
  ) {
    return null
  }

  return {
    hasPage: true,
    pageId: body.pageId,
    slug: body.slug,
    days: body.days,
    retentionDays: body.retentionDays,
    enabled: body.enabled !== false,
    totalViews: body.totalViews,
    uniqueVisits: body.uniqueVisits,
    totalClicks: body.totalClicks,
    clickThroughRate,
    byDay,
  }
}

// A page's identity and publication state. The release snapshot is a display
// label only, so it is trimmed to the fields the picker renders.
function normalizePage(page) {
  if (!page || typeof page !== 'object' || !isId(page.id) || typeof page.slug !== 'string') return null
  const title = page.release && typeof page.release === 'object' && typeof page.release.title === 'string'
    ? page.release.title
    : null
  return {
    id: page.id,
    slug: page.slug,
    pageType: page.pageType === 'release' ? 'release' : 'main',
    title,
    published: typeof page.publishedAt === 'string',
  }
}

function normalizePages(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.pages)) return null
  const pages = body.pages.slice(0, MAX_PAGES).map(normalizePage)
  return pages.includes(null) ? null : pages
}

export async function fetchLinkpageStats(tenantId, days, {
  pageId = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!Number.isSafeInteger(days) || days <= 0) return { ok: false, code: 'invalid_request' }
  if (pageId !== null && !isId(pageId)) return { ok: false, code: 'invalid_request' }

  const query = `?days=${days}${pageId === null ? '' : `&pageId=${pageId}`}`
  const result = await integrationGet(`/stats${query}`, tenantId, { fetchImpl, timeoutMs })
  if (!result.ok) return result

  const stats = normalizeStats(result.body)
  return stats ? { ok: true, stats } : { ok: false, code: 'malformed_response' }
}

export async function fetchLinkpagePages(tenantId, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const result = await integrationGet('/pages', tenantId, { fetchImpl, timeoutMs })
  if (!result.ok) return result

  const pages = normalizePages(result.body)
  return pages ? { ok: true, pages } : { ok: false, code: 'malformed_response' }
}
