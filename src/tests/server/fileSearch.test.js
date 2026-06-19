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

async function addGigAttachment(tenantId, gigId, filename) {
  await pool.query(
    `INSERT INTO gig_attachments (gig_id, tenant_id, object_key, original_filename, content_type, file_size)
     VALUES ($1, $2, $3, $4, 'application/pdf', 1234)`,
    [gigId, tenantId, `tenants/${tenantId}/gig_attachments/${filename}`, filename],
  )
}

async function addSong(tenantId, title) {
  const { rows } = await pool.query(
    'INSERT INTO songs (tenant_id, title) VALUES ($1, $2) RETURNING id',
    [tenantId, title],
  )
  return rows[0].id
}

async function addSongDocument(tenantId, songId, filename) {
  await pool.query(
    `INSERT INTO song_documents (song_id, tenant_id, object_key, original_filename, content_type, file_size)
     VALUES ($1, $2, $3, $4, 'application/pdf', 1234)`,
    [songId, tenantId, `tenants/${tenantId}/song_documents/${filename}`, filename],
  )
}

// Insert an approved contributor user (purchase.create, no finance.view) in a
// tenant, returning its user id.
async function addContributor(tenantId, email) {
  const { rows: [u] } = await pool.query(
    `INSERT INTO users (google_sub, email, name, status, is_super_admin)
     VALUES ($1, $1, 'Contributor', 'approved', false) RETURNING id`,
    [email],
  )
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at)
     VALUES ($1, $2, 'contributor', 'approved', NOW())`,
    [u.id, tenantId],
  )
  return u.id
}

let receiptSeq = 0
async function addPurchaseWithReceipt(tenantId, createdByUserId, filename) {
  const { rows: [p] } = await pool.query(
    `INSERT INTO purchases (tenant_id, receipt_number, supplier_name, created_by_user_id)
     VALUES ($1, $2, 'A Supplier', $3) RETURNING id`,
    [tenantId, ++receiptSeq, createdByUserId],
  )
  await pool.query(
    `INSERT INTO purchase_attachments (purchase_id, tenant_id, object_key, original_filename, content_type, file_size)
     VALUES ($1, $2, $3, $4, 'application/pdf', 1234)`,
    [p.id, tenantId, `tenants/${tenantId}/purchase_attachments/${filename}`, filename],
  )
  return p.id
}

describe('GET /api/files/search', () => {
  it('matches gig attachments by filename and links to the owning gig', async () => {
    await addGigAttachment(seed.tenantA.id, seed.gigA.id, 'stage_plan.pdf')
    const res = await asUserA(request(app).get('/api/files/search').query({ q: 'stage' })).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({
      filename: 'stage_plan.pdf',
      kind: 'Gig attachment',
      to: `/gigs/${seed.gigA.id}`,
    })
  })

  it('matches song documents by filename and links to the owning song', async () => {
    const songId = await addSong(seed.tenantA.id, 'Riffmaster')
    await addSongDocument(seed.tenantA.id, songId, 'riff_chart.pdf')
    const res = await asUserA(request(app).get('/api/files/search').query({ q: 'riff' })).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({ kind: 'Sheet music', to: `/songs/${songId}` })
  })

  it('returns nothing for queries shorter than 3 characters', async () => {
    await addGigAttachment(seed.tenantA.id, seed.gigA.id, 'stage_plan.pdf')
    const res = await asUserA(request(app).get('/api/files/search').query({ q: 'st' })).expect(200)
    expect(res.body).toEqual([])
  })

  it('isolates tenants: userA cannot find tenant B files', async () => {
    await addGigAttachment(seed.tenantB.id, seed.gigB.id, 'secret_beta.pdf')
    const res = await asUserA(request(app).get('/api/files/search').query({ q: 'secret_beta' })).expect(200)
    expect(res.body).toEqual([])
  })

  it('finance.view (tenant admin) finds purchase receipts and links to the purchase', async () => {
    const contributorId = await addContributor(seed.tenantA.id, 'contrib-a@test.local')
    const purchaseId = await addPurchaseWithReceipt(seed.tenantA.id, contributorId, 'amp_receipt.pdf')
    const res = await asUserA(request(app).get('/api/files/search').query({ q: 'amp_receipt' })).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({
      filename: 'amp_receipt.pdf',
      kind: 'Purchase receipt',
      to: `/purchases/${purchaseId}`,
    })
  })

  it('a contributor sees only receipts on purchases they created, not others', async () => {
    const contributorId = await addContributor(seed.tenantA.id, 'contrib-a@test.local')
    const otherId = await addContributor(seed.tenantA.id, 'contrib-b@test.local')
    const ownPurchase = await addPurchaseWithReceipt(seed.tenantA.id, contributorId, 'mine_receipt.pdf')
    await addPurchaseWithReceipt(seed.tenantA.id, otherId, 'theirs_receipt.pdf')

    const asContributor = (req) =>
      req.set('x-test-user-id', String(contributorId)).set('x-test-tenant-id', String(seed.tenantA.id))

    const res = await asContributor(request(app).get('/api/files/search').query({ q: 'receipt' })).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({ filename: 'mine_receipt.pdf', to: `/purchases/${ownPurchase}` })
  })
})
