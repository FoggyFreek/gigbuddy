const COLUMNS = Object.freeze({
  mollie_api_key: {
    legacy: 'mollie_api_key', encrypted: 'mollie_api_key_encrypted', changedAt: 'mollie_api_key_changed_at',
  },
  shopify_client_secret: {
    legacy: 'shopify_client_secret', encrypted: 'shopify_client_secret_encrypted', changedAt: 'shopify_client_secret_changed_at',
  },
})

function columnsFor(type) {
  const columns = COLUMNS[type]
  if (!columns) throw new Error('Unknown integration credential type')
  return columns
}

export async function fetchCredentialRecord(executor, tenantId, type) {
  const { legacy, encrypted } = columnsFor(type)
  const { rows } = await executor.query(
    `SELECT ${encrypted} AS encrypted_value, ${legacy} AS legacy_value
       FROM tenants WHERE id = $1`,
    [tenantId],
  )
  return rows[0] || null
}

export async function fetchCredentialStatus(executor, tenantId, type) {
  const { legacy, encrypted, changedAt } = columnsFor(type)
  const { rows } = await executor.query(
    `SELECT (${encrypted} IS NOT NULL OR ${legacy} IS NOT NULL) AS is_set,
            ${changedAt} AS changed_at
       FROM tenants WHERE id = $1`,
    [tenantId],
  )
  return rows[0] || { is_set: false, changed_at: null }
}

export async function storeEncryptedCredential(executor, tenantId, type, envelope) {
  const { legacy, encrypted, changedAt } = columnsFor(type)
  const { rows } = await executor.query(
    `UPDATE tenants
        SET ${encrypted} = $1::jsonb, ${legacy} = NULL,
            ${changedAt} = NOW(), updated_at = NOW()
      WHERE id = $2
      RETURNING ${changedAt} AS changed_at`,
    [JSON.stringify(envelope), tenantId],
  )
  return rows[0] || null
}

export async function clearCredential(executor, tenantId, type) {
  const { legacy, encrypted, changedAt } = columnsFor(type)
  const { rows } = await executor.query(
    `UPDATE tenants
        SET ${encrypted} = NULL, ${legacy} = NULL,
            ${changedAt} = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING ${changedAt} AS changed_at`,
    [tenantId],
  )
  return rows[0] || null
}

