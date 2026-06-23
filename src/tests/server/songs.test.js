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

async function createSong(tenantId, title, extra = {}) {
  const { rows } = await pool.query(
    `INSERT INTO songs (tenant_id, title, artist, song_key, tempo, duration_seconds)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [tenantId, title, extra.artist ?? null, extra.song_key ?? null, extra.tempo ?? null, extra.duration_seconds ?? null],
  )
  return rows[0]
}

describe('GET /api/songs', () => {
  it('lists only the active tenant songs, with tags aggregated', async () => {
    await createSong(seed.tenantA.id, 'Alpha Song')
    await createSong(seed.tenantB.id, 'Beta Song')
    const res = await asUserA(request(app).get('/api/songs')).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe('Alpha Song')
    expect(res.body[0].tags).toEqual([])
  })
})

describe('POST /api/songs', () => {
  it('creates a song (title required)', async () => {
    const res = await asUserA(
      request(app).post('/api/songs').send({ title: 'New Song', tempo: 120, duration_seconds: 200 }),
    ).expect(201)
    expect(res.body.title).toBe('New Song')
    expect(res.body.tempo).toBe(120)
    expect(res.body.tenant_id).toBe(seed.tenantA.id)
  })

  it('400 on blank title', async () => {
    await asUserA(request(app).post('/api/songs').send({ title: '  ' })).expect(400)
  })
})

describe('GET /api/songs/:id', () => {
  it('returns full song with empty child collections', async () => {
    const song = await createSong(seed.tenantA.id, 'Detail Song')
    const res = await asUserA(request(app).get(`/api/songs/${song.id}`)).expect(200)
    expect(res.body).toMatchObject({ id: song.id, title: 'Detail Song' })
    expect(res.body.tags).toEqual([])
    expect(res.body.links).toEqual([])
    expect(res.body.documents).toEqual([])
    expect(res.body.recordings).toEqual([])
  })

  it('tenant isolation — A cannot read B song (404)', async () => {
    const songB = await createSong(seed.tenantB.id, 'B Song')
    await asUserA(request(app).get(`/api/songs/${songB.id}`)).expect(404)
  })
})

describe('PATCH /api/songs/:id', () => {
  it('updates whitelisted fields', async () => {
    const song = await createSong(seed.tenantA.id, 'Patch Me')
    const res = await asUserA(
      request(app).patch(`/api/songs/${song.id}`).send({ artist: 'The Band', tempo: 90 }),
    ).expect(200)
    expect(res.body.artist).toBe('The Band')
    expect(res.body.tempo).toBe(90)
  })

  it('tenant isolation — A cannot patch B song (404)', async () => {
    const songB = await createSong(seed.tenantB.id, 'B Song')
    await asUserA(request(app).patch(`/api/songs/${songB.id}`).send({ artist: 'x' })).expect(404)
  })
})

describe('DELETE /api/songs/:id', () => {
  it('deletes a song and cascades its children', async () => {
    const song = await createSong(seed.tenantA.id, 'Doomed')
    await pool.query(
      `INSERT INTO song_links (song_id, tenant_id, url) VALUES ($1, $2, 'http://x')`,
      [song.id, seed.tenantA.id],
    )
    await asUserA(request(app).delete(`/api/songs/${song.id}`)).expect(204)
    const { rows } = await pool.query('SELECT id FROM song_links WHERE song_id = $1', [song.id])
    expect(rows).toHaveLength(0)
  })

  it('tenant isolation — A cannot delete B song (404)', async () => {
    const songB = await createSong(seed.tenantB.id, 'B Song')
    await asUserA(request(app).delete(`/api/songs/${songB.id}`)).expect(404)
    const { rows } = await pool.query('SELECT id FROM songs WHERE id = $1', [songB.id])
    expect(rows).toHaveLength(1)
  })
})

describe('PUT /api/songs/:id/tags', () => {
  it('find-or-creates tags case-insensitively and dedupes', async () => {
    const song = await createSong(seed.tenantA.id, 'Tagged')
    let res = await asUserA(
      request(app).put(`/api/songs/${song.id}/tags`).send({ tags: ['Rock', 'Ballad'] }),
    ).expect(200)
    expect(res.body.map((t) => t.name).sort()).toEqual(['Ballad', 'Rock'])

    // Re-using 'rock' (different case) must not create a second tag row.
    res = await asUserA(
      request(app).put(`/api/songs/${song.id}/tags`).send({ tags: ['rock'] }),
    ).expect(200)
    expect(res.body).toHaveLength(1)
    const { rows } = await pool.query('SELECT id FROM song_tags WHERE tenant_id = $1', [seed.tenantA.id])
    expect(rows).toHaveLength(2) // Rock + Ballad still the only two tags
  })

  it('tenant isolation — A cannot set tags on B song (404)', async () => {
    const songB = await createSong(seed.tenantB.id, 'B Song')
    await asUserA(request(app).put(`/api/songs/${songB.id}/tags`).send({ tags: ['x'] })).expect(404)
  })
})

describe('POST /api/songs/:id/documents', () => {
  it('rejects a non-pdf mime type (400)', async () => {
    const song = await createSong(seed.tenantA.id, 'Docs')
    await asUserA(
      request(app)
        .post(`/api/songs/${song.id}/documents`)
        .attach('file', Buffer.from('hello'), { filename: 'note.txt', contentType: 'text/plain' }),
    ).expect(400)
  })

  it('rejects a pdf mime whose bytes are not a pdf (400)', async () => {
    const song = await createSong(seed.tenantA.id, 'Docs')
    await asUserA(
      request(app)
        .post(`/api/songs/${song.id}/documents`)
        .attach('file', Buffer.from('not really a pdf'), { filename: 'x.pdf', contentType: 'application/pdf' }),
    ).expect(400)
  })
})

describe('POST /api/songs/:id/recordings', () => {
  it('rejects a wrong mime type (400)', async () => {
    const song = await createSong(seed.tenantA.id, 'Rec')
    await asUserA(
      request(app)
        .post(`/api/songs/${song.id}/recordings`)
        .attach('file', Buffer.from('ID3hello'), { filename: 'x.wav', contentType: 'audio/wav' }),
    ).expect(400)
  })

  it('rejects audio/mpeg whose bytes are not mp3 (400)', async () => {
    const song = await createSong(seed.tenantA.id, 'Rec')
    await asUserA(
      request(app)
        .post(`/api/songs/${song.id}/recordings`)
        .attach('file', Buffer.from('plain text'), { filename: 'x.mp3', contentType: 'audio/mpeg' }),
    ).expect(400)
  })
})

describe('ChordPro charts', () => {
  const SAMPLE = '{title: Twinkle}\n{start_of_chorus}\n[C]Twinkle [F]little [C]star\n{end_of_chorus}\n'

  it('creates a chart from a JSON body and returns it in getSong', async () => {
    const song = await createSong(seed.tenantA.id, 'Charts')
    const res = await asUserA(
      request(app).post(`/api/songs/${song.id}/charts`).send({ name: 'Guitar', source: SAMPLE }),
    ).expect(201)
    expect(res.body).toMatchObject({ name: 'Guitar', source: SAMPLE })
    expect(res.body.id).toBeGreaterThan(0)

    const got = await asUserA(request(app).get(`/api/songs/${song.id}`)).expect(200)
    expect(got.body.chordpro_charts).toHaveLength(1)
    expect(got.body.chordpro_charts[0].name).toBe('Guitar')
  })

  it('uploads a .cho file, deriving the name from the filename and folding CRLF', async () => {
    const song = await createSong(seed.tenantA.id, 'Charts')
    const res = await asUserA(
      request(app)
        .post(`/api/songs/${song.id}/charts/upload`)
        .attach('file', Buffer.from('[C]hi\r\n[G]there\r\n'), { filename: 'Piano (Bb).cho', contentType: 'text/plain' }),
    ).expect(201)
    expect(res.body.name).toBe('Piano (Bb)')
    expect(res.body.source).toBe('[C]hi\n[G]there\n')
  })

  it('decodes a Latin-1 (ISO-8859-1) upload without corrupting accents', async () => {
    const song = await createSong(seed.tenantA.id, 'Charts')
    const res = await asUserA(
      request(app)
        .post(`/api/songs/${song.id}/charts/upload`)
        .attach('file', Buffer.from('[C]café', 'latin1'), { filename: 'x.cho', contentType: 'application/octet-stream' }),
    ).expect(201)
    expect(res.body.source).toContain('café')
  })

  it('rejects an upload with a disallowed extension (400)', async () => {
    const song = await createSong(seed.tenantA.id, 'Charts')
    await asUserA(
      request(app)
        .post(`/api/songs/${song.id}/charts/upload`)
        .attach('file', Buffer.from('[C]hi'), { filename: 'evil.exe', contentType: 'text/plain' }),
    ).expect(400)
  })

  it('patches a chart name and source', async () => {
    const song = await createSong(seed.tenantA.id, 'Charts')
    const created = await asUserA(
      request(app).post(`/api/songs/${song.id}/charts`).send({ name: 'A', source: 'x' }),
    ).expect(201)
    const res = await asUserA(
      request(app).patch(`/api/songs/${song.id}/charts/${created.body.id}`).send({ name: 'B', source: '[C]y' }),
    ).expect(200)
    expect(res.body).toMatchObject({ name: 'B', source: '[C]y' })
  })

  it('deletes a chart', async () => {
    const song = await createSong(seed.tenantA.id, 'Charts')
    const created = await asUserA(
      request(app).post(`/api/songs/${song.id}/charts`).send({ name: 'A', source: 'x' }),
    ).expect(201)
    await asUserA(request(app).delete(`/api/songs/${song.id}/charts/${created.body.id}`)).expect(204)
    const got = await asUserA(request(app).get(`/api/songs/${song.id}`)).expect(200)
    expect(got.body.chordpro_charts).toEqual([])
  })

  it('tenant isolation — A cannot create a chart on B song (404)', async () => {
    const songB = await createSong(seed.tenantB.id, 'B song')
    await asUserA(
      request(app).post(`/api/songs/${songB.id}/charts`).send({ name: 'x', source: 'y' }),
    ).expect(404)
  })

  it('tenant isolation — A cannot patch or delete B chart (404)', async () => {
    const songB = await createSong(seed.tenantB.id, 'B song')
    const { rows } = await pool.query(
      `INSERT INTO song_chordpro_charts (song_id, tenant_id, name, source)
       VALUES ($1, $2, 'B chart', 'secret') RETURNING id`,
      [songB.id, seed.tenantB.id],
    )
    const chartId = rows[0].id
    await asUserA(
      request(app).patch(`/api/songs/${songB.id}/charts/${chartId}`).send({ source: 'hacked' }),
    ).expect(404)
    await asUserA(request(app).delete(`/api/songs/${songB.id}/charts/${chartId}`)).expect(404)
    // The row is untouched.
    const check = await pool.query('SELECT source FROM song_chordpro_charts WHERE id = $1', [chartId])
    expect(check.rows[0].source).toBe('secret')
  })
})

describe('POST /api/songs/import', () => {
  it('imports new rows, dedupes by title+artist, and creates tags', async () => {
    await createSong(seed.tenantA.id, 'Existing', { artist: 'Band' })
    const res = await asUserA(
      request(app).post('/api/songs/import').send([
        { title: 'Existing', artist: 'Band' }, // dup → skipped
        { title: 'Fresh', artist: 'Band', tempo: '128', tags: 'rock, live' },
        { title: 'Fresh', artist: 'Band' }, // dup within batch → skipped
        { title: '' }, // blank → skipped
      ]),
    ).expect(200)
    expect(res.body).toEqual({ imported: 1, skipped: 3 })

    const { rows } = await pool.query(
      `SELECT s.title, t.name AS tag FROM songs s
         JOIN song_tag_links l ON l.song_id = s.id
         JOIN song_tags t ON t.id = l.tag_id
        WHERE s.tenant_id = $1 AND s.title = 'Fresh' ORDER BY t.name`,
      [seed.tenantA.id],
    )
    expect(rows.map((r) => r.tag)).toEqual(['live', 'rock'])
  })
})
