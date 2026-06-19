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

// Act as an arbitrary (user, tenant) pair — used to prove notes are per-member.
function asUser(req, userId, tenantId) {
  return req
    .set('x-test-user-id', String(userId))
    .set('x-test-tenant-id', String(tenantId))
}

async function createSong(tenantId, title, durationSeconds) {
  const { rows } = await pool.query(
    'INSERT INTO songs (tenant_id, title, duration_seconds) VALUES ($1, $2, $3) RETURNING *',
    [tenantId, title, durationSeconds],
  )
  return rows[0]
}

async function createSetlistA(name = 'Main Set') {
  const res = await asUserA(request(app).post('/api/setlists').send({ name })).expect(201)
  return res.body
}

describe('POST /api/setlists', () => {
  it('creates a setlist with a default "Set 1"', async () => {
    const setlist = await createSetlistA()
    const tree = await asUserA(request(app).get(`/api/setlists/${setlist.id}`)).expect(200)
    expect(tree.body.sets).toHaveLength(1)
    expect(tree.body.sets[0].name).toBe('Set 1')
    expect(tree.body.sets[0].items).toEqual([])
  })

  it('400 on blank name', async () => {
    await asUserA(request(app).post('/api/setlists').send({ name: '  ' })).expect(400)
  })
})

describe('GET /api/setlists — aggregates honor per-set include_in_total', () => {
  it('excludes a set when include_in_total is false', async () => {
    const song1 = await createSong(seed.tenantA.id, 'A', 100)
    const song2 = await createSong(seed.tenantA.id, 'B', 200)
    const setlist = await createSetlistA()
    const tree = await asUserA(request(app).get(`/api/setlists/${setlist.id}`)).expect(200)
    const set1 = tree.body.sets[0].id

    // Set 1: a 100s song + a 30s pause = 130 counted.
    await asUserA(request(app).post(`/api/setlists/${setlist.id}/sets/${set1}/items`)
      .send({ item_type: 'song', song_id: song1.id })).expect(201)
    await asUserA(request(app).post(`/api/setlists/${setlist.id}/sets/${set1}/items`)
      .send({ item_type: 'pause', duration_seconds: 30 })).expect(201)

    // Set 2 excluded from total, holds a 200s song.
    const set2Res = await asUserA(request(app).post(`/api/setlists/${setlist.id}/sets`).send({})).expect(201)
    const set2 = set2Res.body.id
    await asUserA(request(app).patch(`/api/setlists/${setlist.id}/sets/${set2}`)
      .send({ include_in_total: false })).expect(200)
    await asUserA(request(app).post(`/api/setlists/${setlist.id}/sets/${set2}/items`)
      .send({ item_type: 'song', song_id: song2.id })).expect(201)

    const list = await asUserA(request(app).get('/api/setlists')).expect(200)
    const row = list.body.find((s) => s.id === setlist.id)
    expect(row.total_seconds).toBe(130)
    expect(row.set_count).toBe(2)
    expect(row.song_count).toBe(2)
  })
})

describe('Items reorder + cross-set move', () => {
  it('moves an item from one set to another and persists order', async () => {
    const song1 = await createSong(seed.tenantA.id, 'A', 100)
    const song2 = await createSong(seed.tenantA.id, 'B', 100)
    const setlist = await createSetlistA()
    const tree = await asUserA(request(app).get(`/api/setlists/${setlist.id}`)).expect(200)
    const set1 = tree.body.sets[0].id
    const set2Res = await asUserA(request(app).post(`/api/setlists/${setlist.id}/sets`).send({})).expect(201)
    const set2 = set2Res.body.id

    const i1 = (await asUserA(request(app).post(`/api/setlists/${setlist.id}/sets/${set1}/items`)
      .send({ item_type: 'song', song_id: song1.id })).expect(201)).body
    const i2 = (await asUserA(request(app).post(`/api/setlists/${setlist.id}/sets/${set1}/items`)
      .send({ item_type: 'song', song_id: song2.id })).expect(201)).body

    // Move i1 to set2; keep i2 in set1.
    await asUserA(request(app).patch(`/api/setlists/${setlist.id}/items/reorder`).send({
      sets: [
        { setId: set1, itemIds: [i2.id] },
        { setId: set2, itemIds: [i1.id] },
      ],
    })).expect(200)

    const after = await asUserA(request(app).get(`/api/setlists/${setlist.id}`)).expect(200)
    const s1 = after.body.sets.find((s) => s.id === set1)
    const s2 = after.body.sets.find((s) => s.id === set2)
    expect(s1.items.map((x) => x.id)).toEqual([i2.id])
    expect(s2.items.map((x) => x.id)).toEqual([i1.id])
  })

  it('rejects a reorder payload that drops or injects items (400)', async () => {
    const song1 = await createSong(seed.tenantA.id, 'A', 100)
    const setlist = await createSetlistA()
    const tree = await asUserA(request(app).get(`/api/setlists/${setlist.id}`)).expect(200)
    const set1 = tree.body.sets[0].id
    const i1 = (await asUserA(request(app).post(`/api/setlists/${setlist.id}/sets/${set1}/items`)
      .send({ item_type: 'song', song_id: song1.id })).expect(201)).body

    // Inject a non-existent item id.
    await asUserA(request(app).patch(`/api/setlists/${setlist.id}/items/reorder`).send({
      sets: [{ setId: set1, itemIds: [i1.id, 99999] }],
    })).expect(400)
  })
})

describe('Song transitions (segue links)', () => {
  // Create N songs and add them as song items to set1 of a fresh setlist.
  async function setupSongs(count) {
    const setlist = await createSetlistA()
    const tree = await asUserA(request(app).get(`/api/setlists/${setlist.id}`)).expect(200)
    const set1 = tree.body.sets[0].id
    const items = []
    for (let i = 0; i < count; i++) {
      const song = await createSong(seed.tenantA.id, `S${i}`, 100)
      const item = (await asUserA(request(app).post(`/api/setlists/${setlist.id}/sets/${set1}/items`)
        .send({ item_type: 'song', song_id: song.id })).expect(201)).body
      items.push(item)
    }
    return { setlistId: setlist.id, set1, items }
  }

  function getTree(setlistId) {
    return asUserA(request(app).get(`/api/setlists/${setlistId}`)).expect(200)
  }

  it('links two songs with a note and round-trips through the tree', async () => {
    const { setlistId, items: [a] } = await setupSongs(2)
    const res = await asUserA(request(app).patch(`/api/setlists/${setlistId}/items/${a.id}`)
      .send({ linked_to_next: true, transition_note: 'key change to A' })).expect(200)
    // PATCH on a song re-enriches its response (guards the NULL-duration blanking bug).
    expect(res.body.title).toBe('S0')
    expect(res.body.duration_seconds).toBe(100)
    expect(res.body.linked_to_next).toBe(true)

    const tree = await getTree(setlistId)
    const stored = tree.body.sets[0].items.find((it) => it.id === a.id)
    expect(stored.linked_to_next).toBe(true)
    expect(stored.transition_note).toBe('key change to A')
  })

  it('unlinking clears the note even when the client omits it', async () => {
    const { setlistId, items: [a] } = await setupSongs(2)
    await asUserA(request(app).patch(`/api/setlists/${setlistId}/items/${a.id}`)
      .send({ linked_to_next: true, transition_note: 'segue' })).expect(200)
    await asUserA(request(app).patch(`/api/setlists/${setlistId}/items/${a.id}`)
      .send({ linked_to_next: false })).expect(200)

    const tree = await getTree(setlistId)
    const stored = tree.body.sets[0].items.find((it) => it.id === a.id)
    expect(stored.linked_to_next).toBe(false)
    expect(stored.transition_note).toBeNull()
  })

  it('rejects link fields on a non-song item (400)', async () => {
    const { setlistId, set1 } = await setupSongs(0)
    const pause = (await asUserA(request(app).post(`/api/setlists/${setlistId}/sets/${set1}/items`)
      .send({ item_type: 'pause', duration_seconds: 30 })).expect(201)).body
    await asUserA(request(app).patch(`/api/setlists/${setlistId}/items/${pause.id}`)
      .send({ linked_to_next: true })).expect(400)
  })

  it('auto-clears a link when the upper song moves away from its partner (reorder)', async () => {
    const { setlistId, set1, items: [a, b] } = await setupSongs(2)
    await asUserA(request(app).patch(`/api/setlists/${setlistId}/items/${a.id}`)
      .send({ linked_to_next: true, transition_note: 'segue' })).expect(200)
    // Swap order: a is now last with no follower.
    const res = await asUserA(request(app).patch(`/api/setlists/${setlistId}/items/reorder`)
      .send({ sets: [{ setId: set1, itemIds: [b.id, a.id] }] })).expect(200)
    expect(res.body.clearedIds).toContain(a.id)
    const tree = await getTree(setlistId)
    expect(tree.body.sets[0].items.find((it) => it.id === a.id).linked_to_next).toBe(false)
  })

  it('auto-clears a link when the follower moves away (reorder)', async () => {
    const { setlistId, set1, items: [a, b, c] } = await setupSongs(3)
    await asUserA(request(app).patch(`/api/setlists/${setlistId}/items/${a.id}`)
      .send({ linked_to_next: true })).expect(200)
    // a now followed by c instead of b.
    const res = await asUserA(request(app).patch(`/api/setlists/${setlistId}/items/reorder`)
      .send({ sets: [{ setId: set1, itemIds: [a.id, c.id, b.id] }] })).expect(200)
    expect(res.body.clearedIds).toContain(a.id)
  })

  it('auto-clears a link when the follower becomes a pause (reorder)', async () => {
    const { setlistId, set1, items: [a, b] } = await setupSongs(2)
    const pause = (await asUserA(request(app).post(`/api/setlists/${setlistId}/sets/${set1}/items`)
      .send({ item_type: 'pause', duration_seconds: 30 })).expect(201)).body
    await asUserA(request(app).patch(`/api/setlists/${setlistId}/items/${a.id}`)
      .send({ linked_to_next: true })).expect(200)
    // Insert the pause between a and b.
    const res = await asUserA(request(app).patch(`/api/setlists/${setlistId}/items/reorder`)
      .send({ sets: [{ setId: set1, itemIds: [a.id, pause.id, b.id] }] })).expect(200)
    expect(res.body.clearedIds).toContain(a.id)
  })

  // Whichever of the two linked songs gets dragged out of the linked position,
  // the link (and its note) must break. The reorder endpoint is what a drag
  // persists, so each case reorders set1 into the post-drag order.
  it.each([
    ['the linked (upper) song is dragged away', (a, b, c) => [b.id, c.id, a.id]],
    ['its follower song is dragged away', (a, b, c) => [a.id, c.id, b.id]],
  ])('breaks the link when %s', async (_label, newOrder) => {
    const { setlistId, set1, items } = await setupSongs(3)
    const [a, b, c] = items
    await asUserA(request(app).patch(`/api/setlists/${setlistId}/items/${a.id}`)
      .send({ linked_to_next: true, transition_note: 'segue' })).expect(200)

    const res = await asUserA(request(app).patch(`/api/setlists/${setlistId}/items/reorder`)
      .send({ sets: [{ setId: set1, itemIds: newOrder(a, b, c) }] })).expect(200)

    expect(res.body.clearedIds).toContain(a.id)
    const stored = (await getTree(setlistId)).body.sets[0].items.find((it) => it.id === a.id)
    expect(stored.linked_to_next).toBe(false)
    expect(stored.transition_note).toBeNull()
  })

  it('preserves a link when adjacency is unchanged (reorder)', async () => {
    const { setlistId, set1, items: [a, b, c] } = await setupSongs(3)
    await asUserA(request(app).patch(`/api/setlists/${setlistId}/items/${a.id}`)
      .send({ linked_to_next: true, transition_note: 'segue' })).expect(200)
    // Move c to the front; a is still immediately followed by b.
    const res = await asUserA(request(app).patch(`/api/setlists/${setlistId}/items/reorder`)
      .send({ sets: [{ setId: set1, itemIds: [c.id, a.id, b.id] }] })).expect(200)
    expect(res.body.clearedIds).toEqual([])
    const tree = await getTree(setlistId)
    const stored = tree.body.sets[0].items.find((it) => it.id === a.id)
    expect(stored.linked_to_next).toBe(true)
    expect(stored.transition_note).toBe('segue')
  })

  it('auto-clears the predecessor link when the follower is deleted', async () => {
    const { setlistId, items: [a, b] } = await setupSongs(2)
    await asUserA(request(app).patch(`/api/setlists/${setlistId}/items/${a.id}`)
      .send({ linked_to_next: true, transition_note: 'segue' })).expect(200)
    const res = await asUserA(request(app).delete(`/api/setlists/${setlistId}/items/${b.id}`)).expect(200)
    expect(res.body.clearedIds).toEqual([a.id])
    const tree = await getTree(setlistId)
    const stored = tree.body.sets[0].items.find((it) => it.id === a.id)
    expect(stored.linked_to_next).toBe(false)
    expect(stored.transition_note).toBeNull()
  })

  it('does not clear unrelated links when a non-follower is deleted', async () => {
    const { setlistId, items: [a, , c] } = await setupSongs(3)
    await asUserA(request(app).patch(`/api/setlists/${setlistId}/items/${a.id}`)
      .send({ linked_to_next: true })).expect(200)
    const res = await asUserA(request(app).delete(`/api/setlists/${setlistId}/items/${c.id}`)).expect(200)
    expect(res.body.clearedIds).toEqual([])
    const tree = await getTree(setlistId)
    expect(tree.body.sets[0].items.find((it) => it.id === a.id).linked_to_next).toBe(true)
  })
})

describe('tenant isolation', () => {
  it('A cannot read/patch/delete B setlist (404)', async () => {
    const { rows } = await pool.query(
      'INSERT INTO setlists (tenant_id, name) VALUES ($1, $2) RETURNING id',
      [seed.tenantB.id, 'B list'],
    )
    const bId = rows[0].id
    await asUserA(request(app).get(`/api/setlists/${bId}`)).expect(404)
    await asUserA(request(app).patch(`/api/setlists/${bId}`).send({ name: 'x' })).expect(404)
    await asUserA(request(app).delete(`/api/setlists/${bId}`)).expect(404)
  })

  it('A cannot add an item referencing B song (404)', async () => {
    const songB = await createSong(seed.tenantB.id, 'B song', 100)
    const setlist = await createSetlistA()
    const tree = await asUserA(request(app).get(`/api/setlists/${setlist.id}`)).expect(200)
    const set1 = tree.body.sets[0].id
    await asUserA(request(app).post(`/api/setlists/${setlist.id}/sets/${set1}/items`)
      .send({ item_type: 'song', song_id: songB.id })).expect(404)
  })

  it('A cannot link/patch a B item (404)', async () => {
    const sl = (await pool.query(
      'INSERT INTO setlists (tenant_id, name) VALUES ($1, $2) RETURNING id', [seed.tenantB.id, 'B'])).rows[0]
    const st = (await pool.query(
      'INSERT INTO setlist_sets (setlist_id, tenant_id, name) VALUES ($1, $2, $3) RETURNING id',
      [sl.id, seed.tenantB.id, 'S'])).rows[0]
    const songB = await createSong(seed.tenantB.id, 'b', 100)
    const item = (await pool.query(
      'INSERT INTO setlist_items (set_id, tenant_id, item_type, song_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [st.id, seed.tenantB.id, 'song', songB.id])).rows[0]
    await asUserA(request(app).patch(`/api/setlists/${sl.id}/items/${item.id}`)
      .send({ linked_to_next: true })).expect(404)
  })

  it('GET /api/setlists lists only the active tenant', async () => {
    await createSetlistA('Mine')
    await pool.query('INSERT INTO setlists (tenant_id, name) VALUES ($1, $2)', [seed.tenantB.id, 'Theirs'])
    const list = await asUserA(request(app).get('/api/setlists')).expect(200)
    expect(list.body).toHaveLength(1)
    expect(list.body[0].name).toBe('Mine')
  })
})

describe('Per-member song notes', () => {
  // A song item in set 1 of a fresh tenant-A setlist.
  async function setupSongItem() {
    const song = await createSong(seed.tenantA.id, 'Note song', 100)
    const setlist = await createSetlistA()
    const tree = await asUserA(request(app).get(`/api/setlists/${setlist.id}`)).expect(200)
    const set1 = tree.body.sets[0].id
    const item = (await asUserA(request(app).post(`/api/setlists/${setlist.id}/sets/${set1}/items`)
      .send({ item_type: 'song', song_id: song.id })).expect(201)).body
    return { setlistId: setlist.id, set1, item }
  }

  function noteFor(userId, setlistId, itemId) {
    return asUser(request(app).get(`/api/setlists/${setlistId}`), userId, seed.tenantA.id)
      .expect(200)
      .then((res) => res.body.sets[0].items.find((it) => it.id === itemId).my_note)
  }

  it('keeps each member’s note private to that member', async () => {
    const { setlistId, item } = await setupSongItem()

    // userA and superUser are both approved members of tenant A.
    const a = await asUser(request(app).put(`/api/setlists/${setlistId}/items/${item.id}/note`)
      .send({ note: 'capo 2' }), seed.userA.id, seed.tenantA.id).expect(200)
    expect(a.body).toEqual({ my_note: 'capo 2' })

    await asUser(request(app).put(`/api/setlists/${setlistId}/items/${item.id}/note`)
      .send({ note: 'drop D' }), seed.superUser.id, seed.tenantA.id).expect(200)

    expect(await noteFor(seed.userA.id, setlistId, item.id)).toBe('capo 2')
    expect(await noteFor(seed.superUser.id, setlistId, item.id)).toBe('drop D')
  })

  it('round-trips a note and updates it in place', async () => {
    const { setlistId, item } = await setupSongItem()
    await asUserA(request(app).put(`/api/setlists/${setlistId}/items/${item.id}/note`)
      .send({ note: 'first' })).expect(200)
    await asUserA(request(app).put(`/api/setlists/${setlistId}/items/${item.id}/note`)
      .send({ note: 'second' })).expect(200)
    expect(await noteFor(seed.userA.id, setlistId, item.id)).toBe('second')
  })

  it('clears the note on an empty/whitespace body and returns null', async () => {
    const { setlistId, item } = await setupSongItem()
    await asUserA(request(app).put(`/api/setlists/${setlistId}/items/${item.id}/note`)
      .send({ note: 'temp' })).expect(200)
    const res = await asUserA(request(app).put(`/api/setlists/${setlistId}/items/${item.id}/note`)
      .send({ note: '   ' })).expect(200)
    expect(res.body).toEqual({ my_note: null })
    expect(await noteFor(seed.userA.id, setlistId, item.id)).toBeNull()
  })

  it('rejects a note on a non-song item (400)', async () => {
    const { setlistId, set1 } = await setupSongItem()
    const pause = (await asUserA(request(app).post(`/api/setlists/${setlistId}/sets/${set1}/items`)
      .send({ item_type: 'pause', duration_seconds: 30 })).expect(201)).body
    await asUserA(request(app).put(`/api/setlists/${setlistId}/items/${pause.id}/note`)
      .send({ note: 'nope' })).expect(400)
  })

  it('A cannot note a B item (404)', async () => {
    const sl = (await pool.query(
      'INSERT INTO setlists (tenant_id, name) VALUES ($1, $2) RETURNING id', [seed.tenantB.id, 'B'])).rows[0]
    const st = (await pool.query(
      'INSERT INTO setlist_sets (setlist_id, tenant_id, name) VALUES ($1, $2, $3) RETURNING id',
      [sl.id, seed.tenantB.id, 'S'])).rows[0]
    const songB = await createSong(seed.tenantB.id, 'b', 100)
    const item = (await pool.query(
      'INSERT INTO setlist_items (set_id, tenant_id, item_type, song_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [st.id, seed.tenantB.id, 'song', songB.id])).rows[0]
    await asUserA(request(app).put(`/api/setlists/${sl.id}/items/${item.id}/note`)
      .send({ note: 'leak' })).expect(404)
  })
})

describe('GET /api/setlists/search', () => {
  const names = (res) => res.body.map((s) => s.name)

  it('matches setlists by name', async () => {
    await createSetlistA('Summer Tour Set')
    await createSetlistA('Acoustic Evening')
    const res = await asUserA(request(app).get('/api/setlists/search').query({ q: 'Summer' })).expect(200)
    expect(names(res)).toEqual(['Summer Tour Set'])
  })

  it('returns nothing for queries shorter than 3 characters', async () => {
    await createSetlistA('Summer Tour Set')
    const res = await asUserA(request(app).get('/api/setlists/search').query({ q: 'Su' })).expect(200)
    expect(res.body).toEqual([])
  })

  it('isolates tenants: userA cannot find tenant B setlists', async () => {
    await pool.query('INSERT INTO setlists (tenant_id, name) VALUES ($1, $2)',
      [seed.tenantB.id, 'Beta Secret Set'])
    const res = await asUserA(request(app).get('/api/setlists/search').query({ q: 'Beta Secret' })).expect(200)
    expect(res.body).toEqual([])
  })
})
