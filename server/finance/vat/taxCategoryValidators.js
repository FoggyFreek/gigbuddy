import { listTaxCategories } from '../../../shared/taxCategories.js'
import { normalizeVatCountry } from '../../../shared/vatRates.js'

function normalizedOptionalString(value) {
  if (value == null) return null
  return String(value).trim() || null
}

export function validateTaxCategoryFields(lines, {
  direction,
  directionForLine,
  validateRecovery = false,
} = {}) {
  if (!Array.isArray(lines)) return null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? {}
    const lineDirection = directionForLine?.(line) ?? direction
    const category = normalizedOptionalString(line.tax_category_code)
    if (category && (!lineDirection || !listTaxCategories(lineDirection).includes(category))) {
      return {
        error: `Line ${index + 1} has an invalid VAT category`,
        code: 'invalid_tax_category',
        line: index + 1,
      }
    }

    const jurisdiction = normalizedOptionalString(line.tax_jurisdiction_code)
    if (jurisdiction && !normalizeVatCountry(jurisdiction)) {
      return {
        error: `Line ${index + 1} has an unsupported VAT jurisdiction`,
        code: 'invalid_tax_jurisdiction',
        line: index + 1,
      }
    }

    if (validateRecovery && line.input_vat_recovery_percent != null) {
      const recovery = Number(line.input_vat_recovery_percent)
      if (!Number.isFinite(recovery) || recovery < 0 || recovery > 100) {
        return {
          error: `Line ${index + 1} has an invalid input VAT recovery percentage`,
          code: 'invalid_vat_recovery_percent',
          line: index + 1,
        }
      }
    }
  }
  return null
}
