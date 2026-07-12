// Data-access helpers for contacts, their notes, and the contact side of the
// venue_contacts link. Each query takes an `executor` (a pool or transaction
// client) so callers control transactions. Every query is scoped by tenant_id.

// ---------- contacts ----------

export async function listContacts(executor, tenantId, { category, excludeCategory }) {
  const filters = ['tenant_id = $1']
  const values = [tenantId]
  if (category) {
    values.push(category)
    filters.push(`category = $${values.length}`)
  }
  if (excludeCategory) {
    values.push(excludeCategory)
    filters.push(`category <> $${values.length}`)
  }
  const { rows } = await executor.query(
    `SELECT * FROM contacts WHERE ${filters.join(' AND ')} ORDER BY category ASC, name ASC`,
    values,
  )
  return rows
}

export async function searchContacts(executor, tenantId, like, prefix, limit, { category = null, excludeCategory = null } = {}) {
  const params = [tenantId, like, prefix, limit]
  let categoryClause = ''
  if (category) {
    categoryClause = `AND category = $${params.push(category)}`
  } else if (excludeCategory) {
    categoryClause = `AND category <> $${params.push(excludeCategory)}`
  }
  const { rows } = await executor.query(
    `SELECT id, name, category, email, phone, iban
       FROM contacts
      WHERE tenant_id = $1
        AND (name ILIKE $2 OR email ILIKE $2)
        ${categoryClause}
      ORDER BY
        CASE WHEN name ILIKE $3 THEN 0 ELSE 1 END,
        name ASC
      LIMIT $4`,
    params,
  )
  return rows
}

export async function fetchContactWithNotes(executor, contactId, tenantId) {
  const { rows } = await executor.query(
    `SELECT c.*,
       COALESCE(
         json_agg(
           json_build_object(
             'id', n.id,
             'note', n.note,
             'created_at', n.created_at,
             'created_by', u.name
           ) ORDER BY n.created_at DESC
         ) FILTER (WHERE n.id IS NOT NULL),
         '[]'
       ) AS notes
     FROM contacts c
     LEFT JOIN contact_notes n ON n.contact_id = c.id AND n.tenant_id = c.tenant_id
     LEFT JOIN users u ON u.id = n.created_by_user_id
     WHERE c.id = $1 AND c.tenant_id = $2
     GROUP BY c.id`,
    [contactId, tenantId],
  )
  return rows[0] || null
}

export async function contactExistsInTenant(executor, contactId, tenantId) {
  const { rowCount } = await executor.query(
    'SELECT 1 FROM contacts WHERE id = $1 AND tenant_id = $2',
    [contactId, tenantId],
  )
  return rowCount > 0
}

export async function insertContact(executor, tenantId, { name, email, phone, category, iban = null }) {
  const { rows } = await executor.query(
    `INSERT INTO contacts (tenant_id, name, email, phone, category, iban)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [tenantId, name, email, phone, category, iban],
  )
  return rows[0]
}

// Suppliers whose IBAN matches (canonical, case-insensitive). Returns all
// matches so the caller can treat 2+ as ambiguous rather than auto-picking.
export async function findSuppliersByIban(executor, tenantId, iban) {
  if (!iban) return []
  const { rows } = await executor.query(
    `SELECT id, name, category, email, phone, iban
       FROM contacts
      WHERE tenant_id = $1 AND category = 'supplier' AND upper(iban) = upper($2)
      ORDER BY name ASC`,
    [tenantId, iban],
  )
  return rows
}

// Suppliers whose name matches exactly (case-insensitive). Fallback match when
// no IBAN is stored; multiple matches are ambiguous.
export async function findSuppliersByName(executor, tenantId, name) {
  if (!name) return []
  const { rows } = await executor.query(
    `SELECT id, name, category, email, phone, iban
       FROM contacts
      WHERE tenant_id = $1 AND category = 'supplier' AND lower(name) = lower($2)
      ORDER BY name ASC`,
    [tenantId, name],
  )
  return rows
}

// Batched supplier lookup: all suppliers matching any of the given (canonical)
// IBANs or names. Returns rows the caller groups by iban/name in memory — one
// query per import instead of per line.
export async function findSuppliersForImport(executor, tenantId, ibans, names) {
  const wantIbans = [...new Set(ibans.filter(Boolean).map((i) => i.toUpperCase()))]
  const wantNames = [...new Set(names.filter(Boolean).map((n) => n.toLowerCase()))]
  if (!wantIbans.length && !wantNames.length) return []
  const { rows } = await executor.query(
    `SELECT id, name, category, email, phone, iban
       FROM contacts
      WHERE tenant_id = $1 AND category = 'supplier'
        AND (upper(iban) = ANY($2) OR lower(name) = ANY($3))
      ORDER BY name ASC`,
    [tenantId, wantIbans, wantNames],
  )
  return rows
}

export async function updateContactFields(executor, tenantId, contactId, fields, values) {
  const assignments = [...fields, 'updated_at = NOW()']
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE contacts SET ${assignments.join(', ')}
     WHERE id = $${whereIdx} AND tenant_id = $${whereIdx + 1} RETURNING *`,
    [...values, contactId, tenantId],
  )
  return rows[0] || null
}

export async function deleteContact(executor, contactId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM contacts WHERE id = $1 AND tenant_id = $2',
    [contactId, tenantId],
  )
  return rowCount > 0
}

// ---------- notes ----------

// Inserts a note only when the parent contact belongs to the tenant (SELECT
// guard). Returns the new note row, or null when the contact doesn't exist.
export async function insertContactNote(executor, contactId, tenantId, note, userId) {
  const { rows } = await executor.query(
    `INSERT INTO contact_notes (contact_id, tenant_id, note, created_by_user_id)
     SELECT c.id, c.tenant_id, $3, $4
     FROM contacts c
     WHERE c.id = $1 AND c.tenant_id = $2
     RETURNING *`,
    [contactId, tenantId, note, userId ?? null],
  )
  return rows[0] || null
}

export async function deleteContactNote(executor, noteId, contactId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM contact_notes WHERE id = $1 AND contact_id = $2 AND tenant_id = $3',
    [noteId, contactId, tenantId],
  )
  return rowCount > 0
}

// ---------- venue links (contact side) ----------

export async function listContactVenues(executor, contactId, tenantId) {
  const { rows } = await executor.query(
    `SELECT v.id, v.name, v.category, v.organization_name, v.city, v.region, v.country, vc.is_primary
       FROM venue_contacts vc
       JOIN venues v ON v.id = vc.venue_id AND v.tenant_id = vc.tenant_id
      WHERE vc.contact_id = $1 AND vc.tenant_id = $2
      ORDER BY v.category ASC, v.name ASC`,
    [contactId, tenantId],
  )
  return rows
}

export async function fetchVenueSummary(executor, venueId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, name, category, organization_name, city, region, country
       FROM venues WHERE id = $1 AND tenant_id = $2`,
    [venueId, tenantId],
  )
  return rows[0] || null
}

export async function insertVenueContact(executor, venueId, contactId, tenantId) {
  await executor.query(
    'INSERT INTO venue_contacts (venue_id, contact_id, tenant_id) VALUES ($1, $2, $3)',
    [venueId, contactId, tenantId],
  )
}

export async function deleteVenueContact(executor, contactId, venueId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM venue_contacts WHERE contact_id = $1 AND venue_id = $2 AND tenant_id = $3',
    [contactId, venueId, tenantId],
  )
  return rowCount > 0
}

// ---------- import ----------

// Lowercased (name, category) keys of existing contacts matching the incoming
// names, used to dedupe an import.
export async function loadExistingImportKeys(executor, tenantId, names) {
  if (!names.length) return []
  const { rows } = await executor.query(
    `SELECT lower(name) AS name, lower(category) AS category
     FROM contacts WHERE tenant_id = $1 AND lower(name) = ANY($2)`,
    [tenantId, names],
  )
  return rows
}

export async function insertImportContact(executor, tenantId, { name, email, phone, category }) {
  await executor.query(
    'INSERT INTO contacts (tenant_id, name, email, phone, category) VALUES ($1, $2, $3, $4, $5)',
    [tenantId, name, email, phone, category],
  )
}
