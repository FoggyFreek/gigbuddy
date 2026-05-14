import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, afterEach, expect, vi } from 'vitest'
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

function asSuperUser(req) {
  return req
    .set('x-test-user-id', String(seed.superUser.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

// ---------------------------------------------------------------------------
// A06 — magic-byte verification for non-image attachments
// ---------------------------------------------------------------------------
describe('attachment upload magic-byte verification', () => {
  it('rejects HTML content declared as application/pdf → 400', async () => {
    const fakePdf = Buffer.from('<html><body>not a real pdf</body></html>')
    const res = await asUserA(
      request(app)
        .post(`/api/gigs/${seed.gigA.id}/attachments`)
        .attach('file', fakePdf, { filename: 'report.pdf', contentType: 'application/pdf' }),
    ).expect(400)
    expect(res.body.error).toMatch(/does not match/i)
  })

  it('rejects PDF bytes declared as application/msword → 400', async () => {
    // PDF magic bytes (%PDF) are not valid for a Word .doc file
    const pdfBytesAsWord = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])
    const res = await asUserA(
      request(app)
        .post(`/api/gigs/${seed.gigA.id}/attachments`)
        .attach('file', pdfBytesAsWord, {
          filename: 'contract.doc',
          contentType: 'application/msword',
        }),
    ).expect(400)
    expect(res.body.error).toMatch(/does not match/i)
  })

  it('rejects binary content (null bytes) declared as text/plain → 400', async () => {
    const binaryBlob = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]) // ELF header
    const res = await asUserA(
      request(app)
        .post(`/api/gigs/${seed.gigA.id}/attachments`)
        .attach('file', binaryBlob, { filename: 'notes.txt', contentType: 'text/plain' }),
    ).expect(400)
    expect(res.body.error).toMatch(/does not match/i)
  })

  it('passes magic-byte check for a valid PDF buffer (proceeds to storage)', async () => {
    // Minimal valid PDF magic bytes — upload will fail at storage (no bucket in
    // test env) returning a 500, but the 400 magic-byte gate must NOT fire.
    const realPdfMagic = Buffer.from([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, // %PDF-1.4
      0x0a, 0x25, 0xc7, 0xec, 0x8f, 0xa2, 0x0a,       // binary comment
    ])
    const res = await asUserA(
      request(app)
        .post(`/api/gigs/${seed.gigA.id}/attachments`)
        .attach('file', realPdfMagic, { filename: 'valid.pdf', contentType: 'application/pdf' }),
    )
    // The magic-byte check passes (not 400). The request proceeds to storage
    // which is unavailable in tests → 500. This confirms the security gate
    // itself did not reject the valid file.
    expect(res.status).not.toBe(400)
  })

  it('rejects upload to a gig in a different tenant → 404', async () => {
    const fakePdf = Buffer.from('<html>fake</html>')
    // userA targeting gigB (different tenant) — should 404 before magic-byte check
    const res = await asUserA(
      request(app)
        .post(`/api/gigs/${seed.gigB.id}/attachments`)
        .attach('file', fakePdf, { filename: 'x.pdf', contentType: 'application/pdf' }),
    ).expect(404)
    expect(res.body.error).toMatch(/not found/i)
  })
})

// ---------------------------------------------------------------------------
// A09 — audit logging for privileged operations
// ---------------------------------------------------------------------------
describe('audit logging', () => {
  afterEach(() => vi.restoreAllMocks())

  function captureAuditLines() {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    return {
      getEntries: () =>
        logSpy.mock.calls.flatMap(([line]) => {
          try {
            return [JSON.parse(line)]
          } catch {
            return []
          }
        }),
      restore: () => logSpy.mockRestore(),
    }
  }

  it('writes invite.create entry when a tenant admin creates an invite', async () => {
    const capture = captureAuditLines()

    await asSuperUser(
      request(app)
        .post('/api/invites')
        .send({ role: 'member', expiresInDays: 7 }),
    ).expect(201)

    capture.restore()
    const entries = capture.getEntries().filter((e) => e.action === 'invite.create')
    expect(entries).toHaveLength(1)
    expect(entries[0].role).toBe('member')
    expect(entries[0].inviteId).toBeDefined()
    expect(entries[0].tenantId).toBe(seed.tenantA.id)
  })

  it('writes invite.revoke entry when an invite is revoked', async () => {
    // Create an invite to revoke
    const createRes = await asSuperUser(
      request(app).post('/api/invites').send({ role: 'member' }),
    ).expect(201)
    const inviteId = createRes.body.id

    const capture = captureAuditLines()

    await asSuperUser(
      request(app).delete(`/api/invites/${inviteId}`),
    ).expect(204)

    capture.restore()
    const entries = capture.getEntries().filter((e) => e.action === 'invite.revoke')
    expect(entries).toHaveLength(1)
    expect(entries[0].inviteId).toBe(inviteId)
  })

  it('writes membership.update entry when a membership is approved', async () => {
    // Create a pending user so we have something to approve
    const { rows: [pending] } = await pool.query(
      `INSERT INTO users (google_sub, email, name, status)
       VALUES ('sub-pend', 'pend@test.local', 'Pending', 'approved') RETURNING id`,
    )
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status)
       VALUES ($1, $2, 'member', 'pending')`,
      [pending.id, seed.tenantA.id],
    )

    const capture = captureAuditLines()

    await asSuperUser(
      request(app)
        .patch(`/api/users/${pending.id}/membership`)
        .send({ status: 'approved' }),
    ).expect(200)

    capture.restore()
    const entries = capture.getEntries().filter((e) => e.action === 'membership.update')
    expect(entries).toHaveLength(1)
    expect(entries[0].targetUserId).toBe(pending.id)
    expect(entries[0].status).toBe('approved')
    expect(entries[0].tenantId).toBe(seed.tenantA.id)
  })

  it('writes membership.remove entry when a membership is deleted', async () => {
    // Add a plain member to remove
    const { rows: [removable] } = await pool.query(
      `INSERT INTO users (google_sub, email, name, status)
       VALUES ('sub-rm', 'rm@test.local', 'Removable', 'approved') RETURNING id`,
    )
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at)
       VALUES ($1, $2, 'member', 'approved', NOW())`,
      [removable.id, seed.tenantA.id],
    )

    const capture = captureAuditLines()

    await asSuperUser(
      request(app).delete(`/api/users/${removable.id}`),
    ).expect(204)

    capture.restore()
    const entries = capture.getEntries().filter((e) => e.action === 'membership.remove')
    expect(entries).toHaveLength(1)
    expect(entries[0].targetUserId).toBe(removable.id)
  })

  it('writes admin.user.delete entry when a super admin deletes a user', async () => {
    const { rows: [victim] } = await pool.query(
      `INSERT INTO users (google_sub, email, name, status)
       VALUES ('sub-del', 'del@test.local', 'Deleted', 'approved') RETURNING id, email`,
    )

    const capture = captureAuditLines()

    await asSuperUser(
      request(app).delete(`/api/admin/users/${victim.id}`),
    ).expect(204)

    capture.restore()
    const entries = capture.getEntries().filter((e) => e.action === 'admin.user.delete')
    expect(entries).toHaveLength(1)
    expect(entries[0].targetUserId).toBe(victim.id)
    expect(entries[0].targetEmail).toBe('del@test.local')
  })
})
