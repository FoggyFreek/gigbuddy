// Data access for a personal workspace's My Bands collection.
//
// Unlike band_profiles, these rows ARE tenant-owned, so every query here is
// scoped by tenant_id. The composite FK on the event tables is the database
// backstop for the same rule; this file is the primary defence.
import { PROFILE_PROJECTION, CLAIMED_TENANT_JOIN } from './bandProfileRepository.js'

// The three planning tables a personal-workspace event can live in. Kept as one
// list so a new linkable event type cannot be added to some of the paths and
// forgotten in the others.
//
// Aliases stay snake_case: PostgreSQL folds unquoted identifiers to lowercase,
// so a camelCase alias would come back as `bandevents` and read as undefined.
// The service maps these to the API's camelCase.
export const LINKED_EVENT_TABLES = Object.freeze([
  { table: 'gigs', alias: 'gigs' },
  { table: 'rehearsals', alias: 'rehearsals' },
  { table: 'band_events', alias: 'band_events' },
])

// The band label an event carries, for every projection in the three planning
// repositories. A correlated subquery rather than a join, so it can be appended
// to a `SELECT *` or a `RETURNING *` without restructuring the statement — and
// so a projection that forgets it is a visibly missing field rather than a
// silently dropped join.
//
// Correlated on tenant_id as well as the id: the composite FK already
// guarantees they agree, and repeating it here means the label can never be
// resolved across tenants even if that constraint were ever relaxed.
export const myBandSelect = (alias) => `(
    SELECT jsonb_build_object('id', mb.id, 'name', bp.name, 'country_code', bp.country_code)
      FROM my_bands mb
      JOIN band_profiles bp ON bp.id = mb.band_profile_id
     WHERE mb.id = ${alias}.my_band_id AND mb.tenant_id = ${alias}.tenant_id
  ) AS my_band`

const eventCountSql = ({ table, alias }) => `(
    SELECT COUNT(*)::int FROM ${table} e
     WHERE e.my_band_id = mb.id AND e.tenant_id = mb.tenant_id
  ) AS ${alias}_count`

export async function listMyBands(executor, tenantId, limit) {
  const { rows } = await executor.query(
    // Aliased: the profile projection also selects id and created_at, and in a
    // flat result row the later column would silently win.
    `SELECT mb.id AS my_band_id, mb.created_at AS added_at,
            ${PROFILE_PROJECTION},
            ${LINKED_EVENT_TABLES.map(eventCountSql).join(',\n            ')}
       FROM my_bands mb
       JOIN band_profiles bp ON bp.id = mb.band_profile_id
       ${CLAIMED_TENANT_JOIN}
      WHERE mb.tenant_id = $1
      ORDER BY lower(bp.name) ASC, mb.id ASC
      LIMIT $2`,
    [tenantId, limit],
  )
  return rows
}

export async function fetchMyBand(executor, myBandId, tenantId) {
  const { rows } = await executor.query(
    `SELECT mb.id AS my_band_id, mb.tenant_id, mb.band_profile_id, mb.created_at AS added_at,
            ${PROFILE_PROJECTION}
       FROM my_bands mb
       JOIN band_profiles bp ON bp.id = mb.band_profile_id
       ${CLAIMED_TENANT_JOIN}
      WHERE mb.id = $1 AND mb.tenant_id = $2`,
    [myBandId, tenantId],
  )
  return rows[0] ?? null
}

// Bare lookup for paths that only need to know the row is theirs — notably
// validating an event's my_band_id, where the join above would be wasted work.
export async function myBandExistsInTenant(executor, myBandId, tenantId) {
  const { rowCount } = await executor.query(
    'SELECT 1 FROM my_bands WHERE id = $1 AND tenant_id = $2',
    [myBandId, tenantId],
  )
  return rowCount > 0
}

// Takes a KEY SHARE lock on the row and holds it for the caller's transaction,
// so a concurrent removal blocks until the event write commits. Without this an
// event write could validate the row and then hit a foreign-key violation when
// it inserts — a raw 23503 where the caller deserves a clean 404.
export async function lockMyBandForEventWrite(executor, myBandId, tenantId) {
  const { rowCount } = await executor.query(
    'SELECT 1 FROM my_bands WHERE id = $1 AND tenant_id = $2 FOR KEY SHARE',
    [myBandId, tenantId],
  )
  return rowCount > 0
}

export async function findMyBandByProfile(executor, tenantId, profileId) {
  const { rows } = await executor.query(
    'SELECT id FROM my_bands WHERE tenant_id = $1 AND band_profile_id = $2',
    [tenantId, profileId],
  )
  return rows[0]?.id ?? null
}

export async function insertMyBand(executor, tenantId, profileId) {
  const { rows } = await executor.query(
    'INSERT INTO my_bands (tenant_id, band_profile_id) VALUES ($1, $2) RETURNING id',
    [tenantId, profileId],
  )
  return rows[0].id
}

export async function deleteMyBand(executor, myBandId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM my_bands WHERE id = $1 AND tenant_id = $2',
    [myBandId, tenantId],
  )
  return rowCount > 0
}

export async function countMyBands(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT COUNT(*)::int AS count FROM my_bands WHERE tenant_id = $1',
    [tenantId],
  )
  return rows[0].count
}

// How many workspaces hold this profile. Bounds both the holder cap and, by
// consequence, the claim-approval notification fan-out.
export async function countHolders(executor, profileId) {
  const { rows } = await executor.query(
    'SELECT COUNT(*)::int AS count FROM my_bands WHERE band_profile_id = $1',
    [profileId],
  )
  return rows[0].count
}

// The personal workspaces holding a profile, for notifying them when the band
// they tag events against arrives on gigbuddy.
export async function listHolderTenantIds(executor, profileId) {
  const { rows } = await executor.query(
    'SELECT tenant_id FROM my_bands WHERE band_profile_id = $1 ORDER BY tenant_id',
    [profileId],
  )
  return rows.map((row) => row.tenant_id)
}

export async function countLinkedEvents(executor, tenantId, myBandId) {
  const { rows } = await executor.query(
    `SELECT ${LINKED_EVENT_TABLES.map(({ table, alias }) => `(
        SELECT COUNT(*)::int FROM ${table} e
         WHERE e.my_band_id = $2 AND e.tenant_id = $1
      ) AS ${alias}`).join(', ')}`,
    [tenantId, myBandId],
  )
  return rows[0]
}

// Every object key the linked gigs own — the banner and each attachment.
// Attachment rows cascade with their gig, so their keys are unreachable
// afterwards and must be collected before the delete.
export async function listLinkedGigStorageKeys(executor, tenantId, myBandId) {
  const { rows } = await executor.query(
    `SELECT g.banner_path AS key
       FROM gigs g
      WHERE g.tenant_id = $1 AND g.my_band_id = $2 AND g.banner_path IS NOT NULL
      UNION ALL
     SELECT ga.object_key AS key
       FROM gig_attachments ga
       JOIN gigs g ON g.id = ga.gig_id AND g.tenant_id = ga.tenant_id
      WHERE g.tenant_id = $1 AND g.my_band_id = $2`,
    [tenantId, myBandId],
  )
  return rows.map((row) => row.key)
}

// Deletes every event linked to the row, returning how many of each. Must run
// BEFORE the my_bands row is removed: dropping that row fires ON DELETE SET NULL
// on my_band_id, after which there is nothing left to identify the events by.
export async function deleteLinkedEvents(executor, tenantId, myBandId) {
  const deleted = {}
  for (const { table, alias } of LINKED_EVENT_TABLES) {
    const { rowCount } = await executor.query(
      `DELETE FROM ${table} WHERE tenant_id = $1 AND my_band_id = $2`,
      [tenantId, myBandId],
    )
    deleted[alias] = rowCount
  }
  return deleted
}

// The profiles a tenant's collection points at. Read before a tenant is deleted
// so the cascade's effect on those profiles can be swept up in the same
// transaction — the FK does not run service code.
export async function listProfileIdsHeldByTenant(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT band_profile_id FROM my_bands WHERE tenant_id = $1 ORDER BY band_profile_id',
    [tenantId],
  )
  return rows.map((row) => row.band_profile_id)
}
