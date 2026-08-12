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

const getProfile = () => asUserA(request(app).get('/api/accounting-profile'))
const patchProfile = (body) => asUserA(request(app).patch('/api/accounting-profile')).send(body)

// Brings the profile to `complete` for a VAT-registered tenant.
async function completeProfile(overrides = {}) {
  await patchProfile({
    local_legal_form_code: 'nl_vof',
    vat_registered: true,
    ...overrides,
  }).expect(200)
  return patchProfile({ vat_filing_frequency: 'quarterly' }).expect(200)
}

describe('accounting profile — read', () => {
  it('seeded tenants have a profile with the expected defaults', async () => {
    const res = await getProfile().expect(200)
    expect(res.body).toMatchObject({
      tenant_id: seed.tenantA.id,
      country_code: 'nl',
      base_currency: 'EUR',
      default_vat_rate: 21,
      profile_status: 'incomplete',
      profile_source: 'tenant_creation',
      presentation_state: 'incomplete',
      legal_form: null,
      reporting_framework_code: null,
      // Recorded, never asked: the app does micro-entity reporting and posts
      // revenue on the invoice date.
      entity_size: 'micro',
      financial_accounting_basis: 'accrual',
      // Derived from vat_registered, which starts unconfirmed.
      vat_accounting_basis: 'unknown',
      vat_filing_frequency: 'unconfigured',
      vat_registered: null,
      financial_year_start_month: 1,
      financial_year_start_day: 1,
      reviewed_at: null,
    })
  })

  it('records GBP as the base currency for a UK tenant', async () => {
    await asUserA(request(app).post('/api/accounting-profile/change-country'))
      .send({ country_code: 'gb', tax_id: null, kvk_number: null }).expect(200)

    const res = await getProfile().expect(200)
    expect(res.body.country_code).toBe('gb')
    expect(res.body.base_currency).toBe('GBP')
  })

  it('patches a known default VAT rate', async () => {
    const res = await patchProfile({ default_vat_rate: 21 }).expect(200)
    expect(Number(res.body.default_vat_rate)).toBe(21)
    await patchProfile({ default_vat_rate: 18 }).expect(400)
  })
})

describe('accounting profile — country change', () => {
  const changeCountry = (body) => asUserA(
    request(app).post('/api/accounting-profile/change-country'),
  ).send(body)

  it('atomically resets country-dependent configuration before documents exist', async () => {
    await completeProfile()
    await pool.query(
      `INSERT INTO products (
         tenant_id, name, unit_cost_cents, default_price_incl_cents, vat_rate, quantity_on_hand
       ) VALUES ($1, 'Shirt', 500, 1500, 9, 1)`,
      [seed.tenantA.id],
    )

    const res = await changeCountry({
      country_code: 'gb',
      tax_id: null,
      kvk_number: null,
    }).expect(200)
    expect(res.body).toMatchObject({
      country_code: 'gb',
      base_currency: 'GBP',
      profile_status: 'incomplete',
      vat_registered: null,
      vat_accounting_basis: 'unknown',
      vat_filing_frequency: 'unconfigured',
      local_legal_form_code: null,
      reviewed_at: null,
    })
    expect(Number(res.body.default_vat_rate)).toBe(20)

    // base_currency is GBP (truthful, above) but the BOOKS stay euro: the ledger
    // has no currency column and no FX, so a jurisdiction multi-currency has not
    // reached yet must not start stamping documents in another unit.
    const settings = await asUserA(request(app).get('/api/accounts/settings')).expect(200)
    expect(settings.body.currency).toBe('EUR')

    const { rows: [product] } = await pool.query(
      'SELECT vat_rate FROM products WHERE tenant_id = $1', [seed.tenantA.id],
    )
    expect(Number(product.vat_rate)).toBe(20)
  })

  it('blocks drafts and does not inspect another tenant', async () => {
    await pool.query(
      `INSERT INTO invoices (
         tenant_id, invoice_number, issue_date, customer_name, currency
       ) VALUES ($1, '2026-0001', '2026-01-01', 'Customer', 'EUR')`,
      [seed.tenantA.id],
    )
    const blocked = await changeCountry({ country_code: 'gb' }).expect(409)
    expect(blocked.body.code).toBe('accounting_country_has_financial_documents')

    const other = await asUserB(
      request(app).post('/api/accounting-profile/change-country'),
    ).send({ country_code: 'gb', tax_id: null, kvk_number: null }).expect(200)
    expect(other.body.country_code).toBe('gb')
  })
})

// Nothing derives a profile any more. A tenant without one is a fault an
// operator repairs with backfillAccountingProfiles.js, not something the app
// guesses its way past.
describe('accounting profile — a missing row is a fault', () => {
  it('reports 409 accounting_profile_missing instead of inventing a row', async () => {
    await pool.query('DELETE FROM tenant_accounting_profiles WHERE tenant_id = $1', [seed.tenantA.id])

    const res = await getProfile().expect(409)
    expect(res.body.code).toBe('accounting_profile_missing')

    const { rows: [{ count }] } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM tenant_accounting_profiles WHERE tenant_id = $1',
      [seed.tenantA.id],
    )
    expect(count).toBe(0)
  })

  // The regime drives money, so the fault must surface everywhere it is read,
  // not just on the settings screen.
  it('surfaces on the finance surfaces that read the regime', async () => {
    await pool.query('DELETE FROM tenant_accounting_profiles WHERE tenant_id = $1', [seed.tenantA.id])

    for (const path of ['/api/ledger/overview', '/api/accounts/settings']) {
      const res = await asUserA(request(app).get(path)).expect(409)
      expect(res.body.code).toBe('accounting_profile_missing')
    }
  })
})

describe('accounting profile — audit script', () => {
  let auditAccountingProfiles, parseArgs

  beforeAll(async () => {
    const mod = await import('../../../server/finance/accounting-profile/scripts/backfillAccountingProfiles.js')
    auditAccountingProfiles = mod.auditAccountingProfiles
    parseArgs = mod.parseArgs
  })

  it('reports a missing profile and refuses to repair it without a country', async () => {
    await pool.query('DELETE FROM tenant_accounting_profiles WHERE tenant_id = $1', [seed.tenantA.id])

    const result = await auditAccountingProfiles(pool, { apply: true })
    expect(result.counts.migrationNeeded).toBe(1)
    expect(result.counts.migrated).toBe(0)
    expect(result.ok).toBe(false)
  })

  it('repairs the named tenant with the supplied country', async () => {
    await pool.query('DELETE FROM tenant_accounting_profiles WHERE tenant_id = $1', [seed.tenantA.id])

    const result = await auditAccountingProfiles(pool, {
      apply: true,
      repairTenant: { tenantId: seed.tenantA.id, countryCode: 'de' },
    })
    expect(result.counts.migrated).toBe(1)
    expect(result.ok).toBe(true)

    const { rows } = await pool.query(
      'SELECT country_code, default_vat_rate, profile_source FROM tenant_accounting_profiles WHERE tenant_id = $1',
      [seed.tenantA.id],
    )
    expect(rows[0].country_code).toBe('de')
    expect(Number(rows[0].default_vat_rate)).toBe(19)
    expect(rows[0].profile_source).toBe('repair')
  })

  it('does not touch a tenant that was not named', async () => {
    await pool.query('DELETE FROM tenant_accounting_profiles WHERE tenant_id IN ($1, $2)', [
      seed.tenantA.id, seed.tenantB.id,
    ])

    const result = await auditAccountingProfiles(pool, {
      apply: true,
      repairTenant: { tenantId: seed.tenantA.id, countryCode: 'nl' },
    })
    expect(result.counts.migrated).toBe(1)
    expect(result.ok).toBe(false)

    const { rows: [{ count }] } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM tenant_accounting_profiles WHERE tenant_id = $1',
      [seed.tenantB.id],
    )
    expect(count).toBe(0)
  })

  // The rate-fill repair exists to clear migration 144's preflight; once that
  // migration is applied the fault it repairs is unreachable by construction.
  it('cannot see a missing default VAT rate — the column is NOT NULL', async () => {
    await expect(
      pool.query(
        'UPDATE tenant_accounting_profiles SET default_vat_rate = NULL WHERE tenant_id = $1',
        [seed.tenantA.id],
      ),
    ).rejects.toThrow()

    const result = await auditAccountingProfiles(pool, { apply: false })
    expect(result.counts.rateMissing).toBe(0)
  })

  it('rejects a country it has no rate table for', () => {
    expect(() => parseArgs(['--apply', '--tenant=1', '--country=us'])).toThrow(/Unsupported --country/)
    expect(() => parseArgs(['--apply', '--tenant=1'])).toThrow(/together/)
    expect(() => parseArgs(['--check', '--tenant=1'])).toThrow(/Usage/)
    expect(parseArgs(['--apply', '--tenant=7', '--country=NL '])).toEqual({
      apply: true, repairTenant: { tenantId: 7, countryCode: 'nl' },
    })
  })
})

describe('accounting profile — write', () => {
  it('applies a partial patch and leaves the other fields alone', async () => {
    const res = await patchProfile({ financial_year_start_month: 7 }).expect(200)
    expect(res.body.financial_year_start_month).toBe(7)
    expect(res.body.local_legal_form_code).toBeNull()
    expect(res.body.vat_registered).toBeNull()
  })

  it('an empty patch is rejected', async () => {
    const res = await patchProfile({}).expect(400)
    expect(res.body.error).toBe('nothing_to_update')
  })

  it('rejects unknown enum values', async () => {
    await patchProfile({ vat_filing_frequency: 'fortnightly' }).expect(400)
    const res = await patchProfile({ vat_registered: 'yes' }).expect(400)
    expect(res.body.error).toBe('invalid_vat_registered')
  })

  // These four are not questions: entity size and the accounting basis state what
  // the product does, and the legal form, reporting framework and VAT basis are
  // derived. Accepting them would let a band record something untrue.
  it('ignores the derived and product-fact fields entirely', async () => {
    const before = await getProfile().expect(200)

    await patchProfile({ entity_size: 'small' }).expect(400)
    await patchProfile({ financial_accounting_basis: 'cash' }).expect(400)
    await patchProfile({ vat_accounting_basis: 'cash' }).expect(400)
    await patchProfile({ reporting_framework_code: 'nl_bw2t9_small' }).expect(400)
    await patchProfile({ legal_form: 'company' }).expect(400)

    const after = await getProfile().expect(200)
    expect(after.body.entity_size).toBe(before.body.entity_size)
    expect(after.body.financial_accounting_basis).toBe(before.body.financial_accounting_basis)
    expect(after.body.vat_accounting_basis).toBe(before.body.vat_accounting_basis)
    expect(after.body.reporting_framework_code).toBe(before.body.reporting_framework_code)
    expect(after.body.legal_form).toBe(before.body.legal_form)
  })

  it('derives the legal form and the reporting framework from the local form', async () => {
    const res = await patchProfile({ local_legal_form_code: 'nl_bv' }).expect(200)
    expect(res.body.local_legal_form_code).toBe('nl_bv')
    expect(res.body.legal_form).toBe('company')
    expect(res.body.reporting_framework_code).toBe('nl_bw2t9_micro')
  })

  it('clearing the local legal form clears both derived values', async () => {
    await patchProfile({ local_legal_form_code: 'nl_bv' }).expect(200)
    const res = await patchProfile({ local_legal_form_code: null }).expect(200)
    expect(res.body.local_legal_form_code).toBeNull()
    expect(res.body.legal_form).toBeNull()
    expect(res.body.reporting_framework_code).toBeNull()
  })

  it('rejects a local form belonging to another country', async () => {
    const res = await patchProfile({ local_legal_form_code: 'de_gmbh' }).expect(400)
    expect(res.body.error).toBe('invalid_local_legal_form_code')
  })

  // The tenants row carries no regime columns at all, so a write-back is not
  // expressible: `directors` is the only invoice-facing field left on it.
  it('leaves the tenants row without any regime column', async () => {
    await patchProfile({ local_legal_form_code: 'nl_vereniging', default_vat_rate: 9 }).expect(200)
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'tenants'
          AND column_name IN ('vat_country', 'legal_form', 'tax_percentage', 'applies_kor')`,
    )
    expect(rows).toEqual([])
  })
})

describe('accounting profile — immutable country', () => {
  it('rejects a country change with 409', async () => {
    const res = await patchProfile({ country_code: 'de' }).expect(409)
    expect(res.body.code).toBe('country_immutable')

    const after = await getProfile().expect(200)
    expect(after.body.country_code).toBe('nl')
  })

  it('rejects a base_currency change (it is derived from the country)', async () => {
    await patchProfile({ base_currency: 'GBP' }).expect(400)
  })

  // The band profile used to own vat_country. If it still did, the ordinary UI
  // could produce a tenant whose jurisdiction disagreed with its profile.
  it('PATCH /api/profile can no longer change the VAT country', async () => {
    await asUserA(request(app).patch('/api/profile')).send({ vat_country: 'de' }).expect(400)

    const profile = await getProfile().expect(200)
    expect(profile.body.country_code).toBe('nl')
  })

  it('PATCH /api/profile can no longer change the legal form', async () => {
    await patchProfile({ local_legal_form_code: 'nl_bv' }).expect(200)
    await asUserA(request(app).patch('/api/profile')).send({ legal_form: 'sole_trader' }).expect(400)

    const profile = await getProfile().expect(200)
    expect(profile.body.legal_form).toBe('company')
  })

  // Two country-dependent derivations, so a German band must land on the German
  // framework rather than the Dutch one.
  it('derives the framework from the profile country, not a default', async () => {
    await asUserA(request(app).post('/api/accounting-profile/change-country'))
      .send({ country_code: 'de', tax_id: null, kvk_number: null }).expect(200)

    const incorporated = await patchProfile({ local_legal_form_code: 'de_gmbh' }).expect(200)
    expect(incorporated.body.reporting_framework_code).toBe('de_hgb_micro')

    // Unincorporated German businesses keep an Einnahmen-Überschuss-Rechnung.
    const sole = await patchProfile({ local_legal_form_code: 'de_einzelunternehmen' }).expect(200)
    expect(sole.body.reporting_framework_code).toBe('de_eur')
  })
})

describe('accounting profile — VAT dependency rules', () => {
  it('confirming "not registered" settles the VAT fields as not applicable', async () => {
    const res = await patchProfile({ vat_registered: false }).expect(200)
    expect(res.body.vat_accounting_basis).toBe('not_applicable')
    expect(res.body.vat_filing_frequency).toBe('not_applicable')
  })

  // The app recognises VAT on the invoice date, so a registered band is on the
  // invoice basis by construction — it is derived, never asked.
  it('derives the invoice basis when the band is registered', async () => {
    const res = await patchProfile({ vat_registered: true }).expect(200)
    expect(res.body.vat_accounting_basis).toBe('invoice')
  })

  it('becoming registered clears the not-applicable filing period rather than guessing', async () => {
    await patchProfile({ vat_registered: false }).expect(200)
    const res = await patchProfile({ vat_registered: true }).expect(200)
    expect(res.body.vat_accounting_basis).toBe('invoice')
    expect(res.body.vat_filing_frequency).toBe('unconfigured')
  })

  it('going back to unconfirmed resets the basis and the period', async () => {
    await patchProfile({ vat_registered: false }).expect(200)
    const res = await patchProfile({ vat_registered: null }).expect(200)
    expect(res.body.vat_registered).toBeNull()
    expect(res.body.vat_accounting_basis).toBe('unknown')
    expect(res.body.vat_filing_frequency).toBe('unconfigured')
  })

  // 'exempt' is no longer a filing period a band picks: it is DERIVED from a VAT
  // scheme enrolment, which carries dates, a jurisdiction and a confirmation this
  // field cannot express. See taxSchemeEnrolments.test.js for the projection
  // itself; here we only assert the field refuses to be the second control.
  it('refuses an exempt filing period, pointing at the scheme instead', async () => {
    await patchProfile({ vat_registered: true }).expect(200)
    const res = await patchProfile({ vat_filing_frequency: 'exempt' }).expect(409)
    expect(res.body.code).toBe('filing_frequency_derived_from_scheme')
  })

  it('refuses an exempt filing period before registration is confirmed too', async () => {
    // The scheme conflict outranks the less specific "that value needs
    // registration": it names the control that actually owns the fact.
    const res = await patchProfile({ vat_filing_frequency: 'exempt' }).expect(409)
    expect(res.body.code).toBe('filing_frequency_derived_from_scheme')
  })

  it('an exempt band still counts as complete', async () => {
    await patchProfile({ local_legal_form_code: 'nl_eenmanszaak', vat_registered: true }).expect(200)
    // Enrolling is what makes it exempt, and the enrolment sets the field.
    await asUserA(request(app).post('/api/accounting-profile/schemes'))
      .send({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(201)

    const res = await getProfile().expect(200)
    expect(res.body.vat_filing_frequency).toBe('exempt')
    expect(res.body.profile_status).toBe('complete')
  })

  it('rejects a filing period while registration is not confirmed', async () => {
    const res = await patchProfile({ vat_filing_frequency: 'quarterly' }).expect(400)
    expect(res.body.error).toBe('vat_fields_require_registration')
  })

  it('rejects "not applicable" while the tenant is registered', async () => {
    await patchProfile({ vat_registered: true }).expect(200)
    const res = await patchProfile({ vat_filing_frequency: 'not_applicable' }).expect(400)
    expect(res.body.error).toBe('vat_fields_required_when_registered')
  })
})

describe('accounting profile — completeness', () => {
  // Two questions are enough for a band that is not VAT registered: its legal
  // form and the fact that it is not registered.
  it('a non-registered tenant completes with two answers', async () => {
    const res = await patchProfile({
      local_legal_form_code: 'nl_eenmanszaak',
      vat_registered: false,
    }).expect(200)

    expect(res.body.legal_form).toBe('sole_trader')
    expect(res.body.reporting_framework_code).toBe('nl_bw2t9_micro')
    expect(res.body.vat_filing_frequency).toBe('not_applicable')
    expect(res.body.profile_status).toBe('complete')
    expect(res.body.presentation_state).toBe('needs_review')
  })

  it('a registered tenant stays incomplete until the filing period is known', async () => {
    const partial = await patchProfile({
      local_legal_form_code: 'nl_vof',
      vat_registered: true,
    }).expect(200)
    expect(partial.body.profile_status).toBe('incomplete')

    const done = await patchProfile({ vat_filing_frequency: 'quarterly' }).expect(200)
    expect(done.body.profile_status).toBe('complete')
  })

  // A legacy row can arrive with legal_form already inherited from the old tenants
  // column but no framework, so the derivation has to backfill it on any save.
  it('backfills a missing framework for an inherited legal form', async () => {
    await pool.query(
      `UPDATE tenant_accounting_profiles
          SET legal_form = 'company', reporting_framework_code = NULL,
              profile_source = 'legacy_backfill'
        WHERE tenant_id = $1`,
      [seed.tenantA.id],
    )
    const res = await patchProfile({ vat_registered: false }).expect(200)
    expect(res.body.reporting_framework_code).toBe('nl_bw2t9_micro')
  })
})

describe('accounting profile — review provenance', () => {
  it('refuses to confirm an incomplete profile', async () => {
    const res = await asUserA(request(app).post('/api/accounting-profile/review')).expect(409)
    expect(res.body.code).toBe('profile_incomplete')
  })

  it('confirming a complete profile records who did it', async () => {
    await completeProfile()
    const res = await asUserA(request(app).post('/api/accounting-profile/review')).expect(200)
    expect(res.body.reviewed_at).toBeTruthy()
    expect(res.body.reviewed_by_user_id).toBe(seed.userA.id)
    expect(res.body.presentation_state).toBe('complete')
  })
})

describe('accounting profile — financial year start', () => {
  it('accepts month-end starts that exist every year', async () => {
    let res = await patchProfile({ financial_year_start_month: 3, financial_year_start_day: 31 }).expect(200)
    expect(res.body.financial_year_start_month).toBe(3)
    expect(res.body.financial_year_start_day).toBe(31)

    res = await patchProfile({ financial_year_start_month: 7, financial_year_start_day: 1 }).expect(200)
    expect(res.body.financial_year_start_month).toBe(7)
  })

  it('rejects days that do not exist in the chosen month', async () => {
    await patchProfile({ financial_year_start_month: 4, financial_year_start_day: 31 }).expect(400)
    const res = await patchProfile({ financial_year_start_month: 2, financial_year_start_day: 29 }).expect(400)
    expect(res.body.error).toBe('invalid_financial_year_start')
  })

  it('validates the pair even when only one half is sent', async () => {
    await patchProfile({ financial_year_start_month: 1, financial_year_start_day: 31 }).expect(200)
    // Month alone would leave day 31 on a 30-day month behind.
    await patchProfile({ financial_year_start_month: 6 }).expect(400)
  })

  it('rejects out-of-range values', async () => {
    await patchProfile({ financial_year_start_month: 13 }).expect(400)
    await patchProfile({ financial_year_start_day: 0 }).expect(400)
  })

  it('the database refuses an impossible start date directly', async () => {
    await expect(pool.query(
      `UPDATE tenant_accounting_profiles
          SET financial_year_start_month = 2, financial_year_start_day = 29
        WHERE tenant_id = $1`,
      [seed.tenantA.id],
    )).rejects.toThrow()
  })
})

describe('accounting profile — permissions', () => {
  it('a plain member cannot read the profile', async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (google_sub, email, name, status)
       VALUES ('sub-mem', 'mem@test.local', 'Member', 'approved') RETURNING *`,
    )
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source)
       VALUES ($1, $2, 'contributor', 'approved', NOW(), 'admin')`,
      [u.id, seed.tenantA.id],
    )
    await request(app).get('/api/accounting-profile')
      .set('x-test-user-id', String(u.id))
      .set('x-test-tenant-id', String(seed.tenantA.id))
      .expect(403)
  })

  it('a financial_admin can read and write it', async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (google_sub, email, name, status)
       VALUES ('sub-fa', 'fa@test.local', 'FinAdmin', 'approved') RETURNING *`,
    )
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source)
       VALUES ($1, $2, 'financial_admin', 'approved', NOW(), 'admin')`,
      [u.id, seed.tenantA.id],
    )
    await request(app).patch('/api/accounting-profile')
      .set('x-test-user-id', String(u.id))
      .set('x-test-tenant-id', String(seed.tenantA.id))
      .send({ local_legal_form_code: 'nl_bv' })
      .expect(200)
  })
})

describe('accounting profile — isolation', () => {
  it('profile changes do not leak between tenants', async () => {
    await patchProfile({ local_legal_form_code: 'nl_bv', vat_registered: true }).expect(200)

    const bRes = await asUserB(request(app).get('/api/accounting-profile')).expect(200)
    expect(bRes.body.tenant_id).toBe(seed.tenantB.id)
    expect(bRes.body.local_legal_form_code).toBeNull()
    expect(bRes.body.legal_form).toBeNull()
    expect(bRes.body.vat_registered).toBeNull()
  })

  it('the review mark is per tenant', async () => {
    await completeProfile()
    await asUserA(request(app).post('/api/accounting-profile/review')).expect(200)

    const bRes = await asUserB(request(app).get('/api/accounting-profile')).expect(200)
    expect(bRes.body.reviewed_at).toBeNull()
  })

  // The header names the active tenant; a caller cannot address another band's
  // profile at all, because the route has no id parameter to tamper with.
  it('a member of one band cannot reach another band profile', async () => {
    await request(app).get('/api/accounting-profile')
      .set('x-test-user-id', String(seed.userA.id))
      .set('x-test-tenant-id', String(seed.tenantB.id))
      .expect(403)
  })
})
