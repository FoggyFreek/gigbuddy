import { fetchIntegrationConfiguration } from './tenantIntegrationRepository.js'

export async function getIntegrationConfiguration(executor, tenantId) {
  const configured = await fetchIntegrationConfiguration(executor, tenantId)
  return {
    shopify: Boolean(configured.shopify),
    bandsintown: Boolean(configured.bandsintown),
    mollie: Boolean(configured.mollie),
    resend: Boolean(configured.resend),
  }
}
