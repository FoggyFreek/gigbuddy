// Expected billing failures shared by every user-facing billing service.
// Same contract as server/platform/http/serviceErrors.js: { error: { status, body } }.
import { conflict, notFound, serviceError } from '../../platform/http/serviceErrors.js'

export const NOT_CONFIGURED = serviceError(503, 'Billing is not configured', { code: 'billing_not_configured' })
export const PROVIDER_ERROR = serviceError(502, 'Payment provider error', { code: 'provider_error' })
export const COMPLIMENTARY = conflict('This subscription is managed by an administrator', {
  code: 'complimentary_managed_by_admin',
})
export const NO_SUBSCRIPTION = notFound('No subscription')
