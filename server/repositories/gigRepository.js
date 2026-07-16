// Data-access helpers and shared SQL fragments for gigs. Each query takes an
// `executor` (a pool or transaction client) so callers control transactions.

export const VENUE_JSON_SELECT = `CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object(
  'id', v.id,
  'name', v.name,
  'category', v.category,
  'organization_name', v.organization_name,
  'street_and_number', v.street_and_number,
  'city', v.city,
  'region', v.region,
  'postal_code', v.postal_code,
  'country', v.country
) END AS venue`

export const FESTIVAL_JSON_SELECT = `CASE WHEN fv.id IS NULL THEN NULL ELSE jsonb_build_object(
  'id', fv.id,
  'name', fv.name,
  'category', fv.category,
  'organization_name', fv.organization_name,
  'street_and_number', fv.street_and_number,
  'city', fv.city,
  'region', fv.region,
  'postal_code', fv.postal_code,
  'country', fv.country
) END AS festival`

export const VENUE_JOIN = `LEFT JOIN venues v ON v.id = g.venue_id AND v.tenant_id = g.tenant_id`
export const FESTIVAL_JOIN = `LEFT JOIN venues fv ON fv.id = g.festival_id AND fv.tenant_id = g.tenant_id`

export const GIG_TAGS_SELECT = `COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id', gt.id, 'name', gt.name) ORDER BY lower(gt.name), gt.id)
    FROM gig_tag_links gtl
    JOIN gig_tags gt ON gt.id = gtl.tag_id AND gt.tenant_id = gtl.tenant_id
   WHERE gtl.gig_id = g.id AND gtl.tenant_id = g.tenant_id
), '[]'::jsonb) AS tags`

export const GIG_LIST_PROJECTION = `g.*,
  (
    SELECT COUNT(*)::int
      FROM gig_tasks t
     WHERE t.gig_id = g.id
       AND t.tenant_id = g.tenant_id
       AND t.done = FALSE
  ) AS open_task_count,
  ${VENUE_JSON_SELECT},
  ${FESTIVAL_JSON_SELECT},
  ${GIG_TAGS_SELECT}`

// Throws a 400 Error when venueId is set but does not reference a row of the
// expected category in the tenant. A null/undefined id is a no-op.
export async function assertVenueInTenant(executor, venueId, tenantId, expectedCategory = null) {
  if (venueId === null || venueId === undefined) return
  let sql = 'SELECT 1 FROM venues WHERE id = $1 AND tenant_id = $2'
  const params = [venueId, tenantId]
  if (expectedCategory) {
    sql += ' AND category = $3'
    params.push(expectedCategory)
  }
  const { rowCount } = await executor.query(sql, params)
  if (!rowCount) {
    const fieldName = expectedCategory === 'festival' ? 'festival_id' : 'venue_id'
    const err = new Error(`Invalid ${fieldName}`)
    err.status = 400
    throw err
  }
}

export async function gigExistsInTenant(executor, gigId, tenantId) {
  const { rowCount } = await executor.query(
    'SELECT 1 FROM gigs WHERE id = $1 AND tenant_id = $2',
    [gigId, tenantId],
  )
  return rowCount > 0
}

// Recorded merch sales linked to a gig, grouped by VAT rate so the service can
// derive net (Excl. VAT) per rate. Gross uses the exact line total when present
// (Shopify imports), else quantity × unit price. Voided sales are excluded.
export async function summarizeGigMerchSalesByVatRate(executor, tenantId, gigId) {
  const { rows } = await executor.query(
    `SELECT s.vat_rate,
            SUM(s.quantity)::int AS qty,
            SUM(COALESCE(s.gross_incl_cents, s.quantity * s.unit_price_incl_cents))::int AS gross_cents
       FROM merch_sales s
      WHERE s.tenant_id = $1 AND s.gig_id = $2 AND s.status = 'recorded'
      GROUP BY s.vat_rate`,
    [tenantId, gigId],
  )
  return rows
}

export async function loadParticipants(executor, gigIds, tenantId) {
  if (!gigIds.length) return new Map()
  const { rows } = await executor.query(
    `SELECT gp.gig_id, gp.band_member_id, gp.vote,
            bm.name, bm.color, bm.position
     FROM gig_participants gp
     JOIN band_members bm ON bm.id = gp.band_member_id AND bm.tenant_id = $2
     WHERE gp.gig_id = ANY($1) AND gp.tenant_id = $2
     ORDER BY bm.sort_order ASC, bm.id ASC`,
    [gigIds, tenantId],
  )
  const byGig = new Map()
  for (const id of gigIds) byGig.set(id, [])
  for (const row of rows) {
    byGig.get(row.gig_id).push({
      band_member_id: row.band_member_id,
      name: row.name,
      color: row.color,
      position: row.position,
      vote: row.vote,
    })
  }
  return byGig
}

// Lists all gigs with their open-task counts and joined venue/festival data.
export async function listGigsWithTaskCounts(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT
       ${GIG_LIST_PROJECTION}
     FROM gigs g
     ${VENUE_JOIN}
     ${FESTIVAL_JOIN}
     WHERE g.tenant_id = $1
     ORDER BY g.event_date ASC`,
    [tenantId],
  )
  return rows
}

export async function listUpcomingGigs(executor, tenantId, today, limit) {
  const { rows } = await executor.query(
    `SELECT
       ${GIG_LIST_PROJECTION},
       (COUNT(*) OVER ())::int AS collection_total
     FROM gigs g
     ${VENUE_JOIN}
     ${FESTIVAL_JOIN}
     WHERE g.tenant_id = $1 AND g.event_date >= $2
     ORDER BY g.event_date ASC, g.id ASC
     LIMIT $3`,
    [tenantId, today, limit],
  )
  return {
    items: rows.map(({ collection_total: _collectionTotal, ...gig }) => gig),
    total: rows[0]?.collection_total ?? 0,
  }
}

// Past gigs, most recent first. Optional keyset cursor continues past the
// last (event_date, id) pair of a previous page for "load more" pagination.
export async function listPastGigs(executor, tenantId, today, limit, cursor = null) {
  const params = [tenantId, today]
  let cursorClause = ''
  if (cursor) {
    params.push(cursor.date, cursor.id)
    cursorClause = `AND (g.event_date, g.id) < ($${params.length - 1}, $${params.length})`
  }
  params.push(limit)
  const { rows } = await executor.query(
    `SELECT
       ${GIG_LIST_PROJECTION}
     FROM gigs g
     ${VENUE_JOIN}
     ${FESTIVAL_JOIN}
     WHERE g.tenant_id = $1 AND g.event_date < $2 ${cursorClause}
     ORDER BY g.event_date DESC, g.id DESC
     LIMIT $${params.length}`,
    params,
  )
  return rows
}

export async function listGigsInRange(executor, tenantId, from, to) {
  const { rows } = await executor.query(
    `SELECT
       ${GIG_LIST_PROJECTION}
     FROM gigs g
     ${VENUE_JOIN}
     ${FESTIVAL_JOIN}
     WHERE g.tenant_id = $1 AND g.event_date BETWEEN $2 AND $3
     ORDER BY g.event_date ASC, g.id ASC`,
    [tenantId, from, to],
  )
  return rows
}

// Minimal projection used by the gig map. It intentionally omits gig detail,
// task, tag, participant, and availability data.
export async function listGigMapData(executor, tenantId, from, to) {
  const placeJson = (alias) => `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', ${alias}.id,
    'city', ${alias}.city,
    'region', ${alias}.region,
    'country', ${alias}.country,
    'latitude', ${alias}.latitude,
    'longitude', ${alias}.longitude
  ) END`
  const { rows } = await executor.query(
    `SELECT g.id, g.event_date, g.event_description,
            ${placeJson('v')} AS venue,
            ${placeJson('fv')} AS festival
       FROM gigs g
       ${VENUE_JOIN}
       ${FESTIVAL_JOIN}
      WHERE g.tenant_id = $1
        AND g.event_date BETWEEN $2 AND $3
      ORDER BY g.event_date ASC, g.id ASC`,
    [tenantId, from, to],
  )
  return rows
}

// Full-text-ish search over a tenant's gigs: matches the event name, linked
// venue/festival name or city, or a tag. Exact name matches on the event sort
// first, then by most recent date. Tenant-scoped like every other query.
export async function searchGigs(executor, tenantId, { like, limit }) {
  const { rows } = await executor.query(
    `SELECT
       g.id, g.event_date, g.event_description, g.status, g.booking_fee_cents,
       g.venue_id, g.festival_id,
       ${VENUE_JSON_SELECT},
       ${FESTIVAL_JSON_SELECT},
       ${GIG_TAGS_SELECT}
     FROM gigs g
     ${VENUE_JOIN}
     ${FESTIVAL_JOIN}
     WHERE g.tenant_id = $1
       AND (
         g.event_description ILIKE $2
         OR v.name ILIKE $2
         OR v.city ILIKE $2
         OR fv.name ILIKE $2
         OR fv.city ILIKE $2
         OR EXISTS (
           SELECT 1
             FROM gig_tag_links search_link
             JOIN gig_tags search_tag
               ON search_tag.id = search_link.tag_id
              AND search_tag.tenant_id = search_link.tenant_id
            WHERE search_link.gig_id = g.id
              AND search_link.tenant_id = g.tenant_id
              AND search_tag.name ILIKE $2
          )
       )
     ORDER BY
       CASE WHEN g.event_description ILIKE $2 THEN 0 ELSE 1 END,
       g.event_date DESC
     LIMIT $3`,
    [tenantId, like, limit],
  )
  return rows
}

// Pipeline of gross band fees for upcoming gigs (event_date >= today) in the
// active statuses, grouped by status. Only gigs with a fee set contribute, so
// the per-status count and total stay consistent. Pinned to "today" like the
// VAT/bank figures — independent of the selected dashboard period.
export async function upcomingBandFeesByStatus(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT status,
            COUNT(*)::int AS gig_count,
            COALESCE(SUM(booking_fee_cents), 0)::int AS total_cents
       FROM gigs
      WHERE tenant_id = $1
        AND event_date >= CURRENT_DATE
        AND status IN ('option', 'confirmed', 'announced')
        AND booking_fee_cents IS NOT NULL
      GROUP BY status`,
    [tenantId],
  )
  return rows
}

export async function listBandMembers(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM band_members WHERE tenant_id = $1 ORDER BY sort_order ASC, id ASC',
    [tenantId],
  )
  return rows
}

// Slots whose [start_date, end_date] range overlaps the [minDate, maxDate] window.
export async function listAvailabilitySlotsOverlapping(executor, tenantId, minDate, maxDate) {
  const { rows } = await executor.query(
    `SELECT * FROM availability_slots
     WHERE tenant_id = $1 AND start_date <= $2 AND end_date >= $3
     ORDER BY created_at ASC`,
    [tenantId, maxDate, minDate],
  )
  return rows
}

export async function listGigTasks(executor, gigId, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM gig_tasks WHERE gig_id = $1 AND tenant_id = $2 ORDER BY created_at ASC',
    [gigId, tenantId],
  )
  return rows
}

export async function listGigAttachments(executor, gigId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, object_key, original_filename, content_type, file_size, uploaded_at
     FROM gig_attachments WHERE gig_id = $1 AND tenant_id = $2 ORDER BY uploaded_at ASC`,
    [gigId, tenantId],
  )
  return rows
}

export async function getLeadMemberIds(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT id FROM band_members WHERE tenant_id = $1 AND position = 'lead'`,
    [tenantId],
  )
  return rows.map((r) => r.id)
}

export async function getGigDescription(executor, gigId, tenantId) {
  const { rows } = await executor.query(
    'SELECT event_description FROM gigs WHERE id = $1 AND tenant_id = $2',
    [gigId, tenantId],
  )
  return rows[0]?.event_description ?? null
}

// Inserts a normalized import row (see normalizeImportRow). Returns the new id.
export async function insertGigForImport(executor, tenantId, row) {
  const { rows } = await executor.query(
    `INSERT INTO gigs (tenant_id, event_date, event_description, venue_id, festival_id,
       start_time, end_time, status, admission, event_link, ticket_link)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [
      tenantId, row.event_date, row.event_description, row.venueId, row.festivalId,
      row.start_time, row.end_time, row.status, row.admission,
      row.event_link, row.ticket_link,
    ],
  )
  return rows[0].id
}

// Inserts a gig and returns it with joined venue/festival data.
export async function insertGigWithRelations(executor, tenantId, data) {
  const { rows } = await executor.query(
    `WITH inserted AS (
       INSERT INTO gigs (tenant_id, event_date, event_description, venue_id, festival_id, start_time, end_time, status,
                         has_pa_system, has_drumkit, has_stage_lights)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *
     )
     SELECT g.*, ${VENUE_JSON_SELECT}, ${FESTIVAL_JSON_SELECT}, ${GIG_TAGS_SELECT}
       FROM inserted g
       ${VENUE_JOIN}
       ${FESTIVAL_JOIN}`,
    [
      tenantId,
      data.event_date, data.event_description, data.venueId, data.festivalId,
      data.start_time, data.end_time, data.status,
      data.has_pa_system, data.has_drumkit, data.has_stage_lights,
    ],
  )
  return rows[0]
}

export async function insertGigParticipant(executor, tenantId, gigId, memberId, userId) {
  await executor.query(
    `INSERT INTO gig_participants (tenant_id, gig_id, band_member_id, updated_by_user_id)
     VALUES ($1, $2, $3, $4)`,
    [tenantId, gigId, memberId, userId],
  )
}

export async function deleteGigParticipant(executor, gigId, memberId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM gig_participants WHERE gig_id = $1 AND band_member_id = $2 AND tenant_id = $3',
    [gigId, memberId, tenantId],
  )
  return rowCount > 0
}

// Returns the updated participant row, or null when no matching row exists.
export async function updateParticipantVote(executor, tenantId, gigId, memberId, vote, userId) {
  const { rows } = await executor.query(
    `UPDATE gig_participants
     SET vote = $1, updated_by_user_id = $2, updated_at = NOW()
     WHERE gig_id = $3 AND band_member_id = $4 AND tenant_id = $5
     RETURNING *`,
    [vote, userId, gigId, memberId, tenantId],
  )
  return rows[0] || null
}

// Locks the parent option before a response mutation. Every vote takes this
// lock, making the first-unavailable claim and incomplete -> complete check
// deterministic even when members respond concurrently.
export async function lockGigOptionResponseState(executor, gigId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, status, first_unavailable_notification_at
     FROM gigs
     WHERE id = $1 AND tenant_id = $2
     FOR UPDATE`,
    [gigId, tenantId],
  )
  return rows[0] || null
}

export async function getGigParticipantResponseState(executor, gigId, memberId, tenantId) {
  const { rows } = await executor.query(
    `SELECT target.id AS participant_id, target.vote AS previous_vote,
            counts.total, counts.pending
     FROM gig_participants target
     CROSS JOIN LATERAL (
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE vote IS NULL)::int AS pending
       FROM gig_participants
       WHERE gig_id = $1 AND tenant_id = $3
     ) counts
     WHERE target.gig_id = $1 AND target.band_member_id = $2 AND target.tenant_id = $3`,
    [gigId, memberId, tenantId],
  )
  return rows[0] || null
}

export async function markGigFirstUnavailableNotified(executor, gigId, tenantId) {
  await executor.query(
    `UPDATE gigs SET first_unavailable_notification_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND first_unavailable_notification_at IS NULL`,
    [gigId, tenantId],
  )
}

export async function touchGig(executor, gigId, tenantId) {
  await executor.query(
    'UPDATE gigs SET updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
    [gigId, tenantId],
  )
}

export async function deleteGig(executor, gigId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM gigs WHERE id = $1 AND tenant_id = $2',
    [gigId, tenantId],
  )
  return rowCount > 0
}

// ---------- tags ----------

export async function searchGigTags(executor, tenantId, like) {
  const params = [tenantId]
  let nameFilter = ''
  if (like) {
    params.push(like)
    nameFilter = 'AND name ILIKE $2'
  }
  const { rows } = await executor.query(
    `SELECT id, name FROM gig_tags
      WHERE tenant_id = $1 ${nameFilter}
      ORDER BY lower(name), id
      LIMIT 100`,
    params,
  )
  return rows
}

export async function loadGigTags(executor, gigId, tenantId) {
  const { rows } = await executor.query(
    `SELECT gt.id, gt.name
       FROM gig_tag_links gtl
       JOIN gig_tags gt ON gt.id = gtl.tag_id AND gt.tenant_id = gtl.tenant_id
      WHERE gtl.gig_id = $1 AND gtl.tenant_id = $2
      ORDER BY lower(gt.name), gt.id`,
    [gigId, tenantId],
  )
  return rows
}

export async function upsertGigTag(executor, tenantId, name) {
  const { rows } = await executor.query(
    `INSERT INTO gig_tags (tenant_id, name) VALUES ($1, $2)
     ON CONFLICT (tenant_id, lower(name)) DO UPDATE SET name = gig_tags.name
     RETURNING id`,
    [tenantId, name],
  )
  return rows[0].id
}

export async function deleteGigTagLinks(executor, gigId, tenantId) {
  await executor.query(
    'DELETE FROM gig_tag_links WHERE gig_id = $1 AND tenant_id = $2',
    [gigId, tenantId],
  )
}

export async function insertGigTagLink(executor, gigId, tagId, tenantId) {
  await executor.query(
    'INSERT INTO gig_tag_links (gig_id, tag_id, tenant_id) VALUES ($1, $2, $3)',
    [gigId, tagId, tenantId],
  )
}

// Returns { banner_path } for the gig, or null when the gig does not exist
// in the tenant (a gig with no banner still returns a row).
export async function getGigBannerRow(executor, gigId, tenantId) {
  const { rows } = await executor.query(
    'SELECT banner_path FROM gigs WHERE id = $1 AND tenant_id = $2',
    [gigId, tenantId],
  )
  return rows[0] ?? null
}

export async function setGigBannerPath(executor, gigId, tenantId, objectKey) {
  const { rows } = await executor.query(
    `UPDATE gigs SET banner_path = $1, updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3 RETURNING banner_path`,
    [objectKey, gigId, tenantId],
  )
  return rows[0].banner_path
}

export async function clearGigBannerPath(executor, gigId, tenantId) {
  await executor.query(
    'UPDATE gigs SET banner_path = NULL, updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
    [gigId, tenantId],
  )
}

export async function getBandMemberIdForUser(executor, userId, tenantId) {
  const { rows } = await executor.query(
    'SELECT id FROM band_members WHERE user_id = $1 AND tenant_id = $2',
    [userId, tenantId],
  )
  return rows[0]?.id ?? null
}

export async function insertGigAttachment(executor, tenantId, gigId, file, objectKey) {
  const { rows } = await executor.query(
    `INSERT INTO gig_attachments (gig_id, tenant_id, object_key, original_filename, content_type, file_size)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, object_key, original_filename, content_type, file_size, uploaded_at`,
    [gigId, tenantId, objectKey, file.originalname, file.mimetype, file.size],
  )
  return rows[0]
}

// Returns the deleted attachment's object_key, or null when no matching row exists.
export async function deleteGigAttachment(executor, attachmentId, gigId, tenantId) {
  const { rows } = await executor.query(
    'DELETE FROM gig_attachments WHERE id = $1 AND gig_id = $2 AND tenant_id = $3 RETURNING object_key',
    [attachmentId, gigId, tenantId],
  )
  return rows[0]?.object_key ?? null
}

// ---------- gig contacts ----------

export async function getContactInTenant(executor, contactId, tenantId) {
  const { rows } = await executor.query(
    'SELECT id, name, email, phone, category FROM contacts WHERE id = $1 AND tenant_id = $2',
    [contactId, tenantId],
  )
  return rows[0] ?? null
}

export async function listGigContacts(executor, gigId, tenantId) {
  const { rows } = await executor.query(
    `SELECT c.id, c.name, c.email, c.phone, c.category, gc.is_primary
       FROM gig_contacts gc
       JOIN contacts c ON c.id = gc.contact_id AND c.tenant_id = gc.tenant_id
      WHERE gc.gig_id = $1 AND gc.tenant_id = $2
      ORDER BY gc.is_primary DESC, c.name ASC`,
    [gigId, tenantId],
  )
  return rows
}

export async function insertGigContact(executor, gigId, contactId, tenantId) {
  await executor.query(
    'INSERT INTO gig_contacts (gig_id, contact_id, tenant_id) VALUES ($1, $2, $3)',
    [gigId, contactId, tenantId],
  )
}

// Locks the gig's contact links for update; returns the linked contact_ids.
export async function lockGigContacts(executor, gigId, tenantId) {
  const { rows } = await executor.query(
    'SELECT contact_id FROM gig_contacts WHERE gig_id = $1 AND tenant_id = $2 FOR UPDATE',
    [gigId, tenantId],
  )
  return rows.map((r) => r.contact_id)
}

export async function clearPrimaryGigContact(executor, gigId, tenantId) {
  await executor.query(
    'UPDATE gig_contacts SET is_primary = false WHERE gig_id = $1 AND tenant_id = $2 AND is_primary',
    [gigId, tenantId],
  )
}

export async function setGigContactPrimary(executor, gigId, contactId, isPrimary, tenantId) {
  const { rows } = await executor.query(
    `UPDATE gig_contacts SET is_primary = $3
      WHERE gig_id = $1 AND contact_id = $2 AND tenant_id = $4
      RETURNING contact_id, is_primary`,
    [gigId, contactId, isPrimary, tenantId],
  )
  return rows[0]
}

export async function deleteGigContact(executor, gigId, contactId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM gig_contacts WHERE gig_id = $1 AND contact_id = $2 AND tenant_id = $3',
    [gigId, contactId, tenantId],
  )
  return rowCount > 0
}

export async function fetchGigWithRelations(executor, gigId, tenantId) {
  const { rows } = await executor.query(
    `SELECT g.*, ${VENUE_JSON_SELECT}, ${FESTIVAL_JSON_SELECT}, ${GIG_TAGS_SELECT}
       FROM gigs g
       ${VENUE_JOIN}
       ${FESTIVAL_JOIN}
      WHERE g.id = $1 AND g.tenant_id = $2`,
    [gigId, tenantId],
  )
  return rows[0] || null
}

// Applies prebuilt SET fragments (placeholders $1..$N) to a gig, appending
// updated_at and the WHERE bindings. Returns the updated gig with relations, or
// null when no matching row exists.
export async function updateGigFields(executor, tenantId, gigId, fields, values) {
  const assignments = [...fields, 'updated_at = NOW()']
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `WITH updated AS (
       UPDATE gigs SET ${assignments.join(', ')}
       WHERE id = $${whereIdx} AND tenant_id = $${whereIdx + 1}
       RETURNING *
     )
     SELECT g.*, ${VENUE_JSON_SELECT}, ${FESTIVAL_JSON_SELECT}, ${GIG_TAGS_SELECT}
       FROM updated g
       ${VENUE_JOIN}
       ${FESTIVAL_JOIN}`,
    [...values, gigId, tenantId],
  )
  return rows[0] || null
}

