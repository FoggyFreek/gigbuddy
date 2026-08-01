import './_envSetup.js'
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import request from 'supertest'

const storage = vi.hoisted(() => {
  const objects = new Map()
  const versions = new Map()
  return {
    objects,
    client: {
      bucketExists: vi.fn(async () => true),
      putObject: vi.fn(async (_bucket, key, body) => {
        const chunks = []
        for await (const chunk of Readable.from(body)) chunks.push(Buffer.from(chunk))
        const value = Buffer.concat(chunks)
        objects.set(key, value)
        versions.set(key, [{ versionId: `v-${Date.now()}`, value }])
        return { etag: 'etag' }
      }),
      statObject: vi.fn(async (_bucket, key) => ({ size: objects.get(key)?.length ?? 0 })),
      getObject: vi.fn(async (_bucket, key) => Readable.from([objects.get(key)])),
      listObjectsV2: vi.fn((_bucket, prefix) => Readable.from(
        [...objects.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([name, value]) => ({ name, size: value.length })),
      )),
      listObjects: vi.fn((_bucket, prefix) => Readable.from(
        [...versions.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .flatMap(([name, entries]) => entries.map(({ versionId, value }) => ({
            name, versionId, size: value.length,
          }))),
      )),
      removeObject: vi.fn(async (_bucket, key) => objects.delete(key)),
      removeObjects: vi.fn(async (_bucket, entries) => {
        for (const entry of entries) {
          objects.delete(entry.name)
          versions.delete(entry.name)
        }
        return []
      }),
    },
  }
})

vi.mock('../../../server/utils/storage.js', () => ({
  BUCKET: 'tenant-files',
  STORAGE_INFO: {
    configured: true,
    provider: 'backblaze',
    endpoint: 'https://s3.eu.example.backblazeb2.com:443',
    bucket: 'tenant-files',
  },
  storageClient: storage.client,
}))

let app, pool, runMigrations, truncateAll, seedTwoTenants, seed

beforeAll(async () => {
  const db = await import('./_db.js')
  const appModule = await import('./_app.js')
  pool = db.pool
  runMigrations = db.runMigrations
  truncateAll = db.truncateAll
  seedTwoTenants = db.seedTwoTenants
  app = appModule.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  storage.objects.clear()
  vi.clearAllMocks()
})

afterAll(async () => pool.end())

const asSuper = (req) => req
  .set('x-test-user-id', String(seed.superUser.id))
  .set('x-test-tenant-id', String(seed.tenantA.id))
const asUser = (req) => req
  .set('x-test-user-id', String(seed.userA.id))
  .set('x-test-tenant-id', String(seed.tenantA.id))

describe('super-admin S3 connection', () => {
  it('removes the completed storage-migration schema', async () => {
    const { rows: [tables] } = await pool.query(
      `SELECT to_regclass('storage_migrations') AS migrations,
              to_regclass('storage_migration_objects') AS objects`,
    )
    const { rows: columns } = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_name = 'storage_cleanup_queue'
          AND column_name = 'store_target'`,
    )
    expect(tables).toEqual({ migrations: null, objects: null })
    expect(columns).toEqual([])
  })

  it('rejects non-super-admin callers', async () => {
    await asUser(request(app).get('/api/admin/storage/connection')).expect(403)
  })

  it('reports the live provider and verifies object operations', async () => {
    const status = await asSuper(request(app).get('/api/admin/storage/connection')).expect(200)
    expect(status.body).toMatchObject({
      provider: 'backblaze',
      endpoint: 'https://s3.eu.example.backblazeb2.com:443',
      bucket: 'tenant-files',
      connected: true,
      operationsVerified: false,
    })

    const tested = await asSuper(request(app).post('/api/admin/storage/connection/test')).expect(200)
    expect(tested.body).toMatchObject({ connected: true, operationsVerified: true })
    expect(storage.objects.size).toBe(0)
  })
})
