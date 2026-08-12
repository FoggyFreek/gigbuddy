const CONFIG_COLUMNS = Object.freeze({
  bandsintown_artist_name: 'bandsintown_artist_name',
  bandsintown_artist_id: 'bandsintown_artist_id',
  shopify_client_id: 'shopify_client_id',
  shopify_shop_domain: 'shopify_shop_domain',
})

function configColumn(field) {
  const column = CONFIG_COLUMNS[field]
  if (!column) throw new Error('Unknown tenant integration field')
  return column
}

export async function getIntegrationConfigField(executor, tenantId, field) {
  const column = configColumn(field)
  const { rows } = await executor.query(
    `SELECT ${column} FROM tenant_integrations WHERE tenant_id = $1`,
    [tenantId],
  )
  return rows[0]?.[column] || null
}

export async function setIntegrationConfigField(executor, tenantId, field, value) {
  const column = configColumn(field)
  const { rows } = await executor.query(
    `INSERT INTO tenant_integrations (tenant_id, ${column})
     VALUES ($1, $2)
     ON CONFLICT (tenant_id)
     DO UPDATE SET ${column} = EXCLUDED.${column}, updated_at = NOW()
     RETURNING ${column}`,
    [tenantId, value],
  )
  return rows[0]?.[column] || null
}

export async function clearIntegrationConfigField(executor, tenantId, field) {
  const column = configColumn(field)
  await executor.query(
    `UPDATE tenant_integrations SET ${column} = NULL, updated_at = NOW() WHERE tenant_id = $1`,
    [tenantId],
  )
}

export const getShopifyClientId = (executor, tenantId) =>
  getIntegrationConfigField(executor, tenantId, 'shopify_client_id')

export const setShopifyClientId = (executor, tenantId, clientId) =>
  setIntegrationConfigField(executor, tenantId, 'shopify_client_id', clientId)

export const clearShopifyClientId = (executor, tenantId) =>
  clearIntegrationConfigField(executor, tenantId, 'shopify_client_id')

export const getBandsintownArtistId = (executor, tenantId) =>
  getIntegrationConfigField(executor, tenantId, 'bandsintown_artist_id')

export const setBandsintownArtistId = (executor, tenantId, artistId) =>
  setIntegrationConfigField(executor, tenantId, 'bandsintown_artist_id', artistId)

export const clearBandsintownArtistId = (executor, tenantId) =>
  clearIntegrationConfigField(executor, tenantId, 'bandsintown_artist_id')

export const getShopifyDomain = (executor, tenantId) =>
  getIntegrationConfigField(executor, tenantId, 'shopify_shop_domain')

export const setShopifyDomain = (executor, tenantId, domain) =>
  setIntegrationConfigField(executor, tenantId, 'shopify_shop_domain', domain)

export const clearShopifyDomain = (executor, tenantId) =>
  clearIntegrationConfigField(executor, tenantId, 'shopify_shop_domain')

export async function updateBandsintownProfile(executor, tenantId, updates) {
  if (updates.length === 0) return
  const columns = updates.map(({ field }) => configColumn(field))
  const values = updates.map(({ value }) => value)
  const insertColumns = ['tenant_id', ...columns]
  const placeholders = insertColumns.map((_, index) => `$${index + 1}`)
  const assignments = columns.map((column) => `${column} = EXCLUDED.${column}`)
  await executor.query(
    `INSERT INTO tenant_integrations (${insertColumns.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (tenant_id)
     DO UPDATE SET ${assignments.join(', ')}, updated_at = NOW()`,
    [tenantId, ...values],
  )
}

export async function clearBandsintownArtist(executor, tenantId) {
  await executor.query(
    `UPDATE tenant_integrations
        SET bandsintown_artist_name = NULL, bandsintown_artist_id = NULL, updated_at = NOW()
      WHERE tenant_id = $1`,
    [tenantId],
  )
}

export async function fetchIntegrationConfiguration(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT
       (NULLIF(BTRIM(shopify_client_id), '') IS NOT NULL
        AND shopify_client_secret_encrypted IS NOT NULL
        AND NULLIF(BTRIM(shopify_shop_domain), '') IS NOT NULL) AS shopify,
       (bandsintown_app_id_encrypted IS NOT NULL
        AND NULLIF(BTRIM(bandsintown_artist_id), '') IS NOT NULL) AS bandsintown,
       (mollie_api_key_retained_at IS NULL
        AND mollie_api_key_encrypted IS NOT NULL) AS mollie,
       (resend_api_key_encrypted IS NOT NULL) AS resend
       FROM tenant_integrations
      WHERE tenant_id = $1`,
    [tenantId],
  )
  return rows[0] || { shopify: false, bandsintown: false, mollie: false, resend: false }
}
