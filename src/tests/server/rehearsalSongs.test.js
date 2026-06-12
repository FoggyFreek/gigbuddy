import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'

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

async function createSong(tenantId, title, artist = null) {
  const { rows } = await pool.query(
    `INSERT INTO songs (tenant_id, title, artist) VALUES ($1, $2, $3) RETURNING *`,
    [tenantId, title, artist],
  )
  return rows[0]
}

async function createRehearsal(tenantId) {
  const { rows } = await pool.query(
    `INSERT INTO rehearsals (tenant_id, proposed_date) VALUES ($1, '2026-07-01') RETURNING *`,
    [tenantId],
  )
  return rows[0]
}

describe('GET /api/songs/search', () => {
  it('returns [] for queries under 3 characters', async () => {
    await createSong(seed.tenantA.id, 'Wonderwall', 'Oasis')
    const res = await asUserA(request(app).get('/api/songs/search?q=Wo')).expect(200)
    expect(res.body).toEqual([])
  })

  it('matches on title and artist, scoped to the active tenant', async () => {
    await createSong(seed.tenantA.id, 'Wonderwall', 'Oasis')
    await createSong(seed.tenantA.id, 'Champagne Supernova', 'Oasis')
    await createSong(seed.tenantB.id, 'Wonderwall Cover', 'Oasis')

    const byTitle = await asUserA(request(app).get('/api/songs/search?q=wonder')).expect(200)
    expect(byTitle.body).toHaveLength(1)
    expect(byTitle.body[0].title).toBe('Wonderwall')

    const byArtist = await asUserA(request(app).get('/api/songs/search?q=oasis')).expect(200)
    expect(byArtist.body).toHaveLength(2)
  })
})

describe('POST /api/rehearsals/:id/songs', () => {
  it('links a song and returns the rehearsal with songs', async () => {
    const rehearsal = await createRehearsal(seed.tenantA.id)
    const song = await createSong(seed.tenantA.id, 'Wonderwall', 'Oasis')
    const res = await asUserA(
      request(app).post(`/api/rehearsals/${rehearsal.id}/songs`).send({ song_id: song.id }),
    ).expect(201)
    expect(res.body.songs).toHaveLength(1)
    expect(res.body.songs[0]).toMatchObject({ song_id: song.id, title: 'Wonderwall', artist: 'Oasis' })
  })

  it('409s on duplicate link', async () => {
    const rehearsal = await createRehearsal(seed.tenantA.id)
    const song = await createSong(seed.tenantA.id, 'Wonderwall')
    await asUserA(request(app).post(`/api/rehearsals/${rehearsal.id}/songs`).send({ song_id: song.id })).expect(201)
    await asUserA(request(app).post(`/api/rehearsals/${rehearsal.id}/songs`).send({ song_id: song.id })).expect(409)
  })

  it('404s when the song belongs to another tenant', async () => {
    const rehearsal = await createRehearsal(seed.tenantA.id)
    const foreignSong = await createSong(seed.tenantB.id, 'Theirs')
    await asUserA(
      request(app).post(`/api/rehearsals/${rehearsal.id}/songs`).send({ song_id: foreignSong.id }),
    ).expect(404)
  })

  it('404s when the rehearsal belongs to another tenant', async () => {
    const foreignRehearsal = await createRehearsal(seed.tenantB.id)
    const song = await createSong(seed.tenantA.id, 'Mine')
    await asUserA(
      request(app).post(`/api/rehearsals/${foreignRehearsal.id}/songs`).send({ song_id: song.id }),
    ).expect(404)
  })
})

describe('GET /api/rehearsals/:id', () => {
  it('includes linked songs', async () => {
    const rehearsal = await createRehearsal(seed.tenantA.id)
    const song = await createSong(seed.tenantA.id, 'Wonderwall', 'Oasis')
    await pool.query(
      'INSERT INTO rehearsal_songs (tenant_id, rehearsal_id, song_id) VALUES ($1, $2, $3)',
      [seed.tenantA.id, rehearsal.id, song.id],
    )
    const res = await asUserA(request(app).get(`/api/rehearsals/${rehearsal.id}`)).expect(200)
    expect(res.body.songs).toHaveLength(1)
    expect(res.body.songs[0]).toMatchObject({ song_id: song.id, title: 'Wonderwall', artist: 'Oasis' })
  })
})

describe('DELETE /api/rehearsals/:id/songs/:songId', () => {
  it('unlinks the song', async () => {
    const rehearsal = await createRehearsal(seed.tenantA.id)
    const song = await createSong(seed.tenantA.id, 'Wonderwall')
    await pool.query(
      'INSERT INTO rehearsal_songs (tenant_id, rehearsal_id, song_id) VALUES ($1, $2, $3)',
      [seed.tenantA.id, rehearsal.id, song.id],
    )
    await asUserA(request(app).delete(`/api/rehearsals/${rehearsal.id}/songs/${song.id}`)).expect(204)
    const { rows } = await pool.query('SELECT * FROM rehearsal_songs WHERE rehearsal_id = $1', [rehearsal.id])
    expect(rows).toHaveLength(0)
  })

  it('404s for a link in another tenant', async () => {
    const foreignRehearsal = await createRehearsal(seed.tenantB.id)
    const foreignSong = await createSong(seed.tenantB.id, 'Theirs')
    await pool.query(
      'INSERT INTO rehearsal_songs (tenant_id, rehearsal_id, song_id) VALUES ($1, $2, $3)',
      [seed.tenantB.id, foreignRehearsal.id, foreignSong.id],
    )
    await asUserA(
      request(app).delete(`/api/rehearsals/${foreignRehearsal.id}/songs/${foreignSong.id}`),
    ).expect(404)
  })
})
