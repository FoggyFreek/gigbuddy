import {
  defaultDomesticCategory,
  effectiveCategoryTreatment,
  resolveTaxCategory,
} from '../../shared/taxCategories.js'
import { computePurchaseLineTotals } from '../../shared/purchaseTotals.js'
import {
  confirmLegacyTaxFact,
  fetchReviewableTaxFact,
} from '../repositories/taxFactRepository.js'

function isoDate(value) {
  if (typeof value === 'string') return value.slice(0, 10)
  return new Date(value).toISOString().slice(0, 10)
}

function signed(value, sign = 1) {
  return Math.round(Number(value) || 0) * sign
}

export function normalizeTaxSelection({
  line,
  countryCode,
  taxPoint,
  direction,
  rateField,
}) {
  const rate = Number(line[rateField] ?? 0)
  const requestedJurisdiction = String(line.tax_jurisdiction_code ?? '').trim()
  const jurisdiction = (requestedJurisdiction || String(countryCode)).toLowerCase()
  const requestedCategory = typeof line.tax_category_code === 'string'
    ? line.tax_category_code.trim()
    : ''
  const inferredCategory = defaultDomesticCategory(jurisdiction, rate)
  const categoryCode = requestedCategory
    || inferredCategory
    || (rate === 0 ? 'outside_scope' : null)
  const resolved = categoryCode
    ? resolveTaxCategory({
      countryCode: jurisdiction,
      categoryCode,
      taxPoint: isoDate(taxPoint),
      rate,
      direction,
    })
    : null
  const classificationStatus = requestedCategory
    || (inferredCategory && rate > 0)
    ? 'confirmed'
    : 'legacy_inferred'
  return resolved ? { resolved, jurisdiction, classificationStatus } : null
}

export function saleTaxFact({
  line,
  countryCode,
  taxPoint,
  taxableBaseCents,
  taxCents,
  schemeCode = null,
  schemeTreatment = null,
  counterpartyCountry = null,
  sourceLineKind,
  sign = 1,
}) {
  const schemeExempt = schemeTreatment === 'small_business_exempt'
  const factLine = schemeExempt
    ? {
      ...line,
      tax_category_code: 'small_business_exempt',
      tax_percentage: 0,
      vat_rate: 0,
    }
    : line
  const selection = normalizeTaxSelection({
    line: factLine,
    countryCode,
    taxPoint,
    direction: 'sale',
    rateField: line.tax_percentage === undefined ? 'vat_rate' : 'tax_percentage',
  })
  if (!selection) return null
  const treatment = effectiveCategoryTreatment(selection.resolved.code, schemeTreatment)
  const output = treatment === 'small_business_exempt'
    || treatment === 'reverse_charge'
    || treatment === 'zero_rated'
    || treatment === 'exempt_no_credit'
    || treatment === 'outside_scope'
    ? 0
    : taxCents
  return {
    source_line_kind: sourceLineKind,
    source_line_id: line.id ?? null,
    source_line_position: line.position ?? null,
    tax_point: isoDate(taxPoint),
    direction: 'sale',
    tax_jurisdiction_code: selection.jurisdiction,
    counterparty_country_code: counterpartyCountry?.toLowerCase?.() ?? null,
    category_code: selection.resolved.code,
    category_version: selection.resolved.version,
    treatment,
    scheme_code: schemeCode,
    rate: selection.resolved.rate,
    recovery_percent: 0,
    taxable_base_cents: signed(taxableBaseCents, sign),
    tax_amount_cents: signed(taxCents, sign),
    output_vat_cents: signed(output, sign),
    deductible_input_vat_cents: 0,
    non_deductible_input_vat_cents: 0,
    classification_status: selection.classificationStatus,
  }
}

export function purchaseTaxFact({
  line,
  countryCode,
  taxPoint,
  schemeCode = null,
  inputVatRecoverable = true,
  counterpartyCountry = null,
  sourceLineKind,
  sign = 1,
}) {
  const selection = normalizeTaxSelection({
    line,
    countryCode,
    taxPoint,
    direction: 'purchase',
    rateField: line.tax_rate === undefined ? 'vat_rate' : 'tax_rate',
  })
  if (!selection) return null

  const gross = Number(line.amount_incl_cents ?? line.gross_incl_cents ?? line.amount_cents ?? 0)
  const totals = computePurchaseLineTotals({
    amount_incl_cents: gross,
    tax_rate: selection.resolved.rate,
    tax_category_code: selection.resolved.code,
  })
  const selfAssessed = selection.resolved.selfAssessed
  const base = selfAssessed ? gross : totals.netCents
  const tax = selfAssessed
    ? Math.round((base * selection.resolved.rate) / 100)
    : totals.vatCents
  const requestedRecovery = Number(line.input_vat_recovery_percent ?? 100)
  const treatmentAllowsRecovery = ![
    'exempt_no_credit',
    'outside_scope',
    'small_business_exempt',
  ].includes(selection.resolved.treatment)
  const recovery = inputVatRecoverable && treatmentAllowsRecovery
    ? Math.max(0, Math.min(100, Number.isFinite(requestedRecovery) ? requestedRecovery : 100))
    : 0
  const deductible = Math.round((tax * recovery) / 100)
  const output = selfAssessed ? tax : 0

  return {
    source_line_kind: sourceLineKind,
    source_line_id: line.id ?? null,
    source_line_position: line.position ?? null,
    tax_point: isoDate(taxPoint),
    direction: 'purchase',
    tax_jurisdiction_code: selection.jurisdiction,
    counterparty_country_code: counterpartyCountry?.toLowerCase?.() ?? null,
    category_code: selection.resolved.code,
    category_version: selection.resolved.version,
    treatment: selection.resolved.treatment,
    scheme_code: schemeCode,
    rate: selection.resolved.rate,
    recovery_percent: recovery,
    taxable_base_cents: signed(base, sign),
    tax_amount_cents: signed(tax, sign),
    output_vat_cents: signed(output, sign),
    deductible_input_vat_cents: signed(deductible, sign),
    non_deductible_input_vat_cents: signed(tax - deductible, sign),
    classification_status: selection.classificationStatus,
  }
}

export function reverseTaxFacts(facts) {
  return facts.map((fact) => ({
    ...fact,
    id: undefined,
    source_line_kind: 'tax_fact_reversal',
    source_line_id: fact.id,
    taxable_base_cents: -fact.taxable_base_cents,
    tax_amount_cents: -fact.tax_amount_cents,
    output_vat_cents: -fact.output_vat_cents,
    deductible_input_vat_cents: -fact.deductible_input_vat_cents,
    non_deductible_input_vat_cents: -fact.non_deductible_input_vat_cents,
    classification_status: 'confirmed',
  }))
}

export async function confirmTaxFactClassification(
  executor, tenantId, factId, body, actorUserId,
) {
  const fact = await fetchReviewableTaxFact(executor, tenantId, factId)
  if (!fact) return { error: { status: 404, body: { error: 'Not found' } } }
  const direction = body.direction ?? fact.direction
  const jurisdiction = String(body.tax_jurisdiction_code ?? fact.tax_jurisdiction_code).toLowerCase()
  const rate = Number(body.rate ?? fact.rate)
  const categoryCode = String(body.category_code ?? '')
  const resolved = resolveTaxCategory({
    countryCode: jurisdiction,
    categoryCode,
    taxPoint: isoDate(fact.tax_point),
    rate,
    direction,
  })
  if (!resolved) {
    return {
      error: {
        status: 400,
        body: { error: 'Invalid tax category classification', code: 'invalid_tax_category' },
      },
    }
  }
  const taxableBaseCents = Number(body.taxable_base_cents ?? fact.taxable_base_cents)
  const taxAmountCents = Number(body.tax_amount_cents ?? fact.tax_amount_cents)
  if (!Number.isInteger(taxableBaseCents) || !Number.isInteger(taxAmountCents)) {
    return { error: { status: 400, body: { error: 'Invalid tax amounts', code: 'invalid_tax_amounts' } } }
  }
  if (fact.classification_status !== 'unclassified'
    && (taxableBaseCents !== Number(fact.taxable_base_cents)
      || taxAmountCents !== Number(fact.tax_amount_cents))) {
    return {
      error: {
        status: 409,
        body: {
          error: 'Posted tax amounts need a correcting journal',
          code: 'tax_fact_correction_required',
        },
      },
    }
  }
  const expectedTax = Math.round((taxableBaseCents * rate) / 100)
  if (Math.abs(expectedTax - taxAmountCents) > 1) {
    return {
      error: {
        status: 409,
        body: { error: 'VAT amount needs a correcting journal', code: 'tax_fact_correction_required' },
      },
    }
  }
  const outputVat = Number(fact.output_vat_cents)
  const expectedOutput = direction === 'sale' || direction === 'adjustment'
    ? (['standard', 'reduced'].includes(resolved.treatment) ? taxAmountCents : 0)
    : (resolved.selfAssessed ? taxAmountCents : 0)
  if (outputVat !== expectedOutput) {
    return {
      error: {
        status: 409,
        body: { error: 'Output VAT needs a correcting journal', code: 'tax_fact_correction_required' },
      },
    }
  }
  if (direction === 'purchase'
    && Number(fact.deductible_input_vat_cents) > Math.abs(taxAmountCents)) {
    return {
      error: {
        status: 409,
        body: { error: 'Input VAT needs a correcting journal', code: 'tax_fact_correction_required' },
      },
    }
  }
  const updated = await confirmLegacyTaxFact(executor, tenantId, factId, {
    tax_jurisdiction_code: jurisdiction,
    category_code: categoryCode,
    category_version: resolved.version,
    treatment: resolved.treatment,
    recovery_percent: Number(fact.recovery_percent),
    direction,
    rate,
    taxable_base_cents: taxableBaseCents,
    tax_amount_cents: taxAmountCents,
  }, actorUserId)
  return updated
    ? { taxFact: updated }
    : { error: { status: 404, body: { error: 'Not found' } } }
}
