import { badRequest, notFound } from '../../platform/http/serviceErrors.js'
import { fetchPreferredInvoiceMode, updatePreferredInvoiceMode } from './tenantRepository.js'
import { parsePreferredInvoiceMode } from './tenantValidators.js'

export async function getTenantInvoiceMode(db, tenantId) {
  const preferredInvoiceMode = await fetchPreferredInvoiceMode(db, tenantId)
  return preferredInvoiceMode === null
    ? notFound('Tenant not found')
    : { preferredInvoiceMode }
}

export async function setTenantInvoiceMode(db, tenantId, body) {
  const parsed = parsePreferredInvoiceMode(body)
  if (parsed.error) return badRequest(parsed.error, { code: parsed.code })

  const preferredInvoiceMode = await updatePreferredInvoiceMode(db, tenantId, parsed.preferredInvoiceMode)
  return preferredInvoiceMode === null
    ? notFound('Tenant not found')
    : { preferredInvoiceMode }
}
