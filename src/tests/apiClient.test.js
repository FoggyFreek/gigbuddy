import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request, requestBlob, requestForm } from '../api/_client.ts'

const termsRequired = () => new Response(
  JSON.stringify({ error: 'Terms required', code: 'terms_acceptance_required' }),
  { status: 403, headers: { 'Content-Type': 'application/json' } },
)

describe('API client terms-version handling', () => {
  const assign = vi.fn()

  beforeEach(() => {
    assign.mockClear()
    vi.stubGlobal('window', {
      location: { pathname: '/', assign },
      dispatchEvent: vi.fn(),
    })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => termsRequired()))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['JSON', () => request('/api/gigs')],
    ['blob', () => requestBlob('/api/files/1')],
    ['form', () => requestForm('/api/profile/logo', new FormData())],
  ])('hard-navigates stale %s requests to the acceptance page', async (_label, call) => {
    await expect(call()).rejects.toMatchObject({ status: 403 })
    expect(assign).toHaveBeenCalledWith('/accept-terms')
  })
})
