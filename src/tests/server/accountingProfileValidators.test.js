import './_envSetup.js'
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  applyDerivedFields,
  applyVatDependencyRules,
  buildAccountingProfileUpdate,
  isProfileComplete,
  maxDayForMonth,
  profilePresentationState,
} from '../../../server/finance/accounting-profile/accountingProfileValidators.js'
import { parseArgs } from '../../../server/finance/accounting-profile/scripts/backfillAccountingProfiles.js'

function profile(overrides = {}) {
  return {
    country_code: 'nl',
    local_legal_form_code: null,
    legal_form: null,
    reporting_framework_code: null,
    vat_registered: null,
    vat_accounting_basis: 'unknown',
    vat_filing_frequency: 'unconfigured',
    financial_year_start_month: 1,
    financial_year_start_day: 1,
    profile_status: 'incomplete',
    reviewed_at: null,
    ...overrides,
  }
}

describe('accounting profile validators', () => {
  it('accepts tenant facts, ignores non-patchable fields, and derives the regime', () => {
    const current = profile()
    const result = buildAccountingProfileUpdate({
      local_legal_form_code: 'nl_bv',
      local_legal_form_label: '  BV  ',
      vat_registered: true,
      financial_year_start_month: 3,
      financial_year_start_day: 31,
      entity_size: 'small',
      country_code: 'de',
    }, { countryCode: 'nl', current })

    expect(result).toEqual({
      updates: {
        local_legal_form_code: 'nl_bv',
        local_legal_form_label: 'BV',
        vat_registered: true,
        financial_year_start_month: 3,
        financial_year_start_day: 31,
      },
    })
    applyDerivedFields(result.updates, current, 'nl')
    expect(result.updates).toMatchObject({
      legal_form: 'company',
      reporting_framework_code: 'nl_bw2t9_micro',
    })
  })

  it('rejects invalid facts and impossible fiscal-year starts', () => {
    const current = profile({ financial_year_start_day: 31 })
    for (const [body, error] of [
      [{ local_legal_form_code: 'de_gmbh' }, 'invalid_local_legal_form_code'],
      [{ vat_registered: 'yes' }, 'invalid_vat_registered'],
      [{ default_vat_rate: 18 }, 'invalid_default_vat_rate'],
      [{ local_legal_form_label: 'x'.repeat(121) }, 'invalid_local_legal_form_label'],
      [{ financial_year_start_month: 13 }, 'invalid_financial_year_start_month'],
      [{ financial_year_start_day: 0 }, 'invalid_financial_year_start_day'],
      [{ financial_year_start_month: 4, financial_year_start_day: 31 }, 'invalid_financial_year_start'],
      [{ financial_year_start_month: 2, financial_year_start_day: 29 }, 'invalid_financial_year_start'],
      [{ financial_year_start_month: 6 }, 'invalid_financial_year_start'],
    ]) {
      expect(buildAccountingProfileUpdate(body, { countryCode: 'nl', current })).toEqual({ error })
    }
    expect(maxDayForMonth(2)).toBe(28)
    expect(maxDayForMonth(4)).toBe(30)
    expect(maxDayForMonth(1)).toBe(31)
  })

  it('derives VAT fields and presentation from the confirmed profile facts', () => {
    const current = profile()
    const unregistered = { vat_registered: false }
    expect(applyVatDependencyRules(unregistered, current)).toBeNull()
    expect(unregistered).toEqual({
      vat_registered: false,
      vat_accounting_basis: 'not_applicable',
      vat_filing_frequency: 'not_applicable',
    })

    const registered = { vat_registered: true }
    expect(applyVatDependencyRules(registered, { ...current, ...unregistered })).toBeNull()
    expect(registered).toEqual({
      vat_registered: true,
      vat_accounting_basis: 'invoice',
      vat_filing_frequency: 'unconfigured',
    })
    expect(isProfileComplete({ ...current, local_legal_form_code: 'nl_vof', ...registered })).toBe(false)
    expect(isProfileComplete({
      ...current, local_legal_form_code: 'nl_vof', ...registered, vat_filing_frequency: 'quarterly',
    })).toBe(true)
    expect(profilePresentationState({ profile_status: 'complete', reviewed_at: null })).toBe('needs_review')
    expect(profilePresentationState({ profile_status: 'complete', reviewed_at: '2026-01-01' })).toBe('complete')
  })
})

describe('accounting-profile audit arguments', () => {
  it('accepts only an explicit, supported repair target', () => {
    expect(parseArgs(['--check'])).toEqual({ apply: false, repairTenant: null })
    expect(parseArgs(['--apply'])).toEqual({ apply: true, repairTenant: null })
    expect(parseArgs(['--apply', '--tenant=7', '--country=NL '])).toEqual({
      apply: true, repairTenant: { tenantId: 7, countryCode: 'nl' },
    })
    expect(() => parseArgs(['--apply', '--tenant=1', '--country=us'])).toThrow(/Unsupported --country/)
    expect(() => parseArgs(['--apply', '--tenant=1'])).toThrow(/together/)
    expect(() => parseArgs(['--check', '--tenant=1'])).toThrow(/Usage/)
  })
})
