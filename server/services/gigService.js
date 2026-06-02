// Gig domain logic. Route handlers stay thin and delegate here. Functions that
// can fail with a specific HTTP outcome return { error: { status, body } };
// success returns a domain payload (see each function).
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { storageClient, BUCKET } from '../utils/storage.js'
import { validateAndReencodeImage, extensionForImageMime } from '../utils/imageProcess.js'
import { verifyDocumentContent } from '../utils/verifyFileContent.js'
import { sendPushToTenant, sendPushToMember } from '../utils/sendPush.js'
import {
  parseId,
  toDateStr,
  venueDisplay,
  normalizeGigVenueRefs,
  buildGigUpdateFields,
  buildGigTaskUpdateFields,
} from '../validators/gigValidators.js'
import {
  assertVenueInTenant,
  memberExistsInTenant,
  updateGigFields,
  updateGigTaskFields,
} from '../repositories/gigRepository.js'

// ---------- notifications ----------

function gigPushSummary(gig) {
  return [venueDisplay(gig.festival ?? gig.venue), toDateStr(gig.event_date)].filter(Boolean).join(' · ')
}

export function notifyGigCreated(tenantId, gig) {
  sendPushToTenant(tenantId, {
    title: 'New gig option',
    body: gigPushSummary(gig),
    tag: 'gig-new',
    url: '/gigs',
  }).catch((err) => console.error('[push] sendPushToTenant failed', err))
}

export function notifyGigConfirmed(tenantId, gig) {
  sendPushToTenant(tenantId, {
    title: 'Gig confirmed!',
    body: gigPushSummary(gig),
    tag: 'gig-confirmed',
    url: '/gigs',
  }).catch((err) => console.error('[push] sendPushToTenant failed', err))
}

export function notifyGigsImported(tenantId, count) {
  sendPushToTenant(tenantId, {
    title: `${count} gig${count !== 1 ? 's' : ''} imported`,
    body: 'Your Bandsintown import is complete.',
    tag: 'gig-import',
    url: '/gigs',
  }).catch((err) => console.error('[push] sendPushToTenant failed', err))
}

async function notifyTaskAssignment(db, tenantId, gigId, task) {
  const { rows: gigs } = await db.query(
    'SELECT event_description FROM gigs WHERE id = $1 AND tenant_id = $2',
    [gigId, tenantId],
  )
  const suffix = gigs[0]?.event_description ? ` (${gigs[0].event_description})` : ''
  sendPushToMember(task.assigned_to, tenantId, {
    title: 'Task assigned to you',
    body: `${task.title}${suffix}`,
    url: '/tasks',
  }).catch((err) => console.error('[push] task assignment notify failed', err))
}

// ---------- venue/festival validation ----------

// Validates venue_id/festival_id (when present in body) belong to the tenant and
// match the expected category. Returns { error, status } or {}.
export async function validateVenueAndFestivalForTenant(db, body, tenantId) {
  try {
    if ('venue_id' in body) await assertVenueInTenant(db, body.venue_id, tenantId, 'venue')
    if ('festival_id' in body) await assertVenueInTenant(db, body.festival_id, tenantId, 'festival')
    return {}
  } catch (err) {
    if (err.status === 400) return { error: err.message, status: 400 }
    throw err
  }
}

// ---------- gig patch ----------

// Validates and applies a gig PATCH. Returns { error } or { gig }. The caller is
// responsible for firing the confirmed-status notification.
export async function patchGig(db, tenantId, gigId, body) {
  const refs = normalizeGigVenueRefs(body)
  if (refs.error) return { error: { status: 400, body: { error: refs.error } } }
  const normalizedBody = refs.body

  const venueCheck = await validateVenueAndFestivalForTenant(db, normalizedBody, tenantId)
  if (venueCheck.error) return { error: { status: venueCheck.status, body: { error: venueCheck.error } } }

  const built = buildGigUpdateFields(normalizedBody)
  if (built.error) return { error: { status: 400, body: { error: built.error } } }
  if (!built.fields.length) return { error: { status: 400, body: { error: 'No valid fields to update' } } }

  const gig = await updateGigFields(db, tenantId, gigId, built.fields, built.values)
  if (!gig) return { error: { status: 404, body: { error: 'Not found' } } }
  return { gig }
}

// ---------- task patch ----------

// Validates assigned_to (when present) and returns a normalized copy of body
// with it parsed to an integer, leaving the input untouched. A null/absent
// assigned_to passes through unchanged (null clears the assignee). Returns
// { error } | { body: normalizedBody }.
async function resolveTaskAssignee(db, tenantId, body) {
  if (!('assigned_to' in body) || body.assigned_to === null) return { body }
  const assignedTo = parseId(body.assigned_to)
  if (assignedTo === null) return { error: { status: 400, body: { error: 'Invalid assigned_to' } } }
  if (!(await memberExistsInTenant(db, assignedTo, tenantId))) {
    return { error: { status: 404, body: { error: 'assigned_to not found' } } }
  }
  return { body: { ...body, assigned_to: assignedTo } }
}

// Validates and applies a gig-task PATCH. Returns { error } or { task }. Fires
// the assignment push notification as a side effect when assigned_to is set.
export async function patchGigTask(db, tenantId, gigId, taskId, body) {
  const assignee = await resolveTaskAssignee(db, tenantId, body)
  if (assignee.error) return assignee
  const normalizedBody = assignee.body

  const built = buildGigTaskUpdateFields(normalizedBody)
  if (!built.fields.length) return { error: { status: 400, body: { error: 'No valid fields to update' } } }

  const task = await updateGigTaskFields(db, tenantId, gigId, taskId, built.fields, built.values)
  if (!task) return { error: { status: 404, body: { error: 'Not found' } } }

  if (normalizedBody.assigned_to) {
    await notifyTaskAssignment(db, tenantId, gigId, task)
  }
  return { task }
}

// ---------- banner ----------

// Replaces a gig banner: stores the new object, points the row at it, and
// removes the old object on success (or the new object on DB failure).
export async function replaceGigBanner({ db, tenantId, gigId, file }) {
  const image = await validateAndReencodeImage(file.buffer, file.mimetype)

  const { rows: before } = await db.query(
    'SELECT banner_path FROM gigs WHERE id = $1 AND tenant_id = $2',
    [gigId, tenantId],
  )
  if (!before.length) return { error: { status: 404, body: { error: 'Not found' } } }
  const oldKey = before[0].banner_path

  const ext = extensionForImageMime(image.mimetype)
  const objectKey = `tenants/${tenantId}/gig-banners/${randomUUID()}${ext}`

  await storageClient.putObject(BUCKET, objectKey, image.buffer, image.size, {
    'Content-Type': image.mimetype,
  })

  let updatedKey
  try {
    const { rows } = await db.query(
      `UPDATE gigs SET banner_path = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3 RETURNING banner_path`,
      [objectKey, gigId, tenantId],
    )
    updatedKey = rows[0].banner_path
  } catch (err) {
    storageClient.removeObject(BUCKET, objectKey).catch(() => {})
    throw err
  }

  if (oldKey) {
    storageClient.removeObject(BUCKET, oldKey).catch((e) =>
      console.warn('Failed to delete old gig banner object:', e.message),
    )
  }

  return { bannerPath: updatedKey }
}

export async function deleteGigBanner({ db, tenantId, gigId }) {
  const { rows } = await db.query(
    'SELECT banner_path FROM gigs WHERE id = $1 AND tenant_id = $2',
    [gigId, tenantId],
  )
  if (!rows.length) return { error: { status: 404, body: { error: 'Not found' } } }

  const key = rows[0].banner_path
  await db.query(
    'UPDATE gigs SET banner_path = NULL, updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
    [gigId, tenantId],
  )

  if (key) {
    storageClient.removeObject(BUCKET, key).catch((e) =>
      console.warn('Failed to delete gig banner object:', e.message),
    )
  }
  return {}
}

// ---------- attachments ----------

// Verifies file content matches its declared MIME type (OWASP A06), stores the
// object, and records it. Removes the object if the DB insert fails.
export async function createGigAttachment({ db, tenantId, gigId, file }) {
  const { rows } = await db.query(
    'SELECT id FROM gigs WHERE id = $1 AND tenant_id = $2',
    [gigId, tenantId],
  )
  if (!rows.length) return { error: { status: 404, body: { error: 'Not found' } } }

  if (!verifyDocumentContent(file.buffer, file.mimetype)) {
    return { error: { status: 400, body: { error: 'File content does not match declared type' } } }
  }

  const ext = path.extname(file.originalname).toLowerCase()
  const objectKey = `tenants/${tenantId}/gig_attachments/${randomUUID()}${ext}`

  await storageClient.putObject(BUCKET, objectKey, file.buffer, file.size, {
    'Content-Type': file.mimetype,
  })

  try {
    const { rows: inserted } = await db.query(
      `INSERT INTO gig_attachments (gig_id, tenant_id, object_key, original_filename, content_type, file_size)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, object_key, original_filename, content_type, file_size, uploaded_at`,
      [gigId, tenantId, objectKey, file.originalname, file.mimetype, file.size],
    )
    return { attachment: inserted[0] }
  } catch (err) {
    storageClient.removeObject(BUCKET, objectKey).catch(() => {})
    throw err
  }
}
