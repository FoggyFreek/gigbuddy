// Venue domain logic. Route handlers stay thin and delegate here. Functions
// that can fail with a specific HTTP outcome return { error: { status, body } };
// success returns a domain payload (see each function).
import pool from '../db/index.js'
import {
  VALID_CATEGORIES,
  VALID_GIG_ACTIONS,
  parseSearchLimit,
  buildVenueUpdateFields,
  collectIncomingNames,
  normalizeImportRow,
  venueImportKey,
} from '../validators/venueValidators.js'
import {
  listVenues as listVenueRows,
  searchVenues as searchVenueRows,
  fetchVenue,
  venueExistsInTenant,
  getVenueCategory,
  insertVenue,
  updateVenueFields,
  deleteVenue as deleteVenueRow,
  getAffectedGigs,
  clearGigReferences,
  migrateGigReferences,
  getContactInTenant,
  listVenueContacts as listVenueContactRows,
  insertVenueContact,
  lockVenueContactLinks,
  clearPrimaryVenueContact,
  setVenueContactPrimary,
  deleteVenueContact,
  loadExistingImportKeys,
} from '../repositories/venueRepository.js'

const NOT_FOUND = { error: { status: 404, body: { error: 'Not found' } } }

function badRequest(error) {
  return { error: { status: 400, body: { error } } }
}

function conflict(error, extra = {}) {
  return { error: { status: 409, body: { error, ...extra } } }
}

function validateNoFestivalName(body) {
  return 'festival_name' in body
    ? badRequest('festival_name is no longer supported; use name')
    : null
}

// ---------- reads ----------

export async function listVenues(db, tenantId) {
  return listVenueRows(db, tenantId)
}

export async function searchVenues(db, tenantId, query) {
  const q = String(query.q ?? '').trim()
  if (q.length < 3) return []
  return searchVenueRows(db, tenantId, {
    like: `%${q}%`,
    limit: parseSearchLimit(query.limit),
    category: query.category,
  })
}

export async function getVenue(db, tenantId, venueId) {
  const venue = await fetchVenue(db, venueId, tenantId)
  if (!venue) return NOT_FOUND
  return { venue }
}

// Lists the gigs that would lose or migrate their venue/festival reference if
// the venue switched to newCategory. Returns { error } | { affectedGigs }.
export async function getCategoryImpact(db, tenantId, venueId, newCategory) {
  if (!VALID_CATEGORIES.has(newCategory)) {
    return badRequest('Invalid new_category')
  }

  const currentCategory = await getVenueCategory(db, venueId, tenantId)
  if (!currentCategory) return NOT_FOUND
  if (currentCategory === newCategory) return { affectedGigs: [] }

  return { affectedGigs: await getAffectedGigs(db, venueId, tenantId, currentCategory) }
}

// ---------- writes ----------

export async function createVenue(db, tenantId, body) {
  if (!body.name || !String(body.name).trim()) {
    return badRequest('name is required')
  }
  const legacyNameError = validateNoFestivalName(body)
  if (legacyNameError) return legacyNameError

  try {
    return { venue: await insertVenue(db, tenantId, body) }
  } catch (err) {
    if (err.code === '23505') {
      return conflict('A venue with this name and city already exists')
    }
    throw err
  }
}

async function applyGigReferenceAction(client, venueId, tenantId, currentCategory, action) {
  if (action === 'remove') {
    await clearGigReferences(client, venueId, tenantId, currentCategory)
  } else {
    await migrateGigReferences(client, venueId, tenantId, currentCategory)
  }
}

async function applyVenuePatch(db, patch) {
  const venue = await updateVenueFields(db, patch)
  return venue ? { venue } : NOT_FOUND
}

// Owns the transaction that fixes up gig references and applies the patch
// atomically when a category change affects gigs.
async function applyCategoryChangeWithGigAction(venueId, tenantId, currentCategory, action, patch) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await applyGigReferenceAction(client, venueId, tenantId, currentCategory, action)
    const result = await applyVenuePatch(client, patch)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// A category change that would orphan gig references must say what to do with
// them (on_affected_gigs); without it we 409 with the affected gigs so the UI
// can ask. Returns null when no category handling is needed.
async function handleCategoryChange(venueId, tenantId, body, patch) {
  if (!('category' in body)) return null

  const currentCategory = await getVenueCategory(pool, venueId, tenantId)
  if (!currentCategory) return NOT_FOUND
  if (currentCategory === body.category) return null

  const affectedGigs = await getAffectedGigs(pool, venueId, tenantId, currentCategory)
  if (!affectedGigs.length) return null

  const action = body.on_affected_gigs ?? null
  if (action === null) {
    return conflict('Category change affects gigs', { affected_gigs: affectedGigs })
  }

  return applyCategoryChangeWithGigAction(venueId, tenantId, currentCategory, action, patch)
}

export async function patchVenue(tenantId, venueId, body) {
  const legacyNameError = validateNoFestivalName(body)
  if (legacyNameError) return legacyNameError

  const action = body.on_affected_gigs ?? null
  if (action !== null && !VALID_GIG_ACTIONS.has(action)) {
    return badRequest('Invalid on_affected_gigs value')
  }

  const patch = buildVenueUpdateFields(body)
  if (patch.error) return badRequest(patch.error)
  if (!patch.fields.length) return badRequest('No valid fields to update')

  patch.fields.push('updated_at = NOW()')
  patch.values.push(venueId, tenantId)

  const categoryResult = await handleCategoryChange(venueId, tenantId, body, patch)
  return categoryResult ?? applyVenuePatch(pool, patch)
}

export async function deleteVenue(db, tenantId, venueId) {
  const deleted = await deleteVenueRow(db, venueId, tenantId)
  return deleted ? {} : NOT_FOUND
}

// ---------- venue contacts ----------

export async function listVenueContacts(db, tenantId, venueId) {
  if (!await venueExistsInTenant(db, venueId, tenantId)) return NOT_FOUND
  return { contacts: await listVenueContactRows(db, venueId, tenantId) }
}

export async function linkVenueContact(db, tenantId, venueId, contactId) {
  if (!await venueExistsInTenant(db, venueId, tenantId)) return NOT_FOUND

  const contact = await getContactInTenant(db, contactId, tenantId)
  if (!contact) return NOT_FOUND

  try {
    await insertVenueContact(db, venueId, contactId, tenantId)
    return { contact: { ...contact, is_primary: false } }
  } catch (err) {
    if (err.code === '23505') {
      return conflict('Contact is already linked to this venue')
    }
    throw err
  }
}

// Locks the venue's contact links so two concurrent "make primary" requests
// can't both win; clears the old primary before setting the new one.
export async function updateVenueContactPrimary(tenantId, venueId, contactId, makePrimary) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const links = await lockVenueContactLinks(client, venueId, tenantId)
    if (!links.some((link) => link.contact_id === contactId)) {
      await client.query('ROLLBACK')
      return NOT_FOUND
    }

    if (makePrimary) {
      await clearPrimaryVenueContact(client, venueId, tenantId)
    }

    const contact = await setVenueContactPrimary(client, venueId, contactId, makePrimary, tenantId)
    await client.query('COMMIT')
    return { contact }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (err.code === '23505') {
      return conflict('Another contact is already primary')
    }
    throw err
  } finally {
    client.release()
  }
}

export async function unlinkVenueContact(db, tenantId, venueId, contactId) {
  const deleted = await deleteVenueContact(db, venueId, contactId, tenantId)
  return deleted ? {} : NOT_FOUND
}

// ---------- import ----------

async function buildExistingImportKeys(client, tenantId, rows) {
  const existing = await loadExistingImportKeys(client, tenantId, collectIncomingNames(rows))
  return new Set(existing.map((row) => venueImportKey(row.name, row.city)))
}

async function insertImportRows(client, tenantId, rows, existingKeys) {
  const seenKeys = new Set()
  const summary = { imported: 0, skipped: 0 }

  for (const row of rows) {
    const normalized = normalizeImportRow(row)
    if (!normalized || existingKeys.has(normalized.key) || seenKeys.has(normalized.key)) {
      summary.skipped++
      continue
    }

    await insertVenue(client, tenantId, normalized.body)
    summary.imported++
    seenKeys.add(normalized.key)
  }

  return summary
}

// Bulk import; duplicates (against the DB or within the batch, keyed on
// lowercased name+city) are skipped, all inserts happen in one transaction.
export async function importVenues(tenantId, body) {
  if (!Array.isArray(body) || body.length === 0) {
    return badRequest('Expected non-empty array')
  }
  if (body.length > 1000) {
    return badRequest('Maximum 1000 rows per import')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existingKeys = await buildExistingImportKeys(client, tenantId, body)
    const summary = await insertImportRows(client, tenantId, body, existingKeys)
    await client.query('COMMIT')
    return { summary }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
