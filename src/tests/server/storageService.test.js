import './_envSetup.js'
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'node:stream'

vi.mock('../../../server/utils/storage.js', () => ({
  BUCKET: 'test-bucket',
  storageClient: {
    putObject: vi.fn(async () => ({ etag: 'test' })),
    getObject: vi.fn(async () => { throw new Error('no such key') }),
    statObject: vi.fn(async () => ({ size: 0, metaData: {} })),
    removeObject: vi.fn(async () => undefined),
    listObjectsV2: vi.fn(() => Readable.from([])),
    removeObjects: vi.fn(async () => []),
  },
}))

// Prevent sendPush.js from opening a real pg pool during import
vi.mock('../../../server/utils/sendPush.js', () => ({
  sendPushToTenant: vi.fn(),
  sendPushToMember: vi.fn(),
  sendPushToUsers: vi.fn(),
}))

// statisticsService pulls in the pg pool; mock it so these stay unit tests and
// so we can assert the mutation → refresh wiring.
vi.mock('../../../server/services/statisticsService.js', () => ({
  refreshTenantStorageForKey: vi.fn(() => Promise.resolve()),
  tenantIdFromKey: vi.fn((key) => {
    const m = /^tenants\/(\d+)\//.exec(key || '')
    return m ? Number(m[1]) : null
  }),
}))

// Allow verifyDocumentContent to pass for rollback test
vi.mock('../../../server/utils/verifyFileContent.js', () => ({
  verifyDocumentContent: vi.fn(() => true),
}))

// ---------- key builders ----------

describe('key builders', () => {
  let s
  beforeEach(async () => { s = await import('../../../server/services/storageService.js') })

  it('gigBannerKey', () => {
    expect(s.gigBannerKey('5', 'abc', '.jpg')).toBe('tenants/5/gig-banners/abc.jpg')
  })

  it('gigAttachmentKey', () => {
    expect(s.gigAttachmentKey('5', 'abc', '.pdf')).toBe('tenants/5/gig_attachments/abc.pdf')
  })

  it('bandLogoKey', () => {
    expect(s.bandLogoKey('5', 'abc', '.png')).toBe('tenants/5/logo/abc.png')
  })

  it('sharePhotoKey', () => {
    expect(s.sharePhotoKey('5', 'abc', '.webp')).toBe('tenants/5/share/abc.webp')
  })

  it('invoicePdfKey', () => {
    expect(s.invoicePdfKey('5', 'abc')).toBe('tenants/5/invoices/abc.pdf')
  })

  it('invoiceLogoKey', () => {
    expect(s.invoiceLogoKey('5', 'abc', '.jpg')).toBe('tenants/5/invoices/logo-abc.jpg')
  })
})

// ---------- removeObject wrapper ----------

describe('removeObject', () => {
  it('delegates to storageClient with BUCKET', async () => {
    const { storageClient } = await import('../../../server/utils/storage.js')
    const { removeObject } = await import('../../../server/services/storageService.js')
    storageClient.removeObject.mockResolvedValueOnce(undefined)
    await removeObject('tenants/1/logo/x.png')
    expect(storageClient.removeObject).toHaveBeenCalledWith('test-bucket', 'tenants/1/logo/x.png')
  })
})

describe('deleteTenantObjects', () => {
  it('deletes the complete tenant prefix and deduplicated legacy keys in batches', async () => {
    const { storageClient } = await import('../../../server/utils/storage.js')
    const { deleteTenantObjects } = await import('../../../server/services/storageService.js')
    const keys = Array.from({ length: 1001 }, (_, i) => ({ name: `tenants/7/files/${i}` }))
    storageClient.listObjectsV2
      .mockReturnValueOnce(Readable.from(keys))
      .mockReturnValueOnce(Readable.from([]))
    storageClient.removeObjects.mockResolvedValue([])

    await deleteTenantObjects(7, ['legacy/logo.png', 'legacy/logo.png'])

    expect(storageClient.listObjectsV2).toHaveBeenCalledWith('test-bucket', 'tenants/7/', true)
    expect(storageClient.removeObjects).toHaveBeenCalledTimes(2)
    const deleted = storageClient.removeObjects.mock.calls.flatMap(([, batch]) => batch)
    expect(deleted).toContain('legacy/logo.png')
    expect(new Set(deleted).size).toBe(1002)
  })

  it('rejects per-object removal failures and a non-empty verification listing', async () => {
    const { storageClient } = await import('../../../server/utils/storage.js')
    const { deleteTenantObjects } = await import('../../../server/services/storageService.js')
    storageClient.listObjectsV2.mockReturnValueOnce(Readable.from([{ name: 'tenants/8/a' }]))
    storageClient.removeObjects.mockResolvedValueOnce([{ name: 'tenants/8/a', code: 'AccessDenied' }])
    await expect(deleteTenantObjects(8)).rejects.toThrow('object deletion failed')

    storageClient.listObjectsV2
      .mockReturnValueOnce(Readable.from([{ name: 'tenants/9/a' }]))
      .mockReturnValueOnce(Readable.from([{ name: 'tenants/9/a' }]))
    storageClient.removeObjects.mockResolvedValueOnce([])
    await expect(deleteTenantObjects(9)).rejects.toThrow('prefix is not empty')
  })
})

// ---------- mutation → stats refresh wiring ----------

describe('storage mutations trigger a tenant stats refresh', () => {
  it('uploadObject refreshes storage for the key after a successful put', async () => {
    const { uploadObject } = await import('../../../server/services/storageService.js')
    const { refreshTenantStorageForKey } = await import('../../../server/services/statisticsService.js')
    refreshTenantStorageForKey.mockClear()
    const result = await uploadObject('tenants/7/gig-banners/x.jpg', Buffer.from('x'), 1, 'image/jpeg')
    expect(result).toEqual({ etag: 'test' })
    expect(refreshTenantStorageForKey).toHaveBeenCalledWith('tenants/7/gig-banners/x.jpg')
  })

  it('removeObject refreshes storage for the key after a successful delete', async () => {
    const { storageClient } = await import('../../../server/utils/storage.js')
    const { removeObject } = await import('../../../server/services/storageService.js')
    const { refreshTenantStorageForKey } = await import('../../../server/services/statisticsService.js')
    storageClient.removeObject.mockResolvedValueOnce(undefined)
    refreshTenantStorageForKey.mockClear()
    await removeObject('tenants/7/gig-banners/x.jpg')
    expect(refreshTenantStorageForKey).toHaveBeenCalledWith('tenants/7/gig-banners/x.jpg')
  })

  it('upload still resolves even though the refresh is fire-and-forget', async () => {
    const { uploadObject } = await import('../../../server/services/storageService.js')
    const { refreshTenantStorageForKey } = await import('../../../server/services/statisticsService.js')
    // Real refreshTenantStorageForKey never rejects; the mutation does not await
    // it regardless, so the upload resolves.
    refreshTenantStorageForKey.mockClear()
    await expect(
      uploadObject('tenants/7/logo/x.png', Buffer.from('x'), 1, 'image/png'),
    ).resolves.toEqual({ etag: 'test' })
  })
})

// ---------- safeRemove ----------

describe('safeRemove', () => {
  it('is a no-op when key is falsy', async () => {
    const { storageClient } = await import('../../../server/utils/storage.js')
    const { safeRemove } = await import('../../../server/services/storageService.js')
    storageClient.removeObject.mockClear()
    safeRemove(null, 'should not warn')
    expect(storageClient.removeObject).not.toHaveBeenCalled()
  })

  it('calls removeObject and does not warn on success', async () => {
    const { storageClient } = await import('../../../server/utils/storage.js')
    const { safeRemove } = await import('../../../server/services/storageService.js')
    const { logger } = await import('../../../server/utils/logger.js')
    storageClient.removeObject.mockResolvedValueOnce(undefined)
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    safeRemove('tenants/1/logo/x.png', 'unexpected warn')
    await Promise.resolve()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('catches remove error and warns without throwing', async () => {
    const { storageClient } = await import('../../../server/utils/storage.js')
    const { safeRemove } = await import('../../../server/services/storageService.js')
    const { logger } = await import('../../../server/utils/logger.js')
    storageClient.removeObject.mockRejectedValueOnce(new Error('gone'))
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    safeRemove('tenants/1/logo/x.png', 'cleanup failed:')
    await Promise.resolve()
    expect(warn).toHaveBeenCalledWith(
      'storage.remove_failed',
      expect.objectContaining({ err: expect.any(Error), tenantId: 1 }),
    )
    warn.mockRestore()
  })
})

// ---------- rollback integration ----------

describe('createGigAttachment rollback', () => {
  it('removes uploaded object when DB insert fails', async () => {
    const { storageClient } = await import('../../../server/utils/storage.js')
    const { createGigAttachment } = await import('../../../server/services/gigService.js')

    storageClient.putObject.mockClear()
    storageClient.removeObject.mockClear()
    storageClient.removeObject.mockResolvedValueOnce(undefined)

    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rowCount: 1 })          // SELECT gig exists
        .mockRejectedValueOnce(new Error('db error')),   // INSERT fails
    }

    const file = {
      buffer: Buffer.from('%PDF-stub'),
      mimetype: 'application/pdf',
      originalname: 'doc.pdf',
      size: 9,
    }

    await expect(
      createGigAttachment(mockDb, 1, 1, file),
    ).rejects.toThrow('db error')

    // The key passed to putObject must be the same one removeObject received
    const uploadedKey = storageClient.putObject.mock.calls[0][1]
    expect(uploadedKey).toMatch(/^tenants\/1\/gig_attachments\/.+\.pdf$/)
    expect(storageClient.removeObject).toHaveBeenCalledWith('test-bucket', uploadedKey)
  })
})
