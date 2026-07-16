// Venue domain logic. Route handlers stay thin and delegate here. Functions
// that can fail with a specific HTTP outcome return { error: { status, body } };
// success returns a domain payload (see each function).
import pool from '../db/index.js'
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
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
  findVenueDuplicates,
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
import { normalizeOptionalUrl, WEB_URL_PROTOCOLS } from '../utils/urls.js'
import { badRequest, conflict, notFound } from './serviceErrors.js'

const NOT_FOUND = notFound('Not found')

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

const DUPLICATE_LIMIT = 5

function normalizedMatchText(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized || null
}

function normalizedMatchWebsite(value) {
  try {
    return normalizeOptionalUrl(value, { allowedProtocols: WEB_URL_PROTOCOLS })?.toLowerCase() ?? null
  } catch {
    return null
  }
}

export async function checkVenueDuplicates(db, tenantId, body = {}) {
  const input = {
    organizationName: normalizedMatchText(body.organization_name),
    address: normalizedMatchText(body.street_and_number),
    website: normalizedMatchWebsite(body.website),
    email: normalizedMatchText(body.email),
  }
  if (!Object.values(input).some(Boolean)) {
    return { items: [], meta: { limit: DUPLICATE_LIMIT, returned: 0 } }
  }

  const items = await findVenueDuplicates(db, tenantId, { ...input, limit: DUPLICATE_LIMIT })
  return { items, meta: { limit: DUPLICATE_LIMIT, returned: items.length } }
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
    // Coordinates are system/import-managed and are intentionally ignored by
    // the ordinary create endpoint used by venue forms.
    return { venue: await insertVenue(db, tenantId, { ...body, latitude: null, longitude: null }) }
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
  return withTransaction(async (client) => {
    await applyGigReferenceAction(client, venueId, tenantId, currentCategory, action)
    return applyVenuePatch(client, patch)
  })
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
  return withTransaction(async (client) => {
    const links = await lockVenueContactLinks(client, venueId, tenantId)
    if (!links.some((link) => link.contact_id === contactId)) abortTransaction(NOT_FOUND)

    if (makePrimary) {
      await clearPrimaryVenueContact(client, venueId, tenantId)
    }

    return { contact: await setVenueContactPrimary(client, venueId, contactId, makePrimary, tenantId) }
  }, {
    mapError: (err) => (err.code === '23505' ? conflict('Another contact is already primary') : null),
  })
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
    if (!row || existingKeys.has(row.key) || seenKeys.has(row.key)) {
      summary.skipped++
      continue
    }

    await insertVenue(client, tenantId, row.body)
    summary.imported++
    seenKeys.add(row.key)
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

  const normalizedRows = body.map(normalizeImportRow)
  const invalid = normalizedRows.find((row) => row?.error)
  if (invalid) return badRequest(invalid.error)

  return withTransaction(async (client) => {
    const existingKeys = await buildExistingImportKeys(client, tenantId, body)
    return { summary: await insertImportRows(client, tenantId, normalizedRows, existingKeys) }
  })
}
