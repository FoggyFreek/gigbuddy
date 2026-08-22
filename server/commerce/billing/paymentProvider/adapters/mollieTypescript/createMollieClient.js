import { Client } from 'mollie-api-typescript'

export function createMollieTypescriptClient(apiKey) {
  if (!apiKey) return null
  return new Client({
    security: { apiKey },
    retryConfig: { strategy: 'none' },
    customUserAgent: 'gigbuddy-platform-billing',
  })
}
