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
  const fixtureDb = await import('./_db.js')
  seed = await fixtureDb.seedAccountingForTenants(seed)
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

const listSchemes = () => asUserA(request(app).get('/api/accounting-profile/schemes'))
const startScheme = (body) => asUserA(request(app).post('/api/accounting-profile/schemes')).send(body)
const patchScheme = (id, body) => asUserA(request(app).patch(`/api/accounting-profile/schemes/${id}`)).send(body)
const voidScheme = (id, body = {}) => asUserA(request(app).post(`/api/accounting-profile/schemes/${id}/void`)).send(body)
const deleteScheme = (id) => asUserA(request(app).delete(`/api/accounting-profile/schemes/${id}`))

const getProfile = () => asUserA(request(app).get('/api/accounting-profile'))

function isoDaysFromNow(days) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// The scheme's only projection now: 'exempt' is derived from the home enrolment
// in force today rather than answered separately.
async function filingFrequency(tenantId = seed.tenantA.id) {
  const { rows } = await pool.query(
    'SELECT vat_filing_frequency FROM tenant_accounting_profiles WHERE tenant_id = $1', [tenantId],
  )
  return rows[0].vat_filing_frequency
}

// Resolves the domestic scheme through the repository, i.e. the same predicate
// every server read uses.
async function homeSchemeOn(isoDate, tenantId = seed.tenantA.id, country = 'nl') {
  const repo = await import('../../../server/finance/vat/taxSchemeEnrolmentRepository.js')
  return repo.fetchHomeSchemeEnrolmentOn(pool, tenantId, country, isoDate)
}

describe('tax scheme enrolments — validation', () => {
  it('records a confirmed enrolment with its dates and registry decoration', async () => {
    const res = await startScheme({
      scheme_code: 'nl_kor',
      valid_from: '2025-01-01',
      source_confirmation_date: '2024-12-02',
    }).expect(201)

    expect(res.body).toMatchObject({
      scheme_code: 'nl_kor',
      scheme_scope: 'national_home',
      country_code: 'nl',
      valid_from: '2025-01-01',
      valid_to: null,
      status: 'confirmed',
      source_confirmation_date: '2024-12-02',
      scheme_label: 'Kleineondernemersregeling (KOR)',
      scheme_implemented: true,
    })
  })

  it('rejects an unknown scheme code', async () => {
    const res = await startScheme({ scheme_code: 'made_up', valid_from: '2025-01-01' }).expect(400)
    expect(res.body.error).toBe('invalid_scheme_code')
  })

  it("rejects another country's national scheme", async () => {
    const res = await startScheme({ scheme_code: 'de_kleinunternehmer', valid_from: '2025-01-01' }).expect(400)
    expect(res.body.error).toBe('scheme_country_mismatch')
  })

  it('rejects a country_code override on a national scheme', async () => {
    const res = await startScheme({
      scheme_code: 'nl_kor', valid_from: '2025-01-01', country_code: 'de',
    }).expect(400)
    expect(res.body.error).toBe('scheme_country_mismatch')
  })

  it('rejects a malformed or inverted range', async () => {
    expect((await startScheme({ scheme_code: 'nl_kor', valid_from: 'nope' }).expect(400)).body.error)
      .toBe('invalid_valid_from')
    expect((await startScheme({ scheme_code: 'nl_kor', valid_from: '2025-06-01', valid_to: '2025-05-31' }).expect(400)).body.error)
      .toBe('valid_to_before_valid_from')
  })

  it('rejects an empty patch and an inverted patched range', async () => {
    const { body: e } = await startScheme({ scheme_code: 'nl_kor', valid_from: '2025-01-01' }).expect(201)
    expect((await patchScheme(e.id, {}).expect(400)).body.error).toBe('nothing_to_update')
    expect((await patchScheme(e.id, { valid_to: '2024-12-31' }).expect(400)).body.error)
      .toBe('valid_to_before_valid_from')
  })
})

describe('tax scheme enrolments — inclusive valid_to', () => {
  it('covers the last day and not the next one, in SQL and in JS alike', async () => {
    const { enrolmentCoversDate } = await import('../../../shared/taxSchemes.js')
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2025-01-01', valid_to: '2025-12-31' }).expect(201)

    const [before, first, last, after] = await Promise.all([
      homeSchemeOn('2024-12-31'), homeSchemeOn('2025-01-01'),
      homeSchemeOn('2025-12-31'), homeSchemeOn('2026-01-01'),
    ])
    expect(before).toBeNull()
    expect(first?.scheme_code).toBe('nl_kor')
    // The whole reason valid_to is documented as inclusive: a tax authority's
    // "your KOR ends 31 December" means the 31st is still covered.
    expect(last?.scheme_code).toBe('nl_kor')
    expect(after).toBeNull()

    // The JS mirror must agree on both boundary days, or drafts and stored rows
    // would disagree about the same date.
    const row = first
    for (const day of ['2024-12-31', '2025-01-01', '2025-12-31', '2026-01-01']) {
      const sql = await homeSchemeOn(day)
      expect(enrolmentCoversDate(row, day)).toBe(sql !== null)
    }
  })

  it('treats a NULL valid_to as still open', async () => {
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2025-01-01' }).expect(201)
    expect((await homeSchemeOn('2099-01-01'))?.scheme_code).toBe('nl_kor')
  })
})

describe('tax scheme enrolments — scope', () => {
  it('lets a national and a per-destination scheme be open at the same time', async () => {
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2025-01-01' }).expect(201)
    await startScheme({ scheme_code: 'eu_sme', valid_from: '2025-01-01', country_code: 'be' }).expect(201)

    const res = await listSchemes().expect(200)
    expect(res.body).toHaveLength(2)
    expect(res.body.map((e) => e.scheme_scope).sort())
      .toEqual(['eu_sme_destination', 'national_home'])
  })

  it('refuses a second open national scheme', async () => {
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2025-01-01' }).expect(201)
    // Same scheme.
    expect((await startScheme({ scheme_code: 'nl_kor', valid_from: '2026-01-01' }).expect(409)).body.code)
      .toBe('overlapping_enrolment')
  })

  it('refuses overlapping closed ranges, which no DB constraint covers', async () => {
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2024-01-01', valid_to: '2024-12-31' }).expect(201)
    expect((await startScheme({ scheme_code: 'nl_kor', valid_from: '2024-12-31', valid_to: '2025-06-30' }).expect(409)).body.code)
      .toBe('overlapping_enrolment')
    // Starting the day after the inclusive end is fine.
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2025-01-01', valid_to: '2025-06-30' }).expect(201)
  })

  it('refuses an EU SME enrolment for the tenant\'s own country', async () => {
    const res = await startScheme({ scheme_code: 'eu_sme', valid_from: '2025-01-01', country_code: 'nl' }).expect(400)
    expect(res.body.error).toBe('scheme_country_mismatch')
  })

  it('never lets a destination scheme touch the home filing regime', async () => {
    await startScheme({ scheme_code: 'eu_sme', valid_from: '2020-01-01', country_code: 'be' }).expect(201)

    // Spec §9.4: a destination-country exemption does not stop the home returns.
    expect((await getProfile().expect(200)).body.vat_filing_frequency).not.toBe('exempt')
    expect(await homeSchemeOn('2025-06-01')).toBeNull()
  })
})

describe('tax scheme enrolments — projections', () => {
  it('drives the derived filing frequency from the home enrolment', async () => {
    const { body: e } = await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(201)
    expect((await getProfile().expect(200)).body.vat_filing_frequency).toBe('exempt')

    await patchScheme(e.id, { valid_to: isoDaysFromNow(-1) }).expect(200)
    // Leaving the scheme returns the field to unanswered rather than guessing a
    // period the tax authority has not assigned.
    expect((await getProfile().expect(200)).body.vat_filing_frequency).toBe('unconfigured')
  })

  it('records an unimplemented scheme without claiming VAT suppression', async () => {
    await asUserA(request(app).patch('/api/accounting-profile')).send({ local_legal_form_code: 'nl_vof' }).expect(200)
    await startScheme({ scheme_code: 'eu_sme', valid_from: '2020-01-01', country_code: 'de' }).expect(201)
    expect(await filingFrequency()).not.toBe('exempt')
  })

  it('refuses to set or clear the exempt filing frequency directly', async () => {
    const direct = await asUserA(request(app).patch('/api/accounting-profile'))
      .send({ vat_filing_frequency: 'exempt' }).expect(409)
    expect(direct.body.code).toBe('filing_frequency_derived_from_scheme')

    await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(201)
    const away = await asUserA(request(app).patch('/api/accounting-profile'))
      .send({ vat_filing_frequency: 'quarterly' }).expect(409)
    expect(away.body.code).toBe('filing_frequency_derived_from_scheme')
  })

  it('refuses a national enrolment for a band that confirmed it is not registered', async () => {
    await asUserA(request(app).patch('/api/accounting-profile')).send({ vat_registered: false }).expect(200)
    // Spec §9.4: the scheme relieves a registered band of charging and filing,
    // it does not deregister it.
    const res = await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(409)
    expect(res.body.code).toBe('scheme_requires_vat_registration')
  })

  it('recomputes profile completeness when an enrolment changes the filing period', async () => {
    await asUserA(request(app).patch('/api/accounting-profile'))
      .send({ local_legal_form_code: 'nl_vof', vat_registered: true }).expect(200)
    expect((await getProfile().expect(200)).body.profile_status).toBe('incomplete')

    const { body: e } = await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(201)
    expect((await getProfile().expect(200)).body.profile_status).toBe('complete')

    await patchScheme(e.id, { valid_to: isoDaysFromNow(-1) }).expect(200)
    expect((await getProfile().expect(200)).body.profile_status).toBe('incomplete')
  })

  it('refuses the vat_registered cascade that would clear a scheme-derived exempt', async () => {
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(201)
    // A KOR participant IS registered — the cascade would force 'not_applicable'
    // and silently contradict the enrolment.
    const res = await asUserA(request(app).patch('/api/accounting-profile'))
      .send({ vat_registered: false }).expect(409)
    expect(res.body.code).toBe('filing_frequency_derived_from_scheme')
  })

  it('no longer lets PATCH /api/profile claim the exemption', async () => {
    await asUserA(request(app).patch('/api/profile')).send({ applies_kor: true })
    expect(await filingFrequency()).not.toBe('exempt')
  })
})

describe('tax scheme enrolments — scheduled boundaries', () => {
  it('resolves a future start on its boundary date without any job running', async () => {
    const start = isoDaysFromNow(7)
    await startScheme({ scheme_code: 'nl_kor', valid_from: start }).expect(201)

    expect(await homeSchemeOn(isoDaysFromNow(6))).toBeNull()
    expect((await homeSchemeOn(start))?.scheme_code).toBe('nl_kor')
    // The projection is stale by construction until the boundary passes — which
    // is exactly why date-aware resolution, not the projection, is the authority.
    expect(await filingFrequency()).not.toBe('exempt')
  })

  it('resolves a future end on its inclusive last day', async () => {
    const end = isoDaysFromNow(7)
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01', valid_to: end }).expect(201)

    expect((await homeSchemeOn(end))?.scheme_code).toBe('nl_kor')
    expect(await homeSchemeOn(isoDaysFromNow(8))).toBeNull()
    expect(await filingFrequency()).toBe('exempt')
  })

  it('the reconciler catches the projection up, and a second run is a no-op', async () => {
    const { reconcileSchemeProjections } = await import('../../../server/finance/vat/jobs/taxSchemeReconciliation.js')

    // An enrolment that ended yesterday, written straight to the table so no
    // service call has already synced the projection.
    await pool.query(
      `INSERT INTO tax_scheme_enrolments
         (tenant_id, country_code, scheme_code, scheme_scope, valid_from, valid_to, status)
       VALUES ($1, 'nl', 'nl_kor', 'national_home', '2020-01-01', $2, 'confirmed')`,
      [seed.tenantA.id, isoDaysFromNow(-1)],
    )
    await pool.query(
      `UPDATE tenant_accounting_profiles SET vat_filing_frequency = 'exempt' WHERE tenant_id = $1`,
      [seed.tenantA.id],
    )

    expect(await reconcileSchemeProjections(pool)).toBe(1)
    expect(await filingFrequency()).not.toBe('exempt')
    expect(await reconcileSchemeProjections(pool)).toBe(0)
  })

  it('the reconciler turns the projection ON when an enrolment has started', async () => {
    const { reconcileSchemeProjections } = await import('../../../server/finance/vat/jobs/taxSchemeReconciliation.js')
    await pool.query(
      `INSERT INTO tax_scheme_enrolments
         (tenant_id, country_code, scheme_code, scheme_scope, valid_from, valid_to, status)
       VALUES ($1, 'nl', 'nl_kor', 'national_home', $2, NULL, 'confirmed')`,
      [seed.tenantA.id, isoDaysFromNow(-1)],
    )
    expect(await reconcileSchemeProjections(pool)).toBe(1)
    expect(await filingFrequency()).toBe('exempt')
  })
})

describe('tax scheme enrolments — corrections are forward-only', () => {
  it('voids rather than deletes, and stops resolving through the voided row', async () => {
    const { body: e } = await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(201)

    const res = await voidScheme(e.id, { reason: 'never enrolled' }).expect(200)
    expect(res.body.voided_at).not.toBeNull()
    expect(res.body.void_reason).toBe('never enrolled')

    expect(await homeSchemeOn('2025-06-01')).toBeNull()
    expect(await filingFrequency()).not.toBe('exempt')
    // The row survives: it is the evidence explaining any snapshot taken under it.
    expect((await listSchemes().expect(200)).body).toHaveLength(1)
  })

  it('refuses to hard-delete a confirmed enrolment', async () => {
    const { body: e } = await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(201)
    expect((await deleteScheme(e.id).expect(409)).body.code).toBe('enrolment_confirmed')
  })

  it('refuses to edit or re-void a voided enrolment', async () => {
    const { body: e } = await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(201)
    await voidScheme(e.id).expect(200)
    expect((await patchScheme(e.id, { valid_to: '2025-01-01' }).expect(409)).body.code).toBe('enrolment_voided')
    await voidScheme(e.id).expect(404)
  })

  it('hard-deletes a migration-inferred enrolment nothing depends on', async () => {
    const { rows: [e] } = await pool.query(
      `INSERT INTO tax_scheme_enrolments
         (tenant_id, country_code, scheme_code, scheme_scope, valid_from, status)
       VALUES ($1, 'nl', 'nl_kor', 'national_home', '2020-01-01', 'legacy_inferred')
       RETURNING id`,
      [seed.tenantA.id],
    )
    await deleteScheme(e.id).expect(204)
    expect((await listSchemes().expect(200)).body).toHaveLength(0)
  })

  it('refuses to delete an inferred enrolment an issued invoice falls inside', async () => {
    const { rows: [e] } = await pool.query(
      `INSERT INTO tax_scheme_enrolments
         (tenant_id, country_code, scheme_code, scheme_scope, valid_from, status)
       VALUES ($1, 'nl', 'nl_kor', 'national_home', '2020-01-01', 'legacy_inferred')
       RETURNING id`,
      [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO invoices (tenant_id, invoice_number, issue_date, due_date, customer_name, status, finalized_at)
       VALUES ($1, '2025-0001', '2025-06-01', '2025-06-15', 'Venue', 'sent', NOW())`,
      [seed.tenantA.id],
    )
    expect((await deleteScheme(e.id).expect(409)).body.code).toBe('enrolment_referenced')
  })

  it('ignores a voided draft when deciding what depends on an enrolment', async () => {
    const { rows: [e] } = await pool.query(
      `INSERT INTO tax_scheme_enrolments
         (tenant_id, country_code, scheme_code, scheme_scope, valid_from, status)
       VALUES ($1, 'nl', 'nl_kor', 'national_home', '2020-01-01', 'legacy_inferred')
       RETURNING id`,
      [seed.tenantA.id],
    )
    // finalized_at is set on draft -> void too, but such an invoice was never
    // ISSUED and depends on nothing.
    await pool.query(
      `INSERT INTO invoices (tenant_id, invoice_number, issue_date, due_date, customer_name, status, finalized_at)
       VALUES ($1, '2025-0001', '2025-06-01', '2025-06-15', 'Venue', 'void', NOW())`,
      [seed.tenantA.id],
    )
    await deleteScheme(e.id).expect(204)
  })

  it('promotes an inferred enrolment to confirmed when its dates are supplied', async () => {
    const { rows: [e] } = await pool.query(
      `INSERT INTO tax_scheme_enrolments
         (tenant_id, country_code, scheme_code, scheme_scope, valid_from, status)
       VALUES ($1, 'nl', 'nl_kor', 'national_home', '2020-01-01', 'legacy_inferred')
       RETURNING id`,
      [seed.tenantA.id],
    )
    const res = await patchScheme(e.id, { valid_from: '2024-01-01', source_confirmation_date: '2023-11-30' }).expect(200)
    expect(res.body).toMatchObject({
      valid_from: '2024-01-01',
      source_confirmation_date: '2023-11-30',
      status: 'confirmed',
    })
  })
})

describe('tax scheme enrolments — tenant isolation', () => {
  it('does not leak one band\'s enrolments into another\'s list', async () => {
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2025-01-01' }).expect(201)
    const other = await asUserB(request(app).get('/api/accounting-profile/schemes')).expect(200)
    expect(other.body).toEqual([])
  })

  it('404s a cross-tenant read/write, and the owner can still do it', async () => {
    const { body: e } = await startScheme({ scheme_code: 'nl_kor', valid_from: '2025-01-01' }).expect(201)

    // Existence must not leak: 404, never 403.
    await asUserB(request(app).patch(`/api/accounting-profile/schemes/${e.id}`))
      .send({ valid_to: '2025-12-31' }).expect(404)
    await asUserB(request(app).post(`/api/accounting-profile/schemes/${e.id}/void`)).send({}).expect(404)
    await asUserB(request(app).delete(`/api/accounting-profile/schemes/${e.id}`)).expect(404)

    // Proving the 404 is scoping and not a broken id.
    await patchScheme(e.id, { valid_to: '2025-12-31' }).expect(200)
  })

  it('keeps the projections of the two bands independent', async () => {
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(201)
    expect(await filingFrequency(seed.tenantA.id)).toBe('exempt')
    expect(await filingFrequency(seed.tenantB.id)).not.toBe('exempt')
  })
})
