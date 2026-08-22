export class ProviderError extends Error {
  /**
   * @param {string} message
   * @param {{ code: string, retryable: boolean, providerStatus?: number|null }} options
   */
  constructor(message, { code, retryable, providerStatus = null } = {}) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.retryable = Boolean(retryable)
    this.providerStatus = providerStatus
  }
}

export class BillingNotConfiguredError extends ProviderError {
  constructor() {
    super('Platform billing is not configured', {
      code: 'billing_not_configured', retryable: false, providerStatus: 503,
    })
    this.name = 'BillingNotConfiguredError'
  }
}
