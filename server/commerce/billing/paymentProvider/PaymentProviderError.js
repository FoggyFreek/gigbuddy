// A normalized error every payment-provider adapter throws instead of leaking
// its SDK's own error type. The saga layer classifies remote failures purely on
// `.retryable` (→ billing_operations 'failed_retryable' vs 'failed_terminal')
// without knowing anything about the underlying provider.
export class PaymentProviderError extends Error {
  /**
   * @param {string} message
   * @param {object} opts
   * @param {string} opts.code           stable, provider-agnostic error slug
   * @param {boolean} opts.retryable     whether re-issuing the call may succeed
   * @param {number|null} [opts.providerStatus]  raw HTTP status, for logging
   * @param {Error} [opts.cause]
   */
  constructor(message, { code, retryable, providerStatus = null, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'PaymentProviderError'
    this.code = code
    this.retryable = Boolean(retryable)
    this.providerStatus = providerStatus
  }
}

// Thrown by the factory / adapters when platform billing is not configured
// (no provider credentials). Routes translate this to 503.
export class BillingNotConfiguredError extends PaymentProviderError {
  constructor() {
    super('Platform billing is not configured', {
      code: 'billing_not_configured',
      retryable: false,
      providerStatus: 503,
    })
    this.name = 'BillingNotConfiguredError'
  }
}
