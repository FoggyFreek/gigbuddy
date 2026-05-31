import { Router } from 'express'
import pool from '../db/index.js'
import { normalizeOptionalUrl, WEB_URL_PROTOCOLS } from '../utils/urls.js'

const router = Router()

const VALID_CATEGORIES = new Set(['venue', 'festival'])
const VALID_GIG_ACTIONS = new Set(['migrate', 'remove'])

const EDITABLE_FIELDS = [
  'category',
  'name',
  'title',
  'given_name',
  'family_name',
  'organization_name',
  'street_and_number',
  'street_additional',
  'postal_code',
  'city',
  'region',
  'country',
  'website',
  'phone',
  'email',
]

const INSERT_COLUMNS = ['tenant_id', ...EDITABLE_FIELDS]
const INSERT_SQL = `INSERT INTO venues (${INSERT_COLUMNS.join(', ')})
     VALUES (${INSERT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING *`

function badRequest(error) {
  return { status: 400, body: { error } }
}

function notFound() {
  return { status: 404, body: { error: 'Not found' } }
}

function conflict(error, extra = {}) {
  return { status: 409, body: { error, ...extra } }
}

function ok(body) {
  return { status: 200, body }
}

function sendResult(res, result) {
  return res.status(result.status).json(result.body)
}

function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

function requireId(req, res) {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: 'Invalid id' })
    return null
  }
  return id
}

function validateNoFestivalName(body) {
  return 'festival_name' in body
    ? badRequest('festival_name is no longer supported; use name')
    : null
}

function validateRequiredName(body) {
  return body.name && String(body.name).trim()
    ? null
    : badRequest('name is required')
}

function normalizeInsertWebsite(body) {
  try {
    return normalizeOptionalUrl(body.website, { allowedProtocols: WEB_URL_PROTOCOLS })
  } catch {
    return null
  }
}

function normalizeInsertField(key, body) {
  if (key === 'category') return VALID_CATEGORIES.has(body.category) ? body.category : 'venue'
  if (key === 'name') return String(body.name).trim()
  if (key === 'website') return normalizeInsertWebsite(body)
  return body[key] || null
}

function buildInsertValues(tenantId, body) {
  return [
    tenantId,
    ...EDITABLE_FIELDS.map((key) => normalizeInsertField(key, body)),
  ]
}

function parseSearchLimit(value) {
  const parsedLimit = parseInt(value, 10)
  return Math.max(
    1,
    Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 10, 25),
  )
}

function buildCategoryClause(category, params) {
  if (!VALID_CATEGORIES.has(category)) return ''
  return `AND category = $${params.push(category)}`
}

function categoryReferenceColumn(category) {
  return category === 'venue' ? 'venue_id' : 'festival_id'
}

function oppositeCategoryReferenceColumn(category) {
  return category === 'venue' ? 'festival_id' : 'venue_id'
}

async function getVenueCategory(db, id, tenantId) {
  const { rows } = await db.query(
    'SELECT category FROM venues WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  )
  return rows[0]?.category ?? null
}

async function getAffectedGigs(db, id, tenantId, currentCategory) {
  const affectedCol = categoryReferenceColumn(currentCategory)
  const { rows } = await db.query(
    `SELECT id, event_description, event_date
       FROM gigs
      WHERE ${affectedCol} = $1 AND tenant_id = $2
      ORDER BY event_date ASC`,
    [id, tenantId],
  )
  return rows
}

async function getCategoryImpact(id, tenantId, newCategory) {
  if (!VALID_CATEGORIES.has(newCategory)) {
    return badRequest('Invalid new_category')
  }

  const currentCategory = await getVenueCategory(pool, id, tenantId)
  if (!currentCategory) return notFound()
  if (currentCategory === newCategory) return ok({ affected_gigs: [] })

  const affectedGigs = await getAffectedGigs(pool, id, tenantId, currentCategory)
  return ok({ affected_gigs: affectedGigs })
}

async function createVenue(tenantId, body) {
  const nameError = validateRequiredName(body)
  if (nameError) return nameError

  const legacyNameError = validateNoFestivalName(body)
  if (legacyNameError) return legacyNameError

  try {
    const { rows } = await pool.query(INSERT_SQL, buildInsertValues(tenantId, body))
    return { status: 201, body: rows[0] }
  } catch (err) {
    if (err.code === '23505') {
      return conflict('A venue with this name and city already exists')
    }
    throw err
  }
}

function validateGigAction(body) {
  const action = body.on_affected_gigs ?? null
  return action !== null && !VALID_GIG_ACTIONS.has(action)
    ? badRequest('Invalid on_affected_gigs value')
    : null
}

function validatePatchBody(body) {
  return validateNoFestivalName(body) ?? validateGigAction(body)
}

function normalizePatchField(key, value) {
  if (key === 'country') return value || null
  if (key === 'website') {
    return normalizeOptionalUrl(value, { allowedProtocols: WEB_URL_PROTOCOLS })
  }
  return value
}

function buildPatchFields(body) {
  const fields = []
  const values = []
  let idx = 1

  for (const key of EDITABLE_FIELDS) {
    if (!(key in body)) continue
    if (key === 'category' && !VALID_CATEGORIES.has(body[key])) {
      return { error: 'Invalid category value' }
    }
    fields.push(`${key} = $${idx++}`)
    values.push(normalizePatchField(key, body[key]))
  }

  return { fields, values, idx }
}

function buildVenuePatch(body, id, tenantId) {
  const patch = buildPatchFields(body)
  if (patch.error) return { result: badRequest(patch.error) }
  if (!patch.fields.length) return { result: badRequest('No valid fields to update') }

  patch.fields.push('updated_at = NOW()')
  patch.values.push(id, tenantId)
  return { patch }
}

async function updateVenue(db, patch) {
  const { rows } = await db.query(
    `UPDATE venues SET ${patch.fields.join(', ')}
     WHERE id = $${patch.idx} AND tenant_id = $${patch.idx + 1} RETURNING *`,
    patch.values,
  )
  return rows.length ? ok(rows[0]) : notFound()
}

async function applyGigReferenceAction(db, id, tenantId, currentCategory, action) {
  const affectedCol = categoryReferenceColumn(currentCategory)

  if (action === 'remove') {
    await db.query(
      `UPDATE gigs SET ${affectedCol} = NULL WHERE ${affectedCol} = $1 AND tenant_id = $2`,
      [id, tenantId],
    )
    return
  }

  const targetCol = oppositeCategoryReferenceColumn(currentCategory)
  await db.query(
    `UPDATE gigs SET ${targetCol} = ${affectedCol}, ${affectedCol} = NULL
     WHERE ${affectedCol} = $1 AND tenant_id = $2`,
    [id, tenantId],
  )
}

async function applyCategoryChangeWithGigAction(id, tenantId, currentCategory, action, patch) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await applyGigReferenceAction(client, id, tenantId, currentCategory, action)
    const result = await updateVenue(client, patch)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function handleCategoryChange(id, tenantId, body, patch) {
  if (!('category' in body)) return null

  const currentCategory = await getVenueCategory(pool, id, tenantId)
  if (!currentCategory) return notFound()
  if (currentCategory === body.category) return null

  const affectedGigs = await getAffectedGigs(pool, id, tenantId, currentCategory)
  if (!affectedGigs.length) return null

  const action = body.on_affected_gigs ?? null
  if (action === null) {
    return conflict('Category change affects gigs', { affected_gigs: affectedGigs })
  }

  return applyCategoryChangeWithGigAction(id, tenantId, currentCategory, action, patch)
}

async function patchVenue(id, tenantId, body) {
  const bodyError = validatePatchBody(body)
  if (bodyError) return bodyError

  const { patch, result } = buildVenuePatch(body, id, tenantId)
  if (result) return result

  const categoryResult = await handleCategoryChange(id, tenantId, body, patch)
  return categoryResult ?? updateVenue(pool, patch)
}

async function venueInTenant(tenantId, venueId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM venues WHERE id = $1 AND tenant_id = $2',
    [venueId, tenantId],
  )
  return rows.length > 0
}

async function requireVenueInTenant(tenantId, venueId) {
  return await venueInTenant(tenantId, venueId) ? null : notFound()
}

async function getContactInTenant(tenantId, contactId) {
  const { rows } = await pool.query(
    'SELECT id, name, email, phone, category FROM contacts WHERE id = $1 AND tenant_id = $2',
    [contactId, tenantId],
  )
  return rows[0] ?? null
}

async function listVenueContacts(tenantId, venueId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.email, c.phone, c.category, vc.is_primary
       FROM venue_contacts vc
       JOIN contacts c ON c.id = vc.contact_id AND c.tenant_id = vc.tenant_id
      WHERE vc.venue_id = $1 AND vc.tenant_id = $2
      ORDER BY vc.is_primary DESC, c.name ASC`,
    [venueId, tenantId],
  )
  return rows
}

async function linkVenueContact(tenantId, venueId, contactId) {
  const missingVenue = await requireVenueInTenant(tenantId, venueId)
  if (missingVenue) return missingVenue

  const contact = await getContactInTenant(tenantId, contactId)
  if (!contact) return notFound()

  try {
    await pool.query(
      'INSERT INTO venue_contacts (venue_id, contact_id, tenant_id) VALUES ($1, $2, $3)',
      [venueId, contactId, tenantId],
    )
    return { status: 201, body: { ...contact, is_primary: false } }
  } catch (err) {
    if (err.code === '23505') {
      return conflict('Contact is already linked to this venue')
    }
    throw err
  }
}

function validateContactIdParam(req) {
  return parseId(req.params.contactId) ?? badRequest('Invalid contactId')
}

async function lockVenueContactLinks(client, tenantId, venueId) {
  const { rows } = await client.query(
    'SELECT contact_id FROM venue_contacts WHERE venue_id = $1 AND tenant_id = $2 FOR UPDATE',
    [venueId, tenantId],
  )
  return rows
}

function hasContactLink(links, contactId) {
  return links.some((link) => link.contact_id === contactId)
}

async function clearPrimaryVenueContact(client, tenantId, venueId) {
  await client.query(
    'UPDATE venue_contacts SET is_primary = false WHERE venue_id = $1 AND tenant_id = $2 AND is_primary',
    [venueId, tenantId],
  )
}

async function setVenueContactPrimary(client, tenantId, venueId, contactId, isPrimary) {
  const { rows } = await client.query(
    `UPDATE venue_contacts SET is_primary = $3
      WHERE venue_id = $1 AND contact_id = $2 AND tenant_id = $4
      RETURNING contact_id, is_primary`,
    [venueId, contactId, isPrimary, tenantId],
  )
  return rows[0]
}

async function updateVenueContactPrimary(tenantId, venueId, contactId, makePrimary) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const links = await lockVenueContactLinks(client, tenantId, venueId)
    if (!hasContactLink(links, contactId)) {
      await client.query('ROLLBACK')
      return notFound()
    }

    if (makePrimary) {
      await clearPrimaryVenueContact(client, tenantId, venueId)
    }

    const contact = await setVenueContactPrimary(client, tenantId, venueId, contactId, makePrimary)
    await client.query('COMMIT')
    return ok(contact)
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

function validateImportBody(body) {
  if (!Array.isArray(body) || body.length === 0) {
    return badRequest('Expected non-empty array')
  }
  if (body.length > 1000) {
    return badRequest('Maximum 1000 rows per import')
  }
  return null
}

function normalizeImportName(row) {
  return row.name ? String(row.name).trim() : ''
}

function normalizeImportCity(row) {
  return row.city ? String(row.city).trim() : ''
}

function venueImportKey(name, city) {
  return `${name.toLowerCase()} ${city.toLowerCase()}`
}

function collectIncomingNames(rows) {
  return [
    ...new Set(rows.map(normalizeImportName).filter(Boolean).map((name) => name.toLowerCase())),
  ]
}

async function loadExistingImportKeys(client, tenantId, incomingNames) {
  const existingKeys = new Set()
  if (!incomingNames.length) return existingKeys

  const { rows } = await client.query(
    `SELECT lower(name) AS name, lower(coalesce(city, '')) AS city
     FROM venues WHERE tenant_id = $1 AND lower(name) = ANY($2)`,
    [tenantId, incomingNames],
  )

  for (const row of rows) {
    existingKeys.add(venueImportKey(row.name, row.city))
  }
  return existingKeys
}

function normalizeImportRow(row) {
  const name = normalizeImportName(row)
  if (!name) return null

  const city = normalizeImportCity(row)
  return {
    body: { ...row, name, city },
    key: venueImportKey(name, city),
  }
}

async function insertImportRows(client, tenantId, rows, existingKeys) {
  const seenKeys = new Set()
  const summary = { imported: 0, skipped: 0 }

  for (const row of rows) {
    const normalized = normalizeImportRow(row)
    if (!normalized) {
      summary.skipped++
      continue
    }

    if (existingKeys.has(normalized.key) || seenKeys.has(normalized.key)) {
      summary.skipped++
      continue
    }

    await client.query(INSERT_SQL, buildInsertValues(tenantId, normalized.body))
    summary.imported++
    seenKeys.add(normalized.key)
  }

  return summary
}

async function importVenues(tenantId, body) {
  const bodyError = validateImportBody(body)
  if (bodyError) return bodyError

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const incomingNames = collectIncomingNames(body)
    const existingKeys = await loadExistingImportKeys(client, tenantId, incomingNames)
    const summary = await insertImportRows(client, tenantId, body, existingKeys)
    await client.query('COMMIT')
    return ok(summary)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT v.*,
            (SELECT c.name
               FROM venue_contacts vc
               JOIN contacts c ON c.id = vc.contact_id AND c.tenant_id = vc.tenant_id
              WHERE vc.venue_id = v.id AND vc.tenant_id = v.tenant_id AND vc.is_primary
              LIMIT 1) AS primary_contact_name
       FROM venues v
      WHERE v.tenant_id = $1
      ORDER BY v.name ASC`,
    [req.tenantId],
  )
  res.json(rows)
})

router.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (q.length < 3) return res.json([])

  const like = `%${q}%`
  const params = [req.tenantId, like, parseSearchLimit(req.query.limit)]
  const categoryClause = buildCategoryClause(req.query.category, params)
  const { rows } = await pool.query(
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
  res.json(rows)
})

router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rows } = await pool.query(
    'SELECT * FROM venues WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.get('/:id/category-impact', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await getCategoryImpact(id, req.tenantId, req.query.new_category)
  sendResult(res, result)
})

router.post('/', async (req, res) => {
  const result = await createVenue(req.tenantId, req.body)
  sendResult(res, result)
})

router.patch('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await patchVenue(id, req.tenantId, req.body)
  sendResult(res, result)
})

router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rowCount } = await pool.query(
    'DELETE FROM venues WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

// Venue/contact links are informational; venue fields stay canonical for invoices.
router.get('/:id/contacts', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const missingVenue = await requireVenueInTenant(req.tenantId, id)
  if (missingVenue) return sendResult(res, missingVenue)

  const rows = await listVenueContacts(req.tenantId, id)
  res.json(rows)
})

router.post('/:id/contacts', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const contactId = parseId(req.body.contact_id)
  if (contactId === null) return sendResult(res, badRequest('contact_id is required'))

  const result = await linkVenueContact(req.tenantId, id, contactId)
  sendResult(res, result)
})

router.patch('/:id/contacts/:contactId', async (req, res) => {
  const id = requireId(req, res); if (id === null) return

  const contactId = validateContactIdParam(req)
  if (typeof contactId !== 'number') return sendResult(res, contactId)

  if (typeof req.body.is_primary !== 'boolean') {
    return sendResult(res, badRequest('is_primary (boolean) is required'))
  }

  const result = await updateVenueContactPrimary(req.tenantId, id, contactId, req.body.is_primary)
  sendResult(res, result)
})

router.delete('/:id/contacts/:contactId', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const contactId = parseId(req.params.contactId)
  if (contactId === null) return res.status(400).json({ error: 'Invalid contactId' })

  const { rowCount } = await pool.query(
    'DELETE FROM venue_contacts WHERE venue_id = $1 AND contact_id = $2 AND tenant_id = $3',
    [id, contactId, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

router.post('/import', async (req, res) => {
  const result = await importVenues(req.tenantId, req.body)
  sendResult(res, result)
})

export default router
