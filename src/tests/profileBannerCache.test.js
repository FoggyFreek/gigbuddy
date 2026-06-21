import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/_client.ts', () => ({
  request: vi.fn(),
  requestForm: vi.fn(),
}))

import { request, requestForm } from '../api/_client.ts'
import { clearBannerPathCache, getBannerPath, uploadBanner } from '../api/profile.ts'

describe('profile banner-path cache', () => {
  beforeEach(() => {
    clearBannerPathCache()
    request.mockReset()
    requestForm.mockReset()
  })

  it('fetches the profile once, then serves reads from cache', async () => {
    request.mockResolvedValue({ banner_path: 'tenants/1/logo/abc.png' })
    expect(await getBannerPath()).toBe('tenants/1/logo/abc.png')
    expect(await getBannerPath()).toBe('tenants/1/logo/abc.png')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('/api/profile/', undefined)
  })

  it('normalizes a missing banner_path to null and caches that', async () => {
    request.mockResolvedValue({})
    expect(await getBannerPath()).toBeNull()
    expect(await getBannerPath()).toBeNull()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('clearBannerPathCache forces a refetch', async () => {
    request.mockResolvedValue({ banner_path: 'a.png' })
    await getBannerPath()
    clearBannerPathCache()
    await getBannerPath()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('uploadBanner refreshes the cache without an extra profile fetch', async () => {
    request.mockResolvedValue({ banner_path: 'old.png' })
    requestForm.mockResolvedValue({ banner_path: 'new.png' })
    await getBannerPath() // primes cache: old.png (1 profile request)
    await uploadBanner(new File([''], 'b.png'))
    expect(await getBannerPath()).toBe('new.png') // served from refreshed cache
    expect(request).toHaveBeenCalledTimes(1)
    expect(requestForm).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed fetch (retries on the next call)', async () => {
    request.mockRejectedValueOnce(new Error('boom'))
    await expect(getBannerPath()).rejects.toThrow('boom')
    request.mockResolvedValue({ banner_path: 'x.png' })
    expect(await getBannerPath()).toBe('x.png')
    expect(request).toHaveBeenCalledTimes(2)
  })
})
