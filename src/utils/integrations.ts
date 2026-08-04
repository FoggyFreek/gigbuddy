export const INTEGRATION_NAMES = ['shopify', 'bandsintown', 'mollie'] as const

export type IntegrationName = typeof INTEGRATION_NAMES[number]
export type IntegrationConfiguration = Record<IntegrationName, boolean>

export const EMPTY_INTEGRATION_CONFIGURATION: IntegrationConfiguration = {
  shopify: false,
  bandsintown: false,
  mollie: false,
}

export function isIntegrationConfigured(
  configuration: IntegrationConfiguration | null | undefined,
  integration: IntegrationName,
): boolean {
  return configuration?.[integration] === true
}
