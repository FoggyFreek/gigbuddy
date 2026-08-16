import { ProviderError } from '../../ProviderError.js'

export function providerStatusOf(error) {
  return error?.statusCode ?? error?.status ?? null
}

function isRetryable(error, status) {
  if (['InvalidRequestError', 'SDKValidationError'].includes(error?.name)) return false
  if (error?.name === 'ResponseValidationError') return true
  return status == null || status === 408 || status === 425 || status === 429 || status >= 500
}

export function toProviderError(error, operation) {
  if (error instanceof ProviderError) return error
  const providerStatus = providerStatusOf(error)
  const code = providerStatus === 404
    ? 'not_found'
    : (['InvalidRequestError', 'SDKValidationError'].includes(error?.name)
        ? 'invalid_request'
        : 'provider_error')
  return new ProviderError(`Payment provider ${operation} failed`, {
    code,
    retryable: isRetryable(error, providerStatus),
    providerStatus,
  })
}
