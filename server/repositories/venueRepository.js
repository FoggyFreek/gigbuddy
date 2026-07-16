// Data-access helpers for venues. Each query takes an `executor` (a pool or
// transaction client) so callers control transactions.
import {
  VALID_VENUE_CATEGORIES,
  VENUE_INSERT_FIELDS,
  buildVenueInsertValues,
} from '../domain/venue.js'

const INSERT_COLUMNS = ['tenant_id', ...VENUE_INSERT_FIELDS]
const INSERT_SQL = `INSERT INTO venues (${INSERT_COLUMNS.join(', ')})
     VALUES (${INSERT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING *`

function categoryReferenceColumn(category) {
  return category === 'venue' ? 'venue_id' : 'festival_id'
}

function oppositeCategoryReferenceColumn(category) {
  return category === 'venue' ? 'festival_id' : 'venue_id'
}

export async function listVenues(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT v.*,
            (SELECT c.name
               FROM venue_contacts vc
               JOIN contacts c ON c.id = vc.contact_id AND c.tenant_id = vc.tenant_id
              WHERE vc.venue_id = v.id AND vc.tenant_id = v.tenant_id AND vc.is_primary
              LIMIT 1) AS primary_contact_name,
            COALESCE(
              (SELECT ARRAY_AGG(year ORDER BY year)
                 FROM (
                   SELECT DISTINCT EXTRACT(YEAR FROM g.event_date)::INT AS year
                     FROM gigs g
                    WHERE g.tenant_id = v.tenant_id
                      AND (g.venue_id = v.id OR g.festival_id = v.id)
                 ) gy),
              '{}'
            ) AS years
       FROM venues v
      WHERE v.tenant_id = $1
      ORDER BY v.name ASC`,
    [tenantId],
  )
  return rows
}

export async function searchVenues(executor, tenantId, { like, limit, category }) {
  const params = [tenantId, like, limit]
  const categoryClause = VALID_VENUE_CATEGORIES.has(category)
    ? `AND category = $${params.push(category)}`
    : ''
  const { rows } = await executor.query(
    `SELECT id, name, category, organization_name,
            city, region, postal_code, country
       FROM venues
      WHERE tenant_id = $1
        AND (name ILIKE $2 OR city ILIKE $2 OR region ILIKE $2)
        ${categoryClause}
      ORDER BY
        CASE
          WHEN name ILIKE $2 THEN 0
          ELSE 1
        END,
        name ASC
      LIMIT $3`,
    params,
  )
  return rows
}

export async function fetchVenue(executor, venueId, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM venues WHERE id = $1 AND tenant_id = $2',
    [venueId, tenantId],
  )
  return rows[0] || null
}

export async function fetchVenueGeocode(executor, venueId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, city, region, country, latitude, longitude
       FROM venues
      WHERE id = $1 AND tenant_id = $2`,
    [venueId, tenantId],
  )
  return rows[0] || null
}

export async function updateVenueGeocode(executor, latitude, longitude, venueId, tenantId) {
  const { rows } = await executor.query(
    `UPDATE venues
        SET latitude = $1, longitude = $2, updated_at = NOW()
      WHERE id = $3 AND tenant_id = $4
      RETURNING latitude, longitude`,
    [latitude, longitude, venueId, tenantId],
  )
  return rows[0] || null
}

export async function venueExistsInTenant(executor, venueId, tenantId) {
  const { rowCount } = await executor.query(
    'SELECT 1 FROM venues WHERE id = $1 AND tenant_id = $2',
    [venueId, tenantId],
  )
  return rowCount > 0
}

export async function getVenueCategory(executor, venueId, tenantId) {
  const { rows } = await executor.query(
    'SELECT category FROM venues WHERE id = $1 AND tenant_id = $2',
    [venueId, tenantId],
  )
  return rows[0]?.category ?? null
}

export async function insertVenue(executor, tenantId, body) {
  const { rows } = await executor.query(INSERT_SQL, buildVenueInsertValues(tenantId, body))
  return rows[0]
}

// Dynamic PATCH update; `patch` is the prebuilt { fields, values, idx } from
// buildVenueUpdateFields with updated_at and the WHERE bindings appended.
export async function updateVenueFields(executor, patch) {
  const { rows } = await executor.query(
    `UPDATE venues SET ${patch.fields.join(', ')}
     WHERE id = $${patch.idx} AND tenant_id = $${patch.idx + 1} RETURNING *`,
    patch.values,
  )
  return rows[0] || null
}

export async function deleteVenue(executor, venueId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM venues WHERE id = $1 AND tenant_id = $2',
    [venueId, tenantId],
  )
  return rowCount > 0
}

export async function getAffectedGigs(executor, venueId, tenantId, currentCategory) {
  const affectedCol = categoryReferenceColumn(currentCategory)
  const { rows } = await executor.query(
    `SELECT id, event_description, event_date
       FROM gigs
      WHERE ${affectedCol} = $1 AND tenant_id = $2
      ORDER BY event_date ASC`,
    [venueId, tenantId],
  )
  return rows
}

export async function clearGigReferences(executor, venueId, tenantId, currentCategory) {
  const affectedCol = categoryReferenceColumn(currentCategory)
  await executor.query(
    `UPDATE gigs SET ${affectedCol} = NULL WHERE ${affectedCol} = $1 AND tenant_id = $2`,
    [venueId, tenantId],
  )
}

export async function migrateGigReferences(executor, venueId, tenantId, currentCategory) {
  const affectedCol = categoryReferenceColumn(currentCategory)
  const targetCol = oppositeCategoryReferenceColumn(currentCategory)
  await executor.query(
    `UPDATE gigs SET ${targetCol} = ${affectedCol}, ${affectedCol} = NULL
     WHERE ${affectedCol} = $1 AND tenant_id = $2`,
    [venueId, tenantId],
  )
}

export async function getContactInTenant(executor, contactId, tenantId) {
  const { rows } = await executor.query(
    'SELECT id, name, email, phone, category FROM contacts WHERE id = $1 AND tenant_id = $2',
    [contactId, tenantId],
  )
  return rows[0] ?? null
}

export async function listVenueContacts(executor, venueId, tenantId) {
  const { rows } = await executor.query(
    `SELECT c.id, c.name, c.email, c.phone, c.category, vc.is_primary
       FROM venue_contacts vc
       JOIN contacts c ON c.id = vc.contact_id AND c.tenant_id = vc.tenant_id
      WHERE vc.venue_id = $1 AND vc.tenant_id = $2
      ORDER BY vc.is_primary DESC, c.name ASC`,
    [venueId, tenantId],
  )
  return rows
}

export async function insertVenueContact(executor, venueId, contactId, tenantId) {
  await executor.query(
    'INSERT INTO venue_contacts (venue_id, contact_id, tenant_id) VALUES ($1, $2, $3)',
    [venueId, contactId, tenantId],
  )
}

export async function lockVenueContactLinks(executor, venueId, tenantId) {
  const { rows } = await executor.query(
    'SELECT contact_id FROM venue_contacts WHERE venue_id = $1 AND tenant_id = $2 FOR UPDATE',
    [venueId, tenantId],
  )
  return rows
}

export async function clearPrimaryVenueContact(executor, venueId, tenantId) {
  await executor.query(
    'UPDATE venue_contacts SET is_primary = false WHERE venue_id = $1 AND tenant_id = $2 AND is_primary',
    [venueId, tenantId],
  )
}

export async function setVenueContactPrimary(executor, venueId, contactId, isPrimary, tenantId) {
  const { rows } = await executor.query(
    `UPDATE venue_contacts SET is_primary = $3
      WHERE venue_id = $1 AND contact_id = $2 AND tenant_id = $4
      RETURNING contact_id, is_primary`,
    [venueId, contactId, isPrimary, tenantId],
  )
  return rows[0]
}

export async function deleteVenueContact(executor, venueId, contactId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM venue_contacts WHERE venue_id = $1 AND contact_id = $2 AND tenant_id = $3',
    [venueId, contactId, tenantId],
  )
  return rowCount > 0
}

export async function loadExistingImportKeys(executor, tenantId, incomingNames) {
  if (!incomingNames.length) return []
  const { rows } = await executor.query(
    `SELECT lower(name) AS name, lower(coalesce(city, '')) AS city
     FROM venues WHERE tenant_id = $1 AND lower(name) = ANY($2)`,
    [tenantId, incomingNames],
  )
  return rows
}
