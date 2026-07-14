// Contact domain logic. Route handlers stay thin and delegate here. Functions
// that can fail with a specific HTTP outcome return { error: { status, body } };
// success returns a domain payload (see each function).
import { withTransaction } from '../db/withTransaction.js'
import {
  VALID_CATEGORIES,
  parseId,
  parseCategoryFilter,
  parseSearchLimit,
  buildContactUpdateFields,
  normalizeImportRow,
} from '../validators/contactValidators.js'
import { normalizeIban } from '../utils/normalizeIban.js'
import {
  listContacts as listContactRows,
  searchContacts as searchContactRows,
  fetchContactWithNotes,
  contactExistsInTenant,
  insertContact,
  updateContactFields,
  deleteContact as deleteContactRow,
  insertContactNote,
  deleteContactNote,
  listContactVenues,
  fetchVenueSummary,
  insertVenueContact,
  deleteVenueContact,
  loadExistingImportKeys,
  insertImportContact,
} from '../repositories/contactRepository.js'
import { countPurchasesBySupplierContact } from '../repositories/purchaseRepository.js'
import { badRequest, conflict, notFound } from './serviceErrors.js'

const NOT_FOUND = notFound('Not found')

// ---------- reads ----------

export async function listContacts(db, tenantId, query) {
  const category = parseCategoryFilter(query.category)
  const excludeCategory = parseCategoryFilter(query.excludeCategory)
  if (category === false || excludeCategory === false) return badRequest('Invalid category value')
  if (category && excludeCategory) return badRequest('Use category or excludeCategory, not both')
  return { contacts: await listContactRows(db, tenantId, { category, excludeCategory }) }
}

export async function searchContacts(db, tenantId, query) {
  const q = String(query.q ?? '').trim()
  if (q.length < 3) return []
  // Invalid category filters degrade to "no filter" — search never errors, it
  // just returns fewer/zero rows (the route has no error path).
  const category = parseCategoryFilter(query.category) || null
  const excludeCategory = parseCategoryFilter(query.excludeCategory) || null
  return searchContactRows(db, tenantId, `%${q}%`, `${q}%`, parseSearchLimit(query.limit), {
    category,
    excludeCategory,
  })
}

export async function getContact(db, tenantId, contactId) {
  const contact = await fetchContactWithNotes(db, contactId, tenantId)
  if (!contact) return NOT_FOUND
  return { contact }
}

// ---------- writes ----------

export async function createContact(db, tenantId, body) {
  const { name, email, phone, category, iban } = body
  if (!name || !String(name).trim()) return badRequest('name is required')
  const finalCategory = VALID_CATEGORIES.has(category) ? category : 'press'
  try {
    const contact = await insertContact(db, tenantId, {
      name: String(name).trim(),
      email: email || null,
      phone: phone || null,
      category: finalCategory,
      iban: normalizeIban(iban),
    })
    return { contact }
  } catch (err) {
    // UNIQUE(lower(name), lower(category)) collision — surface a 409 with a
    // stable code so callers (e.g. the supplier autocomplete) can recover.
    if (err.code === '23505') {
      return conflict('A contact with that name already exists', { code: 'contact_exists' })
    }
    throw err
  }
}

export async function patchContact(db, tenantId, contactId, body) {
  const built = buildContactUpdateFields(body)
  if (built.error) return badRequest(built.error)
  if (!built.fields.length) return badRequest('No valid fields to update')

  const contact = await updateContactFields(db, tenantId, contactId, built.fields, built.values)
  if (!contact) return NOT_FOUND
  return { contact }
}

export async function deleteContact(db, tenantId, contactId) {
  const purchaseCount = await countPurchasesBySupplierContact(db, tenantId, contactId)
  if (purchaseCount > 0) {
    return {
      error: {
        status: 409,
        body: {
          error: `This supplier is linked to ${purchaseCount} purchase${purchaseCount === 1 ? '' : 's'} and cannot be deleted.`,
          code: 'supplier_has_purchases',
          count: purchaseCount,
        },
      },
    }
  }
  const deleted = await deleteContactRow(db, contactId, tenantId)
  return deleted ? {} : NOT_FOUND
}

// ---------- notes ----------

export async function createNote(db, tenantId, contactId, body, userId) {
  const note = body?.note
  if (!note || !String(note).trim()) return badRequest('note is required')
  const created = await insertContactNote(db, contactId, tenantId, String(note).trim(), userId)
  if (!created) return NOT_FOUND
  return { note: created }
}

export async function deleteNote(db, tenantId, contactId, noteId) {
  const deleted = await deleteContactNote(db, noteId, contactId, tenantId)
  return deleted ? {} : NOT_FOUND
}

// ---------- venue links ----------

export async function listVenues(db, tenantId, contactId) {
  if (!(await contactExistsInTenant(db, contactId, tenantId))) return NOT_FOUND
  return { venues: await listContactVenues(db, contactId, tenantId) }
}

export async function linkVenue(db, tenantId, contactId, body) {
  const venueId = parseId(body.venue_id)
  if (venueId === null) return badRequest('venue_id is required')

  if (!(await contactExistsInTenant(db, contactId, tenantId))) return NOT_FOUND
  const venue = await fetchVenueSummary(db, venueId, tenantId)
  if (!venue) return NOT_FOUND

  try {
    await insertVenueContact(db, venueId, contactId, tenantId)
    return { venue: { ...venue, is_primary: false } }
  } catch (err) {
    if (err.code === '23505') return conflict('Venue is already linked to this contact')
    throw err
  }
}

export async function unlinkVenue(db, tenantId, contactId, venueId) {
  const deleted = await deleteVenueContact(db, contactId, venueId, tenantId)
  return deleted ? {} : NOT_FOUND
}

// ---------- import ----------

// Bulk import; duplicates (against the DB or within the batch, keyed on
// lowercased name+category) are skipped, all inserts happen in one transaction.
export async function importContacts(tenantId, body) {
  if (!Array.isArray(body) || body.length === 0) return badRequest('Expected non-empty array')
  if (body.length > 1000) return badRequest('Maximum 1000 rows per import')

  return withTransaction(async (client) => {
    const incomingNames = [...new Set(
      body.map((r) => String(r.name ?? '').trim().toLowerCase()).filter(Boolean),
    )]
    const existingRows = await loadExistingImportKeys(client, tenantId, incomingNames)
    const existingKeys = new Set(existingRows.map((r) => `${r.name} ${r.category}`))

    let imported = 0
    let skipped = 0
    const seenKeys = new Set()

    for (const raw of body) {
      const { name, email, phone, category } = normalizeImportRow(raw)
      if (!name) { skipped++; continue }

      const key = `${name.toLowerCase()} ${category.toLowerCase()}`
      if (existingKeys.has(key) || seenKeys.has(key)) { skipped++; continue }

      await insertImportContact(client, tenantId, {
        name,
        email: email || null,
        phone: phone || null,
        category,
      })
      imported++
      seenKeys.add(key)
    }
    return { summary: { imported, skipped } }
  })
}
