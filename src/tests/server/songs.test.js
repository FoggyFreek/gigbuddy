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

function asUserB(req) {
  return req
    .set('x-test-user-id', String(seed.userB.id))
    .set('x-test-tenant-id', String(seed.tenantB.id))
}

async function createAlbum(tenantId, title, releaseDate = null) {
  const { rows } = await pool.query(
    `INSERT INTO albums (tenant_id, title, release_date)
     VALUES ($1, $2, $3) RETURNING *`,
    [tenantId, title, releaseDate],
  )
  return rows[0]
}

async function createSong(tenantId, title, extra = {}) {
  const { rows } = await pool.query(
    `INSERT INTO songs (tenant_id, title, artist, album_id, song_key, tempo, duration_seconds)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      tenantId,
      title,
      extra.artist ?? null,
      extra.album_id ?? null,
      extra.song_key ?? null,
      extra.tempo ?? null,
      extra.duration_seconds ?? null,
    ],
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

describe('song albums', () => {
  it('creates and searches a bounded tenant-scoped album collection', async () => {
    const created = await asUserA(
      request(app).post('/api/songs/albums').send({ title: 'OK Computer', release_date: '1997-05-21' }),
    ).expect(201)
    await createAlbum(seed.tenantB.id, 'Other Tenant Album', '2001-01-01')

    expect(created.body).toMatchObject({
      title: 'OK Computer',
      release_date: '1997-05-21',
      tenant_id: seed.tenantA.id,
    })

    const result = await asUserA(request(app).get('/api/songs/albums?q=computer&limit=5')).expect(200)
    expect(result.body).toEqual({
      items: [expect.objectContaining({ id: created.body.id, title: 'OK Computer' })],
      meta: { limit: 5, returned: 1 },
    })
  })

  it('rejects malformed album limits and release dates', async () => {
    await asUserA(request(app).get('/api/songs/albums?limit=nope')).expect(400)
    await asUserA(
      request(app).post('/api/songs/albums').send({ title: 'Impossible', release_date: '2026-02-30' }),
    ).expect(400)
  })

  it('allows the same album title in different tenants but not twice in one tenant', async () => {
    await asUserA(request(app).post('/api/songs/albums').send({ title: 'Shared Title' })).expect(201)
    await asUserA(request(app).post('/api/songs/albums').send({ title: 'shared title' })).expect(409)
    await asUserB(request(app).post('/api/songs/albums').send({ title: 'Shared Title' })).expect(201)
  })

  it('edits album metadata only inside the active tenant', async () => {
    const albumA = await createAlbum(seed.tenantA.id, 'Old title', '2000-01-01')
    const albumB = await createAlbum(seed.tenantB.id, 'Other title', '2001-01-01')

    const updated = await asUserA(
      request(app).patch(`/api/songs/albums/${albumA.id}`).send({ title: 'New title', release_date: '2000-02-02' }),
    ).expect(200)
    expect(updated.body).toMatchObject({ title: 'New title', release_date: '2000-02-02' })

    await asUserA(
      request(app).patch(`/api/songs/albums/${albumB.id}`).send({ title: 'Leaked' }),
    ).expect(404)
  })

  it('rejects invalid album-art content and conceals a cross-tenant album', async () => {
    const albumA = await createAlbum(seed.tenantA.id, 'A Album')
    await asUserA(
      request(app)
        .post(`/api/songs/albums/${albumA.id}/art`)
        .attach('art', Buffer.from('not an image'), { filename: 'art.png', contentType: 'image/png' }),
    ).expect(400)

    const sharp = (await import('sharp')).default
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 30, g: 20, b: 10 } },
    }).png().toBuffer()
    const albumB = await createAlbum(seed.tenantB.id, 'B Album')
    await asUserA(
      request(app)
        .post(`/api/songs/albums/${albumB.id}/art`)
        .attach('art', png, { filename: 'art.png', contentType: 'image/png' }),
    ).expect(404)
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

  it('assigns an album from the active tenant and returns its details', async () => {
    const album = await createAlbum(seed.tenantA.id, 'Kid A', '2000-10-02')
    const res = await asUserA(
      request(app).post('/api/songs').send({ title: 'Everything in Its Right Place', album_id: album.id }),
    ).expect(201)

    expect(res.body.album_id).toBe(album.id)
    expect(res.body.album).toMatchObject({ id: album.id, title: 'Kid A', release_date: '2000-10-02' })
  })

  it('tenant isolation — A cannot assign B album while creating a song (404)', async () => {
    const albumB = await createAlbum(seed.tenantB.id, 'B Album')
    await asUserA(
      request(app).post('/api/songs').send({ title: 'Wrong Album', album_id: albumB.id }),
    ).expect(404)
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

  it('tenant isolation — A cannot assign B album to A song (404)', async () => {
    const song = await createSong(seed.tenantA.id, 'A Song')
    const albumB = await createAlbum(seed.tenantB.id, 'B Album')
    await asUserA(
      request(app).patch(`/api/songs/${song.id}`).send({ album_id: albumB.id }),
    ).expect(404)
  })

  it('tenant isolation — A cannot copy B album art onto A song (404)', async () => {
    const song = await createSong(seed.tenantA.id, 'A Song')
    const albumB = await createAlbum(seed.tenantB.id, 'B Album')
    await pool.query(
      'UPDATE albums SET album_art_url = $1 WHERE id = $2',
      [`tenants/${seed.tenantB.id}/album-art/b.webp`, albumB.id],
    )
    await asUserA(
      request(app).post(`/api/songs/${song.id}/cover/from-album`).send({ album_id: albumB.id }),
    ).expect(404)
  })

  it('only copies art from the album currently selected for the song', async () => {
    const selectedAlbum = await createAlbum(seed.tenantA.id, 'Selected Album')
    const otherAlbum = await createAlbum(seed.tenantA.id, 'Other Album')
    const song = await createSong(seed.tenantA.id, 'A Song', { album_id: selectedAlbum.id })
    await pool.query(
      'UPDATE albums SET album_art_url = $1 WHERE id = $2',
      [`tenants/${seed.tenantA.id}/album-art/other.webp`, otherAlbum.id],
    )

    await asUserA(
      request(app).post(`/api/songs/${song.id}/cover/from-album`).send({ album_id: otherAlbum.id }),
    ).expect(400)
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

describe('song cover image', () => {
  // A real decodable PNG (validateAndReencodeImage decodes before the tenant
  // check, so the isolation test needs valid pixels to get past it).
  let PNG_1PX
  beforeAll(async () => {
    const sharp = (await import('sharp')).default
    PNG_1PX = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
    }).png().toBuffer()
  })

  it('rejects a non-image mime type (400)', async () => {
    const song = await createSong(seed.tenantA.id, 'Cover')
    await asUserA(
      request(app)
        .post(`/api/songs/${song.id}/cover`)
        .attach('cover', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' }),
    ).expect(400)
  })

  it('rejects an image mime whose bytes are not that image (400)', async () => {
    const song = await createSong(seed.tenantA.id, 'Cover')
    await asUserA(
      request(app)
        .post(`/api/songs/${song.id}/cover`)
        .attach('cover', Buffer.from('not a png'), { filename: 'x.png', contentType: 'image/png' }),
    ).expect(400)
  })

  it('tenant isolation — A cannot upload a cover on B song (404)', async () => {
    const songB = await createSong(seed.tenantB.id, 'B Song')
    await asUserA(
      request(app)
        .post(`/api/songs/${songB.id}/cover`)
        .attach('cover', PNG_1PX, { filename: 'c.png', contentType: 'image/png' }),
    ).expect(404)
  })

  it('tenant isolation — A cannot delete a cover on B song (404)', async () => {
    const songB = await createSong(seed.tenantB.id, 'B Song')
    await asUserA(request(app).delete(`/api/songs/${songB.id}/cover`)).expect(404)
  })

  it('delete clears the cover path (204)', async () => {
    const song = await createSong(seed.tenantA.id, 'Cover')
    await pool.query(
      'UPDATE songs SET cover_image_path = $1 WHERE id = $2',
      [`tenants/${seed.tenantA.id}/song_covers/x.webp`, song.id],
    )
    await asUserA(request(app).delete(`/api/songs/${song.id}/cover`)).expect(204)
    const { rows } = await pool.query('SELECT cover_image_path FROM songs WHERE id = $1', [song.id])
    expect(rows[0].cover_image_path).toBeNull()
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

  it('rejects a binary file renamed to a valid extension (400)', async () => {
    const song = await createSong(seed.tenantA.id, 'Charts')
    // A PNG header: control + NUL bytes, so it isn't plain-text ChordPro.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
    await asUserA(
      request(app)
        .post(`/api/songs/${song.id}/charts/upload`)
        .attach('file', png, { filename: 'evil.cho', contentType: 'application/octet-stream' }),
    ).expect(400)
  })

  it('rejects a JSON-body create whose source has control bytes (400)', async () => {
    const song = await createSong(seed.tenantA.id, 'Charts')
    await asUserA(
      request(app).post(`/api/songs/${song.id}/charts`).send({ name: 'x', source: '[C]hi\0' }),
    ).expect(400)
  })

  it('rejects a chart PATCH whose source has control bytes (400)', async () => {
    const song = await createSong(seed.tenantA.id, 'Charts')
    const created = await asUserA(
      request(app).post(`/api/songs/${song.id}/charts`).send({ name: 'A', source: '[C]ok' }),
    ).expect(201)
    await asUserA(
      request(app).patch(`/api/songs/${song.id}/charts/${created.body.id}`).send({ source: 'bad\0' }),
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

  it('creates or reuses tenant albums from optional CSV album fields', async () => {
    const existing = await createAlbum(seed.tenantA.id, 'Existing Album')
    const res = await asUserA(
      request(app).post('/api/songs/import').send([
        { title: 'First', album: 'New Album', release_date: '2024-05-17' },
        { title: 'Second', album: 'new album', release_date: '2024-05-17' },
        { title: 'Third', album: 'Existing Album', release_date: '2020-01-02' },
        { title: 'No Album' },
      ]),
    ).expect(200)
    expect(res.body).toEqual({ imported: 4, skipped: 0 })

    const { rows } = await pool.query(
      `SELECT s.title, a.id AS album_id, a.title AS album_title, a.release_date
         FROM songs s
         LEFT JOIN albums a ON a.id = s.album_id AND a.tenant_id = s.tenant_id
        WHERE s.tenant_id = $1 ORDER BY s.title`,
      [seed.tenantA.id],
    )
    expect(rows).toEqual([
      expect.objectContaining({ title: 'First', album_title: 'New Album', release_date: '2024-05-17' }),
      expect.objectContaining({ title: 'No Album', album_id: null, album_title: null }),
      expect.objectContaining({ title: 'Second', album_title: 'New Album', release_date: '2024-05-17' }),
      expect.objectContaining({ title: 'Third', album_id: existing.id, album_title: 'Existing Album', release_date: '2020-01-02' }),
    ])
  })

  it('skips an import row with an invalid album release date', async () => {
    const res = await asUserA(
      request(app).post('/api/songs/import').send([
        { title: 'Bad Date', album: 'Album', release_date: '17-05-2024' },
      ]),
    ).expect(200)
    expect(res.body).toEqual({ imported: 0, skipped: 1 })
  })
})
