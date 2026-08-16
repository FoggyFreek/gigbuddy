import { ProviderError } from '../../ProviderError.js'

export function providerStatusOf(error) {
  return error?.statusCode ?? error?.status ?? null
}

function isRetryable(status) {
  return status == null || status === 408 || status === 425 || status === 429 || status >= 500
}

export function toProviderError(error, operation) {
  if (error instanceof ProviderError) return error
  const providerStatus = providerStatusOf(error)
  const code = providerStatus === 404
    ? 'not_found'
    : (error?.field ? 'invalid_request' : 'provider_error')
  return new ProviderError(`Payment provider ${operation} failed`, {
    code,
    retryable: isRetryable(providerStatus),
    providerStatus,
  })
}
