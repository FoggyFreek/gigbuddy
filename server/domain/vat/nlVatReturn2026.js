const SOURCE_URL = 'https://download.belastingdienst.nl/belastingdienst/docs/toelichting_bij_btw_aangifte_ob0731t62fd.pdf'

export const NL_VAT_RETURN_SCHEMA_2026 = Object.freeze({
  countryCode: 'nl',
  year: 2026,
  version: 'nl-ob-2026.1',
  sourceUrl: SOURCE_URL,
  sourceCheckedAt: '2026-07-31',
})

export const NL_VAT_RETURN_BOX_DESCRIPTIONS_2026 = Object.freeze({
  '1a': 'Leveringen/diensten belast met hoog tarief',
  '1b': 'Leveringen/diensten belast met laag tarief',
  '1c': 'Leveringen/diensten belast met overige tarieven, behalve 0%',
  '1d': 'Privégebruik',
  '1e': 'Leveringen/diensten belast met 0% of niet bij u belast',
  '2a': 'Leveringen/diensten waarbij de btw naar u is verlegd',
  '3a': 'Leveringen naar landen buiten de EU (uitvoer)',
  '3b': 'Leveringen naar of diensten in landen binnen de EU',
  '3c': 'Installatie/afstandsverkopen binnen de EU',
  '4a': 'Leveringen/diensten uit landen buiten de EU',
  '4b': 'Leveringen/diensten uit landen binnen de EU',
  '5a': 'Verschuldigde btw (rubrieken 1 t/m 4)',
  '5b': 'Voorbelasting',
  '5c': 'Subtotaal (rubriek 5a min 5b)',
})

const BOX_CODES = Object.freeze(['1a', '1b', '1c', '1d', '1e', '2a', '3a', '3b', '3c', '4a', '4b'])

export function getNlVatReturnBoxDescription(code) {
  return NL_VAT_RETURN_BOX_DESCRIPTIONS_2026[code] ?? null
}

function emptyBox() {
  return { base_cents: 0, vat_cents: 0 }
}

function mappedBox(fact) {
  const sale = fact.direction === 'sale'
  const purchase = fact.direction === 'purchase'
  switch (fact.category_code) {
    case 'domestic_standard': return sale ? '1a' : null
    case 'domestic_reduced': return sale ? '1b' : null
    case 'domestic_other_rate': return sale ? '1c' : null
    case 'private_use_adjustment': return '1d'
    case 'domestic_zero': return sale ? '1e' : null
    case 'domestic_reverse_charge': return sale ? '1e' : (purchase ? '2a' : null)
    case 'export_non_eu_goods': return sale ? '3a' : null
    case 'intra_eu_supply_goods':
    case 'intra_eu_supply_services':
      return sale ? '3b' : null
    case 'eu_distance_installation_non_oss': return sale ? '3c' : null
    case 'import_article_23':
    case 'non_eu_service_reverse_charge':
      return purchase ? '4a' : null
    case 'intra_eu_acquisition_goods':
    case 'intra_eu_acquisition_services':
      return purchase ? '4b' : null
    default: return null
  }
}

function isExcluded(fact) {
  return fact.tax_jurisdiction_code !== 'nl'
    || fact.treatment === 'small_business_exempt'
    || fact.treatment === 'exempt_no_credit'
    || fact.treatment === 'outside_scope'
    || fact.category_code === 'foreign_vat'
}

export function computeNlVatReturnBoxes(facts) {
  const boxes = Object.fromEntries(BOX_CODES.map((code) => [code, emptyBox()]))
  const unmapped = []
  const icp_candidates = []

  for (const fact of facts) {
    if (isExcluded(fact)) {
      unmapped.push(fact)
      continue
    }
    const code = mappedBox(fact)
    if (code) {
      boxes[code].base_cents += Number(fact.taxable_base_cents) || 0
      boxes[code].vat_cents += Number(fact.output_vat_cents) || 0
    } else if ((Number(fact.output_vat_cents) || 0) !== 0) {
      unmapped.push(fact)
    }
    if (code === '3b') icp_candidates.push(fact)
  }

  const outputVat = BOX_CODES.reduce((sum, code) => sum + boxes[code].vat_cents, 0)
  const inputVat = facts
    .filter((fact) => !isExcluded(fact))
    .reduce((sum, fact) => sum + (Number(fact.deductible_input_vat_cents) || 0), 0)
  boxes['5a'] = { vat_cents: outputVat }
  boxes['5b'] = { vat_cents: inputVat }
  boxes['5c'] = { vat_cents: outputVat - inputVat }

  return { boxes, unmapped, icp_candidates }
}

export function declaredEuroFor(rawCents, kind) {
  const value = Number(rawCents) / 100
  if (kind === 'input_vat') return Math.ceil(value)
  if (kind === 'output_vat') return Math.floor(value)
  return Math.trunc(value)
}
