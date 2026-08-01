import './_envSetup.js'
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import request from 'supertest'

const storage = vi.hoisted(() => {
  const publicObjects = new Map()
  const privateObjects = new Map()
  function missing() {
    return Object.assign(new Error('missing'), { code: 'NotFound', statusCode: 404 })
  }
  function client(objects, versioned = false) {
    const versions = new Map()
    return {
      bucketExists: vi.fn(async () => true),
      putObject: vi.fn(async (_bucket, key, body) => {
        const chunks = []
        for await (const chunk of Readable.from(body)) chunks.push(Buffer.from(chunk))
        const value = Buffer.concat(chunks)
        objects.set(key, value)
        if (versioned) versions.set(key, [{ versionId: `v-${Date.now()}`, value }])
        return { etag: 'etag' }
      }),
      statObject: vi.fn(async (_bucket, key) => {
        const value = objects.get(key)
        if (!value) throw missing()
        return { size: value.length, etag: 'etag', lastModified: new Date('2026-01-01'), metaData: { 'content-type': 'application/pdf' } }
      }),
      getObject: vi.fn(async (_bucket, key) => {
        const value = objects.get(key)
        if (!value) throw missing()
        return Readable.from([value])
      }),
      listObjectsV2: vi.fn((_bucket, prefix) => Readable.from(
        [...objects.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([name, value]) => ({ name, size: value.length })),
      )),
      listObjects: vi.fn((_bucket, prefix) => Readable.from(
        [...versions.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .flatMap(([name, entries]) => entries.map((entry) => ({ name, versionId: entry.versionId, size: entry.value.length }))),
      )),
      removeObject: vi.fn(async (_bucket, key) => { objects.delete(key) }),
      removeObjects: vi.fn(async (_bucket, entries) => {
        for (const entry of entries) {
          const key = typeof entry === 'string' ? entry : entry.name
          objects.delete(key)
          versions.delete(key)
        }
        return []
      }),
    }
  }
  const publicStorageClient = client(publicObjects)
  const privateStorageClient = client(privateObjects, true)
  return { publicObjects, privateObjects, publicStorageClient, privateStorageClient }
})

vi.mock('../../../server/utils/storage.js', () => ({
  publicStorageClient: storage.publicStorageClient,
  privateStorageClient: storage.privateStorageClient,
  storageClient: storage.publicStorageClient,
  PUBLIC_BUCKET: 'public-bucket',
  PRIVATE_BUCKET: 'private-bucket',
  BUCKET: 'public-bucket',
  PUBLIC_STORE: { id: 'public', bucket: 'public-bucket', client: storage.publicStorageClient },
  PRIVATE_STORE: { id: 'private', bucket: 'private-bucket', client: storage.privateStorageClient },
  STORES: [
    { id: 'public', bucket: 'public-bucket', client: storage.publicStorageClient },
    { id: 'private', bucket: 'private-bucket', client: storage.privateStorageClient },
  ],
}))

let app, pool, runMigrations, truncateAll, seedTwoTenants, runStorageMigrationTick, seed

beforeAll(async () => {
  const db = await import('./_db.js')
  const appModule = await import('./_app.js')
  pool = db.pool
  runMigrations = db.runMigrations
  truncateAll = db.truncateAll
  seedTwoTenants = db.seedTwoTenants
  runStorageMigrationTick = (await import('../../../server/jobs/storageMigration.js')).runStorageMigrationTick
  app = appModule.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  storage.publicObjects.clear()
  storage.privateObjects.clear()
  vi.clearAllMocks()
})

afterAll(async () => pool.end())

const asSuper = (req) => req
  .set('x-test-user-id', String(seed.superUser.id))
  .set('x-test-tenant-id', String(seed.tenantA.id))
const asUser = (req) => req
  .set('x-test-user-id', String(seed.userA.id))
  .set('x-test-tenant-id', String(seed.tenantA.id))

describe('super-admin storage migration', () => {
  it('rejects non-super-admin callers and verifies the configured private store', async () => {
    await asUser(request(app).get('/api/admin/storage-migrations/connection')).expect(403)
    const result = await asSuper(request(app).post('/api/admin/storage-migrations/connection/test')).expect(200)
    expect(result.body).toMatchObject({ connected: true, operationsVerified: true })
  })

  it('copies, validates, and only then explicitly deletes every tenant object from RustFS', async () => {
    const documentKey = `tenants/${seed.tenantA.id}/song_documents/chart.pdf`
    const imageKey = `tenants/${seed.tenantA.id}/logo/logo.webp`
    const referencedShareImageKey = seed.sharePhotos.find(
      (photo) => photo.tenant_id === seed.tenantA.id,
    ).object_key
    storage.publicObjects.set(documentKey, Buffer.from('chart-content'))
    storage.publicObjects.set(imageKey, Buffer.from('logo-content'))
    storage.publicObjects.set(referencedShareImageKey, Buffer.from('share-content'))

    await asSuper(request(app).post(`/api/admin/storage-migrations/tenants/${seed.tenantA.id}/inventory`)).expect(202)
    await runStorageMigrationTick()
    let status = await asSuper(request(app).get(`/api/admin/storage-migrations/tenants/${seed.tenantA.id}`)).expect(200)
    expect(status.body).toMatchObject({ state: 'ready_to_copy', source_object_count: 3 })

    await asSuper(request(app).post(`/api/admin/storage-migrations/tenants/${seed.tenantA.id}/copy`)).expect(202)
    await runStorageMigrationTick()
    expect(storage.privateObjects.get(documentKey)).toEqual(Buffer.from('chart-content'))
    expect(storage.privateObjects.get(imageKey)).toEqual(Buffer.from('logo-content'))
    expect(storage.privateObjects.get(referencedShareImageKey)).toEqual(Buffer.from('share-content'))

    await asSuper(request(app).post(`/api/admin/storage-migrations/tenants/${seed.tenantA.id}/validate`)).expect(202)
    await runStorageMigrationTick()
    status = await asSuper(request(app).get(`/api/admin/storage-migrations/tenants/${seed.tenantA.id}`)).expect(200)
    expect(status.body).toMatchObject({ state: 'verified', mismatch_count: 0, missing_object_count: 0 })

    await asSuper(
      request(app)
        .post(`/api/admin/storage-migrations/tenants/${seed.tenantA.id}/delete-rustfs`)
        .send({ confirmationSlug: seed.tenantA.slug, confirmationPhrase: 'wrong' }),
    ).expect(400)

    await asSuper(
      request(app)
        .post(`/api/admin/storage-migrations/tenants/${seed.tenantA.id}/delete-rustfs`)
        .send({ confirmationSlug: seed.tenantA.slug, confirmationPhrase: 'DELETE RUSTFS COPIES' }),
    ).expect(202)
    await runStorageMigrationTick()

    expect(storage.publicObjects.has(documentKey)).toBe(false)
    expect(storage.publicObjects.has(imageKey)).toBe(false)
    expect(storage.publicObjects.has(referencedShareImageKey)).toBe(false)
    expect(storage.privateObjects.has(documentKey)).toBe(true)
    expect(storage.privateObjects.has(imageKey)).toBe(true)
    expect(storage.privateObjects.has(referencedShareImageKey)).toBe(true)
    status = await asSuper(request(app).get(`/api/admin/storage-migrations/tenants/${seed.tenantA.id}`)).expect(200)
    expect(status.body.state).toBe('complete')
  })
})
