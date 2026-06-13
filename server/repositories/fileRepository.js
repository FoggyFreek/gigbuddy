// Data-access helpers for file-object access control. Each query takes an
// `executor` (a pool or transaction client). Both queries union across every
// table that can own an object key, scoped by tenant_id, so a key is only
// served to the tenant that owns it.

export async function objectKeyBelongsToTenant(executor, tenantId, objectKey) {
  const { rows } = await executor.query(
    `SELECT 1 FROM tenants WHERE id = $1 AND logo_path = $2
     UNION ALL
     SELECT 1 FROM gigs WHERE tenant_id = $1 AND banner_path = $2
     UNION ALL
     SELECT 1 FROM share_photos WHERE tenant_id = $1 AND object_key = $2
     UNION ALL
     SELECT 1 FROM gig_attachments WHERE tenant_id = $1 AND object_key = $2
     UNION ALL
     SELECT 1 FROM invoices WHERE tenant_id = $1 AND pdf_path = $2
     UNION ALL
     SELECT 1 FROM invoices WHERE tenant_id = $1 AND custom_logo_path = $2
     UNION ALL
     SELECT 1 FROM song_documents WHERE tenant_id = $1 AND object_key = $2
     UNION ALL
     SELECT 1 FROM song_recordings WHERE tenant_id = $1 AND object_key = $2
     UNION ALL
     SELECT 1 FROM purchase_attachments WHERE tenant_id = $1 AND object_key = $2
     LIMIT 1`,
    [tenantId, objectKey],
  )
  return rows.length > 0
}

// Original upload filename for downloadable object types (used to set
// Content-Disposition). Returns null for object types without a stored name.
export async function fetchOriginalFilename(executor, objectKey, tenantId) {
  const { rows } = await executor.query(
    `SELECT original_filename FROM gig_attachments WHERE object_key = $1 AND tenant_id = $2
     UNION ALL
     SELECT original_filename FROM song_documents WHERE object_key = $1 AND tenant_id = $2
     UNION ALL
     SELECT original_filename FROM song_recordings WHERE object_key = $1 AND tenant_id = $2
     UNION ALL
     SELECT original_filename FROM purchase_attachments WHERE object_key = $1 AND tenant_id = $2
     LIMIT 1`,
    [objectKey, tenantId],
  )
  return rows[0]?.original_filename ?? null
}
