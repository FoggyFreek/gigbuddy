// Data-access helpers for the tenant profile (a view over the tenants row plus
// profile_links) and the Mollie key / logo columns. Each query takes an
// `executor` (a pool or transaction client) so callers control transactions.
import { tenantSafeProjection } from './tenantSafeProjection.js'

export async function fetchTenant(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT ${tenantSafeProjection()} FROM tenants WHERE id = $1`,
    [tenantId],
  )
  return rows[0] || null
}

export async function listProfileLinks(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM profile_links WHERE tenant_id = $1 ORDER BY sort_order ASC, id ASC',
    [tenantId],
  )
  return rows
}

// Applies prebuilt SET fragments to the tenant row, appending updated_at and the
// id WHERE binding. Returns the updated row or null.
export async function updateTenantFields(executor, tenantId, fields, values) {
  const assignments = [...fields, 'updated_at = NOW()']
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE tenants SET ${assignments.join(', ')} WHERE id = $${whereIdx}
     RETURNING ${tenantSafeProjection()}`,
    [...values, tenantId],
  )
  return rows[0] || null
}

// ---------- links ----------

export async function nextLinkSortOrder(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM profile_links WHERE tenant_id = $1',
    [tenantId],
  )
  return rows[0].next
}

export async function insertProfileLink(executor, tenantId, label, url, sortOrder) {
  const { rows } = await executor.query(
    `INSERT INTO profile_links (tenant_id, label, url, sort_order)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenantId, label, url, sortOrder],
  )
  return rows[0]
}

export async function updateProfileLink(executor, tenantId, linkId, fields, values) {
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE profile_links SET ${fields.join(', ')}
     WHERE id = $${whereIdx} AND tenant_id = $${whereIdx + 1} RETURNING *`,
    [...values, linkId, tenantId],
  )
  return rows[0] || null
}

export async function deleteProfileLink(executor, linkId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM profile_links WHERE id = $1 AND tenant_id = $2',
    [linkId, tenantId],
  )
  return rowCount > 0
}

// ---------- shopify app credentials (client id + secret) ----------

export async function getShopifyClientId(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT shopify_client_id FROM tenants WHERE id = $1',
    [tenantId],
  )
  return rows[0]?.shopify_client_id || null
}

export async function setShopifyClientId(executor, tenantId, clientId) {
  const { rows } = await executor.query(
    'UPDATE tenants SET shopify_client_id = $1, updated_at = NOW() WHERE id = $2 RETURNING shopify_client_id',
    [clientId, tenantId],
  )
  return rows[0]?.shopify_client_id || null
}

export async function clearShopifyClientId(executor, tenantId) {
  await executor.query(
    'UPDATE tenants SET shopify_client_id = NULL, updated_at = NOW() WHERE id = $1',
    [tenantId],
  )
}

// ---------- shopify store domain (non-secret) ----------

export async function getShopifyDomain(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT shopify_shop_domain FROM tenants WHERE id = $1',
    [tenantId],
  )
  return rows[0]?.shopify_shop_domain || null
}

export async function setShopifyDomain(executor, tenantId, domain) {
  const { rows } = await executor.query(
    'UPDATE tenants SET shopify_shop_domain = $1, updated_at = NOW() WHERE id = $2 RETURNING shopify_shop_domain',
    [domain, tenantId],
  )
  return rows[0]?.shopify_shop_domain || null
}

export async function clearShopifyDomain(executor, tenantId) {
  await executor.query(
    'UPDATE tenants SET shopify_shop_domain = NULL, updated_at = NOW() WHERE id = $1',
    [tenantId],
  )
}

// Clears the Bandsintown integration configuration (non-secret, but part of
// the integration surface purged when the entitlement is lost).
export async function clearBandsintownArtist(executor, tenantId) {
  await executor.query(
    'UPDATE tenants SET bandsintown_artist_name = NULL, bandsintown_artist_id = NULL, updated_at = NOW() WHERE id = $1',
    [tenantId],
  )
}

// ---------- tenant image paths (logo, banner, avatar, logo_dark) ----------

const IMAGE_COLUMNS = Object.freeze({
  logo_path: 'logo_path',
  banner_path: 'banner_path',
  avatar_path: 'avatar_path',
  logo_dark_path: 'logo_dark_path',
})

export async function getTenantImagePath(executor, tenantId, column) {
  const col = IMAGE_COLUMNS[column]
  if (!col) throw new Error(`Unknown image column: ${column}`)
  const { rows } = await executor.query(`SELECT ${col} FROM tenants WHERE id = $1`, [tenantId])
  return rows[0]?.[col] || null
}

export async function setTenantImagePath(executor, tenantId, column, objectKey) {
  const col = IMAGE_COLUMNS[column]
  if (!col) throw new Error(`Unknown image column: ${column}`)
  const { rows } = await executor.query(
    `UPDATE tenants SET ${col} = $1, updated_at = NOW() WHERE id = $2 RETURNING ${col}`,
    [objectKey, tenantId],
  )
  return rows[0][col]
}

// Downgrade purge: nulls the accent color and every customization image
// column, returning the previous object keys so they can be queued for
// storage cleanup. Callers run this inside the tenant-lock transaction, so
// the read-then-clear pair cannot race another write.
export async function clearTenantCustomization(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT logo_path, banner_path, avatar_path, logo_dark_path FROM tenants WHERE id = $1',
    [tenantId],
  )
  const keys = rows[0]
    ? [rows[0].logo_path, rows[0].banner_path, rows[0].avatar_path, rows[0].logo_dark_path].filter(Boolean)
    : []
  await executor.query(
    `UPDATE tenants
        SET accent_color = NULL, logo_path = NULL, banner_path = NULL,
            avatar_path = NULL, logo_dark_path = NULL, updated_at = NOW()
      WHERE id = $1`,
    [tenantId],
  )
  return keys
}
