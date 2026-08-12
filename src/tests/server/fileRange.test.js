import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'
import { Readable } from 'node:stream'

// Stateful stand-in for the MinIO/RustFS client. getPartialObject must slice for
// real: the whole point of these tests is that a seek transfers only its own
// bytes, so a mock that returned the full buffer would hide the regression.
const objectStore = new Map()
const getPartialObject = vi.fn(async (bucket, key, offset, length = 0) => {
  const obj = objectStore.get(key)
  if (!obj) throw Object.assign(new Error('Not Found'), { code: 'NoSuchKey' })
  const end = length ? offset + length : obj.buffer.length
  return Readable.from(obj.buffer.subarray(offset, end))
})
const getObject = vi.fn(async (bucket, key) => {
  const obj = objectStore.get(key)
  if (!obj) throw Object.assign(new Error('Not Found'), { code: 'NoSuchKey' })
  return Readable.from(obj.buffer)
})

const OBJECT_ETAG = 'd41d8cd98f00b204e9800998ecf8427e'
const OBJECT_MTIME = new Date('2026-07-01T10:00:00Z')

vi.mock('../../../server/utils/storage.js', () => ({
  BUCKET: 'test-bucket',
  storageClient: {
    putObject: vi.fn(async (bucket, key, buffer, size, meta) => {
      objectStore.set(key, { buffer, contentType: meta?.['Content-Type'] })
      return { etag: 'test' }
    }),
    statObject: vi.fn(async (bucket, key) => {
      const obj = objectStore.get(key)
      if (!obj) throw Object.assign(new Error('Not Found'), { code: 'NoSuchKey' })
      return {
        size: obj.buffer.length,
        etag: OBJECT_ETAG,
        lastModified: OBJECT_MTIME,
        metaData: { 'content-type': obj.contentType },
      }
    }),
    getObject,
    getPartialObject,
    removeObject: vi.fn(async (bucket, key) => { objectStore.delete(key) }),
  },
}))

// Neither path may transfer object bytes on a cache hit.
function expectNoBodyFetched() {
  expect(getObject).not.toHaveBeenCalled()
  expect(getPartialObject).not.toHaveBeenCalled()
}

// 26 bytes, so a Content-Range is readable at a glance ('a' at 0, 'z' at 25).
const AUDIO = Buffer.from('abcdefghijklmnopqrstuvwxyz')

let app, pool, runMigrations, truncateAll, seedTwoTenants
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  app = appMod.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  objectStore.clear()
  vi.clearAllMocks()
  seed = await seedTwoTenants()
})

afterAll(async () => {
  await pool.end()
})

function asUserA(req) {
  return req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

let recordingSeq = 0
async function addRecording(tenantId, buffer = AUDIO) {
  const { rows: [song] } = await pool.query(
    'INSERT INTO songs (tenant_id, title) VALUES ($1, $2) RETURNING id',
    [tenantId, `Song ${++recordingSeq}`],
  )
  const objectKey = `tenants/${tenantId}/song_recordings/take-${recordingSeq}.mp3`
  objectStore.set(objectKey, { buffer, contentType: 'audio/mpeg' })
  await pool.query(
    `INSERT INTO song_recordings (song_id, tenant_id, object_key, original_filename, content_type, file_size)
     VALUES ($1, $2, $3, $4, 'audio/mpeg', $5)`,
    [song.id, tenantId, objectKey, `take-${recordingSeq}.mp3`, buffer.length],
  )
  return objectKey
}

describe('GET /api/files/:objectKey range requests', () => {
  it('advertises range support and serves the whole object without a Range header', async () => {
    const key = await addRecording(seed.tenantA.id)
    const res = await asUserA(request(app).get(`/api/files/${key}`)).expect(200)

    expect(res.headers['accept-ranges']).toBe('bytes')
    expect(res.headers['content-length']).toBe('26')
    expect(res.headers['content-range']).toBeUndefined()
    expect(getPartialObject).not.toHaveBeenCalled()
  })

  it('answers a seek with 206 and only the requested bytes', async () => {
    const key = await addRecording(seed.tenantA.id)
    const res = await asUserA(request(app).get(`/api/files/${key}`))
      .set('Range', 'bytes=10-19')
      .expect(206)

    expect(res.headers['content-range']).toBe('bytes 10-19/26')
    expect(res.headers['content-length']).toBe('10')
    expect(res.body.toString()).toBe('klmnopqrst')
    expect(getPartialObject).toHaveBeenCalledWith('test-bucket', key, 10, 10)
  })

  it('serves an open-ended seek to the end of the object', async () => {
    const key = await addRecording(seed.tenantA.id)
    const res = await asUserA(request(app).get(`/api/files/${key}`))
      .set('Range', 'bytes=20-')
      .expect(206)

    expect(res.headers['content-range']).toBe('bytes 20-25/26')
    expect(res.body.toString()).toBe('uvwxyz')
    expect(getPartialObject).toHaveBeenCalledWith('test-bucket', key, 20, 6)
  })

  it('clamps an end past the object size instead of over-reading', async () => {
    const key = await addRecording(seed.tenantA.id)
    const res = await asUserA(request(app).get(`/api/files/${key}`))
      .set('Range', 'bytes=24-9999')
      .expect(206)

    expect(res.headers['content-range']).toBe('bytes 24-25/26')
    expect(getPartialObject).toHaveBeenCalledWith('test-bucket', key, 24, 2)
  })

  it('resolves a suffix range against the object size', async () => {
    const key = await addRecording(seed.tenantA.id)
    const res = await asUserA(request(app).get(`/api/files/${key}`))
      .set('Range', 'bytes=-6')
      .expect(206)

    expect(res.headers['content-range']).toBe('bytes 20-25/26')
    expect(res.body.toString()).toBe('uvwxyz')
  })

  // range-parser reports a syntactically valid but unsatisfiable spec as -1, so
  // these 416 rather than being ignored, matching what Express's own
  // serve-static does with the same parser.
  it.each([
    ['out of bounds', 'bytes=500-600'],
    ['inverted', 'bytes=20-10'],
  ])('416s a %s range and reports the true size', async (_label, header) => {
    const key = await addRecording(seed.tenantA.id)
    const res = await asUserA(request(app).get(`/api/files/${key}`))
      .set('Range', header)
      .expect(416)

    expect(res.headers['content-range']).toBe('bytes */26')
    expect(getPartialObject).not.toHaveBeenCalled()
  })

  // A malformed spec is not an unsatisfiable range: RFC 9110 has the server
  // ignore the header and serve the whole representation.
  it.each([
    ['unit-less', 'nonsense'],
    ['non-bytes unit', 'items=0-5'],
    ['multi-range', 'bytes=0-4,10-14'],
    ['non-numeric', 'bytes=abc-def'],
  ])('falls back to a full 200 body for a %s header', async (_label, header) => {
    const key = await addRecording(seed.tenantA.id)
    const res = await asUserA(request(app).get(`/api/files/${key}`))
      .set('Range', header)
      .expect(200)

    expect(res.headers['content-range']).toBeUndefined()
    expect(res.headers['content-length']).toBe('26')
    expect(getPartialObject).not.toHaveBeenCalled()
  })

  it('a Range header does not bypass tenant scoping', async () => {
    const key = await addRecording(seed.tenantB.id)
    await asUserA(request(app).get(`/api/files/${key}`))
      .set('Range', 'bytes=0-9')
      .expect(404)

    expect(getPartialObject).not.toHaveBeenCalled()
  })
})

describe('GET /api/files/:objectKey caching', () => {
  it('returns validators and keeps the body out of shared caches', async () => {
    const key = await addRecording(seed.tenantA.id)
    const res = await asUserA(request(app).get(`/api/files/${key}`)).expect(200)

    expect(res.headers.etag).toBe(`"${OBJECT_ETAG}"`)
    expect(res.headers['last-modified']).toBe(OBJECT_MTIME.toUTCString())
    expect(res.headers['cache-control']).toContain('private')
    expect(res.headers['cache-control']).toContain('max-age=3600')
  })

  it('304s a matching If-None-Match without transferring any bytes', async () => {
    const key = await addRecording(seed.tenantA.id)
    const res = await asUserA(request(app).get(`/api/files/${key}`))
      .set('If-None-Match', `"${OBJECT_ETAG}"`)
      .expect(304)

    expect(res.headers.etag).toBe(`"${OBJECT_ETAG}"`)
    expectNoBodyFetched()
  })

  it('304s a fresh If-Modified-Since without transferring any bytes', async () => {
    const key = await addRecording(seed.tenantA.id)
    await asUserA(request(app).get(`/api/files/${key}`))
      .set('If-Modified-Since', new Date(OBJECT_MTIME.getTime() + 60_000).toUTCString())
      .expect(304)

    expectNoBodyFetched()
  })

  it('serves the body again when the validator no longer matches', async () => {
    const key = await addRecording(seed.tenantA.id)
    const res = await asUserA(request(app).get(`/api/files/${key}`))
      .set('If-None-Match', '"stale-etag"')
      .expect(200)

    expect(res.body.toString()).toBe(AUDIO.toString())
    expect(getObject).toHaveBeenCalledTimes(1)
  })

  it('honours a range under a matching If-Range and ignores it under a stale one', async () => {
    const key = await addRecording(seed.tenantA.id)

    const matched = await asUserA(request(app).get(`/api/files/${key}`))
      .set('If-Range', `"${OBJECT_ETAG}"`)
      .set('Range', 'bytes=10-19')
      .expect(206)
    expect(matched.headers['content-range']).toBe('bytes 10-19/26')

    const stale = await asUserA(request(app).get(`/api/files/${key}`))
      .set('If-Range', '"stale-etag"')
      .set('Range', 'bytes=10-19')
      .expect(200)
    expect(stale.headers['content-range']).toBeUndefined()
    expect(stale.body.toString()).toBe(AUDIO.toString())
  })

  it('a stale If-Range does not turn an unsatisfiable range into a 416', async () => {
    const key = await addRecording(seed.tenantA.id)
    await asUserA(request(app).get(`/api/files/${key}`))
      .set('If-Range', '"stale-etag"')
      .set('Range', 'bytes=500-600')
      .expect(200)
  })

  it('never answers 304 for another tenant, only 404', async () => {
    const key = await addRecording(seed.tenantB.id)
    await asUserA(request(app).get(`/api/files/${key}`))
      .set('If-None-Match', `"${OBJECT_ETAG}"`)
      .expect(404)

    expectNoBodyFetched()
  })
})
