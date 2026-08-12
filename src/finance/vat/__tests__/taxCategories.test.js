import { describe, expect, it } from 'vitest'
import {
  TAX_CATEGORY_CODES,
  TAX_TREATMENTS,
  commonVatSelection,
  defaultDomesticCategory,
  resolveTaxCategory,
} from '../../../../shared/taxCategories.js'
import {
  NL_VAT_RETURN_SCHEMA_2026,
  computeNlVatReturnBoxes,
  declaredEuroFor,
  getNlVatReturnBoxDefinition,
  getNlVatReturnBoxDescription,
} from '../../../../server/domain/vat/nlVatReturn2026.js'
import { getVatReturnBoxDefinition } from '../../../../server/domain/vat/vatReturnBoxDefinitions.js'
import { purchaseTaxFact, saleTaxFact } from '../../../../server/finance/vat/taxFactService.js'

describe('tax category registry', () => {
  it('provides Dutch descriptions for every rendered return box', () => {
    expect(getNlVatReturnBoxDescription('1a')).toBe('Leveringen/diensten belast met hoog tarief')
    expect(getNlVatReturnBoxDescription('4b')).toBe('Leveringen/diensten uit landen binnen de EU')
    expect(getNlVatReturnBoxDescription('5c')).toBe('Subtotaal (rubriek 5a min 5b)')
  })

  it('categorises every box under its official return section', () => {
    expect(getNlVatReturnBoxDefinition('1a')).toEqual({
      description: 'Leveringen/diensten belast met hoog tarief',
      section: { id: '1', title: 'Rubriek 1: Prestaties binnenland' },
    })
    expect(getNlVatReturnBoxDefinition('2a').section.title)
      .toBe('Rubriek 2: Verleggingsregelingen binnenland')
    expect(getNlVatReturnBoxDefinition('3c').section.title)
      .toBe('Rubriek 3: Prestaties naar of in het buitenland')
    expect(getNlVatReturnBoxDefinition('4b').section.title)
      .toBe('Rubriek 4: Prestaties vanuit het buitenland aan u verricht')
    expect(getNlVatReturnBoxDefinition('5c').section.title)
      .toBe('Rubriek 5: Voorbelasting')
    expect(getVatReturnBoxDefinition('nl', NL_VAT_RETURN_SCHEMA_2026.version, '2a'))
      .toEqual(getNlVatReturnBoxDefinition('2a'))
    expect(getVatReturnBoxDefinition('be', 'be-vat-2026', '00')).toBeNull()
  })

  it('keeps legally different zero-VAT treatments distinct', () => {
    expect(TAX_TREATMENTS).toEqual(expect.arrayContaining([
      'zero_rated',
      'exempt_no_credit',
      'outside_scope',
      'reverse_charge',
      'small_business_exempt',
    ]))
    expect(TAX_CATEGORY_CODES).toEqual(expect.arrayContaining([
      'domestic_zero',
      'domestic_exempt',
      'outside_scope',
      'domestic_reverse_charge',
      'intra_eu_supply_goods',
      'intra_eu_acquisition_goods',
      'export_non_eu_goods',
      'import_article_23',
    ]))
  })

  it('resolves a dated Dutch category and derives safe domestic defaults', () => {
    expect(defaultDomesticCategory('nl', 21)).toBe('domestic_standard')
    expect(defaultDomesticCategory('nl', 9)).toBe('domestic_reduced')
    expect(defaultDomesticCategory('nl', 0)).toBe('domestic_zero')
    expect(resolveTaxCategory({
      countryCode: 'nl',
      categoryCode: 'domestic_reduced',
      taxPoint: '2026-07-31',
      rate: 9,
      direction: 'sale',
    })).toMatchObject({ treatment: 'reduced', rate: 9 })
  })

  it('maps only the three common Dutch selector rates to stored tax properties', () => {
    expect(commonVatSelection('nl', 21)).toEqual({
      tax_category_code: 'domestic_standard',
      tax_jurisdiction_code: 'nl',
    })
    expect(commonVatSelection('NL', 9)).toEqual({
      tax_category_code: 'domestic_reduced',
      tax_jurisdiction_code: 'nl',
    })
    expect(commonVatSelection('nl', 0)).toEqual({
      tax_category_code: 'domestic_zero',
      tax_jurisdiction_code: 'nl',
    })
    expect(commonVatSelection('de', 19)).toBeNull()
    expect(commonVatSelection('nl', 19)).toBeNull()
  })

  it('never treats an unknown jurisdiction or rate as a valid category', () => {
    expect(resolveTaxCategory({
      countryCode: 'xx',
      categoryCode: 'domestic_standard',
      taxPoint: '2026-01-01',
      rate: 21,
      direction: 'sale',
    })).toBeNull()
    expect(resolveTaxCategory({
      countryCode: 'nl',
      categoryCode: 'domestic_reduced',
      taxPoint: '2026-01-01',
      rate: 21,
      direction: 'sale',
    })).toBeNull()
  })

  it('supports nominal VAT on a reverse-charged purchase but zero VAT on the sale side', () => {
    expect(resolveTaxCategory({
      countryCode: 'nl',
      categoryCode: 'domestic_reverse_charge',
      taxPoint: '2026-01-01',
      rate: 21,
      direction: 'purchase',
    })).toMatchObject({ selfAssessed: true, rate: 21 })
    expect(resolveTaxCategory({
      countryCode: 'nl',
      categoryCode: 'domestic_reverse_charge',
      taxPoint: '2026-01-01',
      rate: 0,
      direction: 'sale',
    })).toMatchObject({ treatment: 'reverse_charge', rate: 0 })
  })
})

describe('Dutch VAT return schema 2026', () => {
  it('is annually versioned and sourced', () => {
    expect(NL_VAT_RETURN_SCHEMA_2026).toMatchObject({
      countryCode: 'nl',
      year: 2026,
      version: 'nl-ob-2026.1',
    })
    expect(NL_VAT_RETURN_SCHEMA_2026.sourceUrl).toContain('belastingdienst.nl')
  })

  it('maps transaction facts to Dutch boxes and derives totals', () => {
    const result = computeNlVatReturnBoxes([
      fact('domestic_standard', 'sale', 10000, 2100, 0),
      fact('domestic_reduced', 'sale', 5000, 450, 0),
      fact('intra_eu_supply_services', 'sale', 25000, 0, 0),
      fact('intra_eu_acquisition_goods', 'purchase', 10000, 2100, 2100),
      fact('domestic_standard', 'purchase', 5000, 0, 1050),
    ])

    expect(result.boxes).toMatchObject({
      '1a': { base_cents: 10000, vat_cents: 2100 },
      '1b': { base_cents: 5000, vat_cents: 450 },
      '3b': { base_cents: 25000, vat_cents: 0 },
      '4b': { base_cents: 10000, vat_cents: 2100 },
      '5a': { vat_cents: 4650 },
      '5b': { vat_cents: 3150 },
      '5c': { vat_cents: 1500 },
    })
  })

  it('keeps exempt, outside-scope and KOR turnover out of normal boxes', () => {
    const result = computeNlVatReturnBoxes([
      fact('domestic_exempt', 'sale', 10000, 0, 0),
      fact('outside_scope', 'sale', 20000, 0, 0),
      { ...fact('domestic_standard', 'sale', 30000, 0, 0), treatment: 'small_business_exempt' },
    ])
    expect(result.boxes['1a']).toMatchObject({ base_cents: 0, vat_cents: 0 })
    expect(result.unmapped).toHaveLength(3)
  })

  it('rounds Dutch declared VAT conservatively to whole euros', () => {
    expect(declaredEuroFor(2199, 'output_vat')).toBe(21)
    expect(declaredEuroFor(2101, 'input_vat')).toBe(22)
    expect(declaredEuroFor(-199, 'net')).toBe(-1)
  })
})

describe('ledger VAT fact snapshots', () => {
  it('books self-assessed acquisition VAT on both sides', () => {
    expect(purchaseTaxFact({
      line: {
        id: 1,
        amount_incl_cents: 10000,
        tax_rate: 21,
        tax_category_code: 'intra_eu_acquisition_goods',
        tax_jurisdiction_code: 'nl',
        input_vat_recovery_percent: 50,
      },
      countryCode: 'nl',
      taxPoint: '2026-06-01',
      sourceLineKind: 'purchase_line',
    })).toMatchObject({
      taxable_base_cents: 10000,
      output_vat_cents: 2100,
      deductible_input_vat_cents: 1050,
      non_deductible_input_vat_cents: 1050,
      classification_status: 'confirmed',
    })
  })

  it('snapshots small-business turnover without charging output VAT', () => {
    expect(saleTaxFact({
      line: { id: 2, tax_percentage: 0 },
      countryCode: 'nl',
      taxPoint: '2026-06-01',
      taxableBaseCents: 10000,
      taxCents: 0,
      schemeTreatment: 'small_business_exempt',
      sourceLineKind: 'invoice_line',
    })).toMatchObject({
      category_code: 'small_business_exempt',
      treatment: 'small_business_exempt',
      output_vat_cents: 0,
      classification_status: 'confirmed',
    })
  })
})

function fact(category, direction, base, output, input) {
  const treatments = {
    domestic_exempt: 'exempt_no_credit',
    outside_scope: 'outside_scope',
  }
  return {
    category_code: category,
    direction,
    treatment: treatments[category] ?? 'standard',
    tax_jurisdiction_code: 'nl',
    taxable_base_cents: base,
    output_vat_cents: output,
    deductible_input_vat_cents: input,
  }
}
