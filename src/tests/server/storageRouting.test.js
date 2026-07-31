import './_envSetup.js'
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'

const mocks = vi.hoisted(() => {
  const client = () => ({
    statObject: vi.fn(),
    getObject: vi.fn(),
    putObject: vi.fn(async () => ({ etag: 'etag' })),
    removeObject: vi.fn(async () => undefined),
    listObjectsV2: vi.fn(() => Readable.from([])),
    listObjects: vi.fn(() => Readable.from([])),
    removeObjects: vi.fn(async () => []),
  })
  const publicStorageClient = client()
  const privateStorageClient = client()
  return { publicStorageClient, privateStorageClient }
})

vi.mock('../../../server/utils/storage.js', () => ({
  publicStorageClient: mocks.publicStorageClient,
  privateStorageClient: mocks.privateStorageClient,
  PUBLIC_BUCKET: 'public-bucket',
  PRIVATE_BUCKET: 'private-bucket',
  PUBLIC_STORE: { id: 'public', client: mocks.publicStorageClient, bucket: 'public-bucket' },
  PRIVATE_STORE: { id: 'private', client: mocks.privateStorageClient, bucket: 'private-bucket' },
  STORES: [
    { id: 'public', client: mocks.publicStorageClient, bucket: 'public-bucket' },
    { id: 'private', client: mocks.privateStorageClient, bucket: 'private-bucket' },
  ],
}))

vi.mock('../../../server/services/statisticsService.js', () => ({
  refreshTenantStorageForKey: vi.fn(() => Promise.resolve()),
  reserveStorageUsage: vi.fn(async () => true),
  releaseStorageUsage: vi.fn(async () => undefined),
  tenantIdFromKey: vi.fn((key) => Number(/^tenants\/(\d+)\//.exec(key)?.[1]) || null),
}))

vi.mock('../../../server/services/entitlementService.js', () => ({
  resolveTenantEntitlements: vi.fn(async () => null),
}))

vi.mock('../../../server/repositories/storageCleanupRepository.js', () => ({
  enqueueCleanup: vi.fn(async () => undefined),
}))

let storage

beforeEach(async () => {
  storage ??= await import('../../../server/services/storageService.js')
  vi.clearAllMocks()
})

describe('storage routing', () => {
  it.each([
    'logo', 'logo-dark', 'profile-banner', 'avatar', 'memory', 'gig-banners', 'share', 'song_covers',
    'gig_attachments', 'invoices', 'purchase_attachments', 'song_documents', 'song_recordings',
    'future_category',
  ])(
    'routes tenant category %s to Backblaze',
    (category) => {
      expect(storage.storeForKey(`tenants/12/${category}/x.bin`).id).toBe('private')
    },
  )

  it('keeps only malformed and legacy keys on the RustFS compatibility path', () => {
    expect(storage.storeForKey('legacy/path/file.bin').id).toBe('public')
    expect(storage.storeForKey('tenants/nope/invoices/file.pdf').id).toBe('public')
    expect(storage.storeForKey('tenants/0/invoices/file.pdf').id).toBe('public')
    expect(storage.storeForKey('tenants/12/future_private/file.bin').id).toBe('private')
  })
})

describe('tenant read fallback', () => {
  it.each(['NoSuchKey', 'NotFound'])(
    'falls back for %s',
    async (code) => {
      const missing = Object.assign(new Error('missing'), { code })
      mocks.privateStorageClient.statObject.mockRejectedValueOnce(missing)
      mocks.publicStorageClient.statObject.mockResolvedValueOnce({ size: 4 })

      await expect(storage.statObject('tenants/12/logo/x.webp')).resolves.toEqual({ size: 4 })
      expect(mocks.privateStorageClient.statObject).toHaveBeenCalledWith('private-bucket', 'tenants/12/logo/x.webp')
      expect(mocks.publicStorageClient.statObject).toHaveBeenCalledWith('public-bucket', 'tenants/12/logo/x.webp')
    },
  )

  it('falls back for an explicit 404 and never for auth/provider failures', async () => {
    mocks.privateStorageClient.getObject.mockRejectedValueOnce(Object.assign(new Error('missing'), { statusCode: 404 }))
    mocks.publicStorageClient.getObject.mockResolvedValueOnce(Readable.from(['ok']))
    await expect(storage.getObject('tenants/12/song_recordings/x.mp3')).resolves.toBeDefined()

    const denied = Object.assign(new Error('denied'), { code: 'AccessDenied', statusCode: 403 })
    mocks.privateStorageClient.getObject.mockRejectedValueOnce(denied)
    await expect(storage.getObject('tenants/12/song_recordings/y.mp3')).rejects.toBe(denied)
    expect(mocks.publicStorageClient.getObject).toHaveBeenCalledTimes(1)
  })
})

describe('tenant writes', () => {
  it('uploads tenant images directly to Backblaze', async () => {
    const key = 'tenants/12/logo/x.webp'
    await storage.uploadObjectWithQuota(key, Buffer.from('image'), 5, 'image/webp')

    expect(mocks.privateStorageClient.putObject).toHaveBeenCalledWith(
      'private-bucket', key, expect.any(Buffer), 5, { 'Content-Type': 'image/webp' },
    )
    expect(mocks.publicStorageClient.putObject).not.toHaveBeenCalled()
  })
})

describe('transition deletes', () => {
  it('deletes every tenant key from B2 and the RustFS fallback', async () => {
    await storage.removeObject('tenants/12/logo/x.webp')
    expect(mocks.privateStorageClient.removeObject).toHaveBeenCalledWith('private-bucket', 'tenants/12/logo/x.webp')
    expect(mocks.publicStorageClient.removeObject).toHaveBeenCalledWith('public-bucket', 'tenants/12/logo/x.webp')
  })
})

describe('version-aware tenant deletion', () => {
  it('deletes every private version and delete marker before succeeding', async () => {
    mocks.publicStorageClient.listObjectsV2
      .mockReturnValueOnce(Readable.from([]))
      .mockReturnValueOnce(Readable.from([]))
    mocks.privateStorageClient.listObjects
      .mockReturnValueOnce(Readable.from([
        { name: 'tenants/12/invoices/x.pdf', versionId: 'v2' },
        { name: 'tenants/12/invoices/x.pdf', versionId: 'v1' },
        { name: 'tenants/12/invoices/x.pdf', versionId: 'marker', isDeleteMarker: true },
      ]))
      .mockReturnValueOnce(Readable.from([]))
      .mockReturnValueOnce(Readable.from([]))

    await storage.deleteTenantObjects(12)

    expect(mocks.privateStorageClient.removeObjects).toHaveBeenCalledWith(
      'private-bucket',
      [
        { name: 'tenants/12/invoices/x.pdf', versionId: 'v2' },
        { name: 'tenants/12/invoices/x.pdf', versionId: 'v1' },
        { name: 'tenants/12/invoices/x.pdf', versionId: 'marker' },
      ],
    )
    expect(mocks.privateStorageClient.listObjects).toHaveBeenCalledWith(
      'private-bucket', 'tenants/12/', true, { IncludeVersion: true },
    )
  })
})
