import './_envSetup.js'
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { computeNlVatReturnBoxes } from '../../../server/domain/vat/nlVatReturn2026.js'
import {
  normalizeTaxSelection,
  purchaseTaxFact,
  saleTaxFact,
} from '../../../server/services/taxFactService.js'
import { validateTaxCategoryFields } from '../../../server/validators/taxCategoryValidators.js'
import { validateSubmission } from '../../../server/validators/vatReturnValidators.js'
import { computePurchaseTotals } from '../../../shared/purchaseTotals.js'

function fact(overrides = {}) {
  return {
    id: 1,
    direction: 'purchase',
    tax_jurisdiction_code: 'nl',
    category_code: 'domestic_standard',
    treatment: 'standard',
    taxable_base_cents: 10000,
    output_vat_cents: 0,
    deductible_input_vat_cents: 2100,
    ...overrides,
  }
}

describe('Dutch VAT box eligibility', () => {
  it('builds box 5b from the same eligibility predicate as the mapped boxes', () => {
    const domestic = fact()
    const foreignVat = fact({
      id: 2,
      category_code: 'foreign_vat',
      treatment: 'outside_scope',
      deductible_input_vat_cents: 1900,
    })
    const foreignJurisdiction = fact({
      id: 3,
      tax_jurisdiction_code: 'de',
      deductible_input_vat_cents: 700,
    })
    const exempt = fact({
      id: 4,
      category_code: 'domestic_exempt',
      treatment: 'exempt_no_credit',
      deductible_input_vat_cents: 500,
    })
    const outsideScope = fact({
      id: 5,
      category_code: 'outside_scope',
      treatment: 'outside_scope',
      deductible_input_vat_cents: 300,
    })

    const result = computeNlVatReturnBoxes([
      domestic,
      foreignVat,
      foreignJurisdiction,
      exempt,
      outsideScope,
    ])

    expect(result.boxes['5b'].vat_cents).toBe(2100)
    expect(result.unmapped.map((row) => row.id)).toEqual([2, 3, 4, 5])
  })
})

describe('purchase tax-fact recovery', () => {
  it.each([
    ['foreign_vat', 'outside_scope'],
    ['domestic_exempt', 'exempt_no_credit'],
    ['outside_scope', 'outside_scope'],
  ])('forces %s recovery to zero because %s is non-creditable', (category, treatment) => {
    const result = purchaseTaxFact({
      line: {
        id: 10,
        position: 0,
        amount_incl_cents: 12100,
        tax_rate: category === 'domestic_exempt' || category === 'outside_scope' ? 0 : 21,
        tax_category_code: category,
        tax_jurisdiction_code: 'nl',
        input_vat_recovery_percent: 100,
      },
      countryCode: 'nl',
      taxPoint: '2026-02-01',
      sourceLineKind: 'purchase_line',
    })

    expect(result.treatment).toBe(treatment)
    expect(result.recovery_percent).toBe(0)
    expect(result.deductible_input_vat_cents).toBe(0)
    expect(result.non_deductible_input_vat_cents).toBe(result.tax_amount_cents)
  })
})

describe('tax-category inference', () => {
  it('confirms an unambiguous domestic standard-rate line', () => {
    const result = saleTaxFact({
      line: { id: 1, position: 0, tax_percentage: 21 },
      countryCode: 'nl',
      taxPoint: '2026-02-01',
      taxableBaseCents: 10000,
      taxCents: 2100,
      sourceLineKind: 'invoice_line',
    })

    expect(result.category_code).toBe('domestic_standard')
    expect(result.classification_status).toBe('confirmed')
  })

  it('confirms the deterministic domestic zero-rate fallback', () => {
    const result = saleTaxFact({
      line: { id: 1, position: 0, tax_percentage: 0 },
      countryCode: 'nl',
      taxPoint: '2026-02-01',
      taxableBaseCents: 10000,
      taxCents: 0,
      sourceLineKind: 'invoice_line',
    })

    expect(result.category_code).toBe('domestic_zero')
    expect(result.classification_status).toBe('confirmed')
  })

  it('falls back from a cleared jurisdiction field to the tenant country', () => {
    const result = normalizeTaxSelection({
      line: {
        tax_percentage: 21,
        tax_category_code: null,
        tax_jurisdiction_code: '',
      },
      countryCode: 'nl',
      taxPoint: '2026-02-01',
      direction: 'sale',
      rateField: 'tax_percentage',
    })

    expect(result.jurisdiction).toBe('nl')
    expect(result.resolved.code).toBe('domestic_standard')
  })
})

describe('purchase presentation totals', () => {
  it('does not extract supplier VAT from a self-assessed intra-EU acquisition', () => {
    const totals = computePurchaseTotals({
      lines: [{
        amount_incl_cents: 10000,
        tax_rate: 21,
        tax_category_code: 'intra_eu_acquisition_goods',
      }],
    })

    expect(totals).toMatchObject({
      subtotalCents: 10000,
      taxCents: 0,
      totalCents: 10000,
      vatByRate: [],
    })
  })
})

describe('VAT return validation errors', () => {
  it('separates the submission error message from its machine-readable code', () => {
    expect(validateSubmission({})).toEqual({
      error: 'Submission reference is required',
      code: 'submission_reference_required',
    })
  })

  it('keeps the legacy filed_at default during the expand-migrate deploy window', () => {
    const sql = readFileSync(
      new URL('../../../server/db/migrations/146_vat_transaction_categories.sql', import.meta.url),
      'utf8',
    )
    expect(sql).not.toMatch(/filed_at\s+DROP DEFAULT/i)
    expect(sql).toMatch(/filed_at\s+DROP NOT NULL/i)
  })
})

describe('tax-category boundary validation', () => {
  it('rejects unknown and direction-incompatible categories', () => {
    expect(validateTaxCategoryFields(
      [{ tax_category_code: 'made_up', tax_jurisdiction_code: 'nl' }],
      { direction: 'sale' },
    )).toMatchObject({ code: 'invalid_tax_category', line: 1 })

    expect(validateTaxCategoryFields(
      [{ tax_category_code: 'export_non_eu_goods', tax_jurisdiction_code: 'nl' }],
      { direction: 'purchase' },
    )).toMatchObject({ code: 'invalid_tax_category', line: 1 })
  })

  it('rejects unsupported jurisdictions but accepts cleared optional fields', () => {
    expect(validateTaxCategoryFields(
      [{ tax_category_code: 'domestic_standard', tax_jurisdiction_code: 'zz' }],
      { direction: 'sale' },
    )).toMatchObject({ code: 'invalid_tax_jurisdiction', line: 1 })

    expect(validateTaxCategoryFields(
      [{ tax_category_code: '', tax_jurisdiction_code: '' }],
      { direction: 'sale' },
    )).toBeNull()
  })
})
