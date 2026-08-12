import './_envSetup.js'
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deliverLinkpageSlugOperation } from '../../../server/promotion/linkpage/linkpageSlugClient.js'

const operation = {
  tenant_id: 42,
  old_slug: 'old-band',
  new_slug: 'new-band',
  slug_revision: '4',
}

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

describe('LinkBuddy slug integration client', () => {
  it.each(['applied', 'already_applied', 'no_pages', 'stale_ignored'])(
    'accepts the %s success outcome',
    async (code) => {
      configured()
      const fetchImpl = vi.fn().mockResolvedValue(response(200, { code }))

      await expect(deliverLinkpageSlugOperation(operation, { fetchImpl })).resolves.toEqual({ ok: true, code })
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://link.test.local/api/integrations/gigbuddy/tenants/42/slug',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({ Authorization: 'Bearer shared-secret' }),
          body: JSON.stringify({ oldSlug: 'old-band', newSlug: 'new-band', revision: 4 }),
        }),
      )
    },
  )

  it.each([
    [409, { code: 'slug_conflict' }, 'slug_conflict'],
    [409, { code: 'revision_gap' }, 'revision_gap'],
    [401, { code: 'unauthorized' }, 'unauthorized'],
    [500, {}, 'server_error'],
    [200, { code: 'surprise' }, 'malformed_response'],
  ])('maps HTTP %s to the safe retry code %s', async (status, body, expectedCode) => {
    configured()
    const fetchImpl = vi.fn().mockResolvedValue(response(status, body))
    await expect(deliverLinkpageSlugOperation(operation, { fetchImpl }))
      .resolves.toEqual({ ok: false, code: expectedCode })
  })

  it('maps timeouts and transport failures without exposing error text', async () => {
    configured()
    const timeoutError = Object.assign(new Error('secret-bearing timeout'), { name: 'TimeoutError' })
    await expect(deliverLinkpageSlugOperation(operation, {
      fetchImpl: vi.fn().mockRejectedValue(timeoutError),
    })).resolves.toEqual({ ok: false, code: 'timeout' })
    await expect(deliverLinkpageSlugOperation(operation, {
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('offline')),
    })).resolves.toEqual({ ok: false, code: 'network_error' })
  })
})
