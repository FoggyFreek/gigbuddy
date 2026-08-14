import './_envSetup.js'
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLinkpagePages, fetchLinkpageStats } from '../../../server/promotion/linkpage/linkpageStatsClient.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

function configured() {
  vi.stubEnv('LINKPAGE_SECRET', 'shared-secret')
  vi.stubEnv('LINKPAGE_URL', 'https://link.test.local/')
}

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const payload = {
  hasPage: true,
  pageId: 8,
  slug: 'the-band',
  days: 7,
  retentionDays: 30,
  enabled: true,
  totalViews: 200,
  uniqueVisits: 120,
  totalClicks: 50,
  clickThroughRate: 25,
  byDay: [{ day: '2026-08-01', views: 12, clicks: { platform: 3, shop: 1 } }],
}

describe('LinkBuddy stats client', () => {
  it('sends the shared secret to the tenant stats endpoint and normalizes the payload', async () => {
    configured()
    const fetchImpl = vi.fn().mockResolvedValue(response(200, payload))

    await expect(fetchLinkpageStats(42, 7, { fetchImpl })).resolves.toEqual({ ok: true, stats: payload })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://link.test.local/api/integrations/gigbuddy/tenants/42/stats?days=7',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer shared-secret' }),
      }),
    )
  })

  it('passes through the "no page yet" outcome without inventing numbers', async () => {
    configured()
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { hasPage: false }))
    await expect(fetchLinkpageStats(42, 30, { fetchImpl })).resolves.toEqual({
      ok: true,
      stats: { hasPage: false },
    })
  })

  it('reports not_configured without calling out when the integration is unset', async () => {
    vi.stubEnv('LINKPAGE_SECRET', '')
    vi.stubEnv('LINKPAGE_URL', '')
    const fetchImpl = vi.fn()
    await expect(fetchLinkpageStats(42, 7, { fetchImpl })).resolves.toEqual({ ok: false, code: 'not_configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('asks for a specific page when one is selected', async () => {
    configured()
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { ...payload, pageId: 9 }))
    await fetchLinkpageStats(42, 30, { pageId: 9, fetchImpl })
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://link.test.local/api/integrations/gigbuddy/tenants/42/stats?days=30&pageId=9',
    )
  })

  it.each([
    [401, 'unauthorized'],
    [400, 'bad_request'],
    [500, 'server_error'],
    [503, 'server_error'],
    [404, 'page_not_found'],
  ])('maps HTTP %s to a safe failure code', async (status, code) => {
    configured()
    const fetchImpl = vi.fn().mockResolvedValue(response(status, {}))
    await expect(fetchLinkpageStats(42, 7, { fetchImpl })).resolves.toEqual({ ok: false, code })
  })

  it('rejects a 200 whose body is not a usable stats payload', async () => {
    configured()
    for (const body of [
      null,
      'nope',
      { hasPage: true },
      { hasPage: true, totalViews: 'lots', byDay: [] },
      // Identifies no page: the tile could not tell which one it is showing.
      { ...payload, pageId: undefined },
      { ...payload, slug: 42 },
    ]) {
      const fetchImpl = vi.fn().mockResolvedValue(response(200, body))
      await expect(fetchLinkpageStats(42, 7, { fetchImpl })).resolves.toEqual({ ok: false, code: 'malformed_response' })
    }
  })

  it('drops day rows the upstream sends in an unusable shape', async () => {
    configured()
    const fetchImpl = vi.fn().mockResolvedValue(response(200, {
      ...payload,
      byDay: [
        { day: '2026-08-01', views: 12, clicks: { platform: 3, bogus: 'x' } },
        { day: 42, views: 1, clicks: {} },
        { views: 1 },
        'nonsense',
      ],
    }))
    const result = await fetchLinkpageStats(42, 7, { fetchImpl })
    expect(result.ok).toBe(true)
    expect(result.stats.byDay).toEqual([{ day: '2026-08-01', views: 12, clicks: { platform: 3 } }])
  })

  it('turns transport failures into retryable codes rather than throwing', async () => {
    configured()
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    await expect(fetchLinkpageStats(42, 7, { fetchImpl: vi.fn().mockRejectedValue(timeout) }))
      .resolves.toEqual({ ok: false, code: 'timeout' })
    await expect(fetchLinkpageStats(42, 7, { fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) }))
      .resolves.toEqual({ ok: false, code: 'network_error' })
  })

  it('refuses a tenant id, window or page id it cannot put on the wire', async () => {
    configured()
    const fetchImpl = vi.fn()
    for (const [tenantId, days] of [[0, 7], ['42', 7], [42, 0], [42, 7.5], [42, Number.NaN]]) {
      await expect(fetchLinkpageStats(tenantId, days, { fetchImpl }))
        .resolves.toEqual({ ok: false, code: 'invalid_request' })
    }
    for (const pageId of [0, -1, 1.5, '9']) {
      await expect(fetchLinkpageStats(42, 7, { pageId, fetchImpl }))
        .resolves.toEqual({ ok: false, code: 'invalid_request' })
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('LinkBuddy page list client', () => {
  const pages = [
    { id: 8, slug: 'the-band', pageType: 'main', release: null, publishedAt: '2026-07-01T10:00:00.000Z' },
    { id: 9, slug: 'the-band/single', pageType: 'release', release: { title: 'New Single' }, publishedAt: null },
  ]

  it('reads the tenant page list and reduces it to what a picker needs', async () => {
    configured()
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { pages }))

    await expect(fetchLinkpagePages(42, { fetchImpl })).resolves.toEqual({
      ok: true,
      pages: [
        { id: 8, slug: 'the-band', pageType: 'main', title: null, published: true },
        { id: 9, slug: 'the-band/single', pageType: 'release', title: 'New Single', published: false },
      ],
    })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://link.test.local/api/integrations/gigbuddy/tenants/42/pages')
  })

  it('accepts an empty list', async () => {
    configured()
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { pages: [] }))
    await expect(fetchLinkpagePages(42, { fetchImpl })).resolves.toEqual({ ok: true, pages: [] })
  })

  it.each([null, { pages: 'nope' }, { pages: [{ id: 0, slug: 'x' }] }, { pages: [{ id: 8 }] }])(
    'rejects an unusable page list',
    async (body) => {
      configured()
      const fetchImpl = vi.fn().mockResolvedValue(response(200, body))
      await expect(fetchLinkpagePages(42, { fetchImpl }))
        .resolves.toEqual({ ok: false, code: 'malformed_response' })
    },
  )

  it('reports not_configured without calling out', async () => {
    vi.stubEnv('LINKPAGE_SECRET', '')
    vi.stubEnv('LINKPAGE_URL', '')
    const fetchImpl = vi.fn()
    await expect(fetchLinkpagePages(42, { fetchImpl })).resolves.toEqual({ ok: false, code: 'not_configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('turns transport failures into retryable codes', async () => {
    configured()
    await expect(fetchLinkpagePages(42, { fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) }))
      .resolves.toEqual({ ok: false, code: 'network_error' })
  })
})
