export async function listVenueGroups(executor, tenantId, search, limit) {
  const { rows } = await executor.query(
    `SELECT id, name
       FROM venue_groups
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR name ILIKE $2)
      ORDER BY lower(name) ASC, id ASC
      LIMIT $3`,
    [tenantId, search, limit],
  )
  return rows
}

export async function fetchVenueGroup(executor, groupId, tenantId, { lock = false } = {}) {
  const { rows } = await executor.query(
    `SELECT id, name FROM venue_groups
      WHERE id = $1 AND tenant_id = $2${lock ? ' FOR SHARE' : ''}`,
    [groupId, tenantId],
  )
  return rows[0] ?? null
}

export async function insertVenueGroup(executor, tenantId, name) {
  const { rows } = await executor.query(
    `INSERT INTO venue_groups (tenant_id, name)
     VALUES ($1, $2) RETURNING id, name`,
    [tenantId, name],
  )
  return rows[0]
}

export async function updateVenueGroupName(executor, groupId, tenantId, name) {
  const { rows } = await executor.query(
    `UPDATE venue_groups SET name = $1, updated_at = NOW()
      WHERE id = $2 AND tenant_id = $3
      RETURNING id, name`,
    [name, groupId, tenantId],
  )
  return rows[0] ?? null
}

export async function deleteVenueGroup(executor, groupId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM venue_groups WHERE id = $1 AND tenant_id = $2',
    [groupId, tenantId],
  )
  return rowCount > 0
}

export async function lockVenueIdsInTenant(executor, venueIds, tenantId) {
  const { rows } = await executor.query(
    `SELECT id FROM venues
      WHERE tenant_id = $1 AND id = ANY($2::int[])
      ORDER BY id FOR SHARE`,
    [tenantId, venueIds],
  )
  return rows.map((row) => row.id)
}

export async function insertVenueGroupMemberships(executor, groupId, tenantId, venueIds) {
  const { rows } = await executor.query(
    `INSERT INTO venue_group_memberships (group_id, venue_id, tenant_id)
     SELECT $1, venue_id, $2 FROM unnest($3::int[]) AS venue_id
     ON CONFLICT DO NOTHING
     RETURNING venue_id`,
    [groupId, tenantId, venueIds],
  )
  return rows.map((row) => row.venue_id)
}

export async function deleteVenueGroupMemberships(executor, groupId, tenantId, venueIds) {
  const { rowCount } = await executor.query(
    `DELETE FROM venue_group_memberships
      WHERE group_id = $1 AND tenant_id = $2 AND venue_id = ANY($3::int[])`,
    [groupId, tenantId, venueIds],
  )
  return rowCount
}
