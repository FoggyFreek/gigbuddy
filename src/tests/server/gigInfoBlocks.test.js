import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import request from 'supertest'

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'server/db/migrations/190_gig_info_blocks.sql',
)

let app, pool, runMigrations, truncateAll, seedTwoTenants
let seed, migrationSql

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  app = appMod.createTestApp()
  migrationSql = await readFile(MIGRATION_PATH, 'utf8')
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

function addBlock(gigId, body) {
  return asUserA(request(app).post(`/api/gigs/${gigId}/info-blocks`).send(body))
}

describe('gig info blocks — CRUD', () => {
  it('starts a gig with no blocks at all', async () => {
    const res = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}/info-blocks`)).expect(200)
    expect(res.body).toEqual([])
  })

  it('adds a canonical-label block and returns it on the gig detail', async () => {
    const created = await addBlock(seed.gigA.id, {
      label: 'timetable', label_is_custom: false, content: '18:00 load in\n20:30 stage',
    }).expect(201)
    expect(created.body).toMatchObject({
      label: 'timetable',
      label_is_custom: false,
      content: '18:00 load in\n20:30 stage',
      position: 0,
    })

    const gig = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}`)).expect(200)
    expect(gig.body.info_blocks).toHaveLength(1)
    expect(gig.body.info_blocks[0].label).toBe('timetable')
  })

  it('accepts a label the user typed themselves', async () => {
    const created = await addBlock(seed.gigA.id, {
      label: '  Shuttle bus  ', label_is_custom: true, content: '',
    }).expect(201)
    expect(created.body).toMatchObject({ label: 'Shuttle bus', label_is_custom: true, content: '' })
  })

  it('appends each new block after the last one', async () => {
    await addBlock(seed.gigA.id, { label: 'catering', label_is_custom: false }).expect(201)
    const second = await addBlock(seed.gigA.id, { label: 'backline', label_is_custom: false }).expect(201)
    expect(second.body.position).toBe(1)

    const list = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}/info-blocks`)).expect(200)
    expect(list.body.map((b) => b.label)).toEqual(['catering', 'backline'])
  })

  it('patches content without touching the label', async () => {
    const created = await addBlock(seed.gigA.id, {
      label: 'hospitality', label_is_custom: false, content: 'Towels',
    }).expect(201)

    const patched = await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}/info-blocks/${created.body.id}`).send({ content: 'Towels, water' })
    ).expect(200)
    expect(patched.body).toMatchObject({ label: 'hospitality', label_is_custom: false, content: 'Towels, water' })
  })

  it('patches the label without touching the content', async () => {
    const created = await addBlock(seed.gigA.id, {
      label: 'light', label_is_custom: false, content: 'Two blinders',
    }).expect(201)

    const patched = await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}/info-blocks/${created.body.id}`)
        .send({ label: 'Lighting plot', label_is_custom: true })
    ).expect(200)
    expect(patched.body).toMatchObject({
      label: 'Lighting plot', label_is_custom: true, content: 'Two blinders',
    })
  })

  it('deletes a block', async () => {
    const created = await addBlock(seed.gigA.id, { label: 'press', label_is_custom: false }).expect(201)
    await asUserA(request(app).delete(`/api/gigs/${seed.gigA.id}/info-blocks/${created.body.id}`)).expect(204)

    const list = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}/info-blocks`)).expect(200)
    expect(list.body).toEqual([])
  })

  it('cascades away with the gig', async () => {
    await addBlock(seed.gigA.id, { label: 'guestlist', label_is_custom: false }).expect(201)
    await asUserA(request(app).delete(`/api/gigs/${seed.gigA.id}`)).expect(204)

    const { rows } = await pool.query('SELECT 1 FROM gig_info_blocks WHERE gig_id = $1', [seed.gigA.id])
    expect(rows).toHaveLength(0)
  })
})

describe('gig info blocks — validation', () => {
  it('rejects a non-canonical label that is not flagged custom', async () => {
    await addBlock(seed.gigA.id, { label: 'Shuttle bus', label_is_custom: false }).expect(400)
  })

  it('rejects a blank custom label', async () => {
    await addBlock(seed.gigA.id, { label: '   ', label_is_custom: true }).expect(400)
  })

  it('rejects a custom label longer than the cap', async () => {
    await addBlock(seed.gigA.id, { label: 'x'.repeat(61), label_is_custom: true }).expect(400)
  })

  it('rejects a patch that moves the label without saying whether it is custom', async () => {
    const created = await addBlock(seed.gigA.id, { label: 'recording', label_is_custom: false }).expect(201)
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}/info-blocks/${created.body.id}`).send({ label: 'Live tape' })
    ).expect(400)
  })

  it('rejects content over the cap', async () => {
    await addBlock(seed.gigA.id, {
      label: 'remarks', label_is_custom: false, content: 'x'.repeat(20001),
    }).expect(400)
  })

  it('rejects a patch with nothing to write', async () => {
    const created = await addBlock(seed.gigA.id, { label: 'remarks', label_is_custom: false }).expect(201)
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}/info-blocks/${created.body.id}`).send({})
    ).expect(400)
  })

  it('caps the number of blocks per gig', async () => {
    for (let i = 0; i < 30; i += 1) {
      await addBlock(seed.gigA.id, { label: `Block ${i}`, label_is_custom: true }).expect(201)
    }
    await addBlock(seed.gigA.id, { label: 'One too many', label_is_custom: true }).expect(400)
  })
})

describe('gig info blocks — tenant isolation', () => {
  it("404s a read of another tenant's gig info blocks", async () => {
    await asUserB(request(app).get(`/api/gigs/${seed.gigA.id}/info-blocks`)).expect(404)
  })

  it("404s a write to another tenant's gig", async () => {
    await asUserB(
      request(app).post(`/api/gigs/${seed.gigA.id}/info-blocks`).send({ label: 'press', label_is_custom: false })
    ).expect(404)

    const { rows } = await pool.query('SELECT 1 FROM gig_info_blocks WHERE gig_id = $1', [seed.gigA.id])
    expect(rows).toHaveLength(0)
  })

  it("404s an update or delete of another tenant's block", async () => {
    const created = await addBlock(seed.gigA.id, {
      label: 'catering', label_is_custom: false, content: 'Vegan x2',
    }).expect(201)

    await asUserB(
      request(app).patch(`/api/gigs/${seed.gigA.id}/info-blocks/${created.body.id}`).send({ content: 'Hijacked' })
    ).expect(404)
    await asUserB(
      request(app).delete(`/api/gigs/${seed.gigA.id}/info-blocks/${created.body.id}`)
    ).expect(404)

    const { rows } = await pool.query('SELECT content FROM gig_info_blocks WHERE id = $1', [created.body.id])
    expect(rows[0].content).toBe('Vegan x2')
  })

  it('404s a block addressed through the wrong gig in the same tenant', async () => {
    const other = await asUserA(
      request(app).post('/api/gigs').send({ event_date: '2026-10-01', event_description: 'Other gig' })
    ).expect(201)
    const created = await addBlock(seed.gigA.id, { label: 'backline', label_is_custom: false }).expect(201)

    await asUserA(
      request(app).delete(`/api/gigs/${other.body.id}/info-blocks/${created.body.id}`)
    ).expect(404)
    await asUserA(
      request(app).patch(`/api/gigs/${other.body.id}/info-blocks/${created.body.id}`).send({ content: 'x' })
    ).expect(404)

    const { rows } = await pool.query('SELECT 1 FROM gig_info_blocks WHERE id = $1', [created.body.id])
    expect(rows).toHaveLength(1)
  })
})

// Migration 190's backfill runs exactly once in production, against data the
// already-migrated test template never reproduces. These tests reconstruct the
// legacy shape (content in gigs.notes, no block rows) and replay the migration,
// which is written to be re-runnable for exactly this reason.
describe('gig info blocks — migration 190 backfill', () => {
  async function blocksFor(gigId) {
    const { rows } = await pool.query(
      'SELECT label, label_is_custom, content, position FROM gig_info_blocks WHERE gig_id = $1 ORDER BY id',
      [gigId],
    )
    return rows
  }

  it("moves a gig's notes into its Remarks block", async () => {
    await pool.query('UPDATE gigs SET notes = $1 WHERE id = $2', ['Bring own PA', seed.gigA.id])
    await pool.query(migrationSql)

    expect(await blocksFor(seed.gigA.id)).toEqual([
      { label: 'remarks', label_is_custom: false, content: 'Bring own PA', position: 0 },
    ])
  })

  it('leaves a gig with blank or absent notes without a block', async () => {
    await pool.query('UPDATE gigs SET notes = $1 WHERE id = $2', ['   ', seed.gigA.id])
    await pool.query('UPDATE gigs SET notes = NULL WHERE id = $1', [seed.gigB.id])
    await pool.query(migrationSql)

    expect(await blocksFor(seed.gigA.id)).toEqual([])
    expect(await blocksFor(seed.gigB.id)).toEqual([])
  })

  it('backfills each gig into its own tenant', async () => {
    await pool.query('UPDATE gigs SET notes = $1 WHERE id = $2', ['Alpha notes', seed.gigA.id])
    await pool.query('UPDATE gigs SET notes = $1 WHERE id = $2', ['Beta notes', seed.gigB.id])
    await pool.query(migrationSql)

    const { rows } = await pool.query(
      'SELECT gig_id, tenant_id, content FROM gig_info_blocks ORDER BY gig_id',
    )
    expect(rows).toEqual(
      [
        { gig_id: seed.gigA.id, tenant_id: seed.tenantA.id, content: 'Alpha notes' },
        { gig_id: seed.gigB.id, tenant_id: seed.tenantB.id, content: 'Beta notes' },
      ].sort((a, b) => a.gig_id - b.gig_id),
    )
  })

  it('does not duplicate or overwrite blocks a replay finds already there', async () => {
    await pool.query('UPDATE gigs SET notes = $1 WHERE id = $2', ['Bring own PA', seed.gigA.id])
    await pool.query(migrationSql)

    // The band has since edited the block and added a second one.
    await pool.query(
      "UPDATE gig_info_blocks SET content = 'Bring own PA and a spare DI' WHERE gig_id = $1",
      [seed.gigA.id],
    )
    await addBlock(seed.gigA.id, { label: 'catering', label_is_custom: false, content: 'Vegan x2' }).expect(201)

    await pool.query(migrationSql)

    expect(await blocksFor(seed.gigA.id)).toEqual([
      { label: 'remarks', label_is_custom: false, content: 'Bring own PA and a spare DI', position: 0 },
      { label: 'catering', label_is_custom: false, content: 'Vegan x2', position: 1 },
    ])
  })
})
