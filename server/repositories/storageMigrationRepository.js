export async function ensureMigration(executor, tenantId) {
  const { rows } = await executor.query(
    `INSERT INTO storage_migrations (tenant_id)
     SELECT id FROM tenants WHERE id = $1
     ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
     RETURNING *`,
    [tenantId],
  )
  return rows[0] || null
}

export async function getMigration(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT sm.*, t.slug, t.band_name
       FROM tenants t
       LEFT JOIN storage_migrations sm ON sm.tenant_id = t.id
      WHERE t.id = $1`,
    [tenantId],
  )
  if (!rows[0]) return null
  return normalizeStatus(rows[0])
}

export async function listMigrations(executor) {
  const { rows } = await executor.query(
    `SELECT sm.*, t.id AS tenant_id, t.slug, t.band_name
       FROM tenants t
       LEFT JOIN storage_migrations sm ON sm.tenant_id = t.id
      ORDER BY t.id`,
  )
  return rows.map(normalizeStatus)
}

function normalizeStatus(row) {
  return {
    ...row,
    state: row.state || 'not_scanned',
    source_object_count: Number(row.source_object_count || 0),
    source_bytes: Number(row.source_bytes || 0),
    copied_object_count: Number(row.copied_object_count || 0),
    copied_bytes: Number(row.copied_bytes || 0),
    database_references_checked: Number(row.database_references_checked || 0),
    missing_object_count: Number(row.missing_object_count || 0),
    mismatch_count: Number(row.mismatch_count || 0),
  }
}

export async function queueMigration(executor, tenantId, action, userId) {
  await ensureMigration(executor, tenantId)
  const { rows } = await executor.query(
    `UPDATE storage_migrations
        SET requested_action = $2,
            requested_by_user_id = $3,
            state = CASE $2
              WHEN 'inventory' THEN 'inventorying'
              WHEN 'copy' THEN 'copying'
              WHEN 'validate' THEN 'validating'
              WHEN 'delete_rustfs' THEN 'deleting_source'
            END,
            error_code = NULL,
            completed_at = NULL,
            updated_at = NOW()
      WHERE tenant_id = $1
        AND requested_action IS NULL
        AND (lease_until IS NULL OR lease_until < NOW())
      RETURNING *`,
    [tenantId, action, userId],
  )
  return rows[0] || null
}

export async function claimNextMigration(executor, leaseSeconds = 120) {
  const { rows } = await executor.query(
    `WITH next_job AS (
       SELECT tenant_id
         FROM storage_migrations
        WHERE requested_action IS NOT NULL
          AND (lease_until IS NULL OR lease_until < NOW())
        ORDER BY updated_at, tenant_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     UPDATE storage_migrations sm
        SET state = CASE sm.requested_action
          WHEN 'inventory' THEN 'inventorying'
          WHEN 'copy' THEN 'copying'
          WHEN 'validate' THEN 'validating'
          WHEN 'delete_rustfs' THEN 'deleting_source'
        END,
            lease_until = NOW() + ($1 * INTERVAL '1 second'),
            heartbeat_at = NOW(),
            started_at = NOW(),
            error_code = NULL,
            updated_at = NOW()
       FROM next_job
      WHERE sm.tenant_id = next_job.tenant_id
      RETURNING sm.*`,
    [leaseSeconds],
  )
  return rows[0] || null
}

export async function heartbeatMigration(executor, tenantId, progress = {}) {
  const fields = {
    source_object_count: progress.sourceObjectCount,
    source_bytes: progress.sourceBytes,
    copied_object_count: progress.copiedObjectCount,
    copied_bytes: progress.copiedBytes,
    database_references_checked: progress.databaseReferencesChecked,
    missing_object_count: progress.missingObjectCount,
    mismatch_count: progress.mismatchCount,
  }
  await executor.query(
    `UPDATE storage_migrations SET
       source_object_count = COALESCE($2, source_object_count),
       source_bytes = COALESCE($3, source_bytes),
       copied_object_count = COALESCE($4, copied_object_count),
       copied_bytes = COALESCE($5, copied_bytes),
       database_references_checked = COALESCE($6, database_references_checked),
       missing_object_count = COALESCE($7, missing_object_count),
       mismatch_count = COALESCE($8, mismatch_count),
       lease_until = NOW() + INTERVAL '2 minutes', heartbeat_at = NOW(), updated_at = NOW()
     WHERE tenant_id = $1`,
    [tenantId, ...Object.values(fields)],
  )
}

export async function completeMigration(executor, tenantId, state, details = {}) {
  const { rows } = await executor.query(
    `UPDATE storage_migrations SET
       state = $2,
       requested_action = NULL,
       lease_until = NULL,
       heartbeat_at = NOW(),
       source_object_count = COALESCE($3, source_object_count),
       source_bytes = COALESCE($4, source_bytes),
       copied_object_count = COALESCE($5, copied_object_count),
       copied_bytes = COALESCE($6, copied_bytes),
       database_references_checked = COALESCE($7, database_references_checked),
       missing_object_count = COALESCE($8, missing_object_count),
       mismatch_count = COALESCE($9, mismatch_count),
       inventory_fingerprint = COALESCE($10, inventory_fingerprint),
       validated_fingerprint = $11,
       validated_at = $12,
       error_code = NULL,
       completed_at = NOW(),
       updated_at = NOW()
     WHERE tenant_id = $1
     RETURNING *`,
    [
      tenantId,
      state,
      details.sourceObjectCount,
      details.sourceBytes,
      details.copiedObjectCount,
      details.copiedBytes,
      details.databaseReferencesChecked,
      details.missingObjectCount,
      details.mismatchCount,
      details.inventoryFingerprint,
      details.validatedFingerprint ?? null,
      details.validatedAt ?? null,
    ],
  )
  return rows[0]
}

export async function failMigration(executor, tenantId, state, errorCode) {
  await executor.query(
    `UPDATE storage_migrations
        SET state = $2, requested_action = NULL, lease_until = NULL,
            error_code = $3, completed_at = NOW(), updated_at = NOW()
      WHERE tenant_id = $1`,
    [tenantId, state, errorCode],
  )
}

export async function replaceInventory(executor, tenantId, objects) {
  const keys = objects.map(({ name }) => name)
  await executor.query(
    `DELETE FROM storage_migration_objects
      WHERE tenant_id = $1
        AND NOT (object_key = ANY($2::text[]))`,
    [tenantId, keys],
  )
  for (const object of objects) {
    await executor.query(
      `INSERT INTO storage_migration_objects
         (tenant_id, object_key, source_size, source_content_type, source_fingerprint, state)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (tenant_id, object_key) DO UPDATE SET
         source_size = EXCLUDED.source_size,
         source_content_type = EXCLUDED.source_content_type,
         state = CASE
           WHEN storage_migration_objects.source_fingerprint = EXCLUDED.source_fingerprint
             THEN storage_migration_objects.state
           ELSE 'pending'
         END,
         source_sha256 = CASE
           WHEN storage_migration_objects.source_fingerprint = EXCLUDED.source_fingerprint
             THEN storage_migration_objects.source_sha256
           ELSE NULL
         END,
         destination_sha256 = CASE
           WHEN storage_migration_objects.source_fingerprint = EXCLUDED.source_fingerprint
             THEN storage_migration_objects.destination_sha256
           ELSE NULL
         END,
         source_fingerprint = EXCLUDED.source_fingerprint,
         updated_at = NOW()`,
      [tenantId, object.name, object.size, object.contentType, object.fingerprint],
    )
  }
}

export async function markObjectVerified(executor, tenantId, object) {
  await executor.query(
    `UPDATE storage_migration_objects
        SET source_sha256 = $3, destination_size = $4, destination_sha256 = $5,
            state = 'verified', attempts = attempts + 1,
            copied_at = COALESCE(copied_at, NOW()), verified_at = NOW(), updated_at = NOW()
      WHERE tenant_id = $1 AND object_key = $2`,
    [tenantId, object.name, object.sourceSha256, object.destinationSize, object.destinationSha256],
  )
}
