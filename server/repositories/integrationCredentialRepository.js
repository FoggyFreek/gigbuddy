const COLUMNS = Object.freeze({
  mollie_api_key: {
    legacy: 'mollie_api_key', encrypted: 'mollie_api_key_encrypted', changedAt: 'mollie_api_key_changed_at',
    // Set when the integrations purge keeps the value alive solely for paid
    // payment links (webhook/sync). While set, the credential reads as absent
    // everywhere except the dedicated retained accessor.
    retained: 'mollie_api_key_retained_at',
  },
  shopify_client_secret: {
    legacy: 'shopify_client_secret', encrypted: 'shopify_client_secret_encrypted', changedAt: 'shopify_client_secret_changed_at',
  },
  bandsintown_app_id: {
    legacy: 'bandsintown_app_id', encrypted: 'bandsintown_app_id_encrypted', changedAt: 'bandsintown_app_id_changed_at',
  },
})

function columnsFor(type) {
  const columns = COLUMNS[type]
  if (!columns) throw new Error('Unknown integration credential type')
  return columns
}

export async function fetchCredentialRecord(executor, tenantId, type) {
  const { legacy, encrypted, retained } = columnsFor(type)
  const { rows } = await executor.query(
    `SELECT ${encrypted} AS encrypted_value, ${legacy} AS legacy_value,
            ${retained ? `${retained}` : 'NULL'} AS retained_at
       FROM tenants WHERE id = $1`,
    [tenantId],
  )
  return rows[0] || null
}

export async function fetchCredentialStatus(executor, tenantId, type) {
  const { legacy, encrypted, changedAt, retained } = columnsFor(type)
  // A retained key is reported ABSENT: the public status must not reveal that
  // a value is still stored for webhook/sync of paid links.
  const retainedGuard = retained ? ` AND ${retained} IS NULL` : ''
  const { rows } = await executor.query(
    `SELECT (${encrypted} IS NOT NULL OR ${legacy} IS NOT NULL)${retainedGuard} AS is_set,
            ${changedAt} AS changed_at
       FROM tenants WHERE id = $1`,
    [tenantId],
  )
  return rows[0] || { is_set: false, changed_at: null }
}

export async function storeEncryptedCredential(executor, tenantId, type, envelope) {
  const { legacy, encrypted, changedAt, retained } = columnsFor(type)
  const clearRetained = retained ? `, ${retained} = NULL` : ''
  const { rows } = await executor.query(
    `UPDATE tenants
        SET ${encrypted} = $1::jsonb, ${legacy} = NULL,
            ${changedAt} = NOW(), updated_at = NOW()${clearRetained}
      WHERE id = $2
      RETURNING ${changedAt} AS changed_at`,
    [JSON.stringify(envelope), tenantId],
  )
  return rows[0] || null
}

export async function clearCredential(executor, tenantId, type) {
  const { legacy, encrypted, changedAt, retained } = columnsFor(type)
  const clearRetained = retained ? `, ${retained} = NULL` : ''
  const { rows } = await executor.query(
    `UPDATE tenants
        SET ${encrypted} = NULL, ${legacy} = NULL,
            ${changedAt} = NOW(), updated_at = NOW()${clearRetained}
      WHERE id = $1
      RETURNING ${changedAt} AS changed_at`,
    [tenantId],
  )
  return rows[0] || null
}

// Marks the stored mollie key as retained-for-paid-links: the value stays but
// the public credential status reports it absent from now on.
export async function setMollieKeyRetained(executor, tenantId) {
  await executor.query(
    'UPDATE tenants SET mollie_api_key_retained_at = NOW(), updated_at = NOW() WHERE id = $1',
    [tenantId],
  )
}
